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

export default function ToolsPage() {
  const [apiKey, setApiKey] = useState('');
  const [apiBase, setApiBase] = useState('');

  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolsError, setToolsError] = useState('');
  const [toolsStatus, setToolsStatus] = useState('');

  const [toolName, setToolName] = useState('crm.lookup');
  const [toolVersion, setToolVersion] = useState('v1');
  const [toolKind, setToolKind] = useState('internal');
  const [toolProvider, setToolProvider] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [toolSchema, setToolSchema] = useState('{"input": {}, "output": {}}');

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
                            variant={selectedToolId === tool.id ? 'warm' : 'outline'}
                            onClick={() => setSelectedToolId(tool.id)}
                          >
                            {selectedToolId === tool.id ? 'Selected' : 'Use'}
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {tool.description || 'No description'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <CardTitle>Create tool</CardTitle>
                <CardDescription>Define protocol metadata and schemas.</CardDescription>
              </div>
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
              <Button onClick={createTool}>Create tool</Button>
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
      </div>
    </main>
  );
}
