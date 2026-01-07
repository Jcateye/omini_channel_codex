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

type Campaign = {
  id: string;
  name: string;
  status: string;
  cost?: number | null;
  revenue?: number | null;
};

export default function RoiPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsError, setCampaignsError] = useState('');

  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [costInput, setCostInput] = useState('');
  const [revenueInput, setRevenueInput] = useState('');
  const [roiStatus, setRoiStatus] = useState('');
  const [roiError, setRoiError] = useState('');

  const [crmLeadId, setCrmLeadId] = useState('');
  const [crmStage, setCrmStage] = useState('converted');
  const [crmTags, setCrmTags] = useState('');
  const [crmSource, setCrmSource] = useState('crm');
  const [crmExternalId, setCrmExternalId] = useState('');
  const [crmFieldMapping, setCrmFieldMapping] = useState('{"dealValue": "crm.dealValue"}');
  const [crmPayloadFields, setCrmPayloadFields] = useState('{"dealValue": 1200}');
  const [crmMetadata, setCrmMetadata] = useState('{"note": "updated from CRM"}');
  const [crmStatus, setCrmStatus] = useState('');
  const [crmError, setCrmError] = useState('');
  const [crmMappingStatus, setCrmMappingStatus] = useState('');
  const [crmMappingError, setCrmMappingError] = useState('');
  const [crmMappingExamples, setCrmMappingExamples] = useState<
    Array<{ id: string; name: string; description: string; mapping: Record<string, string> }>
  >([]);
  const [crmMappingValidation, setCrmMappingValidation] = useState<string>('');
  const [crmMappingPreview, setCrmMappingPreview] = useState<string>('');

  const [revenueLeadId, setRevenueLeadId] = useState('');
  const [revenueCampaignId, setRevenueCampaignId] = useState('');
  const [revenueAmount, setRevenueAmount] = useState('100');
  const [revenueCurrency, setRevenueCurrency] = useState('USD');
  const [revenueExternalId, setRevenueExternalId] = useState('');
  const [revenueStatus, setRevenueStatus] = useState('');
  const [revenueError, setRevenueError] = useState('');

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

  const loadCampaigns = async () => {
    setCampaignsError('');
    try {
      const data = await apiFetch<{ campaigns: Campaign[] }>('/v1/campaigns?limit=50');
      setCampaigns(data.campaigns ?? []);
      if (!selectedCampaignId && data.campaigns?.length) {
        setSelectedCampaignId(data.campaigns[0].id);
      }
    } catch (err) {
      setCampaignsError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateRoi = async () => {
    setRoiError('');
    setRoiStatus('');
    if (!selectedCampaignId) {
      setRoiError('Select a campaign.');
      return;
    }

    const cost = costInput ? Number(costInput) : null;
    const revenue = revenueInput ? Number(revenueInput) : null;

    try {
      const data = await apiFetch<{ campaign: Campaign }>(
        `/v1/campaigns/${selectedCampaignId}/roi`,
        {
          method: 'PUT',
          body: JSON.stringify({ cost, revenue }),
        }
      );
      setRoiStatus('ROI updated.');
      setCampaigns((prev) =>
        prev.map((campaign) => (campaign.id === data.campaign.id ? data.campaign : campaign))
      );
    } catch (err) {
      setRoiError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendCrmUpdate = async () => {
    setCrmError('');
    setCrmStatus('');
    if (!crmLeadId.trim()) {
      setCrmError('Provide lead id.');
      return;
    }

    const tags = crmTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    let metadata: Record<string, unknown> | null = null;
    try {
      metadata = crmMetadata ? (JSON.parse(crmMetadata) as Record<string, unknown>) : null;
    } catch (error) {
      setCrmError('Metadata JSON invalid.');
      return;
    }

    let payloadFields: Record<string, unknown> | null = null;
    try {
      payloadFields = crmPayloadFields
        ? (JSON.parse(crmPayloadFields) as Record<string, unknown>)
        : null;
    } catch (error) {
      setCrmError('Payload fields JSON invalid.');
      return;
    }

    try {
      await apiFetch(`/v1/crm/leads/${crmLeadId.trim()}`, {
        method: 'POST',
        body: JSON.stringify({
          stage: crmStage,
          tags,
          source: crmSource,
          crmExternalId: crmExternalId || undefined,
          metadata,
          ...(payloadFields ? payloadFields : {}),
        }),
      });
      setCrmStatus('CRM update sent.');
    } catch (err) {
      setCrmError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadCrmMapping = async () => {
    setCrmMappingError('');
    setCrmMappingStatus('');
    try {
      const data = await apiFetch<{ mapping: Record<string, string> }>('/v1/crm/mapping');
      setCrmFieldMapping(JSON.stringify(data.mapping ?? {}, null, 2));
      setCrmMappingStatus('Mapping loaded.');
    } catch (err) {
      setCrmMappingError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveCrmMapping = async () => {
    setCrmMappingError('');
    setCrmMappingStatus('');
    setCrmMappingValidation('');
    let mapping: Record<string, unknown>;
    try {
      mapping = crmFieldMapping ? (JSON.parse(crmFieldMapping) as Record<string, unknown>) : {};
    } catch (error) {
      setCrmMappingError('Mapping JSON invalid.');
      return;
    }

    try {
      await apiFetch('/v1/crm/mapping', {
        method: 'PUT',
        body: JSON.stringify({ mapping }),
      });
      setCrmMappingStatus('Mapping saved.');
    } catch (err) {
      setCrmMappingError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadCrmMappingExamples = async () => {
    setCrmMappingError('');
    setCrmMappingStatus('');
    try {
      const data = await apiFetch<{
        examples: Array<{ id: string; name: string; description: string; mapping: Record<string, string> }>;
      }>('/v1/crm/mapping/examples');
      setCrmMappingExamples(data.examples ?? []);
      if (data.examples?.length) {
        setCrmFieldMapping(JSON.stringify(data.examples[0].mapping, null, 2));
        setCrmMappingStatus('Example loaded.');
      }
    } catch (err) {
      setCrmMappingError(err instanceof Error ? err.message : String(err));
    }
  };

  const validateCrmMapping = async () => {
    setCrmMappingError('');
    setCrmMappingValidation('');
    setCrmMappingPreview('');
    let mapping: Record<string, unknown>;
    try {
      mapping = crmFieldMapping ? (JSON.parse(crmFieldMapping) as Record<string, unknown>) : {};
    } catch (error) {
      setCrmMappingError('Mapping JSON invalid.');
      return;
    }

    try {
      const response = await apiFetch<{ valid: boolean; errors?: Array<{ key: string; message: string }> }>(
        '/v1/crm/mapping/validate',
        {
          method: 'POST',
          body: JSON.stringify({ mapping }),
        }
      );
      if (response.valid) {
        setCrmMappingValidation('Mapping valid.');
      } else {
        setCrmMappingValidation(
          (response.errors ?? []).map((item) => `${item.key}: ${item.message}`).join('\n')
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCrmMappingError(message);
    }
  };

  const previewCrmMapping = async () => {
    setCrmMappingError('');
    setCrmMappingPreview('');
    let mapping: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      mapping = crmFieldMapping ? (JSON.parse(crmFieldMapping) as Record<string, unknown>) : {};
    } catch (error) {
      setCrmMappingError('Mapping JSON invalid.');
      return;
    }
    try {
      payload = crmPayloadFields ? (JSON.parse(crmPayloadFields) as Record<string, unknown>) : {};
    } catch (error) {
      setCrmMappingError('Payload fields JSON invalid.');
      return;
    }

    try {
      const response = await apiFetch<{ output: Record<string, unknown> }>(
        '/v1/crm/mapping/preview',
        {
          method: 'POST',
          body: JSON.stringify({ mapping, payload }),
        }
      );
      setCrmMappingPreview(JSON.stringify(response.output ?? {}, null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCrmMappingError(message);
    }
  };

  const sendRevenue = async () => {
    setRevenueError('');
    setRevenueStatus('');

    const amount = Number(revenueAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setRevenueError('Amount must be positive number.');
      return;
    }

    try {
      await apiFetch('/v1/crm/revenue', {
        method: 'POST',
        body: JSON.stringify({
          leadId: revenueLeadId || undefined,
          campaignId: revenueCampaignId || undefined,
          amount,
          currency: revenueCurrency,
          externalId: revenueExternalId || undefined,
          source: 'crm',
        }),
      });
      setRevenueStatus('Revenue recorded.');
    } catch (err) {
      setRevenueError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">ROI & CRM sync</h1>
            </div>
            <Button variant="outline" asChild>
              <Link href="/">Back to console</Link>
            </Button>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Update campaign ROI and test inbound CRM sync events.
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
          </div>
        </Card>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Campaign ROI</CardTitle>
                <CardDescription>Set cost/revenue manually.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadCampaigns}>
                  Load campaigns
                </Button>
                {campaignsError ? (
                  <span className="text-xs text-accent2">{campaignsError}</span>
                ) : null}
              </div>
              {campaigns.length === 0 ? (
                <p className="text-sm text-muted">No campaigns yet.</p>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((campaign) => (
                    <div
                      key={campaign.id}
                      className={`rounded-xl border border-ink/10 bg-white/70 p-4 ${
                        selectedCampaignId === campaign.id ? 'ring-1 ring-accent/40' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{campaign.name}</p>
                          <p className="text-xs text-muted">{campaign.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="muted">{campaign.status}</Badge>
                          <Button
                            size="sm"
                            variant={selectedCampaignId === campaign.id ? 'warm' : 'outline'}
                            onClick={() => setSelectedCampaignId(campaign.id)}
                          >
                            {selectedCampaignId === campaign.id ? 'Selected' : 'Use'}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted">
                        Cost: {campaign.cost ?? 0} · Revenue: {campaign.revenue ?? 0}
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
                <CardTitle>Update ROI</CardTitle>
                <CardDescription>Apply cost/revenue updates for selected campaign.</CardDescription>
              </div>
              <Input
                placeholder="Cost"
                value={costInput}
                onChange={(event) => setCostInput(event.target.value)}
              />
              <Input
                placeholder="Revenue"
                value={revenueInput}
                onChange={(event) => setRevenueInput(event.target.value)}
              />
              <Button onClick={updateRoi}>Save ROI</Button>
              {roiStatus ? <span className="text-xs text-accent">{roiStatus}</span> : null}
              {roiError ? <span className="text-xs text-accent2">{roiError}</span> : null}
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Inbound CRM lead update</CardTitle>
                <CardDescription>Simulate CRM lead sync.</CardDescription>
              </div>
              <Input
                placeholder="Lead id"
                value={crmLeadId}
                onChange={(event) => setCrmLeadId(event.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Stage (converted)"
                  value={crmStage}
                  onChange={(event) => setCrmStage(event.target.value)}
                />
                <Input
                  placeholder="Source"
                  value={crmSource}
                  onChange={(event) => setCrmSource(event.target.value)}
                />
              </div>
              <Input
                placeholder="Tags (comma separated)"
                value={crmTags}
                onChange={(event) => setCrmTags(event.target.value)}
              />
              <Input
                placeholder="CRM external id"
                value={crmExternalId}
                onChange={(event) => setCrmExternalId(event.target.value)}
              />
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                value={crmFieldMapping}
                onChange={(event) => setCrmFieldMapping(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadCrmMapping}>
                  Load mapping
                </Button>
                <Button onClick={saveCrmMapping}>Save mapping</Button>
                <Button variant="outline" onClick={loadCrmMappingExamples}>
                  Load examples
                </Button>
                <Button variant="outline" onClick={validateCrmMapping}>
                  Validate mapping
                </Button>
                <Button variant="outline" onClick={previewCrmMapping}>
                  Preview mapping
                </Button>
                {crmMappingStatus ? (
                  <span className="text-xs text-accent">{crmMappingStatus}</span>
                ) : null}
                {crmMappingError ? (
                  <span className="text-xs text-accent2">{crmMappingError}</span>
                ) : null}
              </div>
              {crmMappingValidation ? (
                <pre className="whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                  {crmMappingValidation}
                </pre>
              ) : null}
              {crmMappingExamples.length > 0 ? (
                <div className="space-y-2 text-xs text-muted">
                  <p>Examples:</p>
                  <div className="flex flex-wrap gap-2">
                    {crmMappingExamples.map((example) => (
                      <Button
                        key={example.id}
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setCrmFieldMapping(JSON.stringify(example.mapping, null, 2))
                        }
                      >
                        {example.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted">CRM payload fields (mapped into metadata)</p>
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                value={crmPayloadFields}
                onChange={(event) => setCrmPayloadFields(event.target.value)}
              />
              <Textarea
                className="min-h-[120px]"
                value={crmMetadata}
                onChange={(event) => setCrmMetadata(event.target.value)}
              />
              {crmMappingPreview ? (
                <pre className="whitespace-pre-wrap rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-xs text-muted">
                  {crmMappingPreview}
                </pre>
              ) : null}
              <Button onClick={sendCrmUpdate}>Send CRM update</Button>
              {crmStatus ? <span className="text-xs text-accent">{crmStatus}</span> : null}
              {crmError ? <span className="text-xs text-accent2">{crmError}</span> : null}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Inbound CRM revenue</CardTitle>
                <CardDescription>Record revenue and attribute to campaign.</CardDescription>
              </div>
              <Input
                placeholder="Lead id (optional)"
                value={revenueLeadId}
                onChange={(event) => setRevenueLeadId(event.target.value)}
              />
              <Input
                placeholder="Campaign id (optional)"
                value={revenueCampaignId}
                onChange={(event) => setRevenueCampaignId(event.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Amount"
                  value={revenueAmount}
                  onChange={(event) => setRevenueAmount(event.target.value)}
                />
                <Input
                  placeholder="Currency (USD)"
                  value={revenueCurrency}
                  onChange={(event) => setRevenueCurrency(event.target.value)}
                />
              </div>
              <Input
                placeholder="External id"
                value={revenueExternalId}
                onChange={(event) => setRevenueExternalId(event.target.value)}
              />
              <Button onClick={sendRevenue}>Record revenue</Button>
              {revenueStatus ? <span className="text-xs text-accent">{revenueStatus}</span> : null}
              {revenueError ? <span className="text-xs text-accent2">{revenueError}</span> : null}
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
