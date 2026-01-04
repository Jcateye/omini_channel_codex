export type LeadRuleCondition = {
  textIncludes?: string[];
  signalsAny?: string[];
  tagsAny?: string[];
  tagsAll?: string[];
  stageIn?: string[];
  sourceIn?: string[];
  minScore?: number;
  maxScore?: number;
};

export type LeadRuleAction = {
  addTags?: string[];
  removeTags?: string[];
  setStage?: string;
  scoreDelta?: number;
  setScore?: number;
  assignQueue?: string;
  setSource?: string;
};

export type LeadRule = {
  id?: string;
  name?: string;
  enabled?: boolean;
  conditions?: LeadRuleCondition;
  actions?: LeadRuleAction;
  stopOnMatch?: boolean;
  priority?: number;
};

export type LeadLike = {
  tags: string[];
  stage: string;
  score?: number | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LeadRuleContext = {
  text?: string;
  signals?: string[];
};

export type LeadRuleResult = {
  updates: Partial<LeadLike>;
  matchedRules: Array<{ id?: string; name?: string }>;
};

const normalizeList = (input?: string[]) => {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
};

const normalizeMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return { ...metadata };
};

const matchesRule = (
  lead: LeadLike,
  context: LeadRuleContext,
  conditions?: LeadRuleCondition
) => {
  if (!conditions) return true;

  const text = typeof context.text === 'string' ? context.text.toLowerCase() : undefined;
  const signals = normalizeList(context.signals);
  const leadTags = normalizeList(lead.tags);
  const score = typeof lead.score === 'number' ? lead.score : 0;

  const textIncludes = normalizeList(conditions.textIncludes);
  if (textIncludes.length > 0) {
    if (!text) return false;
    const match = textIncludes.some((token) => text.includes(token.toLowerCase()));
    if (!match) return false;
  }

  const signalsAny = normalizeList(conditions.signalsAny);
  if (signalsAny.length > 0) {
    if (signals.length === 0) return false;
    const match = signalsAny.some((token) => signals.includes(token));
    if (!match) return false;
  }

  const tagsAny = normalizeList(conditions.tagsAny);
  if (tagsAny.length > 0) {
    const match = tagsAny.some((tag) => leadTags.includes(tag));
    if (!match) return false;
  }

  const tagsAll = normalizeList(conditions.tagsAll);
  if (tagsAll.length > 0) {
    const match = tagsAll.every((tag) => leadTags.includes(tag));
    if (!match) return false;
  }

  const stageIn = normalizeList(conditions.stageIn);
  if (stageIn.length > 0 && !stageIn.includes(lead.stage)) {
    return false;
  }

  const sourceIn = normalizeList(conditions.sourceIn);
  if (sourceIn.length > 0 && (!lead.source || !sourceIn.includes(lead.source))) {
    return false;
  }

  if (typeof conditions.minScore === 'number' && score < conditions.minScore) {
    return false;
  }

  if (typeof conditions.maxScore === 'number' && score > conditions.maxScore) {
    return false;
  }

  return true;
};

export const applyLeadRules = (
  lead: LeadLike,
  rules: LeadRule[],
  context: LeadRuleContext
): LeadRuleResult => {
  const matchedRules: Array<{ id?: string; name?: string }> = [];

  let nextTags = normalizeList(lead.tags);
  let tagsChanged = false;

  let nextStage = lead.stage;
  let stageChanged = false;

  let nextScore = lead.score ?? null;
  let scoreChanged = false;

  let nextSource = lead.source ?? null;
  let sourceChanged = false;

  let nextMetadata = normalizeMetadata(lead.metadata);
  let metadataChanged = false;

  for (const rule of rules) {
    if (rule && rule.enabled === false) {
      continue;
    }

    if (!matchesRule(lead, context, rule?.conditions)) {
      continue;
    }

    matchedRules.push({ id: rule?.id, name: rule?.name });

    const actions = rule?.actions;
    if (!actions) {
      if (rule?.stopOnMatch) {
        break;
      }
      continue;
    }

    const addTags = normalizeList(actions.addTags);
    if (addTags.length > 0) {
      for (const tag of addTags) {
        if (!nextTags.includes(tag)) {
          nextTags.push(tag);
          tagsChanged = true;
        }
      }
    }

    const removeTags = normalizeList(actions.removeTags);
    if (removeTags.length > 0) {
      const filtered = nextTags.filter((tag) => !removeTags.includes(tag));
      if (filtered.length !== nextTags.length) {
        nextTags = filtered;
        tagsChanged = true;
      }
    }

    if (typeof actions.setStage === 'string' && actions.setStage !== nextStage) {
      nextStage = actions.setStage;
      stageChanged = true;
    }

    if (typeof actions.setScore === 'number') {
      nextScore = actions.setScore;
      scoreChanged = true;
    } else if (typeof actions.scoreDelta === 'number') {
      const baseScore = typeof nextScore === 'number' ? nextScore : 0;
      nextScore = baseScore + actions.scoreDelta;
      scoreChanged = true;
    }

    if (typeof actions.assignQueue === 'string') {
      if (nextMetadata.assignmentQueue !== actions.assignQueue) {
        nextMetadata.assignmentQueue = actions.assignQueue;
        metadataChanged = true;
      }
    }

    if (typeof actions.setSource === 'string' && actions.setSource !== nextSource) {
      nextSource = actions.setSource;
      sourceChanged = true;
    }

    if (rule?.stopOnMatch) {
      break;
    }
  }

  const updates: Partial<LeadLike> = {};
  if (tagsChanged) updates.tags = nextTags;
  if (stageChanged) updates.stage = nextStage;
  if (scoreChanged) updates.score = nextScore;
  if (sourceChanged) updates.source = nextSource;
  if (metadataChanged) updates.metadata = nextMetadata;

  return { updates, matchedRules };
};
