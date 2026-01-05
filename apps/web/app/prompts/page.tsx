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

type PromptMetric = {
  prompt: {
    id: string;
    name: string;
    version: string;
    active: boolean;
  };
  totals: {
    success: number;
    failure: number;
    unknown: number;
    total: number;
  };
  successRate: number;
};

export default function PromptMetricsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [metrics, setMetrics] = useState<PromptMetric[]>([]);
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

  const loadMetrics = async () => {
    setError('');
    try {
      const data = await apiFetch<{ metrics: PromptMetric[] }>('/v1/prompts/metrics');
      setMetrics(data.metrics ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">Prompt performance</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/tools">Tools</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">Back to console</Link>
              </Button>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Track prompt usage outcomes and success rates.
          </p>
        </header>

        <Card className="surface-grid">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Connection</CardTitle>
              <CardDescription>Use the same API base and key as other console pages.</CardDescription>
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
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={loadMetrics}>Load metrics</Button>
              {error ? <span className="text-xs text-accent2">{error}</span> : null}
            </div>
          </div>
        </Card>

        <section className="space-y-4">
          {metrics.length === 0 ? (
            <p className="text-sm text-muted">No prompt metrics yet.</p>
          ) : (
            metrics.map((metric) => (
              <Card key={metric.prompt.id}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle>{metric.prompt.name}</CardTitle>
                      <CardDescription>
                        Version {metric.prompt.version} ·{' '}
                        {metric.prompt.active ? 'active' : 'inactive'}
                      </CardDescription>
                    </div>
                    <Badge variant={metric.successRate > 0.5 ? 'accent' : 'muted'}>
                      Success {(metric.successRate * 100).toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted">
                    <span>Total {metric.totals.total}</span>
                    <span>Success {metric.totals.success}</span>
                    <span>Failure {metric.totals.failure}</span>
                    <span>Unknown {metric.totals.unknown}</span>
                  </div>
                </div>
              </Card>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
