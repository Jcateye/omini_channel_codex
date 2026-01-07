'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const storageKeys = {
  apiKey: 'omini_api_key',
  apiBase: 'omini_api_base',
};

type KnowledgeSource = {
  id: string;
  name: string;
  description?: string | null;
  kind: string;
  config?: Record<string, unknown> | null;
  enabled: boolean;
  _count?: { chunks: number };
  syncs?: KnowledgeSync[];
  createdAt: string;
};

type KnowledgeChunk = {
  id: string;
  sourceId: string;
  content: string;
  score?: number;
};

type KnowledgeSync = {
  id: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type Optimization = {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  metrics?: Record<string, unknown> | null;
  createdAt: string;
  campaign?: {
    id: string;
    name: string;
    status?: string | null;
    cost?: number | null;
    revenue?: number | null;
  } | null;
};

type AssignmentLog = {
  id: string;
  leadId: string;
  strategy: string;
  targetId: string;
  targetType: string;
  targetName?: string | null;
  rationale?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  lead?: { id: string; stage: string } | null;
};

type HandoffLog = {
  id: string;
  leadId: string;
  fromRole?: string | null;
  toRole: string;
  triggerType: string;
  triggerRuleId?: string | null;
  triggerDetail?: Record<string, unknown> | null;
  contextShared?: Record<string, unknown> | null;
  createdAt: string;
  lead?: { id: string; stage: string } | null;
};

const safeJson = (value: string) => {
  try {
    return { ok: true, data: JSON.parse(value) } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
};

export default function AgentIntelPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [sourcesStatus, setSourcesStatus] = useState('');
  const [sourcesError, setSourcesError] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceDescription, setSourceDescription] = useState('');
  const [sourceKind, setSourceKind] = useState('manual');
  const [sourceConfigText, setSourceConfigText] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedConfigText, setSelectedConfigText] = useState('');
  const [sourceEditStatus, setSourceEditStatus] = useState('');
  const [sourceEditError, setSourceEditError] = useState('');
  const [syncs, setSyncs] = useState<KnowledgeSync[]>([]);
  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');

  const [chunkContent, setChunkContent] = useState('');
  const [chunkSize, setChunkSize] = useState('600');
  const [chunkStatus, setChunkStatus] = useState('');
  const [chunkError, setChunkError] = useState('');

  const [retrieveQuery, setRetrieveQuery] = useState('');
  const [retrieveResult, setRetrieveResult] = useState('');
  const [retrieveError, setRetrieveError] = useState('');

  const [optimizations, setOptimizations] = useState<Optimization[]>([]);
  const [optimizationsStatus, setOptimizationsStatus] = useState('');
  const [optimizationsError, setOptimizationsError] = useState('');
  const [optimizationFilter, setOptimizationFilter] = useState('');

  const [optimizationStrategyText, setOptimizationStrategyText] = useState('');
  const [distributionStrategyText, setDistributionStrategyText] = useState('');
  const [strategyStatus, setStrategyStatus] = useState('');
  const [strategyError, setStrategyError] = useState('');

  const [previewLeadId, setPreviewLeadId] = useState('');
  const [previewStage, setPreviewStage] = useState('qualified');
  const [previewTags, setPreviewTags] = useState('high-intent,pricing');
  const [previewSuggestedQueue, setPreviewSuggestedQueue] = useState('sales');
  const [previewResult, setPreviewResult] = useState('');
  const [previewError, setPreviewError] = useState('');

  const [assignmentLogs, setAssignmentLogs] = useState<AssignmentLog[]>([]);
  const [assignmentFilterLeadId, setAssignmentFilterLeadId] = useState('');
  const [assignmentStatus, setAssignmentStatus] = useState('');
  const [assignmentError, setAssignmentError] = useState('');

  const [handoffConfigText, setHandoffConfigText] = useState('');
  const [handoffStatus, setHandoffStatus] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const [handoffPreviewLeadId, setHandoffPreviewLeadId] = useState('');
  const [handoffPreviewStage, setHandoffPreviewStage] = useState('qualified');
  const [handoffPreviewScore, setHandoffPreviewScore] = useState('65');
  const [handoffPreviewTags, setHandoffPreviewTags] = useState('high-intent,pricing');
  const [handoffPreviewTask, setHandoffPreviewTask] = useState('support');
  const [handoffPreviewConfidence, setHandoffPreviewConfidence] = useState('0.8');
  const [handoffPreviewResult, setHandoffPreviewResult] = useState('');
  const [handoffPreviewError, setHandoffPreviewError] = useState('');
  const [handoffLogs, setHandoffLogs] = useState<HandoffLog[]>([]);
  const [handoffLogFilterLeadId, setHandoffLogFilterLeadId] = useState('');
  const [handoffLogsStatus, setHandoffLogsStatus] = useState('');
  const [handoffLogsError, setHandoffLogsError] = useState('');

  useEffect(() => {
    const savedKey = window.localStorage.getItem(storageKeys.apiKey) ?? '';
    const savedBase = window.localStorage.getItem(storageKeys.apiBase) ?? '';
    setApiKey(savedKey);
    setApiBase(savedBase);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.apiKey, apiKey);
  }, [apiKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.apiBase, apiBase);
  }, [apiBase]);

  const resolvedBase = useMemo(() => {
    const base = apiBase.trim();
    if (!base) return '';
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }, [apiBase]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? null,
    [sources, selectedSourceId]
  );

  useEffect(() => {
    if (!selectedSource) {
      setSelectedConfigText('');
      return;
    }
    setSelectedConfigText(JSON.stringify(selectedSource.config ?? {}, null, 2));
  }, [selectedSource]);

  const apiFetch = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    if (!apiKey) {
      throw new Error('Missing API key');
    }

    const response = await fetch(`${resolvedBase}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(options?.headers ?? {}),
      },
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);

    if (!response.ok) {
      throw new Error(text || `Request failed (${response.status})`);
    }

    return data;
  };

  const loadStrategies = async () => {
    setStrategyStatus('');
    setStrategyError('');
    try {
      const data = await apiFetch<{
        strategies: { optimization: Record<string, unknown>; distribution: Record<string, unknown> };
      }>('/v1/agent/strategies');
      setOptimizationStrategyText(JSON.stringify(data.strategies.optimization ?? {}, null, 2));
      setDistributionStrategyText(JSON.stringify(data.strategies.distribution ?? {}, null, 2));
      setStrategyStatus('Strategies loaded.');
    } catch (error) {
      setStrategyError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveStrategies = async () => {
    setStrategyStatus('');
    setStrategyError('');

    const optimizationParsed = safeJson(optimizationStrategyText);
    if (!optimizationParsed.ok) {
      setStrategyError('Optimization strategy JSON is invalid.');
      return;
    }

    const distributionParsed = safeJson(distributionStrategyText);
    if (!distributionParsed.ok) {
      setStrategyError('Distribution strategy JSON is invalid.');
      return;
    }

    try {
      await apiFetch('/v1/agent/strategies', {
        method: 'PUT',
        body: JSON.stringify({
          strategies: {
            optimization: optimizationParsed.data,
            distribution: distributionParsed.data,
          },
        }),
      });
      setStrategyStatus('Strategies saved.');
    } catch (error) {
      setStrategyError(error instanceof Error ? error.message : String(error));
    }
  };

  const previewDistribution = async () => {
    setPreviewError('');
    setPreviewResult('');

    try {
      const data = await apiFetch<{ decision: Record<string, unknown> }>(
        '/v1/agent/distribution/preview',
        {
          method: 'POST',
          body: JSON.stringify({
            leadId: previewLeadId.trim() || undefined,
            stage: previewStage.trim() || undefined,
            tags: previewTags
              .split(',')
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0),
            suggestedQueue: previewSuggestedQueue.trim() || undefined,
          }),
        }
      );
      setPreviewResult(JSON.stringify(data.decision ?? {}, null, 2));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadAssignments = async () => {
    setAssignmentStatus('');
    setAssignmentError('');
    try {
      const params = new URLSearchParams();
      if (assignmentFilterLeadId.trim()) {
        params.set('leadId', assignmentFilterLeadId.trim());
      }
      const data = await apiFetch<{ assignments: AssignmentLog[] }>(
        `/v1/agent/assignments${params.toString() ? `?${params.toString()}` : ''}`
      );
      setAssignmentLogs(data.assignments ?? []);
      setAssignmentStatus('Assignments loaded.');
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadHandoffConfig = async () => {
    setHandoffStatus('');
    setHandoffError('');
    try {
      const data = await apiFetch<{ config: Record<string, unknown> }>('/v1/agent/handoffs');
      setHandoffConfigText(JSON.stringify(data.config ?? {}, null, 2));
      setHandoffStatus('Handoff config loaded.');
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveHandoffConfig = async () => {
    setHandoffStatus('');
    setHandoffError('');
    const parsed = safeJson(handoffConfigText);
    if (!parsed.ok) {
      setHandoffError('Handoff config JSON is invalid.');
      return;
    }

    try {
      await apiFetch('/v1/agent/handoffs', {
        method: 'PUT',
        body: JSON.stringify({ config: parsed.data }),
      });
      setHandoffStatus('Handoff config saved.');
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : String(error));
    }
  };

  const previewHandoff = async () => {
    setHandoffPreviewError('');
    setHandoffPreviewResult('');
    try {
      const data = await apiFetch<{ decision: Record<string, unknown> }>(
        '/v1/agent/handoffs/preview',
        {
          method: 'POST',
          body: JSON.stringify({
            leadId: handoffPreviewLeadId.trim() || undefined,
            stage: handoffPreviewStage.trim() || undefined,
            score: Number(handoffPreviewScore),
            tags: handoffPreviewTags
              .split(',')
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0),
            taskType: handoffPreviewTask.trim() || undefined,
            confidence: Number(handoffPreviewConfidence),
          }),
        }
      );
      setHandoffPreviewResult(JSON.stringify(data.decision ?? {}, null, 2));
    } catch (error) {
      setHandoffPreviewError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadHandoffLogs = async () => {
    setHandoffLogsStatus('');
    setHandoffLogsError('');
    try {
      const params = new URLSearchParams();
      if (handoffLogFilterLeadId.trim()) {
        params.set('leadId', handoffLogFilterLeadId.trim());
      }
      const data = await apiFetch<{ logs: HandoffLog[] }>(
        `/v1/agent/handoffs/logs${params.toString() ? `?${params.toString()}` : ''}`
      );
      setHandoffLogs(data.logs ?? []);
      setHandoffLogsStatus('Handoff logs loaded.');
    } catch (error) {
      setHandoffLogsError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadSources = async () => {
    setSourcesStatus('');
    setSourcesError('');
    try {
      const data = await apiFetch<{ sources: KnowledgeSource[] }>('/v1/knowledge-sources');
      setSources(data.sources ?? []);
      if (!selectedSourceId && data.sources?.length) {
        setSelectedSourceId(data.sources[0].id);
      }
      setSourcesStatus('Sources loaded.');
    } catch (error) {
      setSourcesError(error instanceof Error ? error.message : String(error));
    }
  };

  const createSource = async () => {
    setSourcesStatus('');
    setSourcesError('');
    const name = sourceName.trim();
    if (!name) {
      setSourcesError('Provide a source name.');
      return;
    }
    let configPayload: Record<string, unknown> | null = null;
    if (sourceConfigText.trim()) {
      const parsed = safeJson(sourceConfigText);
      if (!parsed.ok) {
        setSourcesError('Source config JSON is invalid.');
        return;
      }
      configPayload = parsed.data as Record<string, unknown>;
    }

    try {
      const data = await apiFetch<{ source: KnowledgeSource }>('/v1/knowledge-sources', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: sourceDescription.trim() || undefined,
          kind: sourceKind.trim() || 'manual',
          config: configPayload ?? undefined,
        }),
      });
      setSources((prev) => [data.source, ...prev]);
      setSelectedSourceId(data.source.id);
      setSourceName('');
      setSourceDescription('');
      setSourceConfigText('');
      setSourcesStatus('Source created.');
    } catch (error) {
      setSourcesError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveSelectedSource = async () => {
    setSourceEditStatus('');
    setSourceEditError('');
    if (!selectedSourceId) {
      setSourceEditError('Select a source to update.');
      return;
    }
    let configPayload: Record<string, unknown> | null = null;
    if (selectedConfigText.trim()) {
      const parsed = safeJson(selectedConfigText);
      if (!parsed.ok) {
        setSourceEditError('Selected config JSON is invalid.');
        return;
      }
      configPayload = parsed.data as Record<string, unknown>;
    }

    try {
      const data = await apiFetch<{ source: KnowledgeSource }>(
        `/v1/knowledge-sources/${selectedSourceId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ config: configPayload }),
        }
      );
      setSources((prev) => prev.map((source) => (source.id === data.source.id ? data.source : source)));
      setSourceEditStatus('Source updated.');
    } catch (error) {
      setSourceEditError(error instanceof Error ? error.message : String(error));
    }
  };

  const triggerSync = async () => {
    setSyncStatus('');
    setSyncError('');
    if (!selectedSourceId) {
      setSyncError('Select a source to sync.');
      return;
    }
    try {
      const data = await apiFetch<{ sync: KnowledgeSync }>(
        `/v1/knowledge-sources/${selectedSourceId}/sync`,
        { method: 'POST' }
      );
      setSyncs((prev) => [data.sync, ...prev]);
      setSyncStatus('Sync queued.');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadSyncs = async () => {
    setSyncStatus('');
    setSyncError('');
    if (!selectedSourceId) {
      setSyncError('Select a source to load syncs.');
      return;
    }
    try {
      const data = await apiFetch<{ syncs: KnowledgeSync[] }>(
        `/v1/knowledge-sources/${selectedSourceId}/syncs`
      );
      setSyncs(data.syncs ?? []);
      setSyncStatus('Sync history loaded.');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  };

  const addChunks = async () => {
    setChunkStatus('');
    setChunkError('');

    if (!selectedSourceId) {
      setChunkError('Select a knowledge source.');
      return;
    }

    if (!chunkContent.trim()) {
      setChunkError('Provide content to index.');
      return;
    }

    const parsedSize = Number(chunkSize);
    const size = Number.isFinite(parsedSize) ? Math.max(100, Math.min(1200, parsedSize)) : 600;

    try {
      const data = await apiFetch<{ created: number }>(
        `/v1/knowledge-sources/${selectedSourceId}/chunks`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: chunkContent,
            chunkSize: size,
          }),
        }
      );
      setChunkStatus(`Indexed ${data.created} chunks.`);
      setChunkContent('');
      await loadSources();
    } catch (error) {
      setChunkError(error instanceof Error ? error.message : String(error));
    }
  };

  const retrieveChunks = async () => {
    setRetrieveError('');
    setRetrieveResult('');
    const query = retrieveQuery.trim();
    if (!query) {
      setRetrieveError('Provide a query.');
      return;
    }

    try {
      const data = await apiFetch<{ results: KnowledgeChunk[] }>('/v1/knowledge/retrieve', {
        method: 'POST',
        body: JSON.stringify({
          query,
          topK: 5,
          sourceIds: selectedSourceId ? [selectedSourceId] : undefined,
        }),
      });
      setRetrieveResult(JSON.stringify(data.results ?? [], null, 2));
    } catch (error) {
      setRetrieveError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadOptimizations = async () => {
    setOptimizationsStatus('');
    setOptimizationsError('');
    try {
      const params = new URLSearchParams();
      if (optimizationFilter.trim()) {
        params.set('status', optimizationFilter.trim());
      }
      const data = await apiFetch<{ optimizations: Optimization[] }>(
        `/v1/agent/optimizations${params.toString() ? `?${params.toString()}` : ''}`
      );
      setOptimizations(data.optimizations ?? []);
      setOptimizationsStatus('Optimizations loaded.');
    } catch (error) {
      setOptimizationsError(error instanceof Error ? error.message : String(error));
    }
  };

  const applyOptimization = async (id: string) => {
    try {
      await apiFetch(`/v1/agent/optimizations/${id}/apply`, { method: 'POST' });
      await loadOptimizations();
    } catch (error) {
      setOptimizationsError(error instanceof Error ? error.message : String(error));
    }
  };

  const dismissOptimization = async (id: string) => {
    try {
      await apiFetch(`/v1/agent/optimizations/${id}/dismiss`, { method: 'POST' });
      await loadOptimizations();
    } catch (error) {
      setOptimizationsError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">Agent intelligence</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/">Console</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/analytics">Analytics</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/roi">ROI/CRM</Link>
              </Button>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Manage knowledge sources, test retrieval, and review campaign optimization
            recommendations.
          </p>
        </header>

        <Card className="surface-grid animate-rise">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Connection</CardTitle>
              <CardDescription>Point to your API base and key.</CardDescription>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>API base</Label>
                <Input
                  placeholder="(empty uses /v1 rewrite)"
                  value={apiBase}
                  onChange={(event) => setApiBase(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>API key</Label>
                <Input
                  type="password"
                  placeholder="omi_xxx"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </div>
            </div>
          </div>
        </Card>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Knowledge sources</CardTitle>
                <CardDescription>Create and manage RAG sources.</CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadSources}>
                  Load sources
                </Button>
                {sourcesStatus ? <span className="text-xs text-accent">{sourcesStatus}</span> : null}
                {sourcesError ? <span className="text-xs text-accent2">{sourcesError}</span> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="Pricing FAQ"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Kind</Label>
                  <select
                    value={sourceKind}
                    onChange={(event) => setSourceKind(event.target.value)}
                    className="flex h-10 w-full rounded-md border border-ink/10 bg-surface/80 px-3 py-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <option value="manual">manual</option>
                    <option value="web">web</option>
                    <option value="notion">notion</option>
                    <option value="google_docs">google_docs</option>
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Description</Label>
                  <Input
                    value={sourceDescription}
                    onChange={(event) => setSourceDescription(event.target.value)}
                    placeholder="Short summary"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Config (JSON)</Label>
                  <Textarea
                    value={sourceConfigText}
                    onChange={(event) => setSourceConfigText(event.target.value)}
                    placeholder='{"url":"https://example.com","crawlDepth":1,"maxPages":5,"syncIntervalMinutes":60}'
                    className="min-h-[120px]"
                  />
                </div>
              </div>

              <Button onClick={createSource}>Create source</Button>

              <div className="space-y-3">
                {sources.length === 0 ? (
                  <p className="text-sm text-muted">No knowledge sources yet.</p>
                ) : null}
                {sources.map((source) => {
                  const latestSync = source.syncs?.[0];
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => setSelectedSourceId(source.id)}
                      className={`flex w-full flex-col gap-1 rounded-xl border border-ink/10 p-4 text-left transition ${
                        selectedSourceId === source.id
                          ? 'bg-white/80 ring-1 ring-accent/40'
                          : 'bg-white/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{source.name}</span>
                        <Badge variant="muted">{source._count?.chunks ?? 0} chunks</Badge>
                      </div>
                      <div className="text-xs text-muted">
                        {source.kind} · {source.description || 'No description'}
                        {latestSync ? ` · sync ${latestSync.status}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Index content</CardTitle>
                <CardDescription>Attach new knowledge chunks.</CardDescription>
              </div>
              <div className="space-y-2">
                <Label>Selected source</Label>
                <Input value={selectedSourceId || 'Select a source'} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Chunk size</Label>
                <Input
                  value={chunkSize}
                  onChange={(event) => setChunkSize(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <Textarea
                  value={chunkContent}
                  onChange={(event) => setChunkContent(event.target.value)}
                  className="min-h-[180px]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={addChunks}>Index content</Button>
                {chunkStatus ? <span className="text-xs text-accent">{chunkStatus}</span> : null}
                {chunkError ? <span className="text-xs text-accent2">{chunkError}</span> : null}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Source sync</CardTitle>
                <CardDescription>Update connector config and trigger sync runs.</CardDescription>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Selected source</Label>
                  <Input
                    value={selectedSource?.name ? `${selectedSource.name} (${selectedSource.kind})` : 'Select a source'}
                    readOnly
                  />
                </div>
                <div className="space-y-2">
                  <Label>Source ID</Label>
                  <Input value={selectedSourceId || 'Select a source'} readOnly />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Selected config (JSON)</Label>
                <Textarea
                  value={selectedConfigText}
                  onChange={(event) => setSelectedConfigText(event.target.value)}
                  placeholder="{}"
                  className="min-h-[160px]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={saveSelectedSource}>
                  Save config
                </Button>
                <Button variant="outline" onClick={triggerSync}>
                  Sync now
                </Button>
                <Button variant="outline" onClick={loadSyncs}>
                  Load syncs
                </Button>
              </div>
              {(sourceEditStatus || sourceEditError || syncStatus || syncError) && (
                <div className="flex flex-wrap gap-3 text-xs">
                  {sourceEditStatus ? (
                    <span className="text-accent">{sourceEditStatus}</span>
                  ) : null}
                  {sourceEditError ? (
                    <span className="text-accent2">{sourceEditError}</span>
                  ) : null}
                  {syncStatus ? <span className="text-accent">{syncStatus}</span> : null}
                  {syncError ? <span className="text-accent2">{syncError}</span> : null}
                </div>
              )}
              <div className="space-y-3">
                {syncs.length === 0 ? (
                  <p className="text-sm text-muted">No sync runs yet.</p>
                ) : null}
                {syncs.map((sync) => (
                  <div
                    key={sync.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{sync.status}</p>
                        <p className="text-xs text-muted">
                          {sync.startedAt || sync.createdAt}
                          {sync.completedAt ? ` → ${sync.completedAt}` : ''}
                        </p>
                      </div>
                      <Badge variant={sync.status === 'failed' ? 'accent' : 'muted'}>
                        {sync.status}
                      </Badge>
                    </div>
                    {sync.errorMessage ? (
                      <p className="mt-2 text-xs text-accent2">{sync.errorMessage}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Retrieve test</CardTitle>
                <CardDescription>Test RAG query results.</CardDescription>
              </div>
              <div className="space-y-2">
                <Label>Query</Label>
                <Input
                  value={retrieveQuery}
                  onChange={(event) => setRetrieveQuery(event.target.value)}
                  placeholder="pricing for enterprise"
                />
              </div>
              <Button variant="outline" onClick={retrieveChunks}>
                Retrieve
              </Button>
              {retrieveError ? <span className="text-xs text-accent2">{retrieveError}</span> : null}
              <pre className="min-h-[200px] whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                {retrieveResult || 'No results yet.'}
              </pre>
            </div>
          </Card>

          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Campaign optimizations</CardTitle>
                <CardDescription>Review agent-generated suggestions.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="status filter (pending)"
                  value={optimizationFilter}
                  onChange={(event) => setOptimizationFilter(event.target.value)}
                />
                <Button variant="outline" onClick={loadOptimizations}>
                  Load
                </Button>
              </div>
              {optimizationsStatus ? (
                <span className="text-xs text-accent">{optimizationsStatus}</span>
              ) : null}
              {optimizationsError ? (
                <span className="text-xs text-accent2">{optimizationsError}</span>
              ) : null}
              <div className="space-y-3">
                {optimizations.length === 0 ? (
                  <p className="text-sm text-muted">No recommendations yet.</p>
                ) : null}
                {optimizations.map((opt) => (
                  <div
                    key={opt.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{opt.title}</p>
                        <p className="text-xs text-muted">{opt.description}</p>
                      </div>
                      <Badge variant={opt.status === 'pending' ? 'accent' : 'muted'}>
                        {opt.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted">
                      Campaign: {opt.campaign?.name ?? opt.campaign?.id ?? 'Unknown'}
                    </div>
                    {opt.metrics ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                        {JSON.stringify(opt.metrics, null, 2)}
                      </pre>
                    ) : null}
                    {opt.status === 'pending' ? (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => applyOptimization(opt.id)}>
                          Apply
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => dismissOptimization(opt.id)}>
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Strategies</CardTitle>
                <CardDescription>Configure optimization and distribution strategies.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadStrategies}>
                  Load strategies
                </Button>
                <Button variant="warm" onClick={saveStrategies}>
                  Save strategies
                </Button>
                {strategyStatus ? <span className="text-xs text-accent">{strategyStatus}</span> : null}
                {strategyError ? <span className="text-xs text-accent2">{strategyError}</span> : null}
              </div>
              <div className="space-y-2">
                <Label>Optimization strategy JSON</Label>
                <Textarea
                  value={optimizationStrategyText}
                  onChange={(event) => setOptimizationStrategyText(event.target.value)}
                  className="min-h-[200px] font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label>Distribution strategy JSON</Label>
                <Textarea
                  value={distributionStrategyText}
                  onChange={(event) => setDistributionStrategyText(event.target.value)}
                  className="min-h-[200px] font-mono text-xs"
                />
              </div>
            </div>
          </Card>

          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Distribution preview</CardTitle>
                <CardDescription>Preview assignment target without saving.</CardDescription>
              </div>
              <div className="space-y-2">
                <Label>Lead id (optional)</Label>
                <Input
                  value={previewLeadId}
                  onChange={(event) => setPreviewLeadId(event.target.value)}
                  placeholder="lead_id"
                />
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Input
                  value={previewStage}
                  onChange={(event) => setPreviewStage(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tags (comma separated)</Label>
                <Input
                  value={previewTags}
                  onChange={(event) => setPreviewTags(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Suggested queue</Label>
                <Input
                  value={previewSuggestedQueue}
                  onChange={(event) => setPreviewSuggestedQueue(event.target.value)}
                />
              </div>
              <Button variant="outline" onClick={previewDistribution}>
                Preview distribution
              </Button>
              {previewError ? <span className="text-xs text-accent2">{previewError}</span> : null}
              <pre className="min-h-[160px] whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                {previewResult || 'No preview yet.'}
              </pre>
            </div>
          </Card>
        </section>

        <section className="grid gap-6">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Assignment logs</CardTitle>
                <CardDescription>Review lead distribution decisions.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="filter by lead id"
                  value={assignmentFilterLeadId}
                  onChange={(event) => setAssignmentFilterLeadId(event.target.value)}
                />
                <Button variant="outline" onClick={loadAssignments}>
                  Load assignments
                </Button>
                {assignmentStatus ? <span className="text-xs text-accent">{assignmentStatus}</span> : null}
                {assignmentError ? <span className="text-xs text-accent2">{assignmentError}</span> : null}
              </div>
              <div className="space-y-3">
                {assignmentLogs.length === 0 ? (
                  <p className="text-sm text-muted">No assignments yet.</p>
                ) : null}
                {assignmentLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {log.targetName ?? log.targetId} · {log.strategy}
                        </p>
                        <p className="text-xs text-muted">Lead: {log.leadId}</p>
                      </div>
                      <Badge variant="muted">{log.targetType}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted">Created: {log.createdAt}</div>
                    {log.rationale ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                        {JSON.stringify(log.rationale ?? {}, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Handoff config</CardTitle>
                <CardDescription>Stage-based role handoff rules.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadHandoffConfig}>
                  Load handoffs
                </Button>
                <Button variant="warm" onClick={saveHandoffConfig}>
                  Save handoffs
                </Button>
                {handoffStatus ? <span className="text-xs text-accent">{handoffStatus}</span> : null}
                {handoffError ? <span className="text-xs text-accent2">{handoffError}</span> : null}
              </div>
              <Textarea
                value={handoffConfigText}
                onChange={(event) => setHandoffConfigText(event.target.value)}
                className="min-h-[240px] font-mono text-xs"
              />
            </div>
          </Card>

          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Handoff preview</CardTitle>
                <CardDescription>Preview role transitions.</CardDescription>
              </div>
              <div className="space-y-2">
                <Label>Lead id (optional)</Label>
                <Input
                  value={handoffPreviewLeadId}
                  onChange={(event) => setHandoffPreviewLeadId(event.target.value)}
                  placeholder="lead_id"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Input
                    value={handoffPreviewStage}
                    onChange={(event) => setHandoffPreviewStage(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Score</Label>
                  <Input
                    value={handoffPreviewScore}
                    onChange={(event) => setHandoffPreviewScore(event.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Tags (comma separated)</Label>
                  <Input
                    value={handoffPreviewTags}
                    onChange={(event) => setHandoffPreviewTags(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Task type</Label>
                  <Input
                    value={handoffPreviewTask}
                    onChange={(event) => setHandoffPreviewTask(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confidence</Label>
                  <Input
                    value={handoffPreviewConfidence}
                    onChange={(event) => setHandoffPreviewConfidence(event.target.value)}
                  />
                </div>
              </div>
              <Button variant="outline" onClick={previewHandoff}>
                Preview handoff
              </Button>
              {handoffPreviewError ? (
                <span className="text-xs text-accent2">{handoffPreviewError}</span>
              ) : null}
              <pre className="min-h-[160px] whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                {handoffPreviewResult || 'No preview yet.'}
              </pre>
            </div>
          </Card>
        </section>

        <section className="grid gap-6">
          <Card className="animate-rise">
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Handoff logs</CardTitle>
                <CardDescription>Audit role transitions.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="filter by lead id"
                  value={handoffLogFilterLeadId}
                  onChange={(event) => setHandoffLogFilterLeadId(event.target.value)}
                />
                <Button variant="outline" onClick={loadHandoffLogs}>
                  Load logs
                </Button>
                {handoffLogsStatus ? (
                  <span className="text-xs text-accent">{handoffLogsStatus}</span>
                ) : null}
                {handoffLogsError ? (
                  <span className="text-xs text-accent2">{handoffLogsError}</span>
                ) : null}
              </div>
              <div className="space-y-3">
                {handoffLogs.length === 0 ? (
                  <p className="text-sm text-muted">No handoff logs yet.</p>
                ) : null}
                {handoffLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {log.fromRole ?? 'none'} → {log.toRole}
                        </p>
                        <p className="text-xs text-muted">Lead: {log.leadId}</p>
                      </div>
                      <Badge variant="muted">{log.triggerType}</Badge>
                    </div>
                    {log.triggerDetail ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                        {JSON.stringify(log.triggerDetail ?? {}, null, 2)}
                      </pre>
                    ) : null}
                    {log.contextShared ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                        {JSON.stringify(log.contextShared ?? {}, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
