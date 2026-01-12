import { prisma, Prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { getAgentAdapter, selectAgent } from '@omini/agent-routing';
import { Langfuse } from 'langfuse';
const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);
const loadOrganizationSettings = async (organizationId) => {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
    });
    return organization?.settings ?? {};
};
const normalizeLangfuseSettings = (input) => {
    if (!input || typeof input !== 'object') {
        return {
            enabled: false,
            baseUrl: 'https://cloud.langfuse.com',
            publicKey: '',
            secretKey: '',
        };
    }
    const settings = input;
    const enabled = typeof settings.enabled === 'boolean' ? settings.enabled : false;
    const baseUrl = typeof settings.baseUrl === 'string' && settings.baseUrl.trim().length > 0
        ? settings.baseUrl.trim()
        : 'https://cloud.langfuse.com';
    const publicKey = typeof settings.publicKey === 'string' ? settings.publicKey.trim() : '';
    const secretKey = typeof settings.secretKey === 'string' ? settings.secretKey.trim() : '';
    return {
        enabled,
        baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
        publicKey,
        secretKey,
    };
};
const langfuseClients = new Map();
const getLangfuseClient = (settings) => {
    if (!settings.enabled || !settings.publicKey || !settings.secretKey) {
        return null;
    }
    const key = `${settings.baseUrl}|${settings.publicKey}|${settings.secretKey}`;
    const existing = langfuseClients.get(key);
    if (existing) {
        return existing;
    }
    const client = new Langfuse({
        publicKey: settings.publicKey,
        secretKey: settings.secretKey,
        baseUrl: settings.baseUrl,
    });
    langfuseClients.set(key, client);
    return client;
};
const sendLangfuseTrace = async (settings, payload) => {
    const client = getLangfuseClient(settings);
    if (!client) {
        return;
    }
    try {
        client.trace(payload);
        await client.flushAsync();
    }
    catch (error) {
        console.warn('Langfuse trace failed', error);
    }
};
const getAgentRoutingConfig = (settings) => {
    const raw = settings.agentRouting;
    if (!raw || typeof raw !== 'object') {
        return { rules: [] };
    }
    const config = raw;
    const rules = Array.isArray(config.rules)
        ? config.rules.filter((rule) => rule && typeof rule === 'object')
        : [];
    return {
        defaultAgentId: typeof config.defaultAgentId === 'string' ? config.defaultAgentId : undefined,
        rules,
    };
};
export const registerAgentRepliesWorker = () => createWorker(QUEUE_NAMES.agentReplies, async ({ data }) => {
    if (!data?.context?.organizationId) {
        throw new Error('Agent reply missing organization context');
    }
    const settings = await loadOrganizationSettings(data.context.organizationId);
    const routingConfig = getAgentRoutingConfig(settings);
    if (!routingConfig.rules?.length && !routingConfig.defaultAgentId) {
        return;
    }
    const routingContext = {
        platform: data.context.platform,
    };
    if (typeof data.context.provider === 'string') {
        routingContext.provider = data.context.provider;
    }
    if (data.context.stage !== undefined) {
        routingContext.stage = data.context.stage;
    }
    if (data.context.source !== undefined) {
        routingContext.source = data.context.source;
    }
    if (data.context.tags !== undefined) {
        routingContext.tags = data.context.tags;
    }
    if (data.context.text !== undefined) {
        routingContext.text = data.context.text;
    }
    const decision = selectAgent(routingConfig, routingContext);
    if (!decision.agentId) {
        return;
    }
    const adapter = getAgentAdapter(decision.agentId);
    if (!adapter) {
        return;
    }
    const response = await adapter.reply(data.context);
    if (!response.text) {
        return;
    }
    const messageContent = {
        text: response.text,
        agentId: adapter.id,
        ruleId: decision.matchedRuleId ?? null,
        metadata: response.metadata ?? null,
    };
    const message = await prisma.message.create({
        data: {
            organizationId: data.context.organizationId,
            conversationId: data.context.conversationId,
            channelId: data.context.channelId,
            contactId: data.context.contactId,
            platform: 'whatsapp',
            type: 'text',
            direction: 'outbound',
            status: 'pending',
            content: messageContent,
        },
    });
    const langfuse = normalizeLangfuseSettings(settings.langfuse);
    await sendLangfuseTrace(langfuse, {
        id: message.id,
        name: `agent.reply:${adapter.id}`,
        input: {
            agentId: adapter.id,
            conversationId: data.context.conversationId,
            contactId: data.context.contactId,
            leadId: data.context.leadId ?? null,
            text: data.context.text ?? '',
            tags: data.context.tags ?? [],
            stage: data.context.stage ?? null,
            source: data.context.source ?? null,
        },
        output: {
            text: response.text ?? '',
        },
        metadata: {
            ruleId: decision.matchedRuleId ?? null,
        },
    });
    await outboundQueue.add('wa.send', { messageId: message.id }, defaultJobOptions);
});
//# sourceMappingURL=agent-replies.js.map