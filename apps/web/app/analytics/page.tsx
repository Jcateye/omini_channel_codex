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

type SummaryResponse = {
  range: { start: string; end: string };
  totals: {
    outboundSent: number;
    outboundDelivered: number;
    outboundFailed: number;
    inboundCount: number;
    responseCount: number;
    leadCreated: number;
    leadConverted: number;
    attributedConversions: number;
  };
  rates: {
    deliveryRate: number;
    responseRate: number;
    conversionRate: number;
  };
};

type AnalyticsSettings = {
  attributionLookbackDays: number;
  aggregationDays: number;
  realtimeWindowMinutes: number;
};

type ChannelMetric = {
  channel: {
    id: string;
    name: string;
    platform: string;
    provider?: string | null;
  } | null;
  outboundSent: number;
  outboundDelivered: number;
  outboundFailed: number;
  inboundCount: number;
  responseCount: number;
  attributedConversions: number;
  deliveryRate: number;
  responseRate: number;
};

type CampaignMetric = {
  campaign: {
    id: string;
    name: string;
    cost?: number | null;
    revenue?: number | null;
    status?: string | null;
  } | null;
  outboundSent: number;
  outboundDelivered: number;
  outboundFailed: number;
  attributedConversions: number;
  deliveryRate: number;
  roi?: number | null;
};

type RealtimeResponse = {
  windowMinutes: number;
  range: { start: string; end: string };
  totals: {
    outboundSent: number;
    outboundDelivered: number;
    outboundFailed: number;
    inboundCount: number;
    responseCount: number;
    leadCreated: number;
    leadConverted: number;
  };
  rates: {
    deliveryRate: number;
    responseRate: number;
    conversionRate: number;
  };
};

type TrendChannel = {
  channel: ChannelMetric['channel'];
  points: Array<{
    date: string;
    outboundSent: number;
    outboundDelivered: number;
    outboundFailed: number;
    inboundCount: number;
    responseCount: number;
    attributedConversions: number;
    deliveryRate: number;
    responseRate: number;
  }>;
};

type TrendCampaign = {
  campaign: CampaignMetric['campaign'];
  roi?: number | null;
  points: Array<{
    date: string;
    outboundSent: number;
    outboundDelivered: number;
    outboundFailed: number;
    attributedConversions: number;
    deliveryRate: number;
  }>;
};

