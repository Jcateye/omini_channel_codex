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
    } catch (error) {
      setSignalError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (apiKey && leadId) {
      void loadLead();
    }
  }, [apiKey, leadId]);

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
      </div>
    </main>
  );
}
