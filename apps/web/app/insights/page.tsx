'use client';

import Link from 'next/link';
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

type TaxonomyIntent = {
  id: string;
  name: string;
};

type IntentRow = {
  id: string;
  intent: string;
  count: number;
  sampleMessages?: string[] | null;
};

type ClusterRow = {
  id: string;
  label: string;
  count: number;
  sampleMessages?: string[] | null;
};

type SuggestionRow = {
  id: string;
  intent: string;
  suggestions: string[];
};

type InsightResponse<T> = {
  windowStart: string | null;
  intents?: T[];
  clusters?: T[];
  suggestions?: T[];
};

export default function InsightsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [windowStart, setWindowStart] = useState('');
  const [taxonomy, setTaxonomy] = useState<TaxonomyIntent[]>([]);

  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [intentWindow, setIntentWindow] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [clusterWindow, setClusterWindow] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [suggestionWindow, setSuggestionWindow] = useState<string | null>(null);

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

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

  const loadTaxonomy = async () => {
    setError('');
    try {
      const data = await apiFetch<{ intents: TaxonomyIntent[] }>('/v1/insights/intents/taxonomy');
      setTaxonomy(data.intents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadInsights = async () => {
    setError('');
    setStatus('');

    try {
      const query = windowStart.trim() ? `?windowStart=${encodeURIComponent(windowStart.trim())}` : '';
      const [intentData, clusterData, suggestionData] = await Promise.all([
        apiFetch<InsightResponse<IntentRow>>(`/v1/insights/intents${query}`),
        apiFetch<InsightResponse<ClusterRow>>(`/v1/insights/clusters${query}`),
        apiFetch<InsightResponse<SuggestionRow>>(`/v1/insights/suggestions${query}`),
      ]);

      setIntents(intentData.intents ?? []);
      setIntentWindow(intentData.windowStart ?? null);
      setClusters(clusterData.clusters ?? []);
      setClusterWindow(clusterData.windowStart ?? null);
      setSuggestions(suggestionData.suggestions ?? []);
      setSuggestionWindow(suggestionData.windowStart ?? null);
      setStatus('Insights loaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">AI insights</h1>
            </div>
            <Button variant="outline" asChild>
              <Link href="/">Back to console</Link>
            </Button>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Real-time intent, cluster, and reply insight windows (1-minute aggregation).
          </p>
        </header>

        <Card className="surface-grid">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Connection</CardTitle>
              <CardDescription>Provide API base and key to load insight windows.</CardDescription>
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
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-2">
                <Label>Window start (optional ISO time)</Label>
                <Input
                  placeholder="2025-01-01T00:00:00Z"
                  value={windowStart}
                  onChange={(event) => setWindowStart(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={loadTaxonomy}>
                  Load taxonomy
                </Button>
              </div>
              <div className="flex items-end">
                <Button onClick={loadInsights}>Load insights</Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {status ? <span className="text-accent">{status}</span> : null}
              {error ? <span className="text-accent2">{error}</span> : null}
            </div>
          </div>
        </Card>

        <section className="grid gap-6 lg:grid-cols-3">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Intent taxonomy</CardTitle>
                <CardDescription>Default labels for insight classification.</CardDescription>
              </div>
              {taxonomy.length === 0 ? (
                <p className="text-sm text-muted">No taxonomy loaded.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {taxonomy.map((intent) => (
                    <Badge key={intent.id} variant="muted">
                      {intent.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Intent window</CardTitle>
                <CardDescription>{intentWindow ?? 'No window loaded yet.'}</CardDescription>
              </div>
              {intents.length === 0 ? (
                <p className="text-sm text-muted">No intent signals yet.</p>
              ) : (
                <div className="space-y-3">
                  {intents.map((intent) => (
                    <div key={intent.id} className="rounded-xl border border-ink/10 bg-white/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{intent.intent}</p>
                        <Badge variant="muted">{intent.count}</Badge>
                      </div>
                      {intent.sampleMessages?.length ? (
                        <ul className="mt-2 space-y-1 text-xs text-muted">
                          {intent.sampleMessages.map((sample, index) => (
                            <li key={`${intent.id}-sample-${index}`}>{sample}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Clusters</CardTitle>
                <CardDescription>{clusterWindow ?? 'No window loaded yet.'}</CardDescription>
              </div>
              {clusters.length === 0 ? (
                <p className="text-sm text-muted">No cluster signals yet.</p>
              ) : (
                <div className="space-y-3">
                  {clusters.map((cluster) => (
                    <div key={cluster.id} className="rounded-xl border border-ink/10 bg-white/70 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{cluster.label}</p>
                        <Badge variant="muted">{cluster.count}</Badge>
                      </div>
                      {cluster.sampleMessages?.length ? (
                        <ul className="mt-2 space-y-1 text-xs text-muted">
                          {cluster.sampleMessages.map((sample, index) => (
                            <li key={`${cluster.id}-sample-${index}`}>{sample}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </section>

        <Card>
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Reply suggestions</CardTitle>
              <CardDescription>{suggestionWindow ?? 'No window loaded yet.'}</CardDescription>
            </div>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted">No suggestions yet.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="rounded-xl border border-ink/10 bg-white/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{suggestion.intent}</p>
                      <Badge variant="muted">{suggestion.suggestions.length}</Badge>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {suggestion.suggestions.map((text, index) => (
                        <li key={`${suggestion.id}-suggestion-${index}`}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
