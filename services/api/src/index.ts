import crypto from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { applyLeadRules, type LeadRule } from '@omini/core';
import type { AgentRoutingConfig, AgentRoutingRule } from '@omini/agent-routing';
import { listAgentAdapters, selectAgent } from '@omini/agent-routing';
import type { ToolExecutionRequest } from '@omini/agent-tools';
import {
  executeTool,
  getExternalAdapter,
  listExternalAdapters,
  registerExternalAdapter,
} from '@omini/agent-tools';
import { httpExternalAdapter, mockExternalAdapter } from '@omini/agent-tools';
import { Langfuse } from 'langfuse';
import {
  prisma,
  Prisma,
  type AgentRunType,
  type AttributionModel,
  type CampaignOptimizationStatus,
  type CampaignStatus,
  type JourneyNodeType,
  type JourneyStatus,
  type JourneyTriggerType,
  type KnowledgeSourceType,
  type LeadStage,
  type MessageStatus,
  type Platform,
  type WebhookDeliveryStatus,
} from '@omini/database';
import { createQueue, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { getWhatsAppAdapter } from '@omini/whatsapp-bsp';

import { createApiKey } from './auth.js';
import { tenantAuth } from './middleware/tenant-auth.js';

type ApiEnv = {
  Variables: {
    tenantId: string;
    apiKeyId: string;
  };
};

const app = new Hono<ApiEnv>();
const api = new Hono<ApiEnv>();
const admin = new Hono();

registerExternalAdapter(mockExternalAdapter);
registerExternalAdapter(httpExternalAdapter);

const inboundQueue = createQueue(QUEUE_NAMES.inboundEvents);
const crmQueue = createQueue(QUEUE_NAMES.crmWebhooks);
const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);
const statusQueue = createQueue(QUEUE_NAMES.statusEvents);
const knowledgeQueue = createQueue(QUEUE_NAMES.knowledgeSync);
const journeyQueue = createQueue(QUEUE_NAMES.journeyRuns);

const leadStages = new Set(['new', 'qualified', 'nurtured', 'converted', 'lost']);
const supportedPlatforms = new Set(['whatsapp', 'twitter', 'instagram', 'tiktok']);
const webhookStatuses = new Set(['pending', 'success', 'failed']);
const messageStatuses = new Set(['pending', 'sent', 'delivered', 'read', 'failed']);
const campaignStatuses = new Set(['draft', 'scheduled', 'running', 'completed', 'failed', 'canceled']);
const campaignOptimizationStatuses = new Set(['pending', 'applied', 'dismissed']);
const agentRunTypes = new Set(['lead_scoring', 'campaign_optimization']);
const journeyStatuses = new Set(['draft', 'active', 'paused', 'archived']);
const journeyTriggerTypes = new Set(['inbound_message', 'tag_change', 'stage_change', 'time']);
const journeyNodeTypes = new Set(['send_message', 'delay', 'condition', 'tag_update', 'webhook']);
const attributionModels = new Set(['first_touch', 'last_touch', 'linear']);

const createTrackingToken = () => crypto.randomBytes(16).toString('hex');

const readJsonBody = async (c: Context) => {
  const parsed = await c.req.json<unknown>().catch(() => ({}));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {} as Record<string, unknown>;
  }
  return parsed as Record<string, unknown>;
};

const toInputJson = (value: unknown) => value as Prisma.InputJsonValue;
const toNullableJson = (value: unknown) =>
  value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

const loadOrganizationSettings = async (organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  return (organization?.settings as Record<string, unknown>) ?? {};
};

const getAgentRoutingConfig = (settings: Record<string, unknown>): AgentRoutingConfig => {
  const raw = settings.agentRouting;
  if (!raw || typeof raw !== 'object') {
    return { rules: [] };
  }

  const config = raw as Record<string, unknown>;
  const rules = Array.isArray(config.rules)
    ? (config.rules.filter((rule) => rule && typeof rule === 'object') as AgentRoutingRule[])
    : [];

  const output: AgentRoutingConfig = { rules };
  if (typeof config.defaultAgentId === 'string') {
    output.defaultAgentId = config.defaultAgentId;
  }
  return output;
};

const normalizeAgentRoutingConfig = (input: unknown): AgentRoutingConfig => {
  if (!input || typeof input !== 'object') {
    return { rules: [] };
  }

  const config = input as Record<string, unknown>;
  const rules = Array.isArray(config.rules)
    ? (config.rules.filter((rule) => rule && typeof rule === 'object') as AgentRoutingRule[])
    : [];

  const output: AgentRoutingConfig = { rules };
  if (typeof config.defaultAgentId === 'string') {
    output.defaultAgentId = config.defaultAgentId;
  }
  return output;
};

const getLeadRulesFromSettings = (settings: Record<string, unknown>): LeadRule[] => {
  const raw = settings.leadRules;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((rule) => rule && typeof rule === 'object') as LeadRule[];
};

const normalizeLeadRules = (input: unknown): LeadRule[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((rule) => {
      if (!rule || typeof rule !== 'object') {
        return null;
      }

      const item = rule as Record<string, unknown>;
      const id =
        typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id
          : `rule_${createTrackingToken()}`;

      return {
        ...item,
        id,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
      } as LeadRule;
    })
    .filter((rule): rule is LeadRule => !!rule);
};

const normalizeTags = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
};

const normalizeTagSet = (tags: string[]) =>
  Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)))
    .sort()
    .join('|');

const enqueueJourneySignal = async (input: {
  organizationId: string;
  leadId: string;
  triggerType: 'tag_change' | 'stage_change';
  tags: string[];
  stage?: string | null;
  text?: string;
}) => {
  await journeyQueue.add(
    'journey.trigger',
    {
      type: 'trigger',
      triggerType: input.triggerType,
      organizationId: input.organizationId,
      leadId: input.leadId,
      tags: input.tags,
      stage: input.stage ?? undefined,
      text: input.text,
    },
    defaultJobOptions
  );
};

const normalizeJourneyStatus = (input: unknown): JourneyStatus => {
  const value = typeof input === 'string' ? input.trim() : '';
  return journeyStatuses.has(value) ? (value as JourneyStatus) : 'draft';
};

const normalizeJourneyTriggers = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const type = typeof item.type === 'string' ? item.type.trim() : '';
      if (!journeyTriggerTypes.has(type)) {
        return null;
      }
      const enabled = typeof item.enabled === 'boolean' ? item.enabled : true;
      const config =
        item.config && typeof item.config === 'object' && !Array.isArray(item.config)
          ? (item.config as Record<string, unknown>)
          : null;
      return { type, enabled, config };
    })
    .filter((trigger): trigger is { type: string; enabled: boolean; config: Record<string, unknown> | null } =>
      !!trigger
    );
};

const normalizeJourneyNodes = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const id =
        typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id.trim()
          : crypto.randomUUID();
      const type = typeof item.type === 'string' ? item.type.trim() : '';
      if (!journeyNodeTypes.has(type)) {
        return null;
      }
      const label = typeof item.label === 'string' ? item.label.trim() : null;
      const config =
        item.config && typeof item.config === 'object' && !Array.isArray(item.config)
          ? (item.config as Record<string, unknown>)
          : null;
      const position =
        item.position && typeof item.position === 'object' && !Array.isArray(item.position)
          ? (item.position as Record<string, unknown>)
          : null;
      return { id, type, label, config, position };
    })
    .filter((node): node is { id: string; type: string; label: string | null; config: Record<string, unknown> | null; position: Record<string, unknown> | null } =>
      !!node
    );
};

const normalizeJourneyEdges = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const id =
        typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id.trim()
          : crypto.randomUUID();
      const fromNodeId = typeof item.fromNodeId === 'string' ? item.fromNodeId.trim() : '';
      const toNodeId = typeof item.toNodeId === 'string' ? item.toNodeId.trim() : '';
      if (!fromNodeId || !toNodeId) {
        return null;
      }
      const label = typeof item.label === 'string' ? item.label.trim() : null;
      const config =
        item.config && typeof item.config === 'object' && !Array.isArray(item.config)
          ? (item.config as Record<string, unknown>)
          : null;
      return { id, fromNodeId, toNodeId, label, config };
    })
    .filter((edge): edge is { id: string; fromNodeId: string; toNodeId: string; label: string | null; config: Record<string, unknown> | null } =>
      !!edge
    );
};

const defaultIntentTaxonomy = [
  { id: 'pricing', name: 'Pricing' },
  { id: 'purchase', name: 'Purchase intent' },
  { id: 'product_info', name: 'Product info' },
  { id: 'promo', name: 'Promotions' },
  { id: 'demo', name: 'Demo or trial' },
  { id: 'shipping', name: 'Shipping' },
  { id: 'returns', name: 'Returns or refunds' },
  { id: 'complaint', name: 'Complaint' },
  { id: 'availability', name: 'Availability' },
  { id: 'payment', name: 'Payment issue' },
  { id: 'comparison', name: 'Competitor comparison' },
  { id: 'human_handoff', name: 'Human handoff' },
];

const applyConversionUpdate = (currentStage: string, updates: Record<string, unknown>) => {
  if (typeof updates.stage !== 'string') {
    return updates;
  }

  if (updates.stage === 'converted' && currentStage !== 'converted') {
    return { ...updates, convertedAt: new Date() };
  }

  if (updates.stage !== 'converted' && currentStage === 'converted') {
    return { ...updates, convertedAt: null };
  }

  return updates;
};

const parseDate = (raw?: string | null) => {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const toDayStart = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const resolveDateRange = (startRaw?: string | null, endRaw?: string | null) => {
  const now = new Date();
  const endDate = parseDate(endRaw) ?? now;
  const endStart = toDayStart(endDate);
  const end = addDays(endStart, 1);

  const startDate = parseDate(startRaw) ?? addDays(endStart, -6);
  const start = toDayStart(startDate);

  return { start, end };
};

const safeRate = (numerator: number, denominator: number) =>
  denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeAnalyticsSettings = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      attributionLookbackDays: 7,
      aggregationDays: 30,
      realtimeWindowMinutes: 60,
    };
  }

  const settings = input as Record<string, unknown>;
  const attributionLookbackDaysRaw =
    typeof settings.attributionLookbackDays === 'number'
      ? settings.attributionLookbackDays
      : 7;
  const aggregationDaysRaw =
    typeof settings.aggregationDays === 'number' ? settings.aggregationDays : 30;
  const realtimeWindowMinutesRaw =
    typeof settings.realtimeWindowMinutes === 'number' ? settings.realtimeWindowMinutes : 60;

  return {
    attributionLookbackDays: clampNumber(Math.floor(attributionLookbackDaysRaw), 1, 60),
    aggregationDays: clampNumber(Math.floor(aggregationDaysRaw), 7, 180),
    realtimeWindowMinutes: clampNumber(Math.floor(realtimeWindowMinutesRaw), 5, 1440),
  };
};

const normalizeAgentIntelligenceSettings = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      memoryRetentionDays: 7,
      optimizationAutoApply: false,
    };
  }

  const settings = input as Record<string, unknown>;
  const memoryRetentionDays =
    typeof settings.memoryRetentionDays === 'number' && settings.memoryRetentionDays > 0
      ? Math.floor(settings.memoryRetentionDays)
      : 7;
  const optimizationAutoApply = settings.optimizationAutoApply === true;

  return {
    memoryRetentionDays,
    optimizationAutoApply,
  };
};

const normalizeOptimizationStrategies = (input: unknown) => {
  const defaults = {
    enabled: true,
    autoApplyActions: ['pause', 'schedule_shift', 'segment_tweak'],
    rules: [
      {
        id: 'delivery_rate_low',
        name: 'Delivery rate below 80%',
        enabled: true,
        thresholds: { deliveryRateMin: 0.8 },
        action: { type: 'schedule_shift', safeAutoApply: true },
      },
      {
        id: 'failure_rate_high',
        name: 'Failure rate above 20%',
        enabled: true,
        thresholds: { failureRateMax: 0.2 },
        action: { type: 'pause', safeAutoApply: true },
      },
      {
        id: 'negative_roi',
        name: 'ROI below 0',
        enabled: true,
        thresholds: { roiMin: 0 },
        action: { type: 'segment_tweak', safeAutoApply: true },
      },
    ],
  };

  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const raw = input as Record<string, unknown>;
  const enabled = raw.enabled !== false;
  const autoApplyActions = Array.isArray(raw.autoApplyActions)
    ? raw.autoApplyActions.filter((action) => typeof action === 'string')
    : defaults.autoApplyActions;
  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .filter((rule) => rule && typeof rule === 'object')
        .map((rule) => {
          const item = rule as Record<string, unknown>;
          const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `rule_${createTrackingToken()}`;
          const name = typeof item.name === 'string' ? item.name.trim() : id;
          const enabled = item.enabled !== false;
          const thresholds =
            item.thresholds && typeof item.thresholds === 'object' && !Array.isArray(item.thresholds)
              ? (item.thresholds as Record<string, unknown>)
              : {};
          const action =
            item.action && typeof item.action === 'object' && !Array.isArray(item.action)
              ? (item.action as Record<string, unknown>)
              : {};
          const actionType = typeof action.type === 'string' ? action.type : 'schedule_shift';
          const safeAutoApply = action.safeAutoApply !== false;
          return {
            id,
            name,
            enabled,
            thresholds,
            action: {
              type: actionType,
              safeAutoApply,
            },
          };
        })
    : defaults.rules;

  return {
    enabled,
    autoApplyActions,
    rules,
  };
};

const normalizeDistributionStrategies = (input: unknown) => {
  const defaults = {
    mode: 'round_robin',
    targets: [
      { id: 'sales', name: 'Sales', weight: 1, skills: ['sales'], stages: [] },
      { id: 'support', name: 'Support', weight: 1, skills: ['support'], stages: [] },
    ],
    state: { cursor: 0 },
  };

  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const raw = input as Record<string, unknown>;
  const mode =
    typeof raw.mode === 'string' && ['round_robin', 'weighted', 'skill_based'].includes(raw.mode)
      ? raw.mode
      : defaults.mode;

  const targets = Array.isArray(raw.targets)
    ? raw.targets
        .filter((target) => target && typeof target === 'object')
        .map((target) => {
          const item = target as Record<string, unknown>;
          const id = typeof item.id === 'string' ? item.id.trim() : '';
          const name = typeof item.name === 'string' ? item.name.trim() : id;
          const weight = typeof item.weight === 'number' && item.weight > 0 ? item.weight : 1;
          const skills = Array.isArray(item.skills)
            ? item.skills.filter((skill) => typeof skill === 'string')
            : [];
          const stages = Array.isArray(item.stages)
            ? item.stages.filter((stage) => typeof stage === 'string')
            : [];
          return { id, name, weight, skills, stages };
        })
        .filter((target) => target.id.length > 0)
    : defaults.targets;

  const state =
    raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state)
      ? (raw.state as Record<string, unknown>)
      : {};
  const cursor = typeof state.cursor === 'number' && state.cursor >= 0 ? Math.floor(state.cursor) : 0;

  return {
    mode,
    targets,
    state: { cursor },
  };
};

const normalizeAgentHandoffConfig = (input: unknown) => {
  const defaultStageRoles: Record<string, string> = {
    new: 'ops',
    qualified: 'sales',
    nurtured: 'sales',
    converted: 'ops',
    lost: 'support',
  };
  const defaults = {
    enabled: true,
    roles: [
      { id: 'sales', name: 'Sales' },
      { id: 'support', name: 'Support' },
      { id: 'ops', name: 'Ops' },
    ],
    stageRoles: defaultStageRoles,
    rules: [
      { id: 'score_sales', type: 'score', minScore: 50, targetRole: 'sales', enabled: true },
      { id: 'tag_support', type: 'tag', tagsAny: ['complaint', 'refund'], targetRole: 'support', enabled: true },
      { id: 'task_support', type: 'task', tasksAny: ['support', 'refund'], targetRole: 'support', enabled: true },
      { id: 'confidence_high', type: 'confidence', minConfidence: 0.7, targetRole: 'sales', enabled: true },
    ],
    contextAllowlist: [
      'lead.id',
      'lead.stage',
      'lead.tags',
      'lead.score',
      'lead.source',
      'lead.metadata.assignmentQueue',
      'context.taskType',
      'context.confidence',
      'context.matchedRuleIds',
    ],
  };

  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const raw = input as Record<string, unknown>;
  const enabled = raw.enabled !== false;
  const roles = Array.isArray(raw.roles)
    ? raw.roles
        .filter((role) => role && typeof role === 'object')
        .map((role) => {
          const item = role as Record<string, unknown>;
          const id = typeof item.id === 'string' ? item.id.trim() : '';
          const name = typeof item.name === 'string' ? item.name.trim() : id;
          return { id, name };
        })
        .filter((role) => role.id.length > 0)
    : defaults.roles;

  const stageRoles =
    raw.stageRoles && typeof raw.stageRoles === 'object' && !Array.isArray(raw.stageRoles)
      ? Object.entries(raw.stageRoles as Record<string, unknown>).reduce(
          (acc, [key, value]) => {
            if (typeof value === 'string' && value.trim()) {
              acc[key] = value.trim();
            }
            return acc;
          },
          {} as Record<string, string>
        )
      : defaults.stageRoles;

  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .filter((rule) => rule && typeof rule === 'object')
        .map((rule) => {
          const item = rule as Record<string, unknown>;
          const id = typeof item.id === 'string' ? item.id : `handoff_${createTrackingToken()}`;
          const type = typeof item.type === 'string' ? item.type : 'score';
          const targetRole = typeof item.targetRole === 'string' ? item.targetRole : 'sales';
          const enabled = item.enabled !== false;
          const minScore = typeof item.minScore === 'number' ? item.minScore : undefined;
          const minConfidence =
            typeof item.minConfidence === 'number' ? item.minConfidence : undefined;
          const tagsAny = Array.isArray(item.tagsAny)
            ? item.tagsAny.filter((tag) => typeof tag === 'string')
            : [];
          const tasksAny = Array.isArray(item.tasksAny)
            ? item.tasksAny.filter((task) => typeof task === 'string')
            : [];
          return { id, type, targetRole, enabled, minScore, minConfidence, tagsAny, tasksAny };
        })
    : defaults.rules;

  const contextAllowlist = Array.isArray(raw.contextAllowlist)
    ? raw.contextAllowlist.filter((entry) => typeof entry === 'string')
    : defaults.contextAllowlist;

  return {
    enabled,
    roles,
    stageRoles,
    rules,
    contextAllowlist,
  };
};

