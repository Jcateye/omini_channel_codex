import type { AgentRoutingConfig, AgentRoutingRule, RoutingDecision } from './types.js';

const normalizeList = (input?: string[]) => (Array.isArray(input) ? input.map((v) => v.toLowerCase()) : []);

const matchesRule = (rule: AgentRoutingRule, input: {
  platform?: string;
  provider?: string;
  stage?: string;
  tags?: string[];
  source?: string | null;
  text?: string;
}) => {
  if (rule.enabled === false) return false;

  const platform = input.platform?.toLowerCase();
  const provider = input.provider?.toLowerCase();
  const stage = input.stage?.toLowerCase();
  const tags = normalizeList(input.tags);
  const sources = normalizeList(input.source ? [input.source] : []);
  const text = input.text?.toLowerCase() ?? '';

  const platforms = normalizeList(rule.platforms);
  if (platforms.length > 0 && (!platform || !platforms.includes(platform))) {
    return false;
  }

  const providers = normalizeList(rule.providers);
  if (providers.length > 0 && (!provider || !providers.includes(provider))) {
    return false;
  }

  const stages = normalizeList(rule.stages);
  if (stages.length > 0 && (!stage || !stages.includes(stage))) {
    return false;
  }

  const sourcesRule = normalizeList(rule.sources);
  if (sourcesRule.length > 0 && (sources.length === 0 || !sourcesRule.includes(sources[0]))) {
    return false;
  }

  if (rule.tagsAll && rule.tagsAll.length > 0) {
    const required = normalizeList(rule.tagsAll);
    if (!required.every((tag) => tags.includes(tag))) {
      return false;
    }
  }

  if (rule.tagsAny && rule.tagsAny.length > 0) {
    const any = normalizeList(rule.tagsAny);
    if (!any.some((tag) => tags.includes(tag))) {
      return false;
    }
  }

  if (rule.textIncludes && rule.textIncludes.length > 0) {
    const needles = normalizeList(rule.textIncludes);
    if (!needles.some((needle) => text.includes(needle))) {
      return false;
    }
  }

  return true;
};

export const selectAgent = (config: AgentRoutingConfig, input: {
  platform?: string;
  provider?: string;
  stage?: string;
  tags?: string[];
  source?: string | null;
  text?: string;
}): RoutingDecision => {
  for (const rule of config.rules ?? []) {
    if (matchesRule(rule, input)) {
      return { agentId: rule.agentId, matchedRuleId: rule.id };
    }
  }

  return config.defaultAgentId ? { agentId: config.defaultAgentId } : {};
};