export default function AnalyticsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [channels, setChannels] = useState<ChannelMetric[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignMetric[]>([]);
  const [realtime, setRealtime] = useState<RealtimeResponse | null>(null);
  const [settings, setSettings] = useState<AnalyticsSettings>({
    attributionLookbackDays: 7,
    aggregationDays: 30,
    realtimeWindowMinutes: 60,
  });
  const [settingsStatus, setSettingsStatus] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [realtimeWindowMinutes, setRealtimeWindowMinutes] = useState(60);
  const [channelTrends, setChannelTrends] = useState<TrendChannel[]>([]);
  const [campaignTrends, setCampaignTrends] = useState<TrendCampaign[]>([]);

  const [loading, setLoading] = useState(false);
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

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (startDate) params.set('start', startDate);
    if (endDate) params.set('end', endDate);
    const value = params.toString();
    return value ? `?${value}` : '';
  };

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

  const loadSettings = async () => {
    setSettingsError('');
    setSettingsStatus('');
    try {
      const data = await apiFetch<{ analytics: AnalyticsSettings }>(
        '/v1/analytics/settings'
      );
      setSettings(data.analytics);
      setRealtimeWindowMinutes(data.analytics.realtimeWindowMinutes);
      setSettingsStatus('Settings loaded.');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveSettings = async () => {
    setSettingsError('');
    setSettingsStatus('');
    try {
      const payload = {
        analytics: {
          ...settings,
          realtimeWindowMinutes,
        },
      };
      const data = await apiFetch<{ analytics: AnalyticsSettings }>(
        '/v1/analytics/settings',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      );
      setSettings(data.analytics);
      setSettingsStatus('Settings saved.');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadRealtime = async () => {
    setError('');
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('windowMinutes', String(realtimeWindowMinutes));
      const data = await apiFetch<RealtimeResponse>(`/v1/analytics/realtime?${query.toString()}`);
      setRealtime(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setError('');
    setLoading(true);

    try {
      const query = buildQuery();
      const [summaryData, channelData, campaignData] = await Promise.all([
        apiFetch<SummaryResponse>(`/v1/analytics/summary${query}`),
        apiFetch<{ channels: ChannelMetric[] }>(`/v1/analytics/channels${query}`),
        apiFetch<{ campaigns: CampaignMetric[] }>(`/v1/analytics/campaigns${query}`),
      ]);

      setSummary(summaryData);
      setChannels(channelData.channels ?? []);
      setCampaigns(campaignData.campaigns ?? []);
      const [trendChannelsData, trendCampaignsData] = await Promise.all([
        apiFetch<{ channels: TrendChannel[] }>(`/v1/analytics/trends/channels${query}`),
        apiFetch<{ campaigns: TrendCampaign[] }>(`/v1/analytics/trends/campaigns${query}`),
      ]);
      setChannelTrends(trendChannelsData.channels ?? []);
      setCampaignTrends(trendCampaignsData.campaigns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">Analytics dashboard</h1>
            </div>
            <Button variant="outline" asChild>
              <Link href="/">Back to console</Link>
            </Button>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Track delivery, responses, conversions, and last-touch attribution.
          </p>
        </header>

        <Card className="surface-grid">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Connection</CardTitle>
              <CardDescription>Provide API base and key to load metrics.</CardDescription>
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

        <Card>
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Analytics settings</CardTitle>
              <CardDescription>Configure attribution and aggregation windows.</CardDescription>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Lookback days</Label>
                <Input
                  type="number"
                  value={settings.attributionLookbackDays}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      attributionLookbackDays: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Aggregation days</Label>
                <Input
                  type="number"
                  value={settings.aggregationDays}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      aggregationDays: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Realtime window (minutes)</Label>
                <Input
                  type="number"
                  value={realtimeWindowMinutes}
                  onChange={(event) => setRealtimeWindowMinutes(Number(event.target.value))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={loadSettings}>
                Load settings
              </Button>
              <Button onClick={saveSettings}>Save settings</Button>
              {settingsStatus ? <span className="text-xs text-accent">{settingsStatus}</span> : null}
              {settingsError ? <span className="text-xs text-accent2">{settingsError}</span> : null}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <CardTitle>Date range</CardTitle>
              <CardDescription>Defaults to last 7 days if empty.</CardDescription>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={loadAnalytics} disabled={loading}>
                {loading ? 'Loading...' : 'Load analytics'}
              </Button>
              <Button variant="outline" onClick={loadRealtime} disabled={loading}>
                Load realtime snapshot
              </Button>
              {error ? <span className="text-xs text-accent2">{error}</span> : null}
            </div>
          </div>
        </Card>

        <section className="grid gap-6 lg:grid-cols-3">
          <Card>
            <div className="space-y-2">
              <CardDescription>Realtime outbound</CardDescription>
              <CardTitle>{realtime?.totals.outboundSent ?? 0}</CardTitle>
              <span className="text-xs text-muted">
                Delivery {((realtime?.rates.deliveryRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </Card>
          <Card>
            <div className="space-y-2">
              <CardDescription>Realtime responses</CardDescription>
              <CardTitle>{realtime?.totals.responseCount ?? 0}</CardTitle>
              <span className="text-xs text-muted">
                Response {((realtime?.rates.responseRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </Card>
          <Card>
            <div className="space-y-2">
              <CardDescription>Realtime conversions</CardDescription>
              <CardTitle>{realtime?.totals.leadConverted ?? 0}</CardTitle>
              <span className="text-xs text-muted">
                Conversion {((realtime?.rates.conversionRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-4">
          <Card>
            <div className="space-y-2">
              <CardDescription>Outbound sent</CardDescription>
              <CardTitle>{summary?.totals.outboundSent ?? 0}</CardTitle>
              <span className="text-xs text-muted">
                Delivery rate {((summary?.rates.deliveryRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </Card>
          <Card>
            <div className="space-y-2">
              <CardDescription>Inbound responses</CardDescription>
              <CardTitle>{summary?.totals.responseCount ?? 0}</CardTitle>
              <span className="text-xs text-muted">
                Response rate {((summary?.rates.responseRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </Card>
          <Card>
            <div className="space-y-2">
              <CardDescription>Lead conversions</CardDescription>
              <CardTitle>{summary?.totals.leadConverted ?? 0}</CardTitle>
              <span className="text-xs text-muted">
                Conversion rate {((summary?.rates.conversionRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </Card>
          <Card>
            <div className="space-y-2">
              <CardDescription>Attributed conversions</CardDescription>
              <CardTitle>{summary?.totals.attributedConversions ?? 0}</CardTitle>
              <span className="text-xs text-muted">Last-touch model</span>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Channel trends</CardTitle>
                <CardDescription>Daily delivery and response rates.</CardDescription>
              </div>
              {channelTrends.length === 0 ? (
                <p className="text-sm text-muted">No channel trends yet.</p>
              ) : (
                <div className="space-y-4">
                  {channelTrends.map((series, index) => (
                    <div
                      key={series.channel?.id ?? `channel-trend-${index}`}
                      className="rounded-xl border border-ink/10 bg-white/70 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">
                          {series.channel?.name ?? series.channel?.id ?? 'Channel'}
                        </p>
                        <Badge variant="muted">{series.points.length} days</Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted">
                        {series.points.map((point) => (
                          <div key={point.date} className="flex flex-wrap justify-between gap-2">
                            <span>{point.date.slice(0, 10)}</span>
                            <span>Sent {point.outboundSent}</span>
                            <span>Delivered {(point.deliveryRate * 100).toFixed(1)}%</span>
                            <span>Responses {(point.responseRate * 100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Campaign trends</CardTitle>
                <CardDescription>Daily delivery and attribution.</CardDescription>
              </div>
              {campaignTrends.length === 0 ? (
                <p className="text-sm text-muted">No campaign trends yet.</p>
              ) : (
                <div className="space-y-4">
                  {campaignTrends.map((series, index) => (
                    <div
                      key={series.campaign?.id ?? `campaign-trend-${index}`}
                      className="rounded-xl border border-ink/10 bg-white/70 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">
                          {series.campaign?.name ?? series.campaign?.id ?? 'Campaign'}
                        </p>
                        <Badge variant={series.roi && series.roi > 0 ? 'accent' : 'muted'}>
                          ROI {series.roi !== null && series.roi !== undefined ? (series.roi * 100).toFixed(1) : 'n/a'}%
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted">
                        {series.points.map((point) => (
                          <div key={point.date} className="flex flex-wrap justify-between gap-2">
                            <span>{point.date.slice(0, 10)}</span>
                            <span>Sent {point.outboundSent}</span>
                            <span>Delivered {(point.deliveryRate * 100).toFixed(1)}%</span>
                            <span>Attributed {point.attributedConversions}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Channels</CardTitle>
                <CardDescription>Delivery, response, and attribution per channel.</CardDescription>
              </div>
              {channels.length === 0 ? (
                <p className="text-sm text-muted">No channel metrics yet.</p>
              ) : (
                <div className="space-y-3">
                  {channels.map((row, index) => (
                    <div
                      key={row.channel?.id ?? `channel-${index}`}
                      className="rounded-xl border border-ink/10 bg-white/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">
                            {row.channel?.name ?? row.channel?.id ?? 'Unknown channel'}
                          </p>
                          <p className="text-xs text-muted">
                            {row.channel?.platform ?? 'channel'} · {row.channel?.provider ?? 'n/a'}
                          </p>
                        </div>
                        <Badge variant="muted">
                          {(row.deliveryRate * 100).toFixed(1)}% delivered
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                        <span>Outbound: {row.outboundSent}</span>
                        <span>Inbound: {row.inboundCount}</span>
                        <span>Responses: {row.responseCount}</span>
                        <span>Attributed: {row.attributedConversions}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Campaigns</CardTitle>
                <CardDescription>Delivery, attribution, and ROI per campaign.</CardDescription>
              </div>
              {campaigns.length === 0 ? (
                <p className="text-sm text-muted">No campaign metrics yet.</p>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((row, index) => (
                    <div
                      key={row.campaign?.id ?? `campaign-${index}`}
                      className="rounded-xl border border-ink/10 bg-white/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">
                            {row.campaign?.name ?? row.campaign?.id ?? 'Campaign'}
                          </p>
                          <p className="text-xs text-muted">
                            Status: {row.campaign?.status ?? 'n/a'}
                          </p>
                        </div>
                        <Badge variant={row.roi && row.roi > 0 ? 'accent' : 'muted'}>
                          ROI {row.roi !== null && row.roi !== undefined ? (row.roi * 100).toFixed(1) : 'n/a'}%
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                        <span>Outbound: {row.outboundSent}</span>
                        <span>Delivered: {row.outboundDelivered}</span>
                        <span>Attributed: {row.attributedConversions}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