const getValueByPath = (source: Record<string, unknown>, path: string) => {
  const parts = path.split('.').filter((part) => part.length > 0);
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const setValueByPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.').filter((part) => part.length > 0);
  let current = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i === parts.length - 1) {
      current[part] = value;
      return;
    }
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
};

const applyContextAllowlist = (source: Record<string, unknown>, allowlist: string[]) => {
  const result: Record<string, unknown> = {};
  for (const entry of allowlist) {
    const value = getValueByPath(source, entry);
    if (value !== undefined) {
      setValueByPath(result, entry, value);
    }
  }
  return result;
};

const evaluateHandoff = (input: {
  config: ReturnType<typeof normalizeAgentHandoffConfig>;
  lead: {
    id: string;
    stage: string;
    score?: number | null;
    tags: string[];
    source?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  context: {
    matchedRuleIds?: string[];
    taskType?: string | null;
    confidence?: number | null;
  };
}) => {
  if (!input.config.enabled) {
    return { nextRole: null, trigger: null };
  }

  const currentRole =
    typeof input.lead.metadata?.agentRole === 'string'
      ? (input.lead.metadata.agentRole as string)
      : input.config.stageRoles[input.lead.stage] ?? null;

  const leadTags = input.lead.tags.map((tag) => tag.toLowerCase());
  const taskType = input.context.taskType?.toLowerCase();
  const confidence = typeof input.context.confidence === 'number' ? input.context.confidence : null;
  const score = typeof input.lead.score === 'number' ? input.lead.score : 0;

  for (const rule of input.config.rules) {
    if (!rule.enabled) continue;
    if (!rule.targetRole || rule.targetRole === currentRole) continue;

    if (rule.type === 'score' && typeof rule.minScore === 'number' && score >= rule.minScore) {
      return {
        nextRole: rule.targetRole,
        trigger: { type: 'score', ruleId: rule.id, detail: { minScore: rule.minScore, score } },
      };
    }

    if (rule.type === 'tag' && rule.tagsAny?.length) {
      const tagsAny = rule.tagsAny.map((tag) => tag.toLowerCase());
      if (tagsAny.some((tag) => leadTags.includes(tag))) {
        return {
          nextRole: rule.targetRole,
          trigger: { type: 'tag', ruleId: rule.id, detail: { tagsAny: rule.tagsAny } },
        };
      }
    }

    if (rule.type === 'task' && rule.tasksAny?.length && taskType) {
      const tasksAny = rule.tasksAny.map((task) => task.toLowerCase());
      if (tasksAny.includes(taskType)) {
        return {
          nextRole: rule.targetRole,
          trigger: { type: 'task', ruleId: rule.id, detail: { taskType } },
        };
      }
    }

    if (rule.type === 'confidence' && confidence !== null && typeof rule.minConfidence === 'number') {
      if (confidence >= rule.minConfidence) {
        return {
          nextRole: rule.targetRole,
          trigger: {
            type: 'confidence',
            ruleId: rule.id,
            detail: { minConfidence: rule.minConfidence, confidence },
          },
        };
      }
    }
  }

  const stageRole = input.config.stageRoles[input.lead.stage];
  if (stageRole && stageRole !== currentRole) {
    return {
      nextRole: stageRole,
      trigger: { type: 'stage', ruleId: null, detail: { stage: input.lead.stage } },
    };
  }

  return { nextRole: null, trigger: null };
};

const selectDistributionTarget = (input: {
  distribution: ReturnType<typeof normalizeDistributionStrategies>;
  lead: {
    stage: string;
    tags: string[];
    metadata?: Record<string, unknown> | null;
  };
  suggestedQueue?: string | null;
}) => {
  const { distribution } = input;
  const targets = distribution.targets;
  if (!targets.length) {
    return { target: null, rationale: ['no_targets'] };
  }

  const leadTags = input.lead.tags.map((tag) => tag.toLowerCase());
  const leadStage = input.lead.stage.toLowerCase();

  if (distribution.mode === 'skill_based') {
    const matched = targets.find((target) => {
      const skills = (target.skills ?? []).map((skill) => skill.toLowerCase());
      const stages = (target.stages ?? []).map((stage) => stage.toLowerCase());
      const stageMatch = stages.length === 0 || stages.includes(leadStage);
      const skillMatch =
        skills.length === 0 || skills.some((skill) => leadTags.includes(skill));
      return stageMatch && skillMatch;
    });

    if (matched) {
    return { target: matched, rationale: ['skill_match'] };
  }
  }

  if (distribution.mode === 'weighted') {
    const total = targets.reduce((sum, target) => sum + (target.weight ?? 1), 0);
    if (total > 0) {
      let pick = Math.random() * total;
      for (const target of targets) {
        pick -= target.weight ?? 1;
        if (pick <= 0) {
          return { target, rationale: ['weighted_pick'] };
        }
      }
    }
  }

  if (distribution.mode === 'round_robin') {
    const cursor = distribution.state.cursor ?? 0;
    const index = cursor % targets.length;
    const target = targets[index];
    return {
      target,
      rationale: ['round_robin', `cursor:${cursor}`],
      nextCursor: cursor + 1,
    };
  }

  if (input.suggestedQueue) {
    const matched = targets.find((target) => target.id === input.suggestedQueue);
    if (matched) {
      return { target: matched, rationale: ['suggested_queue'] };
    }
  }

  return { target: targets[0], rationale: ['fallback'] };
};

const normalizeLangfuseSettings = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      enabled: false,
      baseUrl: 'https://cloud.langfuse.com',
      publicKey: '',
      secretKey: '',
    };
  }

  const settings = input as Record<string, unknown>;
  const enabled = typeof settings.enabled === 'boolean' ? settings.enabled : false;
  const baseUrl =
    typeof settings.baseUrl === 'string' && settings.baseUrl.trim().length > 0
      ? settings.baseUrl.trim()
      : 'https://cloud.langfuse.com';
  const publicKey = typeof settings.publicKey === 'string' ? settings.publicKey.trim() : '';
  const secretKey = typeof settings.secretKey === 'string' ? settings.secretKey.trim() : '';

  return {
    enabled,
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    publicKey,
    secretKey,
  };
};

const langfuseClients = new Map<string, Langfuse>();

const getLangfuseClient = (settings: ReturnType<typeof normalizeLangfuseSettings>) => {
  if (!settings.enabled || !settings.publicKey || !settings.secretKey) {
    return null;
  }

  const key = `${settings.baseUrl}|${settings.publicKey}|${settings.secretKey}`;
  const existing = langfuseClients.get(key);
  if (existing) {
    return existing;
  }

  const client = new Langfuse({
    publicKey: settings.publicKey,
    secretKey: settings.secretKey,
    baseUrl: settings.baseUrl,
  });
  langfuseClients.set(key, client);
  return client;
};

const sendLangfuseTrace = async (
  settings: ReturnType<typeof normalizeLangfuseSettings>,
  payload: Record<string, unknown>
) => {
  const client = getLangfuseClient(settings);
  if (!client) {
    return;
  }

  try {
    client.trace(payload as Parameters<Langfuse['trace']>[0]);
    await client.flushAsync();
  } catch (error) {
    console.warn('Langfuse trace failed', error);
  }
};

const buildExpiresAt = (days: number) => {
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
};

const normalizeQueryTokens = (value: string) =>
  value
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

const splitContentIntoChunks = (content: string, maxLength = 600) => {
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxLength) {
      chunks.push(block);
      continue;
    }

    let cursor = 0;
    while (cursor < block.length) {
      chunks.push(block.slice(cursor, cursor + maxLength));
      cursor += maxLength;
    }
  }

  return chunks;
};

type KnowledgeQueryInput = {
  organizationId: string;
  query: string;
  sourceIds?: string[];
  topK?: number;
  minCreatedAt?: Date | null;
  tags?: string[];
};

const getOpenAIEmbeddingSettings = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return {
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    model: process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
  };
};

const requestOpenAIEmbedding = async (input: {
  text: string;
  settings: NonNullable<ReturnType<typeof getOpenAIEmbeddingSettings>>;
}) => {
  const response = await fetch(`${input.settings.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.settings.apiKey}`,
    },
    body: JSON.stringify({
      model: input.settings.model,
      input: input.text,
    }),
  });

  const payloadText = await response.text();
  const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      (payload?.error as { message?: string } | undefined)?.message ||
      payloadText ||
      `OpenAI error (${response.status})`;
    throw new Error(message);
  }

  const data = Array.isArray(payload.data) ? payload.data : [];
  const embedding = data[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('OpenAI embedding missing');
  }
  return embedding as number[];
};

const getQdrantSettings = () => {
  const url = process.env.QDRANT_URL?.trim();
  if (!url) {
    return null;
  }
  return {
    url,
    apiKey: process.env.QDRANT_API_KEY?.trim() || '',
    collection: process.env.QDRANT_COLLECTION?.trim() || 'omini_knowledge',
  };
};

const qdrantFetch = async (
  settings: NonNullable<ReturnType<typeof getQdrantSettings>>,
  path: string,
  options?: RequestInit
) => {
  const response = await fetch(`${settings.url}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(settings.apiKey ? { 'api-key': settings.apiKey } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const payloadText = await response.text();
  const payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      (payload?.status as { error?: string } | undefined)?.error ||
      payloadText ||
      `Qdrant error (${response.status})`;
    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return payload;
};

const searchQdrant = async (input: {
  settings: NonNullable<ReturnType<typeof getQdrantSettings>>;
  vector: number[];
  topK: number;
  organizationId: string;
  sourceIds?: string[];
}) => {
  const filter: { must: Array<Record<string, unknown>> } = {
    must: [{ key: 'organizationId', match: { value: input.organizationId } }],
  };

  if (input.sourceIds && input.sourceIds.length > 0) {
    filter.must.push({
      key: 'sourceId',
      match:
        input.sourceIds.length === 1
          ? { value: input.sourceIds[0] }
          : { any: input.sourceIds },
    });
  }

  const payload = await qdrantFetch(
    input.settings,
    `/collections/${input.settings.collection}/points/search`,
    {
      method: 'POST',
      body: JSON.stringify({
        vector: input.vector,
        limit: input.topK,
        filter,
      }),
    }
  );

  const result = Array.isArray(payload.result) ? payload.result : [];
  return result
    .map((item) => ({
      id: typeof item?.id === 'string' || typeof item?.id === 'number' ? String(item.id) : null,
      score: typeof item?.score === 'number' ? item.score : null,
    }))
    .filter((item): item is { id: string; score: number } => !!item.id && item.score !== null);
};

const chunkMatchesTags = (
  metadata: Prisma.JsonValue | null | undefined,
  tags?: string[]
) => {
  if (!tags || tags.length === 0) {
    return true;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>).tags;
  if (!Array.isArray(value)) {
    return false;
  }
  const normalized = value.filter((tag) => typeof tag === 'string') as string[];
  return tags.every((tag) => normalized.includes(tag));
};

const listActiveMemories = async (input: {
  organizationId: string;
  leadId?: string | null;
  sessionId?: string | null;
  limit?: number;
}) => {
  const { organizationId, leadId, sessionId } = input;
  const limit = input.limit ?? 20;
  const now = new Date();

  const or: Prisma.AgentMemoryWhereInput[] = [];
  if (leadId) {
    or.push({ scope: 'lead', leadId });
  }
  if (sessionId) {
    or.push({ scope: 'session', sessionId });
  }

  if (or.length === 0) {
    return [];
  }

  return prisma.agentMemory.findMany({
    where: {
      organizationId,
      expiresAt: { gt: now },
      OR: or,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
};

const createAgentMemory = async (input: {
  organizationId: string;
  scope: 'session' | 'lead';
  leadId?: string | null;
  sessionId?: string | null;
  key?: string | null;
  content: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  retentionDays: number;
}) => {
  return prisma.agentMemory.create({
    data: {
      organizationId: input.organizationId,
      scope: input.scope,
      leadId: input.leadId ?? null,
      sessionId: input.sessionId ?? null,
      key: input.key ?? null,
      content: toInputJson(input.content),
      ...(input.metadata ? { metadata: toInputJson(input.metadata) } : {}),
      expiresAt: buildExpiresAt(input.retentionDays),
    },
  });
};

const retrieveKnowledgeChunksKeyword = async (input: KnowledgeQueryInput) => {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  const tokens = normalizeQueryTokens(query);
  const where: Prisma.KnowledgeChunkWhereInput = {
    organizationId: input.organizationId,
    source: { enabled: true },
  };

  if (input.sourceIds && input.sourceIds.length > 0) {
    where.sourceId = { in: input.sourceIds };
  }

  if (input.minCreatedAt) {
    where.createdAt = { gte: input.minCreatedAt };
  }

  if (tokens.length > 0) {
    where.OR = tokens.map((token) => ({
      content: { contains: token, mode: 'insensitive' },
    }));
  }

  const chunks = await prisma.knowledgeChunk.findMany({
    where,
    take: 50,
  });

  const scored = chunks
    .map((chunk) => {
      const text = chunk.content.toLowerCase();
      const score = tokens.reduce((total, token) => {
        if (!text.includes(token)) return total;
        return total + (text.split(token).length - 1);
      }, 0);
      return { chunk, score };
    })
    .filter((row) => row.score > 0 || tokens.length === 0)
    .filter((row) => chunkMatchesTags(row.chunk.metadata, input.tags));

  scored.sort((a, b) => b.score - a.score);
  const topK = input.topK ?? 5;

  return scored.slice(0, topK).map((row) => ({
    id: row.chunk.id,
    sourceId: row.chunk.sourceId,
    content: row.chunk.content,
    score: row.score,
    metadata: row.chunk.metadata,
  }));
};

const retrieveKnowledgeChunksVector = async (input: KnowledgeQueryInput) => {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  const openai = getOpenAIEmbeddingSettings();
  const qdrant = getQdrantSettings();
  if (!openai || !qdrant) {
    return null;
  }

  try {
    const vector = await requestOpenAIEmbedding({ text: query, settings: openai });
    const topK = input.topK ?? 5;
    const hits = await searchQdrant({
      settings: qdrant,
      vector,
      topK,
      organizationId: input.organizationId,
      ...(input.sourceIds && input.sourceIds.length > 0 ? { sourceIds: input.sourceIds } : {}),
    });

    if (hits.length === 0) {
      return [];
    }

    const chunkIds = hits.map((hit) => hit.id);
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        id: { in: chunkIds },
        organizationId: input.organizationId,
        source: { enabled: true },
        ...(input.minCreatedAt ? { createdAt: { gte: input.minCreatedAt } } : {}),
        ...(input.sourceIds && input.sourceIds.length > 0
          ? { sourceId: { in: input.sourceIds } }
          : {}),
      },
    });

    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const ordered = hits
      .map((hit) => {
        const chunk = chunkMap.get(hit.id);
        if (!chunk) return null;
        if (!chunkMatchesTags(chunk.metadata, input.tags)) {
          return null;
        }
        return {
          id: chunk.id,
          sourceId: chunk.sourceId,
          content: chunk.content,
          score: hit.score,
          metadata: chunk.metadata,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return ordered;
  } catch (error) {
    console.warn('Vector retrieval failed, falling back to keyword search', error);
    return null;
  }
};

const retrieveKnowledgeChunks = async (input: KnowledgeQueryInput) => {
  const vectorResults = await retrieveKnowledgeChunksVector(input);
  if (vectorResults && vectorResults.length > 0) {
    return vectorResults;
  }

  return retrieveKnowledgeChunksKeyword(input);
};

const evaluateOptimizationStrategies = (input: {
  strategies: ReturnType<typeof normalizeOptimizationStrategies>;
  analytics: Array<{
    campaignId: string | null;
    outboundSent: number;
    outboundDelivered: number;
    outboundFailed: number;
    attributedRevenue?: number | null;
  }>;
  campaigns: Array<{ id: string; cost?: number | null; revenue?: number | null }>;
}) => {
  if (!input.strategies.enabled) {
    return [];
  }

  const campaignMap = new Map(input.campaigns.map((campaign) => [campaign.id, campaign]));
  const recs: Array<{
    campaignId: string;
    type: string;
    title: string;
    description: string;
    metrics: Record<string, unknown>;
    action: Record<string, unknown>;
  }> = [];

  for (const row of input.analytics) {
    if (!row.campaignId) continue;
    const campaign = campaignMap.get(row.campaignId);
    if (!campaign) continue;
    const outboundSent = row.outboundSent ?? 0;
    const outboundDelivered = row.outboundDelivered ?? 0;
    const outboundFailed = row.outboundFailed ?? 0;
    const deliveryRate = outboundSent > 0 ? outboundDelivered / outboundSent : 1;
    const failureRate = outboundSent > 0 ? outboundFailed / outboundSent : 0;
    const cost = campaign.cost ?? 0;
    const attributedRevenue = row.attributedRevenue ?? 0;
    const roi =
      cost > 0 ? Number(((attributedRevenue - cost) / cost).toFixed(4)) : null;

    for (const rule of input.strategies.rules) {
      if (!rule.enabled) continue;
      const thresholds = rule.thresholds ?? {};
      const deliveryRateMin =
        typeof thresholds.deliveryRateMin === 'number' ? thresholds.deliveryRateMin : null;
      const failureRateMax =
        typeof thresholds.failureRateMax === 'number' ? thresholds.failureRateMax : null;
      const roiMin = typeof thresholds.roiMin === 'number' ? thresholds.roiMin : null;

      if (deliveryRateMin !== null && deliveryRate >= deliveryRateMin) {
        continue;
      }
      if (failureRateMax !== null && failureRate <= failureRateMax) {
        continue;
      }
      if (roiMin !== null) {
        if (roi === null) {
          continue;
        }
        if (roi >= roiMin) {
          continue;
        }
      }

      recs.push({
        campaignId: row.campaignId,
        type: rule.id,
        title: rule.name,
        description: `Strategy triggered: ${rule.name}`,
        metrics: {
          deliveryRate,
          failureRate,
          roi,
          outboundSent,
        },
        action: {
          type: rule.action.type,
          safeAutoApply: rule.action.safeAutoApply,
        },
      });
    }
  }

  return recs;
};

const normalizeToolSchema = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return { input: {}, output: {} };
  }
  const schema = input as Record<string, unknown>;
  const inputSchema =
    schema.input && typeof schema.input === 'object' && !Array.isArray(schema.input)
      ? (schema.input as Record<string, unknown>)
      : {};
  const outputSchema =
    schema.output && typeof schema.output === 'object' && !Array.isArray(schema.output)
      ? (schema.output as Record<string, unknown>)
      : {};
  return { input: inputSchema, output: outputSchema };
};

const normalizeToolDefinitionInput = (input: Record<string, unknown>) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const version = typeof input.version === 'string' ? input.version.trim() : 'v1';
  const kind = typeof input.kind === 'string' ? input.kind.trim() : 'internal';
  const provider = typeof input.provider === 'string' ? input.provider.trim() : null;
  const description = typeof input.description === 'string' ? input.description.trim() : null;
  const protocol = typeof input.protocol === 'string' ? input.protocol.trim() : 'v1';
  const schema = normalizeToolSchema(input.schema);
  const config =
    input.config && typeof input.config === 'object' && !Array.isArray(input.config)
      ? (input.config as Record<string, unknown>)
      : null;
  const auth =
    input.auth && typeof input.auth === 'object' && !Array.isArray(input.auth)
      ? (input.auth as Record<string, unknown>)
      : null;
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;

  return {
    name,
    version,
    kind,
    provider,
    description,
    protocol,
    schema,
    config,
    auth,
    enabled,
  };
};

const normalizePromptInput = (input: Record<string, unknown>) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const version = typeof input.version === 'string' ? input.version.trim() : 'v1';
  const content = typeof input.content === 'string' ? input.content : '';
  const metadata =
    input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : null;
  const active = typeof input.active === 'boolean' ? input.active : true;
  return { name, version, content, metadata, active };
};

const normalizePermissionInput = (input: Record<string, unknown>) => {
  const agentId = typeof input.agentId === 'string' ? input.agentId.trim() : null;
  const allowed = typeof input.allowed === 'boolean' ? input.allowed : true;
  return { agentId: agentId || null, allowed };
};

const checkToolPermission = async (organizationId: string, toolId: string, agentId?: string | null) => {
  const permissions = await prisma.toolPermission.findMany({
    where: { organizationId, toolId },
  });

  if (permissions.length === 0) {
    return true;
  }

  const match = permissions.find((perm) => perm.agentId === agentId) ??
    permissions.find((perm) => perm.agentId === null);
  return match?.allowed ?? false;
};

const normalizeLeadStage = (stage?: unknown) =>
  typeof stage === 'string' && leadStages.has(stage) ? stage : undefined;

const normalizeCurrency = (currency?: unknown) => {
  if (typeof currency !== 'string') {
    return null;
  }
  const normalized = currency.trim().toUpperCase();
  return normalized.length >= 3 ? normalized : null;
};

const applyLeadUpdate = async (
  lead: { id: string; stage: string },
  updates: Record<string, unknown>
) => {
  const normalized = { ...updates };
  const stage = normalizeLeadStage(updates.stage);
  if (stage) {
    normalized.stage = stage;
  }

  const conversionUpdates = applyConversionUpdate(lead.stage, normalized);
  const data: Prisma.LeadUpdateInput = {
    ...conversionUpdates,
    lastActivityAt: new Date(),
  };
  if ('metadata' in conversionUpdates) {
    data.metadata = toNullableJson(
      conversionUpdates.metadata &&
        typeof conversionUpdates.metadata === 'object' &&
        !Array.isArray(conversionUpdates.metadata)
        ? conversionUpdates.metadata
        : null
    );
  }
  return prisma.lead.update({
    where: { id: lead.id },
    data,
  });
};

const computeLeadAgentDecision = (input: {
  lead: {
    stage: string;
    score?: number | null;
    tags: string[];
    source?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  text?: string;
  signals?: string[];
  memories: Array<{ content: Record<string, unknown> }>;
  knowledge: Array<{ content: string }>;
}) => {
  const tags = [...input.lead.tags];
  const addTag = (tag: string) => {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  };

  const normalizedText = (input.text ?? '').toLowerCase();
  const signals = (input.signals ?? []).map((signal) => signal.toLowerCase());
  const hasSignal = (value: string) => signals.includes(value);

  const knowledgeText = input.knowledge.map((chunk) => chunk.content.toLowerCase()).join(' ');
  const memoryText = input.memories
    .map((memory) => JSON.stringify(memory.content ?? {}).toLowerCase())
    .join(' ');

  let stage = input.lead.stage;
  let score = typeof input.lead.score === 'number' ? input.lead.score : 0;
  let assignmentQueue: string | null = null;
  const rationale: string[] = [];

  if (
    hasSignal('purchase') ||
    normalizedText.includes('ready to buy') ||
    normalizedText.includes('buy')
  ) {
    stage = 'qualified';
    score += 10;
    addTag('high-intent');
    assignmentQueue = 'sales';
    rationale.push('purchase_intent');
  }

  if (hasSignal('demo') || normalizedText.includes('demo')) {
    if (stage === 'new') {
      stage = 'nurtured';
    }
    score += 5;
    addTag('demo');
    assignmentQueue = assignmentQueue ?? 'sales';
    rationale.push('demo_request');
  }

  if (normalizedText.includes('price') || knowledgeText.includes('pricing')) {
    score += 3;
    addTag('pricing');
    rationale.push('pricing_interest');
  }

  if (knowledgeText.includes('enterprise') || memoryText.includes('enterprise')) {
    score += 2;
    addTag('enterprise');
    rationale.push('enterprise_signal');
  }

  if (memoryText.includes('complaint') || normalizedText.includes('complaint')) {
    addTag('needs-attention');
    assignmentQueue = assignmentQueue ?? 'support';
    rationale.push('complaint_signal');
  }

  const updates: Record<string, unknown> = {};

  if (tags.join('|') !== input.lead.tags.join('|')) {
    updates.tags = tags;
  }

  if (stage !== input.lead.stage) {
    updates.stage = stage;
  }

  if (score !== (input.lead.score ?? 0)) {
    updates.score = score;
  }

  if (assignmentQueue) {
    const existingMetadata =
      input.lead.metadata && typeof input.lead.metadata === 'object' && !Array.isArray(input.lead.metadata)
        ? { ...(input.lead.metadata as Record<string, unknown>) }
        : {};
    if (existingMetadata.assignmentQueue !== assignmentQueue) {
      existingMetadata.assignmentQueue = assignmentQueue;
      existingMetadata.assignmentReason = rationale;
      updates.metadata = existingMetadata;
    }
  }

  return {
    updates,
    rationale,
    assignmentQueue,
  };
};

const runLeadAgentWorkflow = async (input: {
  organizationId: string;
  leadId: string;
  text?: string;
  signals?: string[];
  sessionId?: string | null;
  matchedRuleIds?: string[];
  taskType?: string | null;
  confidence?: number | null;
}) => {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
  });

  if (!lead) {
    return { lead: null, updates: {}, decision: null, runId: null };
  }

  const settings = await loadOrganizationSettings(input.organizationId);
  const agentSettings = normalizeAgentIntelligenceSettings(settings.agentIntelligence);
  const distributionSettings = normalizeDistributionStrategies(
    (settings.agentStrategies as Record<string, unknown> | undefined)?.distribution
  );
  const handoffConfig = normalizeAgentHandoffConfig(settings.agentHandoffs);

  const run = await prisma.agentRun.create({
    data: {
      organizationId: input.organizationId,
      type: 'lead_scoring',
      leadId: lead.id,
      input: toInputJson({
        text: input.text ?? null,
        signals: input.signals ?? [],
      }),
    },
  });

  const memories = await listActiveMemories({
    organizationId: input.organizationId,
    leadId: lead.id,
    sessionId: input.sessionId ?? null,
  });
  const memoryInputs = memories.map((memory) => ({
    content:
      memory.content && typeof memory.content === 'object' && !Array.isArray(memory.content)
        ? (memory.content as Record<string, unknown>)
        : {},
  }));

  await prisma.agentRunStep.create({
    data: {
      runId: run.id,
      stepIndex: 0,
      stepType: 'memory',
      status: 'completed',
      input: toInputJson({ leadId: lead.id, sessionId: input.sessionId ?? null }),
      output: toInputJson({
        count: memories.length,
        memoryIds: memories.map((memory) => memory.id),
      }),
      finishedAt: new Date(),
    },
  });

  const knowledge = await retrieveKnowledgeChunks({
    organizationId: input.organizationId,
    query: input.text ?? input.signals?.join(' ') ?? '',
    topK: 5,
  });
  const knowledgeInputs = knowledge.map((chunk) => ({ content: chunk.content }));

  await prisma.agentRunStep.create({
    data: {
      runId: run.id,
      stepIndex: 1,
      stepType: 'retrieval',
      status: 'completed',
      input: toInputJson({ query: input.text ?? input.signals ?? [] }),
      output: toInputJson({
        count: knowledge.length,
        chunkIds: knowledge.map((chunk) => chunk.id),
      }),
      finishedAt: new Date(),
    },
  });

  const decision = computeLeadAgentDecision({
    lead: {
      stage: lead.stage,
      score: lead.score,
      tags: lead.tags,
      source: lead.source,
      metadata:
        lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
          ? (lead.metadata as Record<string, unknown>)
          : null,
    },
    memories: memoryInputs,
    knowledge: knowledgeInputs,
    ...(input.text ? { text: input.text } : {}),
    ...(input.signals && input.signals.length > 0 ? { signals: input.signals } : {}),
  });

  const derivedStage =
    typeof decision.updates.stage === 'string' ? (decision.updates.stage as string) : lead.stage;
  const derivedTags = Array.isArray(decision.updates.tags)
    ? (decision.updates.tags as string[])
    : lead.tags;

  const distributionDecision = selectDistributionTarget({
    distribution: distributionSettings,
    lead: {
      stage: derivedStage,
      tags: derivedTags,
      metadata:
        lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
          ? (lead.metadata as Record<string, unknown>)
          : null,
    },
    suggestedQueue: decision.assignmentQueue,
  });

  if (distributionDecision.nextCursor !== undefined) {
    const agentStrategies =
      settings.agentStrategies && typeof settings.agentStrategies === 'object'
        ? { ...(settings.agentStrategies as Record<string, unknown>) }
        : {};
    const currentDistribution = normalizeDistributionStrategies(agentStrategies.distribution);
    const updatedDistribution = {
      ...currentDistribution,
      state: { cursor: distributionDecision.nextCursor },
    };
    await prisma.organization.update({
      where: { id: input.organizationId },
      data: {
        settings: toInputJson({
          ...settings,
          agentStrategies: {
            ...agentStrategies,
            distribution: updatedDistribution,
          },
        }),
      },
    });
  }

  await prisma.agentRunStep.create({
    data: {
      runId: run.id,
      stepIndex: 2,
      stepType: 'tool',
      status: 'completed',
      input: toInputJson({
        toolId: 'internal.lead_scoring',
        signals: input.signals ?? [],
        text: input.text ?? null,
      }),
      output: toInputJson({
        updates: decision.updates,
        rationale: decision.rationale,
      }),
      finishedAt: new Date(),
    },
  });

  if (distributionDecision.target) {
    await prisma.agentRunStep.create({
      data: {
      runId: run.id,
      stepIndex: 3,
      stepType: 'distribution',
      status: 'completed',
      input: toInputJson({
        assignmentQueue: distributionDecision.target.id,
        strategy: distributionSettings.mode,
        rationale: distributionDecision.rationale,
      }),
      output: toInputJson({
        assigned: true,
      }),
      finishedAt: new Date(),
    },
  });
  }

  let updatedLead = lead;
  const mergedUpdates = { ...decision.updates };
  const baseMetadata =
    lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
      ? { ...(lead.metadata as Record<string, unknown>) }
      : {};
  let nextMetadata = { ...baseMetadata };
  let metadataChanged = false;

  if (distributionDecision.target) {
    nextMetadata.assignmentQueue = distributionDecision.target.id;
    nextMetadata.assignmentStrategy = distributionSettings.mode;
    nextMetadata.assignmentRationale = distributionDecision.rationale;
    metadataChanged = true;
  }

  const nextLeadStage =
    typeof mergedUpdates.stage === 'string' ? mergedUpdates.stage : lead.stage;
  const nextLeadTags = Array.isArray(mergedUpdates.tags) ? mergedUpdates.tags : lead.tags;
  const nextLeadScore =
    typeof mergedUpdates.score === 'number' ? mergedUpdates.score : lead.score ?? null;
  const nextLeadSource =
    typeof mergedUpdates.source === 'string' ? mergedUpdates.source : lead.source ?? null;

  const currentRole =
    typeof baseMetadata.agentRole === 'string'
      ? (baseMetadata.agentRole as string)
      : handoffConfig.stageRoles[lead.stage] ?? null;

  const handoffDecision = evaluateHandoff({
    config: handoffConfig,
    lead: {
      id: lead.id,
      stage: nextLeadStage,
      score: nextLeadScore,
      tags: nextLeadTags,
      source: nextLeadSource,
      metadata: nextMetadata,
    },
    context: {
      matchedRuleIds: input.matchedRuleIds ?? [],
      taskType: input.taskType ?? null,
      confidence: input.confidence ?? null,
    },
  });

  if (handoffDecision.nextRole && handoffDecision.nextRole !== currentRole) {
    nextMetadata.agentRole = handoffDecision.nextRole;
    nextMetadata.agentRoleAt = new Date().toISOString();
    nextMetadata.handoffReason = handoffDecision.trigger;
    metadataChanged = true;
  }

  if (metadataChanged) {
    mergedUpdates.metadata = nextMetadata;
  }

  if (Object.keys(mergedUpdates).length > 0) {
    updatedLead = await applyLeadUpdate(lead, mergedUpdates);
  }

  if (distributionDecision.target) {
    await prisma.leadAssignmentLog.create({
      data: {
        organizationId: input.organizationId,
        leadId: lead.id,
        strategy: distributionSettings.mode,
        targetId: distributionDecision.target.id,
        targetType: 'queue',
        targetName: distributionDecision.target.name ?? null,
        rationale: toNullableJson({ reasons: distributionDecision.rationale }),
        metadata: toNullableJson({
          suggestedQueue: decision.assignmentQueue ?? null,
        }),
      },
    });
  }

  if (handoffDecision.nextRole && handoffDecision.nextRole !== currentRole) {
    const sharedContext = applyContextAllowlist(
      {
        lead: {
          id: lead.id,
          stage: nextLeadStage,
          score: nextLeadScore,
          tags: nextLeadTags,
          source: nextLeadSource,
          metadata: nextMetadata,
        },
        context: {
          matchedRuleIds: input.matchedRuleIds ?? [],
          taskType: input.taskType ?? null,
          confidence: input.confidence ?? null,
        },
      },
      handoffConfig.contextAllowlist
    );

    await prisma.agentHandoffLog.create({
      data: {
        organizationId: input.organizationId,
        leadId: lead.id,
        fromRole: currentRole,
        toRole: handoffDecision.nextRole,
        triggerType: handoffDecision.trigger?.type ?? 'unknown',
        triggerRuleId: handoffDecision.trigger?.ruleId ?? null,
        triggerDetail: toNullableJson(handoffDecision.trigger?.detail ?? null),
        contextShared: toNullableJson(sharedContext),
      },
    });
  }

  if (input.text || (input.signals && input.signals.length > 0)) {
    await createAgentMemory({
      organizationId: input.organizationId,
      scope: 'lead',
      leadId: lead.id,
      sessionId: null,
      key: 'lead_signal',
      content: {
        text: input.text ?? null,
        signals: input.signals ?? [],
      },
      retentionDays: agentSettings.memoryRetentionDays,
    });
  }

  if (input.sessionId && input.text) {
    await createAgentMemory({
      organizationId: input.organizationId,
      scope: 'session',
      leadId: null,
      sessionId: input.sessionId,
      key: 'session_message',
      content: {
        text: input.text,
      },
      retentionDays: agentSettings.memoryRetentionDays,
    });
  }

  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: 'completed',
      output: toInputJson({
        updates: mergedUpdates,
        rationale: decision.rationale,
        assignmentQueue: distributionDecision.target?.id ?? null,
        handoffRole: handoffDecision.nextRole ?? null,
      }),
    },
  });

  return {
    lead: updatedLead,
    updates: mergedUpdates,
    decision: {
      ...decision,
      assignmentQueue: distributionDecision.target?.id ?? null,
      handoffRole: handoffDecision.nextRole ?? null,
    },
    runId: run.id,
  };
};

const normalizeCrmFieldMapping = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const mapping = input as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    const target = value.trim();
    if (!target) continue;
    normalized[key.trim()] = target;
  }
  return normalized;
};

const validateCrmFieldMapping = (mapping: Record<string, string>) => {
  const errors: Array<{ key: string; message: string }> = [];
  const keyPattern = /^[a-zA-Z0-9_.-]+$/;
  const reservedTargets = new Set([
    'id',
    'organizationId',
    'contactId',
    'conversationId',
    'stage',
    'tags',
    'source',
    'score',
    'crmExternalId',
    'createdAt',
    'updatedAt',
  ]);

  for (const [source, target] of Object.entries(mapping)) {
    if (!source || source.length > 120) {
      errors.push({ key: source, message: 'source_key_invalid' });
      continue;
    }
    if (!target || target.length > 120) {
      errors.push({ key: source, message: 'target_key_invalid' });
      continue;
    }
    if (!keyPattern.test(source) || !keyPattern.test(target)) {
      errors.push({ key: source, message: 'invalid_characters' });
      continue;
    }
    if (reservedTargets.has(target) || target.startsWith('lead.')) {
      errors.push({ key: source, message: 'reserved_target' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

const applyCrmMetadataMapping = (
  metadata: Record<string, unknown> | null,
  payload: Record<string, unknown>,
  mapping: Record<string, string>
) => {
  if (!mapping || Object.keys(mapping).length === 0) {
    return metadata;
  }

  const next = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    if (sourceKey in payload) {
      next[targetKey] = payload[sourceKey];
    }
  }
  return next;
};

const normalizeStringList = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const normalizeCampaignSegment = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return {
      stages: [],
      tagsAll: [],
      sources: [],
      lastActiveWithinDays: null,
    };
  }

  const segment = input as Record<string, unknown>;

  const stages = normalizeStringList(segment.stages).filter((stage) => leadStages.has(stage));
  const tagsAll = normalizeStringList(segment.tags);
  const sources = normalizeStringList(segment.sources);
  const lastActiveWithinDays =
    typeof segment.lastActiveWithinDays === 'number' && segment.lastActiveWithinDays > 0
      ? Math.floor(segment.lastActiveWithinDays)
      : null;

  return { stages, tagsAll, sources, lastActiveWithinDays };
};

const buildSegmentWhere = (
  organizationId: string,
  segment: ReturnType<typeof normalizeCampaignSegment>
): Prisma.LeadWhereInput => {
  const where: Prisma.LeadWhereInput = {
    organizationId,
    ...(segment.stages.length > 0
      ? { stage: { in: segment.stages as LeadStage[] } }
      : {}),
    ...(segment.tagsAll.length > 0 ? { tags: { hasEvery: segment.tagsAll } } : {}),
    ...(segment.sources.length > 0 ? { source: { in: segment.sources } } : {}),
  };

  if (segment.lastActiveWithinDays) {
    const cutoff = new Date(Date.now() - segment.lastActiveWithinDays * 24 * 60 * 60 * 1000);
    where.OR = [
      { lastActivityAt: { gte: cutoff } },
      { lastActivityAt: null, createdAt: { gte: cutoff } },
    ];
  }

  return where;
};

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

const WEBHOOK_SIGNATURE_HEADER = 'x-omini-signature';
const WEBHOOK_TIMESTAMP_HEADER = 'x-omini-timestamp';
const DEFAULT_WEBHOOK_TTL_MS = 5 * 60 * 1000;

const isWebhookSignatureRequired = () => {
  const raw = process.env.WEBHOOK_SIGNATURE_REQUIRED;
  return raw === 'true' || raw === '1';
};

const resolveWebhookTtlMs = () => {
  const raw = process.env.WEBHOOK_SIGNATURE_TTL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WEBHOOK_TTL_MS;
  }
  return Math.floor(parsed);
};

const resolveWebhookSecret = (channel: {
  credentials: unknown;
  settings: unknown;
}) => {
  const credentials =
    channel.credentials && typeof channel.credentials === 'object' && !Array.isArray(channel.credentials)
      ? (channel.credentials as Record<string, unknown>)
      : null;
  const settings =
    channel.settings && typeof channel.settings === 'object' && !Array.isArray(channel.settings)
      ? (channel.settings as Record<string, unknown>)
      : null;

  const credentialSecret =
    typeof credentials?.webhookSecret === 'string' ? credentials.webhookSecret.trim() : '';
  if (credentialSecret) return credentialSecret;

  const settingsSecret =
    typeof settings?.webhookSecret === 'string' ? settings.webhookSecret.trim() : '';
  if (settingsSecret) return settingsSecret;

  const envSecret = process.env.WEBHOOK_SIGNING_SECRET;
  return envSecret ? envSecret.trim() : '';
};

const parseWebhookTimestamp = (raw: string) => {
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    return new Date(asNumber);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const buildWebhookSignature = (secret: string, timestamp: string, rawBody: string) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

const verifyWebhookSignature = (input: {
  secret: string;
  signature: string;
  timestamp: string;
  rawBody: string;
}) => {
  if (!input.signature || !input.timestamp) {
    return false;
  }

  const timestamp = parseWebhookTimestamp(input.timestamp);
  if (!timestamp) {
    return false;
  }

  const ttlMs = resolveWebhookTtlMs();
  const ageMs = Math.abs(Date.now() - timestamp.getTime());
  if (ageMs > ttlMs) {
    return false;
  }

  const expected = buildWebhookSignature(input.secret, input.timestamp, input.rawBody);
  if (expected.length !== input.signature.length) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(input.signature);
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};

const shouldSendCrmEvent = (settings: Record<string, unknown>, eventType: string) => {
  const raw = settings.crmWebhook as Record<string, unknown> | undefined;
  if (!raw || typeof raw.url !== 'string') {
    return false;
  }
  if (raw.enabled === false) {
    return false;
  }
  if (Array.isArray(raw.events) && raw.events.length > 0) {
    return raw.events.includes(eventType);
  }
  return true;
};

const enqueueCrmWebhook = async (
  organizationId: string,
  eventType: string,
  payload: Record<string, unknown>,
  settings: Record<string, unknown>
) => {
  if (!shouldSendCrmEvent(settings, eventType)) {
    return;
  }

  await crmQueue.add(
    'crm.webhook',
    {
      organizationId,
      eventType,
      payload,
    },
    defaultJobOptions
  );
};

const findOrCreateContact = async (input: {
  organizationId: string;
  platform: Platform;
  externalId: string;
  name?: string;
}) => {
  const identifier = (await prisma.contactIdentifier.findUnique({
    where: {
      organizationId_platform_externalId: {
        organizationId: input.organizationId,
        platform: input.platform,
        externalId: input.externalId,
      },
    },
    include: { contact: true },
  })) as Prisma.ContactIdentifierGetPayload<{
    include: { contact: true };
  }> | null;

  if (identifier?.contact) {
    if (input.name && !identifier.contact.name) {
      await prisma.contact.update({
        where: { id: identifier.contact.id },
        data: { name: input.name },
      });
    }

    return identifier.contact;
  }

  return prisma.contact.create({
    data: {
      organizationId: input.organizationId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.platform === 'whatsapp' ? { phone: input.externalId } : {}),
      identifiers: {
        create: {
          organization: { connect: { id: input.organizationId } },
          platform: input.platform,
          externalId: input.externalId,
          handle: input.externalId,
        },
      },
    },
  });
};

const upsertConversation = async (input: {
  organizationId: string;
  channelId: string;
  contactId: string;
  platform: Platform;
  externalId: string;
}) => {
  return prisma.conversation.upsert({
    where: {
      channelId_externalId: {
        channelId: input.channelId,
        externalId: input.externalId,
      },
    },
    create: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      contactId: input.contactId,
      platform: input.platform,
      externalId: input.externalId,
      status: 'open',
      lastMessageAt: new Date(),
    },
    update: {
      lastMessageAt: new Date(),
      status: 'open',
    },
  });
};

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/v1/webhooks/whatsapp/:provider/:channelId', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  const channelId = c.req.param('channelId');

  const rawBody = await c.req.text();

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const channelProvider = channel.provider.toLowerCase();
  if (channelProvider !== provider) {
    return c.json({ error: 'provider_mismatch' }, 400);
  }

  const adapter = getWhatsAppAdapter(provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  const signatureRequired = isWebhookSignatureRequired();
  const secret = resolveWebhookSecret(channel);
  if (signatureRequired && !secret) {
    console.warn('Webhook signature required but secret missing', {
      channelId,
      provider,
      path: c.req.path,
    });
    return c.json({ error: 'webhook_signature_required' }, 401);
  }
  if (secret) {
    const signature = c.req.header(WEBHOOK_SIGNATURE_HEADER) ?? '';
    const timestamp = c.req.header(WEBHOOK_TIMESTAMP_HEADER) ?? '';
    const valid = verifyWebhookSignature({
      secret,
      signature,
      timestamp,
      rawBody,
    });
    if (!valid) {
      console.warn('Webhook signature invalid', {
        channelId,
        provider,
        path: c.req.path,
      });
      return c.json({ error: 'unauthorized' }, 401);
    }
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const headers = Object.fromEntries(c.req.raw.headers.entries());

  await inboundQueue.add(
    'wa.webhook.live',
    {
      channelId,
      payload,
      rawBody,
      headers,
    },
    defaultJobOptions
  );

  return c.json({ queued: true });
});

app.post('/v1/webhooks/whatsapp/:provider/:channelId/status', async (c) => {
  const provider = c.req.param('provider').toLowerCase();
  const channelId = c.req.param('channelId');

  const rawBody = await c.req.text();

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const channelProvider = channel.provider.toLowerCase();
  if (channelProvider !== provider) {
    return c.json({ error: 'provider_mismatch' }, 400);
  }

  const adapter = getWhatsAppAdapter(provider);
  if (!adapter?.parseStatus) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  const signatureRequired = isWebhookSignatureRequired();
  const secret = resolveWebhookSecret(channel);
  if (signatureRequired && !secret) {
    console.warn('Webhook signature required but secret missing', {
      channelId,
      provider,
      path: c.req.path,
    });
    return c.json({ error: 'webhook_signature_required' }, 401);
  }
  if (secret) {
    const signature = c.req.header(WEBHOOK_SIGNATURE_HEADER) ?? '';
    const timestamp = c.req.header(WEBHOOK_TIMESTAMP_HEADER) ?? '';
    const valid = verifyWebhookSignature({
      secret,
      signature,
      timestamp,
      rawBody,
    });
    if (!valid) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const headers = Object.fromEntries(c.req.raw.headers.entries());

  await statusQueue.add(
    'wa.status',
    {
      channelId,
      payload,
      rawBody,
      headers,
    },
    defaultJobOptions
  );

  return c.json({ queued: true });
});

api.use('*', tenantAuth);

api.get('/v1/lead-rules', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const leadRules = getLeadRulesFromSettings(settings);

  return c.json({ leadRules });
});

api.put('/v1/lead-rules', async (c) => {
  const body = await c.req.json<unknown>().catch(() => ({}));
  const input = Array.isArray(body)
    ? body
    : (body as Record<string, unknown>)?.leadRules;

  if (!Array.isArray(input)) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const leadRules = normalizeLeadRules(input);
  const settings = await loadOrganizationSettings(c.get('tenantId'));

  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        leadRules,
      }),
    },
  });

  return c.json({ leadRules });
});

api.get('/v1/agent-routing', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const config = getAgentRoutingConfig(settings);

  return c.json({ config, adapters: listAgentAdapters() });
});

api.put('/v1/agent-routing', async (c) => {
  const body = await readJsonBody(c);
  const config = normalizeAgentRoutingConfig(body);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        agentRouting: config,
      }),
    },
  });

  return c.json({ config });
});

api.post('/v1/agent-routing/test', async (c) => {
  const body = await readJsonBody(c);
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const config = getAgentRoutingConfig(settings);

  const input: {
    platform?: string;
    provider?: string;
    stage?: string;
    source?: string | null;
    tags?: string[];
    text?: string;
  } = {};
  if (typeof body.platform === 'string') input.platform = body.platform;
  if (typeof body.provider === 'string') input.provider = body.provider;
  if (typeof body.stage === 'string') input.stage = body.stage;
  if (typeof body.source === 'string') input.source = body.source;
  if (Array.isArray(body.tags)) input.tags = body.tags as string[];
  if (typeof body.text === 'string') input.text = body.text;

  const decision = selectAgent(config, input);

  return c.json({ decision });
});

api.get('/v1/agent/settings', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const agentSettings = normalizeAgentIntelligenceSettings(settings.agentIntelligence);

  return c.json({ settings: agentSettings });
});

api.put('/v1/agent/settings', async (c) => {
  const body = await readJsonBody(c);
  const agentSettings = normalizeAgentIntelligenceSettings(
    (body.agentIntelligence as Record<string, unknown>) ?? body
  );

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        agentIntelligence: agentSettings,
      }),
    },
  });

  return c.json({ settings: agentSettings });
});

api.get('/v1/agent/strategies', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const optimization = normalizeOptimizationStrategies(
    (settings.agentStrategies as Record<string, unknown> | undefined)?.optimization
  );
  const distribution = normalizeDistributionStrategies(
    (settings.agentStrategies as Record<string, unknown> | undefined)?.distribution
  );

  return c.json({ strategies: { optimization, distribution } });
});

api.put('/v1/agent/strategies', async (c) => {
  const body = await readJsonBody(c);
  const payload = (body.strategies as Record<string, unknown>) ?? body;

  const optimization = normalizeOptimizationStrategies(payload.optimization);
  const distribution = normalizeDistributionStrategies(payload.distribution);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        agentStrategies: {
          optimization,
          distribution,
        },
      }),
    },
  });

  return c.json({ strategies: { optimization, distribution } });
});

api.get('/v1/agent/handoffs', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const config = normalizeAgentHandoffConfig(settings.agentHandoffs);

  return c.json({ config });
});

api.put('/v1/agent/handoffs', async (c) => {
  const body = await readJsonBody(c);
  const config = normalizeAgentHandoffConfig(body.config ?? body);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        agentHandoffs: config,
      }),
    },
  });

  return c.json({ config });
});

api.post('/v1/agent/handoffs/preview', async (c) => {
  const body = await readJsonBody(c);
  const leadId = typeof body.leadId === 'string' ? body.leadId : null;
  const stage = typeof body.stage === 'string' ? body.stage : 'new';
  const score = typeof body.score === 'number' ? body.score : null;
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag) => typeof tag === 'string')
    : [];
  const taskType = typeof body.taskType === 'string' ? body.taskType : null;
  const confidence =
    typeof body.confidence === 'number' && body.confidence >= 0 ? body.confidence : null;

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const config = normalizeAgentHandoffConfig(settings.agentHandoffs);

  let leadStage = stage;
  let leadTags = tags;
  let leadScore = score;
  let leadMetadata: Record<string, unknown> | null = null;

  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: c.get('tenantId') },
    });
    if (lead) {
      leadStage = lead.stage;
      leadTags = lead.tags;
      leadScore = lead.score ?? null;
      leadMetadata =
        lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
          ? (lead.metadata as Record<string, unknown>)
          : null;
    }
  }

  const decision = evaluateHandoff({
    config,
    lead: {
      id: leadId ?? 'preview',
      stage: leadStage,
      score: leadScore,
      tags: leadTags,
      source: null,
      metadata: leadMetadata,
    },
    context: {
      matchedRuleIds: Array.isArray(body.matchedRuleIds)
        ? body.matchedRuleIds.filter((value) => typeof value === 'string')
        : [],
      taskType,
      confidence,
    },
  });

  const sharedContext = applyContextAllowlist(
    {
      lead: {
        id: leadId ?? 'preview',
        stage: leadStage,
        score: leadScore,
        tags: leadTags,
        source: null,
        metadata: leadMetadata ?? {},
      },
      context: {
        matchedRuleIds: Array.isArray(body.matchedRuleIds)
          ? body.matchedRuleIds.filter((value) => typeof value === 'string')
          : [],
        taskType,
        confidence,
      },
    },
    config.contextAllowlist
  );

  return c.json({
    decision: {
      nextRole: decision.nextRole,
      trigger: decision.trigger,
      sharedContext,
    },
  });
});

api.get('/v1/agent/handoffs/logs', async (c) => {
  const leadId = c.req.query('leadId');
  const limitRaw = c.req.query('limit');
  const limit = Math.min(200, Math.max(1, Number(limitRaw ?? 50)));

  const logs = await prisma.agentHandoffLog.findMany({
    where: {
      organizationId: c.get('tenantId'),
      ...(leadId ? { leadId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      lead: { select: { id: true, stage: true } },
    },
  });

  return c.json({ logs });
});

api.post('/v1/agent/distribution/preview', async (c) => {
  const body = await readJsonBody(c);
  const leadId = typeof body.leadId === 'string' ? body.leadId : null;
  const stage = typeof body.stage === 'string' ? body.stage : 'new';
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag) => typeof tag === 'string')
    : [];
  const suggestedQueue = typeof body.suggestedQueue === 'string' ? body.suggestedQueue : null;

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const distribution = normalizeDistributionStrategies(
    (settings.agentStrategies as Record<string, unknown> | undefined)?.distribution
  );

  let leadStage = stage;
  let leadTags = tags;

  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: c.get('tenantId') },
      select: { stage: true, tags: true },
    });
    if (lead) {
      leadStage = lead.stage;
      leadTags = lead.tags;
    }
  }

  const decision = selectDistributionTarget({
    distribution,
    lead: { stage: leadStage, tags: leadTags },
    suggestedQueue,
  });

  return c.json({
    decision: {
      target: decision.target,
      rationale: decision.rationale,
    },
  });
});

api.get('/v1/agent/assignments', async (c) => {
  const leadId = c.req.query('leadId');
  const limitRaw = c.req.query('limit');
  const limit = Math.min(200, Math.max(1, Number(limitRaw ?? 50)));

  const logs = await prisma.leadAssignmentLog.findMany({
    where: {
      organizationId: c.get('tenantId'),
      ...(leadId ? { leadId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      lead: { select: { id: true, stage: true } },
    },
  });

  return c.json({ assignments: logs });
});

api.get('/v1/agent/optimizations/preview', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const strategies = normalizeOptimizationStrategies(
    (settings.agentStrategies as Record<string, unknown> | undefined)?.optimization
  );

  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));
  const rows = await prisma.analyticsDaily.findMany({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      campaignId: { not: null },
    },
  });

  const campaignIds = Array.from(
    new Set(rows.map((row) => row.campaignId).filter((value): value is string => !!value))
  );
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds }, organizationId: c.get('tenantId') },
        select: { id: true, cost: true, revenue: true },
      })
    : [];

  const recommendations = evaluateOptimizationStrategies({
    strategies,
    analytics: rows,
    campaigns,
  });

  return c.json({ range: { start: start.toISOString(), end: end.toISOString() }, recommendations });
});

api.get('/v1/knowledge-sources', async (c) => {
  const sources = await prisma.knowledgeSource.findMany({
    where: { organizationId: c.get('tenantId') },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { chunks: true } },
      syncs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  return c.json({ sources });
});

api.post('/v1/knowledge-sources', async (c) => {
  const body = await readJsonBody(c);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const kindRaw = typeof body.kind === 'string' ? body.kind.trim() : '';
  const normalizedKind = kindRaw === 'text' ? 'manual' : kindRaw;
  const kindValue = ['manual', 'web', 'notion', 'google_docs'].includes(normalizedKind)
    ? normalizedKind
    : 'manual';
  const kind = kindValue as KnowledgeSourceType;
  const config =
    body.config && typeof body.config === 'object' && !Array.isArray(body.config)
      ? (body.config as Record<string, unknown>)
      : null;

  if (!name) {
    return c.json({ error: 'name_required' }, 400);
  }

  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: c.get('tenantId'),
      name,
      description,
      kind,
      ...(config ? { config: toInputJson(config) } : {}),
    },
  });

  return c.json({ source });
});

api.put('/v1/knowledge-sources/:id', async (c) => {
  const body = await readJsonBody(c);
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!source) {
    return c.json({ error: 'source_not_found' }, 404);
  }

  const updates: Prisma.KnowledgeSourceUpdateInput = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) {
      return c.json({ error: 'name_required' }, 400);
    }
    updates.name = name;
  }
  if (typeof body.description === 'string') {
    updates.description = body.description.trim() || null;
  } else if (body.description === null) {
    updates.description = null;
  }
  if (typeof body.kind === 'string') {
    const normalizedKind = body.kind.trim() === 'text' ? 'manual' : body.kind.trim();
    if (!['manual', 'web', 'notion', 'google_docs'].includes(normalizedKind)) {
      return c.json({ error: 'invalid_kind' }, 400);
    }
    updates.kind = normalizedKind as KnowledgeSourceType;
  }
  if (typeof body.enabled === 'boolean') {
    updates.enabled = body.enabled;
  }
  if (body.config === null) {
    updates.config = Prisma.DbNull;
  } else if (body.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
    updates.config = toInputJson(body.config);
  }

  const updated = await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: updates,
  });

  return c.json({ source: updated });
});

api.post('/v1/knowledge-sources/:id/chunks', async (c) => {
  const body = await readJsonBody(c);
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const chunkSize =
    typeof body.chunkSize === 'number' && body.chunkSize > 0 ? Math.floor(body.chunkSize) : 600;
  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : null;

  if (!content) {
    return c.json({ error: 'content_required' }, 400);
  }

  const source = await prisma.knowledgeSource.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!source) {
    return c.json({ error: 'source_not_found' }, 404);
  }

  const chunks = splitContentIntoChunks(content, chunkSize);
  if (chunks.length === 0) {
    return c.json({ error: 'no_chunks' }, 400);
  }

  const chunkRows = chunks.map((chunk, index) => ({
    id: crypto.randomUUID(),
    organizationId: c.get('tenantId'),
    sourceId: source.id,
    content: chunk,
    metadata: metadata ? { ...metadata, chunkIndex: index } : { chunkIndex: index },
  }));

  await prisma.knowledgeChunk.createMany({ data: chunkRows });
  await Promise.all(
    chunkRows.map((row) =>
      knowledgeQueue.add(
        'embed-chunk',
        { type: 'embed-chunk', chunkId: row.id },
        defaultJobOptions
      )
    )
  );

  return c.json({ created: chunks.length });
});

api.post('/v1/knowledge-sources/:id/sync', async (c) => {
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!source) {
    return c.json({ error: 'source_not_found' }, 404);
  }

  if (!['web', 'notion', 'google_docs'].includes(source.kind)) {
    return c.json({ error: 'source_not_syncable' }, 400);
  }

  const sync = await prisma.knowledgeSync.create({
    data: {
      organizationId: c.get('tenantId'),
      sourceId: source.id,
      status: 'pending',
      metadata: toInputJson({ trigger: 'manual' }),
    },
  });

  await knowledgeQueue.add(
    'sync-source',
    { type: 'sync-source', syncId: sync.id },
    defaultJobOptions
  );

  return c.json({ sync });
});

api.get('/v1/knowledge-sources/:id/syncs', async (c) => {
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!source) {
    return c.json({ error: 'source_not_found' }, 404);
  }

  const limit =
    typeof c.req.query('limit') === 'string' ? Number(c.req.query('limit')) : 20;
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
  const syncs = await prisma.knowledgeSync.findMany({
    where: { sourceId: source.id },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return c.json({ syncs });
});

api.post('/v1/knowledge/retrieve', async (c) => {
  const body = await readJsonBody(c);
  const query = typeof body.query === 'string' ? body.query : '';
  const topK = typeof body.topK === 'number' && body.topK > 0 ? Math.floor(body.topK) : 5;
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.filter((id) => typeof id === 'string')
    : undefined;
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
    : undefined;
  const recentDays =
    typeof body.recentDays === 'number' && body.recentDays > 0 ? body.recentDays : null;
  const since =
    typeof body.since === 'string' && body.since.trim().length > 0
      ? new Date(body.since)
      : null;
  const minCreatedAt =
    since && !Number.isNaN(since.getTime())
      ? since
      : recentDays
        ? new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000)
        : null;

  if (!query.trim()) {
    return c.json({ error: 'query_required' }, 400);
  }

  const results = await retrieveKnowledgeChunks({
    organizationId: c.get('tenantId'),
    query,
    topK,
    ...(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(minCreatedAt ? { minCreatedAt } : {}),
  });

  return c.json({ results });
});

api.get('/v1/analytics/summary', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const aggregate = await prisma.analyticsDaily.aggregate({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      channelId: null,
      campaignId: null,
    },
    _sum: {
      outboundSent: true,
      outboundDelivered: true,
      outboundFailed: true,
      inboundCount: true,
      responseCount: true,
      leadCreated: true,
      leadConverted: true,
      attributedConversions: true,
    },
  });

  const totals = aggregate._sum;
  const outboundSent = totals.outboundSent ?? 0;
  const outboundDelivered = totals.outboundDelivered ?? 0;
  const outboundFailed = totals.outboundFailed ?? 0;
  const inboundCount = totals.inboundCount ?? 0;
  const responseCount = totals.responseCount ?? 0;
  const leadCreated = totals.leadCreated ?? 0;
  const leadConverted = totals.leadConverted ?? 0;
  const attributedConversions = totals.attributedConversions ?? 0;

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    totals: {
      outboundSent,
      outboundDelivered,
      outboundFailed,
      inboundCount,
      responseCount,
      leadCreated,
      leadConverted,
      attributedConversions,
    },
    rates: {
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      responseRate: safeRate(responseCount, outboundSent),
      conversionRate: safeRate(leadConverted, leadCreated),
    },
  });
});

api.get('/v1/analytics/channels', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.groupBy({
    by: ['channelId'],
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      channelId: { not: null },
      campaignId: null,
    },
    _sum: {
      outboundSent: true,
      outboundDelivered: true,
      outboundFailed: true,
      inboundCount: true,
      responseCount: true,
      attributedConversions: true,
    },
  });

  const channelIds = rows
    .map((row) => row.channelId)
    .filter((value): value is string => !!value);

  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, platform: true, provider: true },
      })
    : [];

  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  const metrics = rows.map((row) => {
    const outboundSent = row._sum.outboundSent ?? 0;
    const outboundDelivered = row._sum.outboundDelivered ?? 0;
    const responseCount = row._sum.responseCount ?? 0;

    return {
      channel: channelMap.get(row.channelId ?? '') ?? null,
      outboundSent,
      outboundDelivered,
      outboundFailed: row._sum.outboundFailed ?? 0,
      inboundCount: row._sum.inboundCount ?? 0,
      responseCount,
      attributedConversions: row._sum.attributedConversions ?? 0,
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      responseRate: safeRate(responseCount, outboundSent),
    };
  });

  return c.json({ range: { start: start.toISOString(), end: end.toISOString() }, channels: metrics });
});

api.get('/v1/analytics/campaigns', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.groupBy({
    by: ['campaignId'],
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      campaignId: { not: null },
    },
    _sum: {
      outboundSent: true,
      outboundDelivered: true,
      outboundFailed: true,
      attributedConversions: true,
    },
  });

  const campaignIds = rows
    .map((row) => row.campaignId)
    .filter((value): value is string => !!value);

  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, cost: true, revenue: true, status: true },
      })
    : [];

  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const metrics = rows.map((row) => {
    const outboundSent = row._sum.outboundSent ?? 0;
    const outboundDelivered = row._sum.outboundDelivered ?? 0;
    const campaign = campaignMap.get(row.campaignId ?? '') ?? null;
    const cost = campaign?.cost ?? null;
    const revenue = campaign?.revenue ?? null;
    const roi =
      typeof cost === 'number' && cost > 0 && typeof revenue === 'number'
        ? Number(((revenue - cost) / cost).toFixed(4))
        : null;

    return {
      campaign,
      outboundSent,
      outboundDelivered,
      outboundFailed: row._sum.outboundFailed ?? 0,
      attributedConversions: row._sum.attributedConversions ?? 0,
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      roi,
    };
  });

  return c.json({ range: { start: start.toISOString(), end: end.toISOString() }, campaigns: metrics });
});

api.get('/v1/analytics/attribution', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const campaignRows = await prisma.leadAttribution.groupBy({
    by: ['campaignId'],
    where: {
      organizationId: c.get('tenantId'),
      campaignId: { not: null },
      attributedAt: { gte: start, lt: end },
    },
    _count: { _all: true },
  });

  const channelRows = await prisma.leadAttribution.groupBy({
    by: ['channelId'],
    where: {
      organizationId: c.get('tenantId'),
      channelId: { not: null },
      attributedAt: { gte: start, lt: end },
    },
    _count: { _all: true },
  });

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    campaigns: campaignRows.map((row) => ({
      campaignId: row.campaignId,
      conversions: row._count._all,
    })),
    channels: channelRows.map((row) => ({
      channelId: row.channelId,
      conversions: row._count._all,
    })),
  });
});

api.get('/v1/analytics/settings', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const analytics = normalizeAnalyticsSettings(settings.analytics);

  return c.json({ analytics });
});

api.put('/v1/analytics/settings', async (c) => {
  const body = await readJsonBody(c);
  const analytics = normalizeAnalyticsSettings(body.analytics ?? body);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        analytics,
      }),
    },
  });

  return c.json({ analytics });
});

api.get('/v1/analytics/realtime', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const analyticsSettings = normalizeAnalyticsSettings(settings.analytics);
  const windowMinutesRaw = c.req.query('windowMinutes');
  const windowMinutes = windowMinutesRaw
    ? clampNumber(Number(windowMinutesRaw), 5, 1440)
    : analyticsSettings.realtimeWindowMinutes;

  const end = new Date();
  const start = new Date(end.getTime() - windowMinutes * 60 * 1000);

  const [outboundSent, outboundDelivered, outboundFailed, inboundCount] = await Promise.all([
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'outbound',
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'outbound',
        status: { in: ['delivered', 'read'] },
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'outbound',
        status: 'failed',
        createdAt: { gte: start, lt: end },
      },
    }),
    prisma.message.count({
      where: {
        organizationId: c.get('tenantId'),
        direction: 'inbound',
        createdAt: { gte: start, lt: end },
      },
    }),
  ]);

  const [leadCreated, leadConverted] = await Promise.all([
    prisma.lead.count({
      where: { organizationId: c.get('tenantId'), createdAt: { gte: start, lt: end } },
    }),
    prisma.lead.count({
      where: { organizationId: c.get('tenantId'), convertedAt: { gte: start, lt: end } },
    }),
  ]);

  const responseCount = inboundCount;

  return c.json({
    windowMinutes,
    range: { start: start.toISOString(), end: end.toISOString() },
    totals: {
      outboundSent,
      outboundDelivered,
      outboundFailed,
      inboundCount,
      responseCount,
      leadCreated,
      leadConverted,
    },
    rates: {
      deliveryRate: safeRate(outboundDelivered, outboundSent),
      responseRate: safeRate(responseCount, outboundSent),
      conversionRate: safeRate(leadConverted, leadCreated),
    },
  });
});

api.get('/v1/analytics/trends/channels', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.findMany({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      channelId: { not: null },
      campaignId: null,
    },
    orderBy: { date: 'asc' },
  });

  const channelIds = Array.from(
    new Set(rows.map((row) => row.channelId).filter((value): value is string => !!value))
  );
  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, platform: true, provider: true },
      })
    : [];
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  const series = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.channelId) continue;
    const bucket = series.get(row.channelId) ?? [];
    bucket.push(row);
    series.set(row.channelId, bucket);
  }

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    channels: Array.from(series.entries()).map(([channelId, entries]) => ({
      channel: channelMap.get(channelId) ?? null,
      points: entries.map((entry) => ({
        date: entry.date.toISOString(),
        outboundSent: entry.outboundSent,
        outboundDelivered: entry.outboundDelivered,
        outboundFailed: entry.outboundFailed,
        inboundCount: entry.inboundCount,
        responseCount: entry.responseCount,
        attributedConversions: entry.attributedConversions,
        deliveryRate: safeRate(entry.outboundDelivered, entry.outboundSent),
        responseRate: safeRate(entry.responseCount, entry.outboundSent),
      })),
    })),
  });
});

api.get('/v1/analytics/trends/campaigns', async (c) => {
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const rows = await prisma.analyticsDaily.findMany({
    where: {
      organizationId: c.get('tenantId'),
      date: { gte: start, lt: end },
      campaignId: { not: null },
    },
    orderBy: { date: 'asc' },
  });

  const campaignIds = Array.from(
    new Set(rows.map((row) => row.campaignId).filter((value): value is string => !!value))
  );
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds }, organizationId: c.get('tenantId') },
        select: { id: true, name: true, cost: true, revenue: true, status: true },
      })
    : [];
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

  const series = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const bucket = series.get(row.campaignId) ?? [];
    bucket.push(row);
    series.set(row.campaignId, bucket);
  }

  return c.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    campaigns: Array.from(series.entries()).map(([campaignId, entries]) => {
      const campaign = campaignMap.get(campaignId) ?? null;
      const cost = campaign?.cost ?? null;
      const revenue = campaign?.revenue ?? null;
      const roi =
        typeof cost === 'number' && cost > 0 && typeof revenue === 'number'
          ? Number(((revenue - cost) / cost).toFixed(4))
          : null;

      return {
        campaign,
        roi,
        points: entries.map((entry) => ({
          date: entry.date.toISOString(),
          outboundSent: entry.outboundSent,
          outboundDelivered: entry.outboundDelivered,
          outboundFailed: entry.outboundFailed,
          attributedConversions: entry.attributedConversions,
          deliveryRate: safeRate(entry.outboundDelivered, entry.outboundSent),
        })),
      };
    }),
  });
});

const resolveInsightWindow = async (
  organizationId: string,
  windowRaw: string | null | undefined,
  model: 'intent' | 'cluster' | 'suggestion'
) => {
  const parsed = parseDate(windowRaw ?? null);
  if (parsed) {
    return parsed;
  }

  if (model === 'intent') {
    const latest = await prisma.aiIntentWindow.findFirst({
      where: { organizationId },
      orderBy: { windowStart: 'desc' },
      select: { windowStart: true },
    });
    return latest?.windowStart ?? null;
  }

  if (model === 'cluster') {
    const latest = await prisma.aiTopicCluster.findFirst({
      where: { organizationId },
      orderBy: { windowStart: 'desc' },
      select: { windowStart: true },
    });
    return latest?.windowStart ?? null;
  }

  const latest = await prisma.aiReplySuggestion.findFirst({
    where: { organizationId },
    orderBy: { windowStart: 'desc' },
    select: { windowStart: true },
  });
  return latest?.windowStart ?? null;
};

api.get('/v1/insights/intents/taxonomy', async (c) => {
  return c.json({ intents: defaultIntentTaxonomy });
});

api.get('/v1/insights/intents', async (c) => {
  const windowStart = await resolveInsightWindow(
    c.get('tenantId'),
    c.req.query('windowStart'),
    'intent'
  );

  if (!windowStart) {
    return c.json({ windowStart: null, intents: [] });
  }

  const intents = await prisma.aiIntentWindow.findMany({
    where: { organizationId: c.get('tenantId'), windowStart },
    orderBy: { count: 'desc' },
  });

  return c.json({ windowStart: windowStart.toISOString(), intents });
});

api.get('/v1/insights/clusters', async (c) => {
  const windowStart = await resolveInsightWindow(
    c.get('tenantId'),
    c.req.query('windowStart'),
    'cluster'
  );

  if (!windowStart) {
    return c.json({ windowStart: null, clusters: [] });
  }

  const clusters = await prisma.aiTopicCluster.findMany({
    where: { organizationId: c.get('tenantId'), windowStart },
    orderBy: { count: 'desc' },
  });

  return c.json({ windowStart: windowStart.toISOString(), clusters });
});

api.get('/v1/insights/suggestions', async (c) => {
  const windowStart = await resolveInsightWindow(
    c.get('tenantId'),
    c.req.query('windowStart'),
    'suggestion'
  );

  if (!windowStart) {
    return c.json({ windowStart: null, suggestions: [] });
  }

  const suggestions = await prisma.aiReplySuggestion.findMany({
    where: { organizationId: c.get('tenantId'), windowStart },
    orderBy: { intent: 'asc' },
  });

  return c.json({ windowStart: windowStart.toISOString(), suggestions });
});

api.get('/v1/attribution/report', async (c) => {
  const modelRaw = c.req.query('model');
  const model =
    typeof modelRaw === 'string' && attributionModels.has(modelRaw)
      ? modelRaw
      : 'last_touch';
  const { start, end } = resolveDateRange(c.req.query('start'), c.req.query('end'));

  const touchpoints = await prisma.attributionTouchpoint.findMany({
    where: {
      organizationId: c.get('tenantId'),
      model: model as AttributionModel,
      touchedAt: { gte: start, lt: end },
    },
  });

  const sumBy = <T extends { weight: number }>(items: T[]) =>
    items.reduce((total, item) => total + item.weight, 0);

  const groupBy = <T extends { key: string | null; weight: number }>(items: T[]) => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (!item.key) continue;
      map.set(item.key, (map.get(item.key) ?? 0) + item.weight);
    }
    return map;
  };

  const channelMap = groupBy(
    touchpoints.map((item) => ({ key: item.channelId, weight: item.weight }))
  );
  const campaignMap = groupBy(
    touchpoints.map((item) => ({ key: item.campaignId, weight: item.weight }))
  );
  const journeyMap = groupBy(
    touchpoints.map((item) => ({ key: item.journeyId, weight: item.weight }))
  );

  const channelIds = Array.from(channelMap.keys());
  const campaignIds = Array.from(campaignMap.keys());
  const journeyIds = Array.from(journeyMap.keys());

  const [channels, campaigns, journeys] = await Promise.all([
    channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: channelIds }, organizationId: c.get('tenantId') },
          select: { id: true, name: true, platform: true, provider: true },
        })
      : [],
    campaignIds.length
      ? prisma.campaign.findMany({
          where: { id: { in: campaignIds }, organizationId: c.get('tenantId') },
          select: { id: true, name: true, status: true, cost: true, revenue: true },
        })
      : [],
    journeyIds.length
      ? prisma.journey.findMany({
          where: { id: { in: journeyIds }, organizationId: c.get('tenantId') },
          select: { id: true, name: true, status: true },
        })
      : [],
  ]);

  const channelLookup = new Map(channels.map((item) => [item.id, item]));
  const campaignLookup = new Map(campaigns.map((item) => [item.id, item]));
  const journeyLookup = new Map(journeys.map((item) => [item.id, item]));

  return c.json({
    model,
    range: { start: start.toISOString(), end: end.toISOString() },
    totalWeight: sumBy(touchpoints),
    channels: Array.from(channelMap.entries()).map(([id, weight]) => ({
      channel: channelLookup.get(id) ?? null,
      weight,
    })),
    campaigns: Array.from(campaignMap.entries()).map(([id, weight]) => ({
      campaign: campaignLookup.get(id) ?? null,
      weight,
    })),
    journeys: Array.from(journeyMap.entries()).map(([id, weight]) => ({
      journey: journeyLookup.get(id) ?? null,
      weight,
    })),
  });
});

api.get('/v1/agent/optimizations', async (c) => {
  const statusRaw = c.req.query('status');
  const campaignId = c.req.query('campaignId');
  const status =
    typeof statusRaw === 'string' && campaignOptimizationStatuses.has(statusRaw)
      ? (statusRaw as CampaignOptimizationStatus)
      : undefined;

  const where: Prisma.CampaignOptimizationWhereInput = {
    organizationId: c.get('tenantId'),
    ...(status ? { status } : {}),
    ...(campaignId ? { campaignId } : {}),
  };

  const optimizations = await prisma.campaignOptimization.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      campaign: { select: { id: true, name: true, status: true, cost: true, revenue: true } },
    },
  });

  return c.json({ optimizations });
});

api.post('/v1/agent/optimizations/:id/apply', async (c) => {
  const optimization = await prisma.campaignOptimization.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
    include: { campaign: true },
  });

  if (!optimization) {
    return c.json({ error: 'optimization_not_found' }, 404);
  }

  if (optimization.status !== 'pending') {
    return c.json({ optimization });
  }

  const campaignMetadata =
    optimization.campaign.metadata && typeof optimization.campaign.metadata === 'object' && !Array.isArray(optimization.campaign.metadata)
      ? { ...(optimization.campaign.metadata as Record<string, unknown>) }
      : {};

  const appliedList = Array.isArray(campaignMetadata.optimizationsApplied)
    ? [...campaignMetadata.optimizationsApplied]
    : [];

  appliedList.push({
    id: optimization.id,
    type: optimization.type,
    appliedAt: new Date().toISOString(),
  });

  campaignMetadata.optimizationsApplied = appliedList;

  await prisma.campaign.update({
    where: { id: optimization.campaignId },
    data: {
      metadata: toInputJson(campaignMetadata),
    },
  });

  const updated = await prisma.campaignOptimization.update({
    where: { id: optimization.id },
    data: {
      status: 'applied',
      appliedAt: new Date(),
    },
  });

  return c.json({ optimization: updated });
});

api.post('/v1/agent/optimizations/:id/dismiss', async (c) => {
  const optimization = await prisma.campaignOptimization.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!optimization) {
    return c.json({ error: 'optimization_not_found' }, 404);
  }

  if (optimization.status !== 'pending') {
    return c.json({ optimization });
  }

  const updated = await prisma.campaignOptimization.update({
    where: { id: optimization.id },
    data: {
      status: 'dismissed',
    },
  });

  return c.json({ optimization: updated });
});

api.get('/v1/agent/runs', async (c) => {
  const typeRaw = c.req.query('type');
  const leadId = c.req.query('leadId');
  const campaignId = c.req.query('campaignId');
  const type =
    typeof typeRaw === 'string' && agentRunTypes.has(typeRaw)
      ? (typeRaw as AgentRunType)
      : undefined;

  const where: Prisma.AgentRunWhereInput = {
    organizationId: c.get('tenantId'),
    ...(type ? { type } : {}),
    ...(leadId ? { leadId } : {}),
    ...(campaignId ? { campaignId } : {}),
  };

  const runs = await prisma.agentRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return c.json({ runs });
});

api.get('/v1/agent/runs/:id/steps', async (c) => {
  const run = await prisma.agentRun.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!run) {
    return c.json({ error: 'run_not_found' }, 404);
  }

  const steps = await prisma.agentRunStep.findMany({
    where: { runId: run.id },
    orderBy: { stepIndex: 'asc' },
  });

  return c.json({ run, steps });
});

api.get('/v1/agent-tools', async (c) => {
  const tools = await prisma.toolDefinition.findMany({
    where: { organizationId: c.get('tenantId') },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({ tools });
});

api.post('/v1/agent-tools', async (c) => {
  const body = await readJsonBody(c);
  const normalized = normalizeToolDefinitionInput(body);

  if (!normalized.name || !normalized.version) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const tool = await prisma.toolDefinition.create({
    data: {
      organizationId: c.get('tenantId'),
      name: normalized.name,
      version: normalized.version,
      kind: normalized.kind === 'external' ? 'external' : 'internal',
      provider: normalized.provider,
      description: normalized.description,
      protocol: normalized.protocol,
      schema: toInputJson(normalized.schema),
      ...(normalized.config ? { config: toInputJson(normalized.config) } : {}),
      ...(normalized.auth ? { auth: toInputJson(normalized.auth) } : {}),
      enabled: normalized.enabled,
    },
  });

  return c.json({ tool }, 201);
});

api.put('/v1/agent-tools/:id', async (c) => {
  const body = await readJsonBody(c);
  const normalized = normalizeToolDefinitionInput(body);

  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const updated = await prisma.toolDefinition.update({
    where: { id: tool.id },
    data: {
      name: normalized.name || tool.name,
      version: normalized.version || tool.version,
      kind: normalized.kind === 'external' ? 'external' : 'internal',
      provider: normalized.provider,
      description: normalized.description,
      protocol: normalized.protocol,
      schema: toInputJson(normalized.schema),
      config: normalized.config ? toInputJson(normalized.config) : Prisma.DbNull,
      auth: normalized.auth ? toInputJson(normalized.auth) : Prisma.DbNull,
      enabled: normalized.enabled,
    },
  });

  return c.json({ tool: updated });
});

api.post('/v1/agent-tools/:id/execute', async (c) => {
  const body = await readJsonBody(c);
  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId : null;
  const inputs =
    body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
      ? (body.inputs as Record<string, unknown>)
      : {};
  const context =
    body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? (body.context as Record<string, unknown>)
      : null;

  const allowed = await checkToolPermission(c.get('tenantId'), tool.id, agentId);
  if (!allowed) {
    await prisma.toolExecutionLog.create({
      data: {
        organizationId: c.get('tenantId'),
        toolId: tool.id,
        agentId,
        status: 'denied',
        requestPayload: toInputJson({ inputs, context }),
        responsePayload: toNullableJson(null),
      },
    });
    return c.json({ error: 'tool_access_denied' }, 403);
  }

  let result;
  if (tool.kind === 'external') {
    const adapterId =
      tool.config && typeof tool.config === 'object'
        ? (tool.config as Record<string, unknown>).adapterId
        : null;
    const adapter = typeof adapterId === 'string' ? getExternalAdapter(adapterId) : null;

    if (!adapter) {
      result = { status: 'error', error: 'adapter_not_found' } as const;
    } else {
      result = await adapter.execute(tool as unknown as Parameters<typeof executeTool>[0], {
        toolId: tool.id,
        agentId,
        inputs,
        context,
      } as ToolExecutionRequest);
    }
  } else {
    result = await executeTool(tool as unknown as Parameters<typeof executeTool>[0], {
      toolId: tool.id,
      agentId,
      inputs,
      context,
    } as ToolExecutionRequest);
  }

  const executionLog = await prisma.toolExecutionLog.create({
    data: {
      organizationId: c.get('tenantId'),
      toolId: tool.id,
      agentId,
      status: result.status,
      latencyMs: result.latencyMs ?? null,
      errorMessage: result.error ?? null,
      requestPayload: toInputJson({ inputs, context }),
      responsePayload: toNullableJson(result.outputs ?? null),
    },
  });

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const langfuse = normalizeLangfuseSettings(settings.langfuse);
  await sendLangfuseTrace(langfuse, {
    id: executionLog.id,
    name: `tool:${tool.name}`,
    input: {
      toolId: tool.id,
      toolName: tool.name,
      agentId,
      inputs,
      context,
    },
    output: {
      status: result.status,
      error: result.error ?? null,
      outputs: result.outputs ?? null,
    },
    metadata: {
      latencyMs: result.latencyMs ?? null,
    },
  });

  return c.json({ result });
});

api.get('/v1/agent-tools/:id/permissions', async (c) => {
  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const permissions = await prisma.toolPermission.findMany({
    where: { organizationId: c.get('tenantId'), toolId: tool.id },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({ permissions });
});

api.put('/v1/agent-tools/:id/permissions', async (c) => {
  const body = await readJsonBody(c);
  const tool = await prisma.toolDefinition.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!tool) {
    return c.json({ error: 'tool_not_found' }, 404);
  }

  const normalized = normalizePermissionInput(body);

  const existing = await prisma.toolPermission.findFirst({
    where: {
      organizationId: c.get('tenantId'),
      toolId: tool.id,
      agentId: normalized.agentId,
    },
  });
  const permission = existing
    ? await prisma.toolPermission.update({
        where: { id: existing.id },
        data: { allowed: normalized.allowed },
      })
    : await prisma.toolPermission.create({
        data: {
          organizationId: c.get('tenantId'),
          toolId: tool.id,
          agentId: normalized.agentId,
          allowed: normalized.allowed,
        },
      });

  return c.json({ permission });
});

api.get('/v1/agent-tools/logs', async (c) => {
  const toolId = c.req.query('toolId');
  const agentId = c.req.query('agentId');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const where: Prisma.ToolExecutionLogWhereInput = {
    organizationId: c.get('tenantId'),
    ...(toolId ? { toolId } : {}),
    ...(agentId ? { agentId } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.toolExecutionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { tool: true },
    }),
    prisma.toolExecutionLog.count({ where }),
  ]);

  return c.json({ logs, total, limit, offset });
});

api.get('/v1/agent-tools/adapters', async (c) => {
  return c.json({
    adapters: listExternalAdapters().map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      provider: adapter.provider,
    })),
  });
});

api.get('/v1/agent-tools/adapters/:id/health', async (c) => {
  const adapter = getExternalAdapter(c.req.param('id'));
  if (!adapter) {
    return c.json({ error: 'adapter_not_found' }, 404);
  }

  const health = adapter.healthcheck ? await adapter.healthcheck() : { status: 'ok' };
  return c.json({ adapter: adapter.id, health });
});

api.get('/v1/prompts', async (c) => {
  const name = c.req.query('name');
  const where: Prisma.PromptTemplateWhereInput = {
    organizationId: c.get('tenantId'),
    ...(name ? { name } : {}),
  };
  const prompts = await prisma.promptTemplate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return c.json({ prompts });
});

api.get('/v1/langfuse', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const langfuse = normalizeLangfuseSettings(settings.langfuse);

  return c.json({
    langfuse: {
      enabled: langfuse.enabled,
      baseUrl: langfuse.baseUrl,
      publicKey: langfuse.publicKey ? `${langfuse.publicKey.slice(0, 4)}...` : '',
      secretKey: langfuse.secretKey ? '***' : '',
    },
  });
});

api.put('/v1/langfuse', async (c) => {
  const body = await readJsonBody(c);
  const incoming = normalizeLangfuseSettings(body.langfuse ?? body);

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const current = normalizeLangfuseSettings(settings.langfuse);

  const langfuse = {
    enabled: incoming.enabled,
    baseUrl: incoming.baseUrl,
    publicKey: incoming.publicKey || current.publicKey,
    secretKey: incoming.secretKey || current.secretKey,
  };

  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        langfuse,
      }),
    },
  });

  return c.json({
    langfuse: {
      enabled: langfuse.enabled,
      baseUrl: langfuse.baseUrl,
      publicKey: langfuse.publicKey ? `${langfuse.publicKey.slice(0, 4)}...` : '',
      secretKey: langfuse.secretKey ? '***' : '',
    },
  });
});

api.get('/v1/prompts/metrics', async (c) => {
  const name = c.req.query('name');
  const promptId = c.req.query('promptId');

  const where: Prisma.PromptUsageWhereInput = {
    organizationId: c.get('tenantId'),
    ...(promptId ? { promptId } : {}),
  };

  if (name) {
    const promptIds = await prisma.promptTemplate.findMany({
      where: { organizationId: c.get('tenantId'), name },
      select: { id: true },
    });
    where.promptId = { in: promptIds.map((item) => item.id) };
  }

  const usage = await prisma.promptUsage.groupBy({
    by: ['promptId', 'outcome'],
    where,
    _count: { _all: true },
  });

  const promptIds = Array.from(new Set(usage.map((row) => row.promptId)));
  const prompts = promptIds.length
    ? await prisma.promptTemplate.findMany({
        where: { id: { in: promptIds } },
        select: { id: true, name: true, version: true, active: true },
      })
    : [];

  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));

  const metrics = promptIds.map((id) => {
    const rows = usage.filter((row) => row.promptId === id);
    const success = rows.find((row) => row.outcome === 'success')?._count._all ?? 0;
    const failure = rows.find((row) => row.outcome === 'failure')?._count._all ?? 0;
    const unknown = rows.find((row) => row.outcome === 'unknown')?._count._all ?? 0;
    const total = success + failure + unknown;

    return {
      prompt: promptMap.get(id) ?? { id, name: 'unknown', version: 'n/a', active: false },
      totals: { success, failure, unknown, total },
      successRate: safeRate(success, total),
    };
  });

  return c.json({ metrics });
});

api.post('/v1/prompts/:id/usage', async (c) => {
  const body = await readJsonBody(c);
  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!prompt) {
    return c.json({ error: 'prompt_not_found' }, 404);
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId : null;
  const outcomeRaw = typeof body.outcome === 'string' ? body.outcome : 'unknown';
  const outcome = outcomeRaw === 'success' || outcomeRaw === 'failure' ? outcomeRaw : 'unknown';
  const latencyMs = typeof body.latencyMs === 'number' ? Math.floor(body.latencyMs) : null;
  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : null;

  const usage = await prisma.promptUsage.create({
    data: {
      organizationId: c.get('tenantId'),
      promptId: prompt.id,
      agentId,
      outcome,
      latencyMs,
      metadata: toNullableJson(metadata),
    },
  });

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const langfuse = normalizeLangfuseSettings(settings.langfuse);
  await sendLangfuseTrace(langfuse, {
    id: usage.id,
    name: `prompt:${prompt.name}`,
    input: {
      promptId: prompt.id,
      promptVersion: prompt.version,
      agentId,
      metadata,
    },
    output: {
      outcome,
    },
    metadata: {
      latencyMs,
    },
  });

  return c.json({ usage }, 201);
});

api.post('/v1/prompts', async (c) => {
  const body = await readJsonBody(c);
  const normalized = normalizePromptInput(body);

  if (!normalized.name || !normalized.content) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const prompt = await prisma.promptTemplate.create({
    data: {
      organizationId: c.get('tenantId'),
      name: normalized.name,
      version: normalized.version,
      content: normalized.content,
      metadata: toNullableJson(normalized.metadata),
      active: normalized.active,
    },
  });

  return c.json({ prompt }, 201);
});

api.put('/v1/prompts/:id', async (c) => {
  const body = await readJsonBody(c);
  const normalized = normalizePromptInput(body);

  const prompt = await prisma.promptTemplate.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!prompt) {
    return c.json({ error: 'prompt_not_found' }, 404);
  }

  const updated = await prisma.promptTemplate.update({
    where: { id: prompt.id },
    data: {
      name: normalized.name || prompt.name,
      version: normalized.version || prompt.version,
      content: normalized.content || prompt.content,
      metadata: toNullableJson(normalized.metadata),
      active: normalized.active,
    },
  });

  return c.json({ prompt: updated });
});

api.post('/v1/crm/leads/:id', async (c) => {
  const body = await readJsonBody(c);
  const leadId = c.req.param('id');
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const fieldMapping = normalizeCrmFieldMapping(settings.crmFieldMapping);

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: c.get('tenantId') },
  });

  if (!lead) {
    return c.json({ error: 'lead_not_found' }, 404);
  }

  const originalTags = lead.tags ?? [];
  const originalStage = lead.stage;

  const updates: Record<string, unknown> = {};
  if (typeof body.stage === 'string') {
    updates.stage = body.stage;
  }
  if (Array.isArray(body.tags)) {
    updates.tags = body.tags.filter((tag) => typeof tag === 'string');
  }
  if (typeof body.source === 'string') {
    updates.source = body.source;
  }
  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
    updates.metadata = body.metadata as Record<string, unknown>;
  }
  if (typeof body.crmExternalId === 'string') {
    updates.crmExternalId = body.crmExternalId.trim();
  }

  if (fieldMapping && Object.keys(fieldMapping).length > 0) {
    const existingMetadata =
      updates.metadata && typeof updates.metadata === 'object' && !Array.isArray(updates.metadata)
        ? (updates.metadata as Record<string, unknown>)
        : lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
          ? (lead.metadata as Record<string, unknown>)
          : null;

    updates.metadata = applyCrmMetadataMapping(existingMetadata, body, fieldMapping);
  }

  const updatedLead = await applyLeadUpdate(lead, updates);

  const tagsChanged = normalizeTagSet(updatedLead.tags ?? []) !== normalizeTagSet(originalTags);
  const stageChanged = updatedLead.stage !== originalStage;

  if (tagsChanged) {
    await enqueueJourneySignal({
      organizationId: c.get('tenantId'),
      leadId: updatedLead.id,
      triggerType: 'tag_change',
      tags: updatedLead.tags ?? [],
      stage: updatedLead.stage,
    });
  }

  if (stageChanged) {
    await enqueueJourneySignal({
      organizationId: c.get('tenantId'),
      leadId: updatedLead.id,
      triggerType: 'stage_change',
      tags: updatedLead.tags ?? [],
      stage: updatedLead.stage,
    });
  }

  return c.json({ lead: updatedLead });
});

api.post('/v1/crm/revenue', async (c) => {
  const body = await readJsonBody(c);
  const amount = typeof body.amount === 'number' ? body.amount : NaN;
  const currency = normalizeCurrency(body.currency) ?? 'USD';
  const source = typeof body.source === 'string' ? body.source.trim() : 'crm';
  const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : null;
  const occurredAtRaw = body.occurredAt;
  const occurredAt =
    typeof occurredAtRaw === 'string' || typeof occurredAtRaw === 'number'
      ? new Date(occurredAtRaw)
      : new Date();

  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: 'invalid_amount' }, 400);
  }

  const leadId = typeof body.leadId === 'string' ? body.leadId : null;
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : null;

  const lead = leadId
    ? await prisma.lead.findFirst({
        where: { id: leadId, organizationId: c.get('tenantId') },
      })
    : null;

  if (leadId && !lead) {
    return c.json({ error: 'lead_not_found' }, 404);
  }

  const campaign = campaignId
    ? await prisma.campaign.findFirst({
        where: { id: campaignId, organizationId: c.get('tenantId') },
      })
    : null;

  if (campaignId && !campaign) {
    return c.json({ error: 'campaign_not_found' }, 404);
  }

  let resolvedCampaign = campaign;
  if (!resolvedCampaign && lead) {
    const attribution = await prisma.leadAttribution.findUnique({
      where: { leadId_model: { leadId: lead.id, model: 'last_touch' } },
    });
    if (attribution?.campaignId) {
      resolvedCampaign = await prisma.campaign.findFirst({
        where: { id: attribution.campaignId, organizationId: c.get('tenantId') },
      });
    }
  }

  const revenueEvent = await prisma.revenueEvent.create({
    data: {
      organizationId: c.get('tenantId'),
      leadId: lead?.id ?? null,
      campaignId: resolvedCampaign?.id ?? null,
      amount,
      currency,
      source,
      externalId,
      occurredAt,
      metadata: toNullableJson(
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? (body.metadata as Record<string, unknown>)
          : null
      ),
    },
  });

  if (resolvedCampaign) {
    await prisma.campaign.update({
      where: { id: resolvedCampaign.id },
      data: { revenue: (resolvedCampaign.revenue ?? 0) + amount },
    });
  }

  return c.json({ revenueEvent }, 201);
});

api.put('/v1/campaigns/:id/roi', async (c) => {
  const body = await readJsonBody(c);
  const cost = typeof body.cost === 'number' ? body.cost : null;
  const revenue = typeof body.revenue === 'number' ? body.revenue : null;

  const campaign = await prisma.campaign.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!campaign) {
    return c.json({ error: 'campaign_not_found' }, 404);
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      cost: cost ?? campaign.cost,
      revenue: revenue ?? campaign.revenue,
    },
  });

  return c.json({ campaign: updated });
});

api.get('/v1/crm/mapping', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const mapping = normalizeCrmFieldMapping(settings.crmFieldMapping);

  return c.json({ mapping });
});

api.get('/v1/crm/mapping/examples', async (c) => {
  const examples = [
    {
      id: 'hubspot-deal',
      name: 'HubSpot Deal Sync',
      description: 'Map common HubSpot deal fields into metadata.',
      mapping: {
        hs_deal_id: 'crm.dealId',
        hs_deal_amount: 'crm.dealAmount',
        hs_deal_stage: 'crm.dealStage',
        hs_close_date: 'crm.closeDate',
      },
    },
    {
      id: 'salesforce-oppty',
      name: 'Salesforce Opportunity',
      description: 'Map common Salesforce opportunity fields.',
      mapping: {
        Id: 'crm.opportunityId',
        Amount: 'crm.amount',
        StageName: 'crm.stage',
        CloseDate: 'crm.closeDate',
      },
    },
    {
      id: 'custom-minimal',
      name: 'Minimal',
      description: 'Minimal mapping for custom CRM payloads.',
      mapping: {
        dealValue: 'crm.dealValue',
        owner: 'crm.owner',
      },
    },
  ];

  return c.json({ examples });
});

api.post('/v1/crm/mapping/validate', async (c) => {
  const body = await readJsonBody(c);
  const mapping = normalizeCrmFieldMapping(body.mapping ?? body);
  const result = validateCrmFieldMapping(mapping);
  return c.json(result, result.valid ? 200 : 400);
});

api.post('/v1/crm/mapping/preview', async (c) => {
  const body = await readJsonBody(c);
  const mapping = normalizeCrmFieldMapping(body.mapping ?? body);
  const validation = validateCrmFieldMapping(mapping);
  if (!validation.valid) {
    return c.json(validation, 400);
  }

  const payload =
    body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};

  const output = applyCrmMetadataMapping({}, payload, mapping);
  return c.json({ output });
});

api.put('/v1/crm/mapping', async (c) => {
  const body = await readJsonBody(c);
  const mapping = normalizeCrmFieldMapping(body.mapping ?? body);
  const validation = validateCrmFieldMapping(mapping);

  if (!validation.valid) {
    return c.json(validation, 400);
  }

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: {
      settings: toInputJson({
        ...settings,
        crmFieldMapping: mapping,
      }),
    },
  });

  return c.json({ mapping });
});

api.get('/v1/crm/webhook', async (c) => {
  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const crmWebhook = settings.crmWebhook ?? null;

  return c.json({ crmWebhook });
});

api.put('/v1/crm/webhook', async (c) => {
  const body = await readJsonBody(c);
  const url = body.url as string | undefined;

  if (!url) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const webhook: Record<string, unknown> = {
    url,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    mode: body.mode === 'mock' ? 'mock' : 'live',
  };
  if (typeof body.secret === 'string') {
    webhook.secret = body.secret;
  }
  if (typeof body.headers === 'object' && body.headers) {
    webhook.headers = body.headers as Record<string, string>;
  }
  if (Array.isArray(body.events)) {
    webhook.events = (body.events as string[]).filter((event) => typeof event === 'string');
  }
  const updated = {
    ...settings,
    crmWebhook: webhook,
  };

  await prisma.organization.update({
    where: { id: c.get('tenantId') },
    data: { settings: toInputJson(updated) },
  });

  return c.json({ crmWebhook: updated.crmWebhook });
});

api.get('/v1/leads', async (c) => {
  const stageQuery = c.req.query('stage');
  const tagQuery = c.req.query('tag');
  const search = c.req.query('q');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const stages = stageQuery
    ? stageQuery
        .split(',')
        .map((stage) => stage.trim())
        .filter((stage) => leadStages.has(stage))
    : [];
  const tags = tagQuery
    ? tagQuery
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : [];

  const where: Prisma.LeadWhereInput = {
    organizationId: c.get('tenantId'),
    ...(stages.length > 0 ? { stage: { in: stages as LeadStage[] } } : {}),
    ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
  };

  if (search) {
    where.OR = [
      { contact: { is: { name: { contains: search, mode: 'insensitive' } } } },
      { contact: { is: { email: { contains: search, mode: 'insensitive' } } } },
      { contact: { is: { phone: { contains: search } } } },
    ];
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        contact: true,
        conversation: true,
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return c.json({ leads, total, limit, offset });
});

api.post('/v1/leads/:id/signals', async (c) => {
  const body = await readJsonBody(c);
  const signals = normalizeTags(body.signals);
  const text = typeof body.text === 'string' ? body.text : undefined;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const taskType = typeof body.taskType === 'string' ? body.taskType : undefined;
  const confidence =
    typeof body.confidence === 'number' && body.confidence >= 0 ? body.confidence : undefined;

  if (signals.length === 0 && !text) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const lead = await prisma.lead.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!lead) {
    return c.json({ error: 'lead_not_found' }, 404);
  }

  const originalTags = lead.tags ?? [];
  const originalStage = lead.stage;

  const settings = await loadOrganizationSettings(c.get('tenantId'));
  const leadRules = getLeadRulesFromSettings(settings);

  let updatedLead = lead;
  let ruleResult: ReturnType<typeof applyLeadRules> | null = null;
  let ruleUpdates: Record<string, unknown> = {};

  if (leadRules.length > 0) {
    const leadRuleContext = {
      signals,
      ...(text ? { text } : {}),
    };
    ruleResult = applyLeadRules(
      {
        tags: updatedLead.tags,
        stage: updatedLead.stage,
        score: updatedLead.score,
        source: updatedLead.source,
        metadata:
          updatedLead.metadata && typeof updatedLead.metadata === 'object' && !Array.isArray(updatedLead.metadata)
            ? (updatedLead.metadata as Record<string, unknown>)
            : null,
      },
      leadRules,
      leadRuleContext
    );

    if (Object.keys(ruleResult.updates).length > 0) {
      ruleUpdates = applyConversionUpdate(updatedLead.stage, ruleResult.updates);
      const leadUpdate: Prisma.LeadUpdateInput = {
        ...ruleUpdates,
        lastActivityAt: new Date(),
      };
      if ('metadata' in ruleUpdates) {
        leadUpdate.metadata = toNullableJson(
          ruleUpdates.metadata &&
            typeof ruleUpdates.metadata === 'object' &&
            !Array.isArray(ruleUpdates.metadata)
            ? ruleUpdates.metadata
            : null
        );
      }
      updatedLead = await prisma.lead.update({
        where: { id: updatedLead.id },
        data: leadUpdate,
      });
    }
  }

  const matchedRuleIds = ruleResult?.matchedRules
    ?.map((rule) => rule.id ?? rule.name ?? '')
    .filter((value) => value.length > 0);
  const agentResult = await runLeadAgentWorkflow({
    organizationId: c.get('tenantId'),
    leadId: updatedLead.id,
    ...(text ? { text } : {}),
    ...(signals.length > 0 ? { signals } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(matchedRuleIds && matchedRuleIds.length > 0 ? { matchedRuleIds } : {}),
    ...(taskType ? { taskType } : {}),
    ...(typeof confidence === 'number' ? { confidence } : {}),
  });

  if (agentResult.lead) {
    updatedLead = agentResult.lead;
  }

  const combinedUpdates = {
    ...ruleUpdates,
    ...(agentResult.updates ?? {}),
  };

  if (Object.keys(combinedUpdates).length > 0) {
    await enqueueCrmWebhook(
      c.get('tenantId'),
      'lead.updated',
      {
        lead: updatedLead,
        matchedRules: ruleResult?.matchedRules ?? [],
        changes: combinedUpdates,
        signals,
        agent: agentResult.decision
          ? {
              runId: agentResult.runId,
              updates: agentResult.updates,
              rationale: agentResult.decision.rationale,
            }
          : null,
      },
      settings
    );
  }

  const tagsChanged = normalizeTagSet(updatedLead.tags ?? []) !== normalizeTagSet(originalTags);
  const stageChanged = updatedLead.stage !== originalStage;

  if (tagsChanged) {
    await enqueueJourneySignal({
      organizationId: c.get('tenantId'),
      leadId: updatedLead.id,
      triggerType: 'tag_change',
      tags: updatedLead.tags ?? [],
      stage: updatedLead.stage,
      ...(text ? { text } : {}),
    });
  }

  if (stageChanged) {
    await enqueueJourneySignal({
      organizationId: c.get('tenantId'),
      leadId: updatedLead.id,
      triggerType: 'stage_change',
      tags: updatedLead.tags ?? [],
      stage: updatedLead.stage,
      ...(text ? { text } : {}),
    });
  }

  return c.json({
    lead: updatedLead,
    matchedRules: ruleResult?.matchedRules ?? [],
    updates: combinedUpdates,
    agent: agentResult.decision
      ? {
          runId: agentResult.runId,
          updates: agentResult.updates,
          rationale: agentResult.decision.rationale,
          assignmentQueue: agentResult.decision.assignmentQueue,
        }
      : null,
  });
});

api.post('/v1/agent/leads/:id/score', async (c) => {
  const body = await readJsonBody(c);
  const signals = normalizeTags(body.signals);
  const text = typeof body.text === 'string' ? body.text : undefined;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
  const taskType = typeof body.taskType === 'string' ? body.taskType : undefined;
  const confidence =
    typeof body.confidence === 'number' && body.confidence >= 0 ? body.confidence : undefined;

  if (signals.length === 0 && !text) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const lead = await prisma.lead.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!lead) {
    return c.json({ error: 'lead_not_found' }, 404);
  }

  const originalTags = lead.tags ?? [];
  const originalStage = lead.stage;

  const agentResult = await runLeadAgentWorkflow({
    organizationId: c.get('tenantId'),
    leadId: lead.id,
    ...(text ? { text } : {}),
    ...(signals.length > 0 ? { signals } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(Array.isArray(body.matchedRuleIds)
      ? { matchedRuleIds: body.matchedRuleIds.filter((value) => typeof value === 'string') }
      : {}),
    ...(taskType ? { taskType } : {}),
    ...(typeof confidence === 'number' ? { confidence } : {}),
  });

  if (!agentResult.lead) {
    return c.json({ error: 'lead_not_found' }, 404);
  }

  const tagsChanged =
    normalizeTagSet(agentResult.lead.tags ?? []) !== normalizeTagSet(originalTags);
  const stageChanged = agentResult.lead.stage !== originalStage;

  if (tagsChanged) {
    await enqueueJourneySignal({
      organizationId: c.get('tenantId'),
      leadId: agentResult.lead.id,
      triggerType: 'tag_change',
      tags: agentResult.lead.tags ?? [],
      stage: agentResult.lead.stage,
      ...(text ? { text } : {}),
    });
  }

  if (stageChanged) {
    await enqueueJourneySignal({
      organizationId: c.get('tenantId'),
      leadId: agentResult.lead.id,
      triggerType: 'stage_change',
      tags: agentResult.lead.tags ?? [],
      stage: agentResult.lead.stage,
      ...(text ? { text } : {}),
    });
  }

  return c.json({
    lead: agentResult.lead,
    updates: agentResult.updates,
    agent: agentResult.decision
      ? {
          runId: agentResult.runId,
          updates: agentResult.updates,
          rationale: agentResult.decision.rationale,
          assignmentQueue: agentResult.decision.assignmentQueue,
        }
      : null,
  });
});

api.get('/v1/webhook-deliveries', async (c) => {
  const statusQuery = c.req.query('status');
  const eventQuery = c.req.query('eventType');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const statuses = statusQuery
    ? statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => webhookStatuses.has(value))
    : [];
  const statusFilter = statuses as WebhookDeliveryStatus[];

  const eventTypes = eventQuery
    ? eventQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const where: Prisma.WebhookDeliveryWhereInput = {
    organizationId: c.get('tenantId'),
    ...(statusFilter.length > 0 ? { status: { in: statusFilter } } : {}),
    ...(eventTypes.length > 0 ? { eventType: { in: eventTypes } } : {}),
  };

  const [deliveries, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.webhookDelivery.count({ where }),
  ]);

  return c.json({ deliveries, total, limit, offset });
});

api.get('/v1/messages', async (c) => {
  const statusQuery = c.req.query('status');
  const channelQuery = c.req.query('channelId');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const statuses = statusQuery
    ? statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => messageStatuses.has(value))
    : [];
  const statusFilter = statuses as MessageStatus[];

  const channelIds = channelQuery
    ? channelQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const where: Prisma.MessageWhereInput = {
    organizationId: c.get('tenantId'),
    ...(statusFilter.length > 0 ? { status: { in: statusFilter } } : {}),
    ...(channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
  };

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        channel: true,
        contact: true,
      },
    }),
    prisma.message.count({ where }),
  ]);

  return c.json({ messages, total, limit, offset });
});

api.get('/v1/campaigns', async (c) => {
  const statusQuery = c.req.query('status');
  const channelQuery = c.req.query('channelId');
  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');

  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const limit = Math.min(200, Math.max(1, parseNumber(limitRaw, 50)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const statuses = statusQuery
    ? statusQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => campaignStatuses.has(value))
    : [];

  const channelIds = channelQuery
    ? channelQuery
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const where: Prisma.CampaignWhereInput = {
    organizationId: c.get('tenantId'),
    ...(statuses.length > 0
      ? { status: { in: statuses as CampaignStatus[] } }
      : {}),
    ...(channelIds.length > 0 ? { channelId: { in: channelIds } } : {}),
  };

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { segment: true, channel: true },
    }),
    prisma.campaign.count({ where }),
  ]);

  return c.json({ campaigns, total, limit, offset });
});

api.post('/v1/campaigns/preview', async (c) => {
  const body = await readJsonBody(c);
  const segment = normalizeCampaignSegment(body.segment);

  const where = buildSegmentWhere(c.get('tenantId'), segment);
  const count = await prisma.lead.count({ where });

  return c.json({ count, segment });
});

api.post('/v1/campaigns', async (c) => {
  const body = await readJsonBody(c);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const messageText = typeof body.messageText === 'string' ? body.messageText.trim() : '';
  const scheduledAtRaw = body.scheduledAt;

  if (!name || !channelId || !messageText) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, organizationId: c.get('tenantId') },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  let scheduledAt: Date | null = null;
  if (typeof scheduledAtRaw === 'string' || typeof scheduledAtRaw === 'number') {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_schedule' }, 400);
    }
    scheduledAt = parsed;
  }

  const segmentInput = normalizeCampaignSegment(body.segment);

  const campaign = await prisma.$transaction(async (tx) => {
    const segment = await tx.campaignSegment.create({
      data: {
        organizationId: c.get('tenantId'),
        stages: segmentInput.stages as LeadStage[],
        tagsAll: segmentInput.tagsAll,
        sources: segmentInput.sources,
        lastActiveWithinDays: segmentInput.lastActiveWithinDays,
      },
    });

    return tx.campaign.create({
      data: {
        organizationId: c.get('tenantId'),
        channelId: channel.id,
        name,
        messageText,
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduledAt,
        segmentId: segment.id,
      },
      include: { segment: true, channel: true },
    });
  });

  return c.json({ campaign }, 201);
});

api.post('/v1/campaigns/:id/schedule', async (c) => {
  const body = await readJsonBody(c);
  const scheduledAtRaw = body.scheduledAt;

  let scheduledAt: Date | null = null;
  if (typeof scheduledAtRaw === 'string' || typeof scheduledAtRaw === 'number') {
    const parsed = new Date(scheduledAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_schedule' }, 400);
    }
    scheduledAt = parsed;
  }

  if (!scheduledAt) {
    return c.json({ error: 'invalid_schedule' }, 400);
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!campaign) {
    return c.json({ error: 'campaign_not_found' }, 404);
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      scheduledAt,
      status: 'scheduled',
    },
    include: { segment: true, channel: true },
  });

  return c.json({ campaign: updated });
});

api.post('/v1/campaigns/:id/cancel', async (c) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!campaign) {
    return c.json({ error: 'campaign_not_found' }, 404);
  }

  if (campaign.status === 'completed' || campaign.status === 'failed') {
    return c.json({ error: 'campaign_not_cancelable' }, 409);
  }

  if (campaign.status === 'canceled') {
    return c.json({ campaign });
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: 'canceled',
      scheduledAt: null,
      completedAt: new Date(),
    },
    include: { segment: true, channel: true },
  });

  return c.json({ campaign: updated });
});

api.get('/v1/journeys', async (c) => {
  const journeys = await prisma.journey.findMany({
    where: { organizationId: c.get('tenantId') },
    orderBy: { createdAt: 'desc' },
    include: {
      triggers: true,
      nodes: true,
      edges: true,
    },
  });

  return c.json({ journeys });
});

api.post('/v1/journeys', async (c) => {
  const body = await readJsonBody(c);
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!name) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const status = normalizeJourneyStatus(body.status);
  const triggers = normalizeJourneyTriggers(body.triggers);
  const nodes = normalizeJourneyNodes(body.nodes);
  const edges = normalizeJourneyEdges(body.edges);

  const journey = await prisma.$transaction(async (tx) => {
    const created = await tx.journey.create({
      data: {
        organizationId: c.get('tenantId'),
        name,
        description,
        status,
      },
    });

    if (triggers.length > 0) {
      await tx.journeyTrigger.createMany({
        data: triggers.map((trigger) => ({
          organizationId: c.get('tenantId'),
          journeyId: created.id,
          type: trigger.type as JourneyTriggerType,
          enabled: trigger.enabled,
          config: toNullableJson(trigger.config),
        })),
      });
    }

    if (nodes.length > 0) {
      await tx.journeyNode.createMany({
        data: nodes.map((node) => ({
          id: node.id,
          organizationId: c.get('tenantId'),
          journeyId: created.id,
          type: node.type as JourneyNodeType,
          label: node.label,
          config: toNullableJson(node.config),
          position: toNullableJson(node.position),
        })),
      });
    }

    if (edges.length > 0) {
      await tx.journeyEdge.createMany({
        data: edges.map((edge) => ({
          id: edge.id,
          organizationId: c.get('tenantId'),
          journeyId: created.id,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          label: edge.label,
          config: toNullableJson(edge.config),
        })),
      });
    }

    return tx.journey.findUnique({
      where: { id: created.id },
      include: { triggers: true, nodes: true, edges: true },
    });
  });

  return c.json({ journey }, 201);
});

api.get('/v1/journeys/:id', async (c) => {
  const journey = await prisma.journey.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
    include: {
      triggers: true,
      nodes: true,
      edges: true,
    },
  });

  if (!journey) {
    return c.json({ error: 'journey_not_found' }, 404);
  }

  return c.json({ journey });
});

api.put('/v1/journeys/:id', async (c) => {
  const body = await readJsonBody(c);
  const journey = await prisma.journey.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!journey) {
    return c.json({ error: 'journey_not_found' }, 404);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : journey.name;
  const description =
    typeof body.description === 'string' ? body.description.trim() : journey.description;
  const status = body.status ? normalizeJourneyStatus(body.status) : journey.status;
  const triggers = normalizeJourneyTriggers(body.triggers);
  const nodes = normalizeJourneyNodes(body.nodes);
  const edges = normalizeJourneyEdges(body.edges);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        name,
        description,
        status,
      },
    });

    await tx.journeyTrigger.deleteMany({ where: { journeyId: journey.id } });
    if (triggers.length > 0) {
      await tx.journeyTrigger.createMany({
        data: triggers.map((trigger) => ({
          organizationId: c.get('tenantId'),
          journeyId: journey.id,
          type: trigger.type as JourneyTriggerType,
          enabled: trigger.enabled,
          config: toNullableJson(trigger.config),
        })),
      });
    }

    await tx.journeyEdge.deleteMany({ where: { journeyId: journey.id } });
    if (edges.length > 0) {
      await tx.journeyEdge.createMany({
        data: edges.map((edge) => ({
          id: edge.id,
          organizationId: c.get('tenantId'),
          journeyId: journey.id,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          label: edge.label,
          config: toNullableJson(edge.config),
        })),
      });
    }

    for (const node of nodes) {
      await tx.journeyNode.upsert({
        where: { id: node.id },
        update: {
          type: node.type as JourneyNodeType,
          label: node.label,
          config: toNullableJson(node.config),
          position: toNullableJson(node.position),
        },
        create: {
          id: node.id,
          organizationId: c.get('tenantId'),
          journeyId: journey.id,
          type: node.type as JourneyNodeType,
          label: node.label,
          config: toNullableJson(node.config),
          position: toNullableJson(node.position),
        },
      });
    }

    return tx.journey.findUnique({
      where: { id: journey.id },
      include: { triggers: true, nodes: true, edges: true },
    });
  });

  return c.json({ journey: updated });
});

api.get('/v1/journeys/:id/runs', async (c) => {
  const journey = await prisma.journey.findFirst({
    where: { id: c.req.param('id'), organizationId: c.get('tenantId') },
  });

  if (!journey) {
    return c.json({ error: 'journey_not_found' }, 404);
  }

  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const parseNumber = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const limit = Math.min(100, Math.max(1, parseNumber(limitRaw, 25)));
  const offset = Math.max(0, parseNumber(offsetRaw, 0));

  const [runs, total] = await Promise.all([
    prisma.journeyRun.findMany({
      where: { journeyId: journey.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { steps: true },
    }),
    prisma.journeyRun.count({ where: { journeyId: journey.id } }),
  ]);

  return c.json({ runs, total, limit, offset });
});

api.get('/v1/channels', async (c) => {
  const channels = await prisma.channel.findMany({
    where: { organizationId: c.get('tenantId') },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({ channels });
});

api.post('/v1/channels', async (c) => {
  const body = await readJsonBody(c);

  if (!body.name || !body.platform || !body.externalId || !body.credentials) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const platformRaw = body.platform as string;
  if (!supportedPlatforms.has(platformRaw)) {
    return c.json({ error: 'invalid_platform' }, 400);
  }

  const channelData: Prisma.ChannelCreateInput = {
    organization: { connect: { id: c.get('tenantId') } },
    platform: platformRaw as Platform,
    name: body.name as string,
    externalId: body.externalId as string,
    status: 'pending',
    credentials: toInputJson(body.credentials),
  };
  if (typeof body.provider === 'string' && body.provider.trim().length > 0) {
    channelData.provider = body.provider;
  }
  if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
    channelData.settings = toInputJson(body.settings);
  }
  if (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
    channelData.metadata = toInputJson(body.metadata);
  }

  const channel = await prisma.channel.create({
    data: channelData,
  });

  return c.json({ channel }, 201);
});

api.post('/v1/whatsapp/channels/:channelId/messages', async (c) => {
  const channelId = c.req.param('channelId');
  const body = await readJsonBody(c);

  const rawTo = typeof body.to === 'string' ? body.to.trim() : '';
  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;

  if (!rawTo || !rawText) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, organizationId: c.get('tenantId') },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }

  const adapter = getWhatsAppAdapter(channel.provider.toLowerCase());
  if (!adapter?.sendText) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  const normalizedTo = normalizePhone(rawTo);
  if (!normalizedTo) {
    return c.json({ error: 'invalid_recipient' }, 400);
  }
  const platform: Platform = 'whatsapp';

  const contactInput: {
    organizationId: string;
    platform: Platform;
    externalId: string;
    name?: string;
  } = {
    organizationId: c.get('tenantId'),
    platform,
    externalId: normalizedTo,
  };
  if (name) {
    contactInput.name = name;
  }
  const contact = await findOrCreateContact(contactInput);

  const conversation = await upsertConversation({
    organizationId: c.get('tenantId'),
    channelId: channel.id,
    contactId: contact.id,
    platform,
    externalId: normalizedTo,
  });

  const message = await prisma.message.create({
    data: {
      organizationId: c.get('tenantId'),
      conversationId: conversation.id,
      channelId: channel.id,
      contactId: contact.id,
      platform,
      type: 'text',
      direction: 'outbound',
      status: 'pending',
      content: {
        text: rawText,
        to: normalizedTo,
      },
    },
  });

  await outboundQueue.add(
    'wa.send',
    {
      messageId: message.id,
    },
    defaultJobOptions
  );

  return c.json({ message }, 202);
});

api.post('/v1/mock/whatsapp/inbound', async (c) => {
  const body = await readJsonBody(c);
  const channelId = body.channelId as string | undefined;
  const from = body.from as string | undefined;
  const text = body.text as string | undefined;

  if (!channelId || !from || !text) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, organizationId: c.get('tenantId') },
  });

  if (!channel) {
    return c.json({ error: 'channel_not_found' }, 404);
  }

  if (channel.platform !== 'whatsapp') {
    return c.json({ error: 'unsupported_platform' }, 400);
  }

  if (!channel.provider) {
    return c.json({ error: 'provider_required' }, 400);
  }
  const provider = channel.provider.toLowerCase();

  const adapter = getWhatsAppAdapter(provider);
  if (!adapter) {
    return c.json({ error: 'unsupported_provider' }, 400);
  }

  if (!adapter.buildMockPayload) {
    return c.json({ error: 'provider_mock_unsupported' }, 400);
  }

  let timestamp: Date | undefined;
  if (typeof body.timestamp === 'string' || typeof body.timestamp === 'number') {
    const parsed = new Date(body.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'invalid_timestamp' }, 400);
    }
    timestamp = parsed;
  }

  const mockInput: Parameters<typeof adapter.buildMockPayload>[0] = {
    from,
    text,
  };
  if (typeof body.name === 'string') {
    mockInput.name = body.name;
  }
  if (typeof body.messageId === 'string') {
    mockInput.messageId = body.messageId;
  }
  if (timestamp) {
    mockInput.timestamp = timestamp;
  }

  const payload = adapter.buildMockPayload(mockInput);

  await inboundQueue.add(
    'wa.webhook.mock',
    {
      channelId,
      payload,
      rawBody: JSON.stringify(payload),
      headers: {},
    },
    defaultJobOptions
  );

  return c.json({ queued: true, payload });
});

admin.post('/v1/admin/bootstrap', async (c) => {
  const token = process.env.BOOTSTRAP_TOKEN;
  const provided = c.req.header('x-bootstrap-token');

  if (!token || !provided || token !== provided) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const body = await readJsonBody(c);
  const name = body.name as string | undefined;
  const slug = body.slug as string | undefined;
  const apiKeyName = (body.apiKeyName as string | undefined) ?? 'default';

  if (!name || !slug) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const organization = await prisma.organization.create({
    data: { name, slug },
  });

  const { apiKey } = await createApiKey(organization.id, apiKeyName);

  return c.json({ organization, apiKey }, 201);
});

app.route('/', api);
app.route('/', admin);

const port = Number(process.env.PORT ?? 3000);

serve({
  fetch: app.fetch,
  port,
});

console.log(`API listening on :${port}`);
