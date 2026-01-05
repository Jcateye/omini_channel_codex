export type AgentContext = {
  organizationId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  leadId?: string | null;
  messageId: string;
  platform: string;
  provider?: string | null;
  text?: string;
  tags?: string[];
  stage?: string;
  source?: string | null;
};

export type AgentResponse = {
  text?: string;
  metadata?: Record<string, unknown>;
};

export type AgentAdapter = {
  id: string;
  name: string;
  kind: 'internal' | 'llm' | 'external';
  provider?: string;
  reply: (context: AgentContext) => Promise<AgentResponse>;
};

export type AgentRoutingRule = {
  id: string;
  agentId: string;
  enabled?: boolean;
  platforms?: string[];
  providers?: string[];
  stages?: string[];
  tagsAny?: string[];
  tagsAll?: string[];
  sources?: string[];
  textIncludes?: string[];
};

export type AgentRoutingConfig = {
  defaultAgentId?: string;
  rules: AgentRoutingRule[];
};

export type RoutingDecision = {
  agentId?: string;
  matchedRuleId?: string;
};
