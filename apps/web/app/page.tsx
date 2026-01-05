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
  rulesDraft: 'omini_rules_draft',
};

type Lead = {
  id: string;
  stage: string;
  score?: number | null;
  tags: string[];
  createdAt: string;
  lastActivityAt?: string | null;
  contact?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
};

type WebhookDelivery = {
  id: string;
  eventType: string;
  status: string;
  targetUrl: string;
  responseCode?: number | null;
  errorMessage?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Channel = {
  id: string;
  name: string;
  platform: string;
  provider?: string | null;
  externalId: string;
  status: string;
  credentials?: Record<string, unknown> | null;
  createdAt: string;
};

type Message = {
  id: string;
  externalId?: string | null;
  direction: string;
  status: string;
  content: Record<string, unknown>;
  createdAt: string;
  channel?: {
    id: string;
    name: string;
    provider?: string | null;
  } | null;
  contact?: {
    name?: string | null;
    phone?: string | null;
  } | null;
};

const safeJson = (value: string) => {
  try {
    return { ok: true, data: JSON.parse(value) } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
};

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [leadQuery, setLeadQuery] = useState('');
  const [leadStage, setLeadStage] = useState('');
  const [leadTag, setLeadTag] = useState('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState('');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');

  const [channelName, setChannelName] = useState('WA MessageBird');
  const [channelExternalId, setChannelExternalId] = useState('');
  const [channelProvider, setChannelProvider] = useState('messagebird');
  const [channelApiKey, setChannelApiKey] = useState('');
  const [channelFrom, setChannelFrom] = useState('');
  const [channelSenderId, setChannelSenderId] = useState('');
  const [channelBaseUrl, setChannelBaseUrl] = useState('');
  const [channelStatus, setChannelStatus] = useState('');
  const [channelError, setChannelError] = useState('');

  const [sendChannelId, setSendChannelId] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendText, setSendText] = useState('Hello from Omini');
  const [sendStatus, setSendStatus] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendResponse, setSendResponse] = useState('');

  const [rulesText, setRulesText] = useState('[]');
  const [rulesStatus, setRulesStatus] = useState('');
  const [rulesError, setRulesError] = useState('');

  const [messageStatusFilter, setMessageStatusFilter] = useState('');
  const [messageChannelFilter, setMessageChannelFilter] = useState('');
  const [messageLimit, setMessageLimit] = useState(10);
  const [messageOffset, setMessageOffset] = useState(0);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');

  const [signalLeadId, setSignalLeadId] = useState('');
  const [signalText, setSignalText] = useState('ready to buy');
  const [signalTags, setSignalTags] = useState('purchase');
  const [signalStatus, setSignalStatus] = useState('');
  const [signalError, setSignalError] = useState('');
  const [signalResponse, setSignalResponse] = useState('');

  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('');
  const [deliveryEventFilter, setDeliveryEventFilter] = useState('');
  const [deliveryLimit, setDeliveryLimit] = useState(10);
  const [deliveryOffset, setDeliveryOffset] = useState(0);
  const [deliveryTotal, setDeliveryTotal] = useState(0);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState('');

  useEffect(() => {
    const savedKey = window.localStorage.getItem(storageKeys.apiKey) ?? '';
    const savedBase = window.localStorage.getItem(storageKeys.apiBase) ?? '';
    const savedRules = window.localStorage.getItem(storageKeys.rulesDraft) ?? '[]';

    setApiKey(savedKey);
    setApiBase(savedBase);
    setRulesText(savedRules);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.apiKey, apiKey);
  }, [apiKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.apiBase, apiBase);
  }, [apiBase]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.rulesDraft, rulesText);
  }, [rulesText]);

  const resolvedBase = useMemo(() => {
    const base = apiBase.trim();
    if (!base) return '';
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }, [apiBase]);

  useEffect(() => {
    if (selectedChannelId) {
      setSendChannelId(selectedChannelId);
    }
  }, [selectedChannelId]);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  );

  const buildWebhookUrl = (path: string) =>
    resolvedBase ? `${resolvedBase}${path}` : path;

  const selectedProvider = (selectedChannel?.provider ?? channelProvider).toLowerCase();
  const inboundWebhookUrl = selectedChannelId
    ? buildWebhookUrl(`/v1/webhooks/whatsapp/${selectedProvider}/${selectedChannelId}`)
    : '';
  const statusWebhookUrl = selectedChannelId
    ? buildWebhookUrl(`/v1/webhooks/whatsapp/${selectedProvider}/${selectedChannelId}/status`)
    : '';

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

  const loadLeads = async () => {
    setLeadsError('');
    setLeadsLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', '20');
      if (leadQuery.trim()) params.set('q', leadQuery.trim());
      if (leadStage) params.set('stage', leadStage);
      if (leadTag.trim()) params.set('tag', leadTag.trim());

      const data = await apiFetch<{ leads: Lead[] }>(`/v1/leads?${params.toString()}`);
      setLeads(data.leads ?? []);
    } catch (error) {
      setLeadsError(error instanceof Error ? error.message : String(error));
    } finally {
      setLeadsLoading(false);
    }
  };

  const loadChannels = async () => {
    setChannelsError('');
    setChannelsLoading(true);

    try {
      const data = await apiFetch<{ channels: Channel[] }>('/v1/channels');
      const whatsappChannels = (data.channels ?? []).filter(
        (channel) => channel.platform === 'whatsapp'
      );
      setChannels(whatsappChannels);
      if (!selectedChannelId && whatsappChannels.length > 0) {
        setSelectedChannelId(whatsappChannels[0].id);
      }
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setChannelsLoading(false);
    }
  };

  const createChannel = async () => {
    setChannelStatus('');
    setChannelError('');

    const name = channelName.trim();
    const externalId = channelExternalId.trim();
    const provider = channelProvider.trim().toLowerCase();
    const apiKey = channelApiKey.trim();
    const from = channelFrom.trim();
    const senderId = channelSenderId.trim();
    const baseUrl = channelBaseUrl.trim();

    if (!name || !externalId || !provider) {
      setChannelError('Provide name, external id, and provider.');
      return;
    }

    if (!apiKey) {
      setChannelError('MessageBird API key is required.');
      return;
    }

    if (!from && !senderId) {
      setChannelError('Provide from or channelId.');
      return;
    }

    const credentials: Record<string, unknown> = {
      apiKey,
    };

    if (from) credentials.from = from;
    if (senderId) credentials.channelId = senderId;
    if (baseUrl) credentials.baseUrl = baseUrl;

    try {
      const data = await apiFetch<{ channel: Channel }>('/v1/channels', {
        method: 'POST',
        body: JSON.stringify({
          name,
          platform: 'whatsapp',
          provider,
          externalId,
          credentials,
          settings: { mode: 'live' },
        }),
      });
      setChannels((prev) => [data.channel, ...prev]);
      setSelectedChannelId(data.channel.id);
      setChannelStatus('Channel created.');
    } catch (error) {
      setChannelError(error instanceof Error ? error.message : String(error));
    }
  };

  const sendMessage = async () => {
    setSendStatus('');
    setSendError('');
    setSendResponse('');

    const channelId = sendChannelId.trim();
    const to = sendTo.trim();
    const text = sendText.trim();

    if (!channelId || !to || !text) {
      setSendError('Provide channel id, recipient, and text.');
      return;
    }

    try {
      const data = await apiFetch(`/v1/whatsapp/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          to,
          text,
        }),
      });
      setSendResponse(JSON.stringify(data, null, 2));
      setSendStatus('Message queued.');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadMessages = async (nextOffset = messageOffset) => {
    setMessagesError('');
    setMessagesLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(messageLimit));
      params.set('offset', String(nextOffset));
      if (messageStatusFilter.trim()) params.set('status', messageStatusFilter.trim());
      if (messageChannelFilter.trim()) params.set('channelId', messageChannelFilter.trim());

      const data = await apiFetch<{
        messages: Message[];
        total: number;
      }>(`/v1/messages?${params.toString()}`);

      setMessages(data.messages ?? []);
      setMessageTotal(data.total ?? 0);
      setMessageOffset(nextOffset);
    } catch (error) {
      setMessagesError(error instanceof Error ? error.message : String(error));
    } finally {
      setMessagesLoading(false);
    }
  };

  const loadRules = async () => {
    setRulesStatus('');
    setRulesError('');
    try {
      const data = await apiFetch<{ leadRules: unknown[] }>('/v1/lead-rules');
      setRulesText(JSON.stringify(data.leadRules ?? [], null, 2));
      setRulesStatus('Rules loaded.');
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveRules = async () => {
    setRulesStatus('');
    setRulesError('');

    const parsed = safeJson(rulesText);
    if (!parsed.ok) {
      setRulesError('Rules JSON is invalid.');
      return;
    }

    const payload = Array.isArray(parsed.data)
      ? { leadRules: parsed.data }
      : (parsed.data as { leadRules?: unknown[] });

    if (!payload.leadRules || !Array.isArray(payload.leadRules)) {
      setRulesError('Expected an array or { leadRules: [] }.');
      return;
    }

    try {
      await apiFetch('/v1/lead-rules', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setRulesStatus('Rules saved.');
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : String(error));
    }
  };

  const sendSignals = async () => {
    setSignalStatus('');
    setSignalError('');
    setSignalResponse('');

    if (!signalLeadId.trim()) {
      setSignalError('Provide a lead id.');
      return;
    }

    const signals = signalTags
      .split(',')
      .map((signal) => signal.trim())
      .filter((signal) => signal.length > 0);

    if (signals.length === 0 && !signalText.trim()) {
      setSignalError('Provide signals or text.');
      return;
    }

    try {
      const data = await apiFetch(`/v1/leads/${signalLeadId.trim()}/signals`, {
        method: 'POST',
        body: JSON.stringify({
          signals,
          text: signalText.trim() || undefined,
        }),
      });
      setSignalResponse(JSON.stringify(data, null, 2));
      setSignalStatus('Signals delivered.');
    } catch (error) {
      setSignalError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadDeliveries = async (nextOffset = deliveryOffset) => {
    setDeliveriesError('');
    setDeliveriesLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(deliveryLimit));
      params.set('offset', String(nextOffset));
      if (deliveryStatusFilter.trim()) params.set('status', deliveryStatusFilter.trim());
      if (deliveryEventFilter.trim()) params.set('eventType', deliveryEventFilter.trim());

      const data = await apiFetch<{
        deliveries: WebhookDelivery[];
        total: number;
      }>(`/v1/webhook-deliveries?${params.toString()}`);

      setDeliveries(data.deliveries ?? []);
      setDeliveryTotal(data.total ?? 0);
      setDeliveryOffset(nextOffset);
    } catch (error) {
      setDeliveriesError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeliveriesLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
          <h1 className="text-4xl font-semibold sm:text-5xl">Agent-native mock console</h1>
          <p className="max-w-2xl text-sm text-muted">
            Minimal UI for lead routing, rule tuning, and signal injection. Use the mock
            endpoints to validate the flow before full integration.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="surface-grid animate-rise" style={{ animationDelay: '60ms' }}>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Connection</CardTitle>
                <CardDescription>Use relative proxy or point to a remote API.</CardDescription>
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
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>Proxy: /v1 -> API_BASE (next.config.mjs)</span>
                <span>Key stored in localStorage</span>
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '120ms' }}>
            <div className="space-y-4">
              <CardTitle>Quick flow</CardTitle>
              <CardDescription>Run the mock script to populate sample leads.</CardDescription>
              <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-4 py-3 text-xs">
                <code>API_KEY=... pnpm --filter @omini/api exec tsx scripts/mock-flow.ts</code>
              </div>
              <div className="text-xs text-muted">
                Tip: add <code>--only=inbound,wait,signals</code> or{' '}
                <code>LEAD_ID=...</code> for focused runs.
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise" style={{ animationDelay: '150ms' }}>
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>MessageBird channels</CardTitle>
                <CardDescription>Configure live WhatsApp channels and view webhook URLs.</CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadChannels}>
                  {channelsLoading ? 'Loading...' : 'Load channels'}
                </Button>
                {channelsError ? (
                  <span className="text-xs text-accent2">{channelsError}</span>
                ) : null}
              </div>

              <div className="space-y-3">
                {channels.length === 0 && !channelsLoading ? (
                  <p className="text-sm text-muted">No WhatsApp channels yet.</p>
                ) : null}
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className={`rounded-xl border border-ink/10 bg-white/70 p-4 ${
                      selectedChannelId === channel.id ? 'ring-1 ring-accent/40' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{channel.name}</p>
                        <p className="text-xs text-muted">{channel.id}</p>
                        <p className="text-xs text-muted">
                          Provider: {channel.provider ?? 'unknown'} · External: {channel.externalId}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="muted">{channel.status}</Badge>
                        <Button
                          size="sm"
                          variant={selectedChannelId === channel.id ? 'warm' : 'outline'}
                          onClick={() => setSelectedChannelId(channel.id)}
                        >
                          {selectedChannelId === channel.id ? 'Selected' : 'Use'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
                <p className="text-sm font-semibold">Create MessageBird channel</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Channel name"
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                  />
                  <Input
                    placeholder="External id"
                    value={channelExternalId}
                    onChange={(event) => setChannelExternalId(event.target.value)}
                  />
                  <Input
                    placeholder="Provider (messagebird)"
                    value={channelProvider}
                    onChange={(event) => setChannelProvider(event.target.value)}
                  />
                  <Input
                    placeholder="API key"
                    type="password"
                    value={channelApiKey}
                    onChange={(event) => setChannelApiKey(event.target.value)}
                  />
                  <Input
                    placeholder="From (phone)"
                    value={channelFrom}
                    onChange={(event) => setChannelFrom(event.target.value)}
                  />
                  <Input
                    placeholder="Channel ID (optional)"
                    value={channelSenderId}
                    onChange={(event) => setChannelSenderId(event.target.value)}
                  />
                  <Input
                    placeholder="Base URL (optional)"
                    value={channelBaseUrl}
                    onChange={(event) => setChannelBaseUrl(event.target.value)}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <Button size="sm" variant="warm" onClick={createChannel}>
                    Create channel
                  </Button>
                  {channelStatus ? (
                    <span className="text-accent">{channelStatus}</span>
                  ) : null}
                  {channelError ? (
                    <span className="text-accent2">{channelError}</span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Inbound webhook</Label>
                  <Input value={inboundWebhookUrl || 'Select a channel'} readOnly />
                </div>
                <div className="space-y-2">
                  <Label>Status webhook</Label>
                  <Input value={statusWebhookUrl || 'Select a channel'} readOnly />
                </div>
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '210ms' }}>
            <div className="flex h-full flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Send WhatsApp</CardTitle>
                <CardDescription>Queue a live MessageBird outbound message.</CardDescription>
              </div>

              <div className="space-y-2">
                <Label>Channel id</Label>
                <Input
                  list="channel-list"
                  placeholder="channel_id"
                  value={sendChannelId}
                  onChange={(event) => setSendChannelId(event.target.value)}
                />
                <datalist id="channel-list">
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2">
                <Label>Recipient</Label>
                <Input
                  placeholder="+8613xxxx"
                  value={sendTo}
                  onChange={(event) => setSendTo(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={sendText}
                  onChange={(event) => setSendText(event.target.value)}
                  className="min-h-[140px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={sendMessage}>Send message</Button>
                {sendStatus ? <span className="text-xs text-accent">{sendStatus}</span> : null}
                {sendError ? <span className="text-xs text-accent2">{sendError}</span> : null}
              </div>

              <div className="space-y-2">
                <Label>Send response</Label>
                <pre className="min-h-[160px] whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                  {sendResponse || 'No response yet.'}
                </pre>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="animate-rise" style={{ animationDelay: '180ms' }}>
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Leads</CardTitle>
                <CardDescription>Filter by stage, tag, or keyword.</CardDescription>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  placeholder="Search name/phone"
                  value={leadQuery}
                  onChange={(event) => setLeadQuery(event.target.value)}
                />
                <Input
                  placeholder="Stage (new, qualified, ...)"
                  value={leadStage}
                  onChange={(event) => setLeadStage(event.target.value)}
                />
                <Input
                  placeholder="Tag"
                  value={leadTag}
                  onChange={(event) => setLeadTag(event.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={loadLeads} variant="outline">
                  {leadsLoading ? 'Loading...' : 'Load leads'}
                </Button>
                {leadsError ? <span className="text-xs text-accent2">{leadsError}</span> : null}
              </div>

              <div className="space-y-3">
                {leads.length === 0 && !leadsLoading ? (
                  <p className="text-sm text-muted">No leads loaded yet.</p>
                ) : null}
                {leads.map((lead) => (
                  <div
                    key={lead.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {lead.contact?.name || lead.contact?.phone || 'Unknown lead'}
                        </p>
                        <p className="text-xs text-muted">{lead.id}</p>
                      </div>
                      <Badge variant="accent">{lead.stage}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>Score: {lead.score ?? 0}</span>
                      <span>Tags:</span>
                      {lead.tags.length > 0 ? (
                        lead.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                      ) : (
                        <Badge variant="muted">none</Badge>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-muted">
                        Last active: {lead.lastActivityAt ?? lead.createdAt}
                      </span>
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-accent hover:underline"
                      >
                        View detail
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '240ms' }}>
            <div className="flex h-full flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Lead rules</CardTitle>
                <CardDescription>Paste JSON rules or load from API.</CardDescription>
              </div>
              <Textarea
                value={rulesText}
                onChange={(event) => setRulesText(event.target.value)}
                className="min-h-[220px] font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadRules}>
                  Load rules
                </Button>
                <Button variant="warm" onClick={saveRules}>
                  Save rules
                </Button>
                {rulesStatus ? <span className="text-xs text-accent">{rulesStatus}</span> : null}
                {rulesError ? <span className="text-xs text-accent2">{rulesError}</span> : null}
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise" style={{ animationDelay: '330ms' }}>
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Messages</CardTitle>
                <CardDescription>Track outbound ids and status updates.</CardDescription>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  placeholder="Status (pending, sent, delivered...)"
                  value={messageStatusFilter}
                  onChange={(event) => setMessageStatusFilter(event.target.value)}
                />
                <Input
                  placeholder="Channel id"
                  value={messageChannelFilter}
                  onChange={(event) => setMessageChannelFilter(event.target.value)}
                />
                <Input
                  placeholder="Limit"
                  value={String(messageLimit)}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (!Number.isNaN(parsed)) {
                      setMessageLimit(Math.min(200, Math.max(1, parsed)));
                    }
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => loadMessages(0)}>
                  {messagesLoading ? 'Loading...' : 'Load messages'}
                </Button>
                {messagesError ? (
                  <span className="text-xs text-accent2">{messagesError}</span>
                ) : null}
              </div>

              <div className="space-y-3">
                {messages.length === 0 && !messagesLoading ? (
                  <p className="text-sm text-muted">No messages loaded yet.</p>
                ) : null}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {message.contact?.name ||
                            message.contact?.phone ||
                            message.channel?.name ||
                            'Message'}
                        </p>
                        <p className="text-xs text-muted">{message.id}</p>
                      </div>
                      <Badge variant={message.status === 'failed' ? 'muted' : 'accent'}>
                        {message.status}
                      </Badge>
                    </div>
                    <div className="mt-3 text-xs text-muted">
                      <span>External id: {message.externalId ?? '-'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>Direction: {message.direction}</span>
                      <span>
                        Channel: {message.channel?.name ?? 'unknown'} (
                        {message.channel?.provider ?? 'n/a'})
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted">
                      Created: {message.createdAt}
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs">
                      {JSON.stringify(message.content ?? {}, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '390ms' }}>
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="space-y-1">
                <CardTitle>Message paging</CardTitle>
                <CardDescription>Navigate message history.</CardDescription>
              </div>
              <div className="space-y-4">
                <div className="text-sm text-muted">
                  Offset {messageOffset} · Showing {messages.length} of {messageTotal}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    disabled={messageOffset === 0 || messagesLoading}
                    onClick={() => loadMessages(Math.max(0, messageOffset - messageLimit))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    disabled={messagesLoading || messageOffset + messageLimit >= messageTotal}
                    onClick={() => loadMessages(messageOffset + messageLimit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted">
                Tip: filter status like <code>sent</code> or <code>delivered</code>.
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="animate-rise" style={{ animationDelay: '300ms' }}>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Signals</CardTitle>
                <CardDescription>Trigger rule evaluation for a lead.</CardDescription>
              </div>
              <div className="space-y-2">
                <Label>Lead id</Label>
                <Input
                  placeholder="lead_id"
                  value={signalLeadId}
                  onChange={(event) => setSignalLeadId(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Signals (comma separated)</Label>
                <Input
                  value={signalTags}
                  onChange={(event) => setSignalTags(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Text context</Label>
                <Input
                  value={signalText}
                  onChange={(event) => setSignalText(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={sendSignals}>Send signals</Button>
                {signalStatus ? <span className="text-xs text-accent">{signalStatus}</span> : null}
                {signalError ? <span className="text-xs text-accent2">{signalError}</span> : null}
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '360ms' }}>
            <div className="space-y-4">
              <CardTitle>Signal response</CardTitle>
              <CardDescription>Latest payload from /v1/leads/:id/signals.</CardDescription>
              <pre className="min-h-[220px] whitespace-pre-wrap rounded-xl border border-ink/10 bg-ink/[0.03] p-4 text-xs text-muted">
                {signalResponse || 'No response yet.'}
              </pre>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="animate-rise" style={{ animationDelay: '420ms' }}>
            <div className="flex flex-col gap-5">
              <div className="space-y-1">
                <CardTitle>Webhook deliveries</CardTitle>
                <CardDescription>Inspect CRM webhook delivery attempts.</CardDescription>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  placeholder="Status (pending, success, failed)"
                  value={deliveryStatusFilter}
                  onChange={(event) => setDeliveryStatusFilter(event.target.value)}
                />
                <Input
                  placeholder="Event type (comma separated)"
                  value={deliveryEventFilter}
                  onChange={(event) => setDeliveryEventFilter(event.target.value)}
                />
                <Input
                  placeholder="Limit"
                  value={String(deliveryLimit)}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (!Number.isNaN(parsed)) {
                      setDeliveryLimit(Math.min(200, Math.max(1, parsed)));
                    }
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => loadDeliveries(0)}>
                  {deliveriesLoading ? 'Loading...' : 'Load deliveries'}
                </Button>
                {deliveriesError ? (
                  <span className="text-xs text-accent2">{deliveriesError}</span>
                ) : null}
              </div>

              <div className="space-y-3">
                {deliveries.length === 0 && !deliveriesLoading ? (
                  <p className="text-sm text-muted">No deliveries loaded yet.</p>
                ) : null}
                {deliveries.map((delivery) => (
                  <details
                    key={delivery.id}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
                      <span>{delivery.eventType}</span>
                      <Badge variant={delivery.status === 'success' ? 'accent' : 'muted'}>
                        {delivery.status}
                      </Badge>
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-muted">
                      <div className="flex flex-wrap gap-3">
                        <span>Target: {delivery.targetUrl}</span>
                        <span>Code: {delivery.responseCode ?? '-'}</span>
                      </div>
                      {delivery.errorMessage ? (
                        <p className="text-accent2">Error: {delivery.errorMessage}</p>
                      ) : null}
                      <p>Created: {delivery.createdAt}</p>
                      <pre className="whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
                        {JSON.stringify(delivery.payload, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </Card>

          <Card className="animate-rise" style={{ animationDelay: '480ms' }}>
            <div className="flex h-full flex-col justify-between gap-6">
              <div className="space-y-1">
                <CardTitle>Paging</CardTitle>
                <CardDescription>Navigate delivery history.</CardDescription>
              </div>
              <div className="space-y-4">
                <div className="text-sm text-muted">
                  Offset {deliveryOffset} · Showing {deliveries.length} of {deliveryTotal}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    disabled={deliveryOffset === 0 || deliveriesLoading}
                    onClick={() => loadDeliveries(Math.max(0, deliveryOffset - deliveryLimit))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      deliveriesLoading || deliveryOffset + deliveryLimit >= deliveryTotal
                    }
                    onClick={() => loadDeliveries(deliveryOffset + deliveryLimit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted">
                Tip: filter by event type like <code>lead.created</code> or{' '}
                <code>lead.updated</code>.
              </div>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
