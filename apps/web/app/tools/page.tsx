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

type ToolDefinition = {
  id: string;
  name: string;
  version: string;
  kind: string;
  provider?: string | null;
  description?: string | null;
  protocol: string;
  schema: Record<string, unknown>;
  config?: Record<string, unknown> | null;
  auth?: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
};

type ToolPermission = {
  id: string;
  toolId: string;
  agentId?: string | null;
  allowed: boolean;
};

type PromptTemplate = {
  id: string;
  name: string;
  version: string;
  content: string;
  active: boolean;
  createdAt: string;
};

type ToolExecutionLog = {
  id: string;
  toolId: string;
  agentId?: string | null;
  status: string;
  latencyMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  tool?: ToolDefinition | null;
};

const buildToolPayload = (tool: ToolDefinition) => ({
  name: tool.name,
  version: tool.version,
  kind: tool.kind,
  provider: tool.provider ?? undefined,
  description: tool.description ?? undefined,
  protocol: tool.protocol,
  schema: tool.schema,
  config: tool.config ?? undefined,
  auth: tool.auth ?? undefined,
  enabled: tool.enabled,
});

export default function ToolsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const defaultSchema = '{"input": {}, "output": {}}';
  const defaultConfig =
    '{"adapterId":"external.http","url":"https://example.com/tools/lookup","method":"POST"}';
  const defaultAuth = '{"scheme":"apiKey","secretRef":"CRM_TOOL_API_KEY"}';

  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolsError, setToolsError] = useState('');
  const [toolsStatus, setToolsStatus] = useState('');

  const [toolName, setToolName] = useState('crm.lookup');
  const [toolVersion, setToolVersion] = useState('v1');
  const [toolKind, setToolKind] = useState('internal');
  const [toolProvider, setToolProvider] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [toolSchema, setToolSchema] = useState(defaultSchema);
  const [toolConfig, setToolConfig] = useState(
    defaultConfig
  );
  const [toolAuth, setToolAuth] = useState(defaultAuth);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const [selectedToolId, setSelectedToolId] = useState('');
  const [permissions, setPermissions] = useState<ToolPermission[]>([]);
  const [permissionAgentId, setPermissionAgentId] = useState('');
  const [permissionAllowed, setPermissionAllowed] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState('');
  const [permissionError, setPermissionError] = useState('');

  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [promptName, setPromptName] = useState('default-agent');
  const [promptVersion, setPromptVersion] = useState('v1');
  const [promptContent, setPromptContent] = useState('You are a helpful agent.');
  const [promptStatus, setPromptStatus] = useState('');
  const [promptError, setPromptError] = useState('');

  const [logs, setLogs] = useState<ToolExecutionLog[]>([]);
  const [logsError, setLogsError] = useState('');

  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState('https://cloud.langfuse.com');
  const [langfusePublicKey, setLangfusePublicKey] = useState('');
  const [langfuseSecretKey, setLangfuseSecretKey] = useState('');
  const [langfuseStatus, setLangfuseStatus] = useState('');
  const [langfuseError, setLangfuseError] = useState('');

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

  const getAdapterId = (tool: ToolDefinition) => {
    const config =
      tool.config && typeof tool.config === 'object' && !Array.isArray(tool.config)
        ? tool.config
        : null;
    return typeof config?.adapterId === 'string' ? config.adapterId : '';
  };

  const getAuthScheme = (tool: ToolDefinition) => {
    const auth =
      tool.auth && typeof tool.auth === 'object' && !Array.isArray(tool.auth) ? tool.auth : null;
    return typeof auth?.scheme === 'string' ? auth.scheme : '';
  };

  const stringifyJson = (value: unknown, fallback: string) => {
    if (!value || typeof value !== 'object') {
      return fallback;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  };

  const resetToolEditor = () => {
    setEditingToolId(null);
    setToolName('crm.lookup');
    setToolVersion('v1');
    setToolKind('internal');
    setToolProvider('');
    setToolDescription('');
    setToolSchema(defaultSchema);
    setToolConfig(defaultConfig);
    setToolAuth(defaultAuth);
  };

  const loadToolIntoEditor = (tool: ToolDefinition) => {
    setEditingToolId(tool.id);
    setSelectedToolId(tool.id);
    setToolName(tool.name);
    setToolVersion(tool.version);
    setToolKind(tool.kind);
    setToolProvider(tool.provider ?? '');
    setToolDescription(tool.description ?? '');
    setToolSchema(stringifyJson(tool.schema ?? { input: {}, output: {} }, defaultSchema));
    setToolConfig(stringifyJson(tool.config ?? null, ''));
    setToolAuth(stringifyJson(tool.auth ?? null, ''));
  };

  const copyText = async (value: string, fallback: string) => {
    const text = value || fallback;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setToolsStatus('Copied to clipboard.');
      setToolsError('');
    } catch (error) {
      setToolsError('Copy failed.');
    }
  };

  const toggleToolEnabled = async (tool: ToolDefinition) => {
    setToolsError('');
    setToolsStatus('');
    try {
      const data = await apiFetch<{ tool: ToolDefinition }>(`/v1/agent-tools/${tool.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: !tool.enabled,
        }),
      });
      setTools((prev) => prev.map((item) => (item.id === tool.id ? data.tool : item)));
      if (selectedToolId === tool.id) {
        setSelectedToolId(tool.id);
      }
      setToolsStatus(data.tool.enabled ? 'Tool enabled.' : 'Tool disabled.');
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleToolExpanded = (toolId: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolId]: !prev[toolId] }));
  };

  const loadTools = async () => {
    setToolsError('');
    setToolsStatus('');
    try {
      const data = await apiFetch<{ tools: ToolDefinition[] }>('/v1/agent-tools');
      setTools(data.tools ?? []);
      if (!selectedToolId && data.tools?.length) {
        setSelectedToolId(data.tools[0].id);
      }
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    }
  };

  const createTool = async () => {
    setToolsError('');
    setToolsStatus('');

    const schema = (() => {
      try {
        return JSON.parse(toolSchema);
      } catch (error) {
        setToolsError('Schema JSON invalid');
        return null;
      }
    })();

    if (!schema) {
      return;
    }

    const config = (() => {
      if (!toolConfig.trim()) {
        return null;
      }
      try {
        return JSON.parse(toolConfig);
      } catch (error) {
        setToolsError('Config JSON invalid');
        return null;
      }
    })();

    if (config === null && toolConfig.trim()) {
      return;
    }

    const auth = (() => {
      if (!toolAuth.trim()) {
        return null;
      }
      try {
        return JSON.parse(toolAuth);
      } catch (error) {
        setToolsError('Auth JSON invalid');
        return null;
      }
    })();

    if (auth === null && toolAuth.trim()) {
      return;
    }

    try {
      const data = await apiFetch<{ tool: ToolDefinition }>('/v1/agent-tools', {
        method: 'POST',
        body: JSON.stringify({
          name: toolName,
          version: toolVersion,
          kind: toolKind,
          provider: toolProvider || undefined,
          description: toolDescription || undefined,
          schema,
          config,
          auth,
          enabled: true,
        }),
      });
      setTools((prev) => [data.tool, ...prev]);
      setSelectedToolId(data.tool.id);
      setToolsStatus('Tool created.');
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateTool = async () => {
    setToolsError('');
    setToolsStatus('');

    if (!editingToolId) {
      setToolsError('Select a tool to edit.');
      return;
    }

    const schema = (() => {
      try {
        return JSON.parse(toolSchema);
      } catch (error) {
        setToolsError('Schema JSON invalid');
        return null;
      }
    })();

    if (!schema) {
      return;
    }

    const config = (() => {
      if (!toolConfig.trim()) {
        return null;
      }
      try {
        return JSON.parse(toolConfig);
      } catch (error) {
        setToolsError('Config JSON invalid');
        return null;
      }
    })();

    if (config === null && toolConfig.trim()) {
      return;
    }

    const auth = (() => {
      if (!toolAuth.trim()) {
        return null;
      }
      try {
        return JSON.parse(toolAuth);
      } catch (error) {
        setToolsError('Auth JSON invalid');
        return null;
      }
    })();

    if (auth === null && toolAuth.trim()) {
      return;
    }

    try {
      const data = await apiFetch<{ tool: ToolDefinition }>(`/v1/agent-tools/${editingToolId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: toolName,
          version: toolVersion,
          kind: toolKind,
          provider: toolProvider || undefined,
          description: toolDescription || undefined,
          schema,
          config,
          auth,
          enabled: true,
        }),
      });
      setTools((prev) => prev.map((tool) => (tool.id === data.tool.id ? data.tool : tool)));
      setToolsStatus('Tool updated.');
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadPermissions = async () => {
    setPermissionError('');
    if (!selectedToolId) {
      setPermissionError('Select a tool first.');
      return;
    }

    try {
      const data = await apiFetch<{ permissions: ToolPermission[] }>(
        `/v1/agent-tools/${selectedToolId}/permissions`
      );
      setPermissions(data.permissions ?? []);
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    }
  };

  const savePermission = async () => {
    setPermissionError('');
    setPermissionStatus('');
    if (!selectedToolId) {
      setPermissionError('Select a tool first.');
      return;
    }

    try {
      const data = await apiFetch<{ permission: ToolPermission }>(
        `/v1/agent-tools/${selectedToolId}/permissions`,
        {
          method: 'PUT',
          body: JSON.stringify({
            agentId: permissionAgentId || null,
            allowed: permissionAllowed,
          }),
        }
      );
      setPermissions((prev) => [data.permission, ...prev.filter((p) => p.id !== data.permission.id)]);
      setPermissionStatus('Permission saved.');
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadPrompts = async () => {
    setPromptError('');
    try {
      const data = await apiFetch<{ prompts: PromptTemplate[] }>('/v1/prompts');
      setPrompts(data.prompts ?? []);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : String(err));
    }
  };

  const createPrompt = async () => {
    setPromptError('');
    setPromptStatus('');

    try {
      const data = await apiFetch<{ prompt: PromptTemplate }>('/v1/prompts', {
        method: 'POST',
        body: JSON.stringify({
          name: promptName,
          version: promptVersion,
          content: promptContent,
          active: true,
        }),
      });
      setPrompts((prev) => [data.prompt, ...prev]);
      setPromptStatus('Prompt saved.');
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadLogs = async () => {
    setLogsError('');
    try {
      const params = new URLSearchParams();
      if (selectedToolId) params.set('toolId', selectedToolId);
      const data = await apiFetch<{ logs: ToolExecutionLog[] }>(
        `/v1/agent-tools/logs?${params.toString()}`
      );
      setLogs(data.logs ?? []);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadLangfuse = async () => {
    setLangfuseError('');
    setLangfuseStatus('');
    try {
      const data = await apiFetch<{
        langfuse: { enabled: boolean; baseUrl: string; publicKey: string; secretKey: string };
      }>('/v1/langfuse');
      setLangfuseEnabled(data.langfuse.enabled);
      setLangfuseBaseUrl(data.langfuse.baseUrl);
      setLangfusePublicKey(data.langfuse.publicKey);
      setLangfuseSecretKey('');
      setLangfuseStatus('Langfuse settings loaded.');
    } catch (err) {
      setLangfuseError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveLangfuse = async () => {
    setLangfuseError('');
    setLangfuseStatus('');
    try {
      await apiFetch('/v1/langfuse', {
        method: 'PUT',
        body: JSON.stringify({
          langfuse: {
            enabled: langfuseEnabled,
            baseUrl: langfuseBaseUrl,
            publicKey: langfusePublicKey,
            secretKey: langfuseSecretKey,
          },
        }),
      });
      setLangfuseStatus('Langfuse settings saved.');
    } catch (err) {
      setLangfuseError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Omini Console</p>
              <h1 className="text-4xl font-semibold sm:text-5xl">Agent tools & governance</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/analytics">Analytics</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">Back to console</Link>
              </Button>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Manage tool definitions, permissions, prompts, and execution monitoring.
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
                <CardTitle>Tools</CardTitle>
                <CardDescription>Register internal/external tools.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadTools}>
                  Load tools
                </Button>
                {toolsStatus ? <span className="text-xs text-accent">{toolsStatus}</span> : null}
                {toolsError ? <span className="text-xs text-accent2">{toolsError}</span> : null}
              </div>
              {tools.length === 0 ? (
                <p className="text-sm text-muted">No tools yet.</p>
              ) : (
                <div className="space-y-3">
                  {tools.map((tool) => (
                    <div
                      key={tool.id}
                      className={`rounded-xl border border-ink/10 bg-white/70 p-4 ${
                        selectedToolId === tool.id ? 'ring-1 ring-accent/40' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{tool.name}</p>
                          <p className="text-xs text-muted">{tool.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="muted">{tool.kind}</Badge>
                          <Badge variant={tool.enabled ? 'accent' : 'muted'}>
                            {tool.enabled ? 'enabled' : 'disabled'}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleToolEnabled(tool)}
                          >
                            {tool.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            size="sm"
                            variant={selectedToolId === tool.id ? 'warm' : 'outline'}
                            onClick={() => setSelectedToolId(tool.id)}
                          >
                            {selectedToolId === tool.id ? 'Selected' : 'Use'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => loadToolIntoEditor(tool)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              copyText(
                                stringifyJson(
                                  buildToolPayload(tool),
                                  ''
                                ),
                                ''
                              )
                            }
                          >
                            Copy JSON
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyText(stringifyJson(buildToolPayload(tool), ''), '')}
                          >
                            Copy Create Payload
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleToolExpanded(tool.id)}
                          >
                            {expandedTools[tool.id] ? 'Hide details' : 'Show details'}
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {tool.description || 'No description'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                        {getAdapterId(tool) ? (
                          <span>Adapter: {getAdapterId(tool)}</span>
                        ) : null}
                        {getAuthScheme(tool) ? <span>Auth: {getAuthScheme(tool)}</span> : null}
                        <span>Protocol: {tool.protocol}</span>
                      </div>
                      {expandedTools[tool.id] ? (
                        <div className="mt-3 grid gap-3 text-xs">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
                              Config
                            </p>
                            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-ink/10 bg-slate-50 px-3 py-2 text-[11px] text-ink">
                              {stringifyJson(tool.config ?? {}, '{}')}
                            </pre>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Auth</p>
                            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-ink/10 bg-slate-50 px-3 py-2 text-[11px] text-ink">
                              {stringifyJson(tool.auth ?? {}, '{}')}
                            </pre>
                          </div>
                        </div>
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
                <CardTitle>{editingToolId ? 'Edit tool' : 'Create tool'}</CardTitle>
                <CardDescription>Define protocol metadata and schemas.</CardDescription>
              </div>
              {editingToolId ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>Editing: {editingToolId}</span>
                  <Button size="sm" variant="outline" onClick={resetToolEditor}>
                    Clear editor
                  </Button>
                </div>
              ) : null}
              <Input
                placeholder="Name"
                value={toolName}
                onChange={(event) => setToolName(event.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Version"
                  value={toolVersion}
                  onChange={(event) => setToolVersion(event.target.value)}
                />
                <Input
                  placeholder="Kind (internal/external)"
                  value={toolKind}
                  onChange={(event) => setToolKind(event.target.value)}
                />
              </div>
              <Input
                placeholder="Provider (optional)"
                value={toolProvider}
                onChange={(event) => setToolProvider(event.target.value)}
              />
              <Input
                placeholder="Description"
                value={toolDescription}
                onChange={(event) => setToolDescription(event.target.value)}
              />
              <Textarea
                className="min-h-[140px] font-mono text-xs"
                value={toolSchema}
                onChange={(event) => setToolSchema(event.target.value)}
              />
              <p className="text-xs text-muted">Config JSON (adapter settings).</p>
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                value={toolConfig}
                onChange={(event) => setToolConfig(event.target.value)}
                placeholder='{"adapterId":"external.http","url":"https://example.com/tools/lookup"}'
              />
              <p className="text-xs text-muted">Auth JSON (scheme + secretRef).</p>
              <Textarea
                className="min-h-[96px] font-mono text-xs"
                value={toolAuth}
                onChange={(event) => setToolAuth(event.target.value)}
                placeholder='{"scheme":"apiKey","secretRef":"CRM_TOOL_API_KEY"}'
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={createTool}>Create tool</Button>
                <Button variant="outline" onClick={updateTool} disabled={!editingToolId}>
                  Update tool
                </Button>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Permissions</CardTitle>
                <CardDescription>Allow/deny tool usage per agent.</CardDescription>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  placeholder="Agent id (optional)"
                  value={permissionAgentId}
                  onChange={(event) => setPermissionAgentId(event.target.value)}
                />
                <Input
                  placeholder="Allowed (true/false)"
                  value={permissionAllowed ? 'true' : 'false'}
                  onChange={(event) => setPermissionAllowed(event.target.value !== 'false')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadPermissions}>
                  Load permissions
                </Button>
                <Button onClick={savePermission}>Save permission</Button>
                {permissionStatus ? (
                  <span className="text-xs text-accent">{permissionStatus}</span>
                ) : null}
                {permissionError ? (
                  <span className="text-xs text-accent2">{permissionError}</span>
                ) : null}
              </div>
              {permissions.length === 0 ? (
                <p className="text-sm text-muted">No permissions yet.</p>
              ) : (
                <div className="space-y-2 text-xs text-muted">
                  {permissions.map((permission) => (
                    <div key={permission.id} className="flex justify-between">
                      <span>{permission.agentId || 'org-default'}</span>
                      <span>{permission.allowed ? 'allowed' : 'denied'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Prompt templates</CardTitle>
                <CardDescription>Manage prompt versions and content.</CardDescription>
              </div>
              <Input
                placeholder="Prompt name"
                value={promptName}
                onChange={(event) => setPromptName(event.target.value)}
              />
              <Input
                placeholder="Version"
                value={promptVersion}
                onChange={(event) => setPromptVersion(event.target.value)}
              />
              <Textarea
                className="min-h-[120px]"
                value={promptContent}
                onChange={(event) => setPromptContent(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={loadPrompts}>
                  Load prompts
                </Button>
                <Button onClick={createPrompt}>Save prompt</Button>
                {promptStatus ? <span className="text-xs text-accent">{promptStatus}</span> : null}
                {promptError ? <span className="text-xs text-accent2">{promptError}</span> : null}
              </div>
              {prompts.length === 0 ? (
                <p className="text-sm text-muted">No prompts yet.</p>
              ) : (
                <div className="space-y-2 text-xs text-muted">
                  {prompts.map((prompt) => (
                    <div key={prompt.id} className="flex justify-between">
                      <span>
                        {prompt.name} · {prompt.version}
                      </span>
                      <span>{prompt.active ? 'active' : 'inactive'}</span>
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
              <CardTitle>Execution logs</CardTitle>
              <CardDescription>Monitor tool usage and failures.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={loadLogs}>
                Load logs
              </Button>
              {logsError ? <span className="text-xs text-accent2">{logsError}</span> : null}
            </div>
            {logs.length === 0 ? (
              <p className="text-sm text-muted">No logs yet.</p>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-ink/10 bg-white/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {log.tool?.name ?? log.toolId}
                        </p>
                        <p className="text-xs text-muted">{log.createdAt}</p>
                      </div>
                      <Badge variant={log.status === 'success' ? 'accent' : 'muted'}>
                        {log.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted">
                      <span>Agent: {log.agentId || 'n/a'}</span>
                      <span className="ml-3">Latency: {log.latencyMs ?? 0}ms</span>
                    </div>
                    {log.errorMessage ? (
                      <p className="mt-2 text-xs text-accent2">{log.errorMessage}</p>
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
              <CardTitle>Langfuse</CardTitle>
              <CardDescription>Cloud prompt monitoring settings.</CardDescription>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Enabled (true/false)"
                value={langfuseEnabled ? 'true' : 'false'}
                onChange={(event) => setLangfuseEnabled(event.target.value !== 'false')}
              />
              <Input
                placeholder="Base URL"
                value={langfuseBaseUrl}
                onChange={(event) => setLangfuseBaseUrl(event.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Public key"
                value={langfusePublicKey}
                onChange={(event) => setLangfusePublicKey(event.target.value)}
              />
              <Input
                placeholder="Secret key (leave blank to keep)"
                type="password"
                value={langfuseSecretKey}
                onChange={(event) => setLangfuseSecretKey(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={loadLangfuse}>
                Load Langfuse
              </Button>
              <Button onClick={saveLangfuse}>Save Langfuse</Button>
              {langfuseStatus ? <span className="text-xs text-accent">{langfuseStatus}</span> : null}
              {langfuseError ? <span className="text-xs text-accent2">{langfuseError}</span> : null}
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
