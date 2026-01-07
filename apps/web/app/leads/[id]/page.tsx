'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const storageKeys = {
  apiKey: 'omini_api_key',
  apiBase: 'omini_api_base',
};

type Lead = {
  id: string;
  stage: string;
  score?: number | null;
  tags: string[];
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  lastActivityAt?: string | null;
  contact?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
};

type SignalResponse = {
  lead?: Lead;
  matchedRules?: Array<{ id?: string; name?: string }>;
  updates?: Record<string, unknown>;
};

type AgentRun = {
  id: string;
  type: string;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  createdAt: string;
};

type AgentRunStep = {
  id: string;
  stepIndex: number;
  stepType: string;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  startedAt: string;
  finishedAt?: string | null;
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
  } | null;
};

const normalizeTags = (input: string) =>
  input
    .split(',')
    .map((signal) => signal.trim())
    .filter((signal) => signal.length > 0);

export default function LeadDetailPage() {
  const params = useParams();
  const leadId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadError, setLeadError] = useState('');
  const [leadLoading, setLeadLoading] = useState(false);

  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentRunsLoading, setAgentRunsLoading] = useState(false);
  const [agentRunsError, setAgentRunsError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runSteps, setRunSteps] = useState<AgentRunStep[]>([]);
  const [runStepsError, setRunStepsError] = useState('');

  const [optimizations, setOptimizations] = useState<Optimization[]>([]);
  const [optimizationsLoading, setOptimizationsLoading] = useState(false);
  const [optimizationsError, setOptimizationsError] = useState('');
  const [optimizationStatusFilter, setOptimizationStatusFilter] = useState('pending');
  const [optimizationCampaignFilter, setOptimizationCampaignFilter] = useState('');

  const [signalTags, setSignalTags] = useState('purchase');
  const [signalText, setSignalText] = useState('ready to buy');
  const [signalStatus, setSignalStatus] = useState('');
  const [signalError, setSignalError] = useState('');
  const [signalResponse, setSignalResponse] = useState('');

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

  const loadAgentRuns = async () => {
    if (!leadId) {
      setAgentRunsError('Missing lead id.');
      return;
    }

    setAgentRunsError('');
    setAgentRunsLoading(true);
    try {
      const data = await apiFetch<{ runs: AgentRun[] }>(
        `/v1/agent/runs?leadId=${encodeURIComponent(leadId)}`
      );
      const runs = data.runs ?? [];
      setAgentRuns(runs);
      if (!selectedRunId && runs.length > 0) {
        setSelectedRunId(runs[0].id);
      }
    } catch (error) {
      setAgentRunsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentRunsLoading(false);
    }
  };

  const loadRunSteps = async (runId: string) => {
    if (!runId) {
      setRunSteps([]);
      return;
    }
    setRunStepsError('');
    try {
      const data = await apiFetch<{ steps: AgentRunStep[] }>(
        `/v1/agent/runs/${runId}/steps`
      );
      setRunSteps(data.steps ?? []);
    } catch (error) {
      setRunStepsError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadOptimizations = async () => {
    setOptimizationsError('');
    setOptimizationsLoading(true);
    try {
      const params = new URLSearchParams();
      if (optimizationStatusFilter.trim()) {
        params.set('status', optimizationStatusFilter.trim());
      }
      if (optimizationCampaignFilter.trim()) {
        params.set('campaignId', optimizationCampaignFilter.trim());
      }
      const data = await apiFetch<{ optimizations: Optimization[] }>(
        `/v1/agent/optimizations${params.toString() ? `?${params.toString()}` : ''}`
      );
      setOptimizations(data.optimizations ?? []);
    } catch (error) {
      setOptimizationsError(error instanceof Error ? error.message : String(error));
    } finally {
      setOptimizationsLoading(false);
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

  const loadLead = async () => {
    if (!leadId) {
      setLeadError('Missing lead id.');
      return;
    }

    setLeadError('');
    setLeadLoading(true);

    try {
      const data = await apiFetch<{ leads: Lead[] }>('/v1/leads?limit=200&offset=0');
      const found = data.leads?.find((item) => item.id === leadId) ?? null;

      if (!found) {
        setLead(null);
        setLeadError('Lead not found in the latest 200 records.');
      } else {
        setLead(found);
      }
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLeadLoading(false);
    }
  };

  const sendSignals = async () => {
    setSignalStatus('');
    setSignalError('');
    setSignalResponse('');

    if (!leadId) {
      setSignalError('Missing lead id.');
      return;
    }

    const signals = normalizeTags(signalTags);

    if (signals.length === 0 && !signalText.trim()) {
      setSignalError('Provide signals or text.');
      return;
    }

    try {
      const data = await apiFetch<SignalResponse>(`/v1/leads/${leadId}/signals`, {
        method: 'POST',
        body: JSON.stringify({
          signals,
          text: signalText.trim() || undefined,
        }),
      });

      if (data.lead) {
        setLead(data.lead);
      }

      setSignalResponse(JSON.stringify(data, null, 2));
      setSignalStatus('Signals delivered.');
      await loadAgentRuns();
    } catch (error) {
      setSignalError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (apiKey && leadId) {
      void loadLead();
      void loadAgentRuns();
      void loadOptimizations();
    }
  }, [apiKey, leadId]);

  useEffect(() => {
    if (apiKey && selectedRunId) {
      void loadRunSteps(selectedRunId);
    }
  }, [apiKey, selectedRunId]);

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold sm:text-4xl">Lead detail</h1>
            <Badge variant="muted">{leadId ?? 'unknown'}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Inspect lead attributes, tags, metadata, and run a signal evaluation to see rule
            matches.
          </p>
          <Link href="/" className="text-sm text-accent hover:underline">
            Back to console
          </Link>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="surface-grid animate-rise" style={{ animationDelay: '60ms' }}>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Connection</CardTitle>
                <CardDescription>Ensure API base and key are configured.</CardDescription>
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
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={loadLead}>
                  {leadLoading ? 'Loading...' : 'Reload lead'}
                </Button>
                {leadError ? <span className="text-xs text-accent2">{leadError}</span> : null}
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '120ms' }}>
            <div className="space-y-3">
              <CardTitle>Status snapshot</CardTitle>
              <CardDescription>Latest known lead state.</CardDescription>
              {lead ? (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent">{lead.stage}</Badge>
                    <Badge variant="muted">Score {lead.score ?? 0}</Badge>
                    {lead.source ? <Badge>{lead.source}</Badge> : null}
                  </div>
                  <div className="space-y-1 text-xs text-muted">
                    <p>Created: {lead.createdAt}</p>
                    <p>Last active: {lead.lastActivityAt ?? lead.createdAt}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No lead loaded yet.</p>
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="animate-rise" style={{ animationDelay: '180ms' }}>
            <div className="space-y-4">
              <CardTitle>Lead profile</CardTitle>
              <CardDescription>Contact, tags, and metadata.</CardDescription>
              {lead ? (
                <div className="space-y-3 text-sm">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      {lead.contact?.name || lead.contact?.phone || 'Unknown lead'}
                    </p>
                    <p className="text-xs text-muted">{lead.contact?.email ?? 'No email'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted">Tags:</span>
                    {lead.tags.length > 0 ? (
                      lead.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                    ) : (
                      <Badge variant="muted">none</Badge>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted">Metadata</p>
                    <pre className="whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                      {JSON.stringify(lead.metadata ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No lead loaded yet.</p>
              )}
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '240ms' }}>
            <div className="flex h-full flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Signals</CardTitle>
                <CardDescription>Trigger rule evaluation for this lead.</CardDescription>
              </div>
              <div className="space-y-2">
                <Label>Signals (comma separated)</Label>
                <Input value={signalTags} onChange={(event) => setSignalTags(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Text context</Label>
                <Input value={signalText} onChange={(event) => setSignalText(event.target.value)} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={sendSignals}>Send signals</Button>
                {signalStatus ? <span className="text-xs text-accent">{signalStatus}</span> : null}
                {signalError ? <span className="text-xs text-accent2">{signalError}</span> : null}
              </div>
              <div>
                <p className="text-xs text-muted">Latest response</p>
                <pre className="min-h-[180px] whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                  {signalResponse || 'No response yet.'}
                </pre>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise" style={{ animationDelay: '300ms' }}>
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Agent runs</CardTitle>
                <CardDescription>Agent scoring/distribution execution traces.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadAgentRuns}>
                  {agentRunsLoading ? 'Loading...' : 'Load runs'}
                </Button>
                {agentRunsError ? (
                  <span className="text-xs text-accent2">{agentRunsError}</span>
                ) : null}
              </div>
              <div className="space-y-3">
                {agentRuns.length === 0 ? (
                  <p className="text-sm text-muted">No agent runs yet.</p>
                ) : null}
                {agentRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`flex w-full flex-col gap-1 rounded-xl border border-ink/10 p-4 text-left transition ${
                      selectedRunId === run.id ? 'bg-white/80 ring-1 ring-accent/40' : 'bg-white/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{run.type}</span>
                      <Badge variant={run.status === 'completed' ? 'accent' : 'muted'}>
                        {run.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted">Run id: {run.id}</div>
                    <div className="text-xs text-muted">Created: {run.createdAt}</div>
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '360ms' }}>
            <div className="flex h-full flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Run steps</CardTitle>
                <CardDescription>Selected run execution details.</CardDescription>
              </div>
              {runStepsError ? (
                <span className="text-xs text-accent2">{runStepsError}</span>
              ) : null}
              <div className="space-y-3">
                {runSteps.length === 0 ? (
                  <p className="text-sm text-muted">Select a run to view steps.</p>
                ) : null}
                {runSteps.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          Step {step.stepIndex + 1}: {step.stepType}
                        </p>
                        <p className="text-xs text-muted">{step.id}</p>
                      </div>
                      <Badge variant={step.status === 'completed' ? 'accent' : 'muted'}>
                        {step.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted">
                      Started: {step.startedAt}
                    </div>
                    {step.output ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                        {JSON.stringify(step.output ?? {}, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6">
          <Card className="animate-rise" style={{ animationDelay: '420ms' }}>
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Campaign optimizations</CardTitle>
                <CardDescription>Latest optimization recommendations.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="status (pending/applied)"
                  value={optimizationStatusFilter}
                  onChange={(event) => setOptimizationStatusFilter(event.target.value)}
                />
                <Input
                  placeholder="campaign id (optional)"
                  value={optimizationCampaignFilter}
                  onChange={(event) => setOptimizationCampaignFilter(event.target.value)}
                />
                <Button variant="outline" onClick={loadOptimizations}>
                  {optimizationsLoading ? 'Loading...' : 'Load'}
                </Button>
              </div>
              {optimizationsError ? (
                <span className="text-xs text-accent2">{optimizationsError}</span>
              ) : null}
              <div className="space-y-3">
                {optimizations.length === 0 ? (
                  <p className="text-sm text-muted">No optimizations yet.</p>
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
      </div>
    </main>
  );
}
