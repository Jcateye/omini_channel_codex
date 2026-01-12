import crypto from 'node:crypto';
import { prisma, Prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
const embeddingDimensions = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
};
const knowledgeQueue = createQueue(QUEUE_NAMES.knowledgeSync);
const getOpenAIEmbeddingSettings = () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return null;
    }
    const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
    return {
        apiKey,
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
        model,
        dimension: embeddingDimensions[model] ?? 1536,
    };
};
const requestOpenAIEmbeddings = async (input) => {
    const response = await fetch(`${input.settings.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${input.settings.apiKey}`,
        },
        body: JSON.stringify({
            model: input.settings.model,
            input: input.texts,
        }),
    });
    const payloadText = await response.text();
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (!response.ok) {
        const message = payload?.error?.message ||
            payloadText ||
            `OpenAI error (${response.status})`;
        throw new Error(message);
    }
    const data = Array.isArray(payload.data) ? payload.data : [];
    const embeddings = data.map((item) => item?.embedding).filter(Array.isArray);
    if (embeddings.length !== input.texts.length) {
        throw new Error('OpenAI embeddings mismatch');
    }
    return embeddings;
};
const getQdrantSettings = () => {
    const url = process.env.QDRANT_URL?.trim();
    if (!url) {
        return null;
    }
    return {
        url,
        apiKey: process.env.QDRANT_API_KEY?.trim() || '',
        collection: process.env.QDRANT_COLLECTION?.trim() || 'omini_knowledge',
    };
};
const qdrantFetch = async (settings, path, options) => {
    const response = await fetch(`${settings.url}${path}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            ...(settings.apiKey ? { 'api-key': settings.apiKey } : {}),
            ...(options?.headers ?? {}),
        },
    });
    const payloadText = await response.text();
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (!response.ok) {
        const message = payload?.status?.error ||
            payloadText ||
            `Qdrant error (${response.status})`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return payload;
};
const ensureQdrantCollection = async (settings, dimension) => {
    try {
        await qdrantFetch(settings, `/collections/${settings.collection}`);
    }
    catch (error) {
        const status = error.status;
        if (status !== 404) {
            throw error;
        }
        await qdrantFetch(settings, `/collections/${settings.collection}`, {
            method: 'PUT',
            body: JSON.stringify({
                vectors: {
                    size: dimension,
                    distance: 'Cosine',
                },
            }),
        });
    }
};
const deleteQdrantBySource = async (input) => {
    const filter = {
        must: [
            { key: 'organizationId', match: { value: input.organizationId } },
            { key: 'sourceId', match: { value: input.sourceId } },
        ],
    };
    await qdrantFetch(input.settings, `/collections/${input.settings.collection}/points/delete?wait=true`, {
        method: 'POST',
        body: JSON.stringify({ filter }),
    });
};
const upsertQdrantPoints = async (input) => {
    if (input.points.length === 0) {
        return;
    }
    await qdrantFetch(input.settings, `/collections/${input.settings.collection}/points?wait=true`, {
        method: 'PUT',
        body: JSON.stringify({ points: input.points }),
    });
};
const splitContentIntoChunks = (content, maxLength = 600) => {
    const blocks = content
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0);
    const chunks = [];
    for (const block of blocks) {
        if (block.length <= maxLength) {
            chunks.push(block);
            continue;
        }
        let cursor = 0;
        while (cursor < block.length) {
            chunks.push(block.slice(cursor, cursor + maxLength));
            cursor += maxLength;
        }
    }
    return chunks;
};
const stripHtml = (html) => html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const extractTitle = (html) => {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
};
const extractLinks = (html) => {
    const links = [];
    const regex = /href\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html))) {
        links.push(match[1]);
    }
    return links;
};
const crawlWebSource = async (config) => {
    const seedUrl = typeof config.url === 'string' ? config.url : '';
    const seedUrls = Array.isArray(config.urls)
        ? config.urls.filter((url) => typeof url === 'string')
        : seedUrl
            ? [seedUrl]
            : [];
    if (seedUrls.length === 0) {
        throw new Error('web_source_missing_url');
    }
    const crawlDepth = typeof config.crawlDepth === 'number' && config.crawlDepth >= 0
        ? Math.floor(config.crawlDepth)
        : 0;
    const maxPages = typeof config.maxPages === 'number' && config.maxPages > 0
        ? Math.floor(config.maxPages)
        : 5;
    const sameOrigin = config.sameOrigin !== false;
    const userAgent = typeof config.userAgent === 'string' ? config.userAgent : 'OminiBot/1.0';
    const visited = new Set();
    const queue = seedUrls.map((url) => ({
        url,
        depth: 0,
    }));
    const documents = [];
    while (queue.length > 0 && documents.length < maxPages) {
        const current = queue.shift();
        if (!current)
            continue;
        try {
            const parsedUrl = new URL(current.url);
            parsedUrl.hash = '';
            const normalized = parsedUrl.toString();
            if (visited.has(normalized)) {
                continue;
            }
            visited.add(normalized);
            const response = await fetch(normalized, {
                headers: { 'user-agent': userAgent },
            });
            if (!response.ok) {
                continue;
            }
            const contentType = response.headers.get('content-type') ?? '';
            const body = await response.text();
            const text = contentType.includes('text/html') || contentType.includes('text/plain')
                ? stripHtml(body)
                : '';
            if (text) {
                documents.push({
                    content: text,
                    metadata: {
                        url: normalized,
                        title: extractTitle(body),
                    },
                });
            }
            if (current.depth >= crawlDepth) {
                continue;
            }
            const origin = parsedUrl.origin;
            for (const link of extractLinks(body)) {
                if (link.startsWith('#') || link.startsWith('mailto:') || link.startsWith('tel:')) {
                    continue;
                }
                try {
                    const resolved = new URL(link, parsedUrl);
                    resolved.hash = '';
                    if (sameOrigin && resolved.origin !== origin) {
                        continue;
                    }
                    queue.push({ url: resolved.toString(), depth: current.depth + 1 });
                }
                catch {
                    continue;
                }
            }
        }
        catch (error) {
            console.warn('Web crawl failed', error);
        }
    }
    return documents;
};
const notionFetch = async (token, path) => {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
        headers: {
            authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'content-type': 'application/json',
        },
    });
    const payloadText = await response.text();
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (!response.ok) {
        const message = payload?.message ||
            payloadText ||
            `Notion error (${response.status})`;
        throw new Error(message);
    }
    return payload;
};
const extractNotionText = (block) => {
    const type = typeof block.type === 'string' ? block.type : null;
    if (!type)
        return '';
    const data = block[type];
    if (!data)
        return '';
    const rich = Array.isArray(data.rich_text) ? data.rich_text : [];
    return rich
        .map((item) => (typeof item?.plain_text === 'string' ? item.plain_text : ''))
        .filter((text) => text.length > 0)
        .join('');
};
const collectNotionBlocks = async (token, blockId, depth, maxDepth, lines) => {
    let cursor = null;
    do {
        const query = cursor ? `?start_cursor=${cursor}` : '';
        const payload = await notionFetch(token, `/blocks/${blockId}/children${query}`);
        const results = Array.isArray(payload.results) ? payload.results : [];
        for (const item of results) {
            if (!item || typeof item !== 'object')
                continue;
            const block = item;
            const text = extractNotionText(block);
            if (text) {
                lines.push(text);
            }
            if (block.has_children && depth < maxDepth && typeof block.id === 'string') {
                await collectNotionBlocks(token, block.id, depth + 1, maxDepth, lines);
            }
        }
        cursor = typeof payload.next_cursor === 'string' ? payload.next_cursor : null;
    } while (cursor);
};
const loadNotionDocuments = async (config) => {
    const token = typeof config.token === 'string' ? config.token : '';
    const pageIds = Array.isArray(config.pageIds)
        ? config.pageIds.filter((id) => typeof id === 'string')
        : [];
    const maxDepth = typeof config.maxDepth === 'number' && config.maxDepth > 0 ? Math.floor(config.maxDepth) : 2;
    if (!token || pageIds.length === 0) {
        throw new Error('notion_config_missing');
    }
    const documents = [];
    for (const pageId of pageIds) {
        const lines = [];
        await collectNotionBlocks(token, pageId, 0, maxDepth, lines);
        const content = lines.join('\n').trim();
        if (content) {
            documents.push({ content, metadata: { pageId } });
        }
    }
    return documents;
};
const loadGoogleDocs = async (config) => {
    const accessToken = typeof config.accessToken === 'string' ? config.accessToken : '';
    const documentIds = Array.isArray(config.documentIds)
        ? config.documentIds.filter((id) => typeof id === 'string')
        : [];
    if (!accessToken || documentIds.length === 0) {
        throw new Error('google_docs_config_missing');
    }
    const documents = [];
    for (const docId of documentIds) {
        const response = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });
        const payloadText = await response.text();
        const payload = payloadText ? JSON.parse(payloadText) : {};
        if (!response.ok) {
            const message = payload?.error?.message ||
                payloadText ||
                `Google Docs error (${response.status})`;
            throw new Error(message);
        }
        const body = payload.body;
        const content = Array.isArray(body?.content) ? body?.content : [];
        const lines = [];
        for (const item of content) {
            if (!item || typeof item !== 'object')
                continue;
            const paragraph = item.paragraph;
            if (!paragraph?.elements)
                continue;
            for (const element of paragraph.elements) {
                const textRun = element.textRun;
                if (typeof textRun?.content === 'string') {
                    lines.push(textRun.content);
                }
            }
        }
        const docText = lines.join('').trim();
        if (docText) {
            documents.push({ content: docText, metadata: { documentId: docId } });
        }
    }
    return documents;
};
const buildDocumentsForSource = async (source) => {
    const config = source.config && typeof source.config === 'object' && !Array.isArray(source.config)
        ? source.config
        : {};
    if (source.kind === 'web') {
        return crawlWebSource(config);
    }
    if (source.kind === 'notion') {
        return loadNotionDocuments(config);
    }
    if (source.kind === 'google_docs') {
        return loadGoogleDocs(config);
    }
    return [];
};
const embedAndUpsertChunks = async (input) => {
    const openai = getOpenAIEmbeddingSettings();
    const qdrant = getQdrantSettings();
    if (!openai || !qdrant) {
        throw new Error('vector_store_not_configured');
    }
    await ensureQdrantCollection(qdrant, openai.dimension);
    const batchSize = 24;
    for (let i = 0; i < input.chunks.length; i += batchSize) {
        const batch = input.chunks.slice(i, i + batchSize);
        const embeddings = await requestOpenAIEmbeddings({
            texts: batch.map((chunk) => chunk.content),
            settings: openai,
        });
        const points = batch.map((chunk, index) => ({
            id: chunk.id,
            vector: embeddings[index],
            payload: {
                organizationId: chunk.organizationId,
                sourceId: chunk.sourceId,
                chunkId: chunk.id,
            },
        }));
        await upsertQdrantPoints({ settings: qdrant, points });
        for (const chunk of batch) {
            await prisma.knowledgeChunk.update({
                where: { id: chunk.id },
                data: { vectorId: chunk.id },
            });
        }
    }
};
const ingestKnowledgeSource = async (input) => {
    const documents = await buildDocumentsForSource({ kind: input.kind, config: input.config });
    if (documents.length === 0) {
        return { documents: 0, chunks: 0 };
    }
    const chunkSize = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
        ? input.config.chunkSize
        : null;
    const maxChunkSize = typeof chunkSize === 'number' && chunkSize > 0 ? Math.floor(chunkSize) : 600;
    const now = new Date();
    const chunkRows = documents.flatMap((doc, docIndex) => {
        const content = doc.content.trim();
        if (!content)
            return [];
        const chunks = splitContentIntoChunks(content, maxChunkSize);
        return chunks.map((chunk, chunkIndex) => ({
            id: crypto.randomUUID(),
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            content: chunk,
            metadata: {
                ...(doc.metadata ?? {}),
                chunkIndex,
                documentIndex: docIndex,
            },
            createdAt: now,
        }));
    });
    await prisma.knowledgeChunk.deleteMany({
        where: { organizationId: input.organizationId, sourceId: input.sourceId },
    });
    const qdrant = getQdrantSettings();
    if (qdrant) {
        try {
            await deleteQdrantBySource({
                settings: qdrant,
                organizationId: input.organizationId,
                sourceId: input.sourceId,
            });
        }
        catch (error) {
            console.warn('Qdrant cleanup failed', error);
        }
    }
    const batchSize = 100;
    for (let i = 0; i < chunkRows.length; i += batchSize) {
        await prisma.knowledgeChunk.createMany({
            data: chunkRows.slice(i, i + batchSize),
        });
    }
    if (chunkRows.length > 0) {
        await embedAndUpsertChunks({ chunks: chunkRows });
    }
    return { documents: documents.length, chunks: chunkRows.length };
};
const handleEmbedChunk = async (chunkId) => {
    const chunk = await prisma.knowledgeChunk.findUnique({ where: { id: chunkId } });
    if (!chunk) {
        return;
    }
    try {
        await embedAndUpsertChunks({
            chunks: [
                {
                    id: chunk.id,
                    organizationId: chunk.organizationId,
                    sourceId: chunk.sourceId,
                    content: chunk.content,
                    metadata: chunk.metadata && typeof chunk.metadata === 'object' && !Array.isArray(chunk.metadata)
                        ? chunk.metadata
                        : null,
                },
            ],
        });
    }
    catch (error) {
        console.warn('Embedding chunk failed', error);
    }
};
const handleSyncSource = async (syncId) => {
    const sync = await prisma.knowledgeSync.findUnique({
        where: { id: syncId },
        include: { source: true },
    });
    if (!sync) {
        return;
    }
    if (!['web', 'notion', 'google_docs'].includes(sync.source.kind)) {
        await prisma.knowledgeSync.update({
            where: { id: sync.id },
            data: {
                status: 'failed',
                completedAt: new Date(),
                errorMessage: 'source_not_syncable',
            },
        });
        return;
    }
    await prisma.knowledgeSync.update({
        where: { id: sync.id },
        data: { status: 'running', startedAt: new Date(), errorMessage: null },
    });
    let errorMessage = null;
    let stats = null;
    const existingMetadata = sync.metadata && typeof sync.metadata === 'object' && !Array.isArray(sync.metadata)
        ? sync.metadata
        : {};
    try {
        stats = await ingestKnowledgeSource({
            sourceId: sync.sourceId,
            organizationId: sync.organizationId,
            kind: sync.source.kind,
            config: sync.source.config,
        });
    }
    catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
    }
    await prisma.knowledgeSync.update({
        where: { id: sync.id },
        data: {
            status: errorMessage ? 'failed' : 'completed',
            completedAt: new Date(),
            errorMessage,
            metadata: (stats ? { ...existingMetadata, ...stats } : existingMetadata),
        },
    });
};
const scheduleDueKnowledgeSyncs = async () => {
    const sources = await prisma.knowledgeSource.findMany({
        where: {
            enabled: true,
            kind: { in: ['web', 'notion', 'google_docs'] },
        },
    });
    const now = Date.now();
    for (const source of sources) {
        const config = source.config && typeof source.config === 'object' && !Array.isArray(source.config)
            ? source.config
            : {};
        const intervalMinutes = typeof config.syncIntervalMinutes === 'number' && config.syncIntervalMinutes > 0
            ? config.syncIntervalMinutes
            : typeof config.syncIntervalHours === 'number' && config.syncIntervalHours > 0
                ? config.syncIntervalHours * 60
                : null;
        if (!intervalMinutes) {
            continue;
        }
        const latestSync = await prisma.knowledgeSync.findFirst({
            where: { sourceId: source.id },
            orderBy: { createdAt: 'desc' },
        });
        if (latestSync && ['pending', 'running'].includes(latestSync.status)) {
            continue;
        }
        const lastAt = latestSync?.completedAt ?? latestSync?.createdAt;
        if (lastAt && now - lastAt.getTime() < intervalMinutes * 60 * 1000) {
            continue;
        }
        const sync = await prisma.knowledgeSync.create({
            data: {
                organizationId: source.organizationId,
                sourceId: source.id,
                status: 'pending',
                metadata: { trigger: 'schedule' },
            },
        });
        await knowledgeQueue.add('sync-source', { type: 'sync-source', syncId: sync.id }, defaultJobOptions);
    }
};
export const registerKnowledgeSyncWorker = () => createWorker(QUEUE_NAMES.knowledgeSync, async ({ data }) => {
    if (!data) {
        return;
    }
    if (data.type === 'sync-source') {
        await handleSyncSource(data.syncId);
        return;
    }
    if (data.type === 'embed-chunk') {
        await handleEmbedChunk(data.chunkId);
    }
});
export const startKnowledgeSyncScheduler = () => {
    const intervalMs = typeof process.env.KNOWLEDGE_SYNC_POLL_MS === 'string'
        ? Number(process.env.KNOWLEDGE_SYNC_POLL_MS)
        : 10 * 60 * 1000;
    const resolvedInterval = Number.isFinite(intervalMs) ? intervalMs : 10 * 60 * 1000;
    const timer = setInterval(() => {
        scheduleDueKnowledgeSyncs().catch((error) => {
            console.warn('Knowledge sync scheduler failed', error);
        });
    }, resolvedInterval);
    return {
        intervalMs: resolvedInterval,
        stop: () => clearInterval(timer),
    };
};
//# sourceMappingURL=knowledge-sync.js.map