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
  journeyDraft: 'omini_journey_draft',
};

type JourneyTrigger = {
  id: string;
  type: string;
  enabled: boolean;
  config?: Record<string, unknown> | null;
};

type JourneyNode = {
  id: string;
  type: string;
  label?: string | null;
  config?: Record<string, unknown> | null;
  position?: Record<string, number> | null;
};

type JourneyEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string | null;
  config?: Record<string, unknown> | null;
};

type Journey = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  triggers: JourneyTrigger[];
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  createdAt: string;
  updatedAt: string;
};

type JourneyRunStep = {
  id: string;
  status: string;
  nodeId: string;
  messageId?: string | null;
};

type JourneyRun = {
  id: string;
  status: string;
  triggerType: string;
  leadId?: string | null;
  channelId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  steps?: JourneyRunStep[];
};

const defaultTriggers = JSON.stringify(
  [
    {
      type: 'inbound_message',
      enabled: true,
      config: { textIncludes: ['price', 'buy'] },
    },
    {
      type: 'tag_change',
      enabled: true,
      config: { tagsAny: ['purchase'] },
    },
    {
      type: 'stage_change',
      enabled: true,
      config: { stages: ['qualified'] },
    },
    {
      type: 'time',
      enabled: true,
      config: { scheduleAt: '2025-01-01T00:00:00Z', lastActiveWithinDays: 7 },
    },
  ],
  null,
  2
);

const defaultNodes = JSON.stringify(
  [
    {
      id: 'start_message',
      type: 'send_message',
      label: 'Welcome',
      config: {
        text: 'Thanks for reaching out! Want a demo?',
        channelId: 'replace-with-channel-id',
      },
      position: { x: 80, y: 40 },
    },
    {
      id: 'delay_1',
      type: 'delay',
      label: 'Wait 5m',
      config: { delayMinutes: 5 },
      position: { x: 320, y: 40 },
    },
    {
      id: 'check_intent',
      type: 'condition',
      label: 'Intent: purchase?',
      config: { tagsAny: ['purchase'] },
      position: { x: 560, y: 40 },
    },
    {
      id: 'tag_hot',
      type: 'tag_update',
      label: 'Tag hot lead',
      config: { addTags: ['hot_lead'], stage: 'qualified' },
      position: { x: 800, y: 20 },
    },
    {
      id: 'notify_crm',
      type: 'webhook',
      label: 'Notify CRM',
      config: {
        url: 'https://example.com/webhook',
        method: 'POST',
        body: { note: 'Journey hot lead' },
      },
      position: { x: 800, y: 120 },
    },
  ],
  null,
  2
);

const defaultEdges = JSON.stringify(
  [
    { id: 'edge_1', fromNodeId: 'start_message', toNodeId: 'delay_1' },
    { id: 'edge_2', fromNodeId: 'delay_1', toNodeId: 'check_intent' },
    { id: 'edge_3', fromNodeId: 'check_intent', toNodeId: 'tag_hot', label: 'true' },
    { id: 'edge_4', fromNodeId: 'check_intent', toNodeId: 'notify_crm', label: 'false' },
  ],
  null,
  2
);

const safeJson = (value: string) => {
  try {
    return { ok: true, data: JSON.parse(value) } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
};

export default function JourneysPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [journeyError, setJourneyError] = useState('');
  const [journeyStatus, setJourneyStatus] = useState('');
  const [selectedJourneyId, setSelectedJourneyId] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [triggersText, setTriggersText] = useState(defaultTriggers);
  const [nodesText, setNodesText] = useState(defaultNodes);
  const [edgesText, setEdgesText] = useState(defaultEdges);

  const [runs, setRuns] = useState<JourneyRun[]>([]);
  const [runsError, setRunsError] = useState('');
  const [runsLoading, setRunsLoading] = useState(false);

  useEffect(() => {
    const savedKey = window.localStorage.getItem(storageKeys.apiKey) ?? '';
    const savedBase = window.localStorage.getItem(storageKeys.apiBase) ?? '';
    const savedDraft = window.localStorage.getItem(storageKeys.journeyDraft) ?? '';

    setApiKey(savedKey);
    setApiBase(savedBase);

    if (savedDraft) {
      const parsed = safeJson(savedDraft);
      if (parsed.ok) {
        const draft = parsed.data as Record<string, unknown>;
        if (typeof draft.name === 'string') setName(draft.name);
        if (typeof draft.description === 'string') setDescription(draft.description);
        if (typeof draft.status === 'string') setStatus(draft.status);
        if (typeof draft.triggersText === 'string') setTriggersText(draft.triggersText);
        if (typeof draft.nodesText === 'string') setNodesText(draft.nodesText);
        if (typeof draft.edgesText === 'string') setEdgesText(draft.edgesText);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.apiKey, apiKey);
  }, [apiKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.apiBase, apiBase);
  }, [apiBase]);

  useEffect(() => {
    window.localStorage.setItem(
      storageKeys.journeyDraft,
      JSON.stringify({ name, description, status, triggersText, nodesText, edgesText })
    );
  }, [name, description, status, triggersText, nodesText, edgesText]);

  const resolvedBase = useMemo(() => {
    const base = apiBase.trim();
    if (!base) return '';
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }, [apiBase]);

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

  const loadJourneys = async () => {
    setJourneyError('');
    setJourneyStatus('');
    try {
      const data = await apiFetch<{ journeys: Journey[] }>('/v1/journeys');
      setJourneys(data.journeys ?? []);
    } catch (err) {
      setJourneyError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadRuns = async (journeyId: string) => {
    if (!journeyId) return;
    setRunsError('');
    setRunsLoading(true);
    try {
      const data = await apiFetch<{ runs: JourneyRun[] }>(`/v1/journeys/${journeyId}/runs`);
      setRuns(data.runs ?? []);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunsLoading(false);
    }
  };

  const applySelectedJourney = () => {
    const selected = journeys.find((journey) => journey.id === selectedJourneyId);
    if (!selected) return;
    setName(selected.name ?? '');
    setDescription(selected.description ?? '');
    setStatus(selected.status ?? 'draft');
    setTriggersText(JSON.stringify(selected.triggers ?? [], null, 2));
    setNodesText(JSON.stringify(selected.nodes ?? [], null, 2));
    setEdgesText(JSON.stringify(selected.edges ?? [], null, 2));
    void loadRuns(selected.id);
  };

  const parseJourneyPayload = () => {
    const triggersJson = safeJson(triggersText);
    const nodesJson = safeJson(nodesText);
    const edgesJson = safeJson(edgesText);

    if (!triggersJson.ok) throw new Error('Triggers JSON invalid');
    if (!nodesJson.ok) throw new Error('Nodes JSON invalid');
    if (!edgesJson.ok) throw new Error('Edges JSON invalid');

    return {
      name: name.trim(),
      description: description.trim() || null,
      status,
      triggers: triggersJson.data,
      nodes: nodesJson.data,
      edges: edgesJson.data,
    } as const;
  };

  const createJourney = async () => {
    setJourneyError('');
    setJourneyStatus('');
    try {
      const payload = parseJourneyPayload();
      if (!payload.name) {
        setJourneyError('Name is required.');
        return;
      }
      const data = await apiFetch<{ journey: Journey }>('/v1/journeys', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setJourneyStatus('Journey created.');
      setJourneys((prev) => [data.journey, ...prev]);
      setSelectedJourneyId(data.journey.id);
      void loadRuns(data.journey.id);
    } catch (err) {
      setJourneyError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateJourney = async () => {
    setJourneyError('');
    setJourneyStatus('');
    if (!selectedJourneyId) {
      setJourneyError('Select a journey.');
      return;
    }
    try {
      const payload = parseJourneyPayload();
      const data = await apiFetch<{ journey: Journey }>(`/v1/journeys/${selectedJourneyId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setJourneyStatus('Journey updated.');
      setJourneys((prev) =>
        prev.map((item) => (item.id === selectedJourneyId ? data.journey : item))
      );
    } catch (err) {
      setJourneyError(err instanceof Error ? err.message : String(err));
    }
  };

  const selectedJourney = journeys.find((journey) => journey.id === selectedJourneyId) ?? null;

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">Journey orchestration</h1>
            </div>
            <Button variant="outline" asChild>
              <Link href="/">Back to console</Link>
            </Button>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Build WhatsApp journeys with triggers, branches, delays, tags, and webhooks.
          </p>
        </header>

        <Card className="surface-grid">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Connection</CardTitle>
              <CardDescription>Provide API base and key to manage journeys.</CardDescription>
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
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>Journey canvas</CardTitle>
                  <CardDescription>Define triggers, nodes, and edges as JSON.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={loadJourneys}>
                    Load journeys
                  </Button>
                  <Button variant="outline" onClick={applySelectedJourney}>
                    Load selected
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="flex h-10 w-full rounded-md border border-ink/10 bg-surface/80 px-3 py-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="paused">paused</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Description</Label>
                  <Input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Short journey summary"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Triggers (JSON)</Label>
                  <Textarea
                    value={triggersText}
                    onChange={(event) => setTriggersText(event.target.value)}
                    className="min-h-[150px]"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Nodes (JSON)</Label>
                  <Textarea
                    value={nodesText}
                    onChange={(event) => setNodesText(event.target.value)}
                    className="min-h-[200px]"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Edges (JSON)</Label>
                  <Textarea
                    value={edgesText}
                    onChange={(event) => setEdgesText(event.target.value)}
                    className="min-h-[140px]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={createJourney}>Create journey</Button>
                <Button variant="outline" onClick={updateJourney}>
                  Update selected
                </Button>
                {journeyStatus ? <span className="text-xs text-accent">{journeyStatus}</span> : null}
                {journeyError ? <span className="text-xs text-accent2">{journeyError}</span> : null}
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <div className="flex flex-col gap-4">
                <div className="space-y-1">
                  <CardTitle>Journeys</CardTitle>
                  <CardDescription>Select a journey to inspect runs.</CardDescription>
                </div>
                <div className="space-y-3">
                  {journeys.length === 0 ? (
                    <p className="text-sm text-muted">No journeys yet.</p>
                  ) : (
                    journeys.map((journey) => (
                      <button
                        key={journey.id}
                        type="button"
                        onClick={() => {
                          setSelectedJourneyId(journey.id);
                          void loadRuns(journey.id);
                        }}
                        className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                          selectedJourneyId === journey.id
                            ? 'border-accent bg-accent/5'
                            : 'border-ink/10 bg-white/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{journey.name}</p>
                          <Badge variant="muted">{journey.status}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                          <span>{journey.triggers?.length ?? 0} triggers</span>
                          <span>{journey.nodes?.length ?? 0} nodes</span>
                          <span>{journey.edges?.length ?? 0} edges</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex flex-col gap-4">
                <div className="space-y-1">
                  <CardTitle>Runs</CardTitle>
                  <CardDescription>
                    {selectedJourney
                      ? `Recent executions for ${selectedJourney.name}.`
                      : 'Select a journey to load runs.'}
                  </CardDescription>
                </div>
                {runsLoading ? (
                  <p className="text-sm text-muted">Loading runs...</p>
                ) : runs.length === 0 ? (
                  <p className="text-sm text-muted">No runs yet.</p>
                ) : (
                  <div className="space-y-3">
                    {runs.map((run) => (
                      <div key={run.id} className="rounded-xl border border-ink/10 bg-white/70 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{run.triggerType}</p>
                          <Badge variant="muted">{run.status}</Badge>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted">
                          <span>Lead: {run.leadId ?? 'n/a'}</span>
                          <span>Channel: {run.channelId ?? 'n/a'}</span>
                          <span>Steps: {run.steps?.length ?? 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {runsError ? <span className="text-xs text-accent2">{runsError}</span> : null}
              </div>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
