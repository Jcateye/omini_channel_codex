const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LEAD_ID = process.env.LEAD_ID;

const INBOUND_FROM = process.env.INBOUND_FROM ?? '+12065550123';
const INBOUND_TEXT = process.env.INBOUND_TEXT ?? 'I want the price';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

const STEP_ORDER = ['crm', 'rules', 'channel', 'inbound', 'wait', 'signals'] as const;
type Step = (typeof STEP_ORDER)[number];

const parseStepList = (value?: string) => {
  if (!value) return [];
  return value
    .split(',')
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
};

const resolveSteps = () => {
  const args = process.argv.slice(2);
  const onlyArg = args.find((arg) => arg.startsWith('--only=') || arg.startsWith('--steps='));
  const skipArg = args.find((arg) => arg.startsWith('--skip='));

  const onlyRaw =
    onlyArg?.split('=')[1] ?? process.env.MOCK_ONLY ?? process.env.MOCK_STEPS ?? '';
  const skipRaw = skipArg?.split('=')[1] ?? process.env.MOCK_SKIP ?? '';

  const onlyList = parseStepList(onlyRaw);
  const skipList = parseStepList(skipRaw);

  const validSteps = new Set(STEP_ORDER);
  let enabled = new Set(STEP_ORDER);

  if (onlyList.length > 0) {
    enabled = new Set(onlyList.filter((step) => validSteps.has(step as Step)) as Step[]);
  }

  for (const step of skipList) {
    if (validSteps.has(step as Step)) {
      enabled.delete(step as Step);
    }
  }

  return { enabled, onlyList, skipList };
};

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  if (!API_KEY) {
    throw new Error('Missing API_KEY env var.');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }

  return data;
};

const ensureCrmWebhook = async () => {
  await request('PUT', '/v1/crm/webhook', {
    url: 'mock',
    mode: 'mock',
    enabled: true,
    events: ['lead.created', 'lead.updated', 'lead.converted'],
  });
  console.log('CRM webhook set to mock mode.');
};

const ensureLeadRules = async () => {
  const leadRules = [
    {
      id: 'rule_price_intent',
      name: 'Price intent',
      enabled: true,
      conditions: {
        textIncludes: ['price', 'quote', 'cost'],
      },
      actions: {
        addTags: ['price-intent'],
        scoreDelta: 5,
        setSource: 'inbound',
      },
    },
    {
      id: 'rule_purchase_signal',
      name: 'Purchase signal',
      enabled: true,
      conditions: {
        signalsAny: ['purchase'],
      },
      actions: {
        addTags: ['high-intent'],
        setStage: 'qualified',
        scoreDelta: 10,
        assignQueue: 'sales',
      },
      stopOnMatch: true,
    },
  ];

  await request('PUT', '/v1/lead-rules', { leadRules });
  console.log('Lead rules configured.');
};

type Channel = {
  id: string;
  platform: string;
  settings?: Record<string, unknown> | null;
  credentials?: Record<string, unknown> | null;
};

const pickOrCreateChannel = async () => {
  if (CHANNEL_ID) {
    return CHANNEL_ID;
  }

  const existing = await request<{ channels: Channel[] }>('GET', '/v1/channels');
  const mockChannel = existing.channels.find(
    (channel) =>
      channel.platform === 'whatsapp' &&
      (channel.settings?.mock === true || channel.credentials?.mock === true)
  );

  if (mockChannel) {
    console.log(`Using existing mock channel ${mockChannel.id}.`);
    return mockChannel.id;
  }

  const externalId = `mock-wa-${Date.now()}`;
  const created = await request<{ channel: Channel }>('POST', '/v1/channels', {
    name: 'WA Mock',
    platform: 'whatsapp',
    provider: 'messagebird',
    externalId,
    credentials: {
      bsp: 'messagebird',
      mock: true,
      apiKey: 'mock',
    },
    settings: {
      mock: true,
    },
  });

  console.log(`Created mock channel ${created.channel.id}.`);
  return created.channel.id;
};

const waitForLead = async (query: string) => {
  for (let i = 0; i < 10; i += 1) {
    const result = await request<{
      leads: Array<{ id: string; contactId: string; stage: string; tags: string[] }>;
    }>('GET', `/v1/leads?limit=5&q=${encodeURIComponent(query)}`);

    if (result.leads.length > 0) {
      return result.leads[0];
    }

    await sleep(1000);
  }

  return null;
};

const run = async () => {
  const { enabled, onlyList, skipList } = resolveSteps();
  const isEnabled = (step: Step) => enabled.has(step);

  if (onlyList.length > 0) {
    console.log(`Enabled steps: ${onlyList.join(', ')}`);
  }
  if (skipList.length > 0) {
    console.log(`Skipped steps: ${skipList.join(', ')}`);
  }

  if (isEnabled('crm')) {
    console.log('Step 1: Configure CRM webhook mock.');
    await ensureCrmWebhook();
  }

  if (isEnabled('rules')) {
    console.log('Step 2: Configure lead rules.');
    await ensureLeadRules();
  }

  let channelId = CHANNEL_ID;
  if (isEnabled('channel')) {
    console.log('Step 3: Ensure mock WhatsApp channel.');
    channelId = await pickOrCreateChannel();
  }

  if (isEnabled('inbound')) {
    console.log('Step 4: Send mock inbound message.');
    if (!channelId) {
      channelId = await pickOrCreateChannel();
    }
    await request('POST', '/v1/mock/whatsapp/inbound', {
      channelId,
      from: INBOUND_FROM,
      text: INBOUND_TEXT,
    });
  }

  let leadId = LEAD_ID ?? null;
  let lead: { id: string; contactId: string; stage: string; tags: string[] } | null = null;

  if (isEnabled('wait')) {
    if (leadId) {
      console.log('Step 5: Lead id provided, skipping wait.');
    } else {
      console.log('Step 5: Wait for lead creation.');
      lead = await waitForLead(normalizePhone(INBOUND_FROM));
      leadId = lead?.id ?? null;
    }
  }

  if (isEnabled('signals')) {
    const resolvedLeadId = leadId ?? lead?.id ?? null;
    if (!resolvedLeadId) {
      console.log('Step 6: No lead id available. Provide LEAD_ID or enable wait.');
      return;
    }

    console.log(`Step 6: Trigger signal for lead ${resolvedLeadId}.`);
    const updated = await request<{
      lead: { id: string; stage: string; tags: string[]; score?: number | null };
    }>('POST', `/v1/leads/${resolvedLeadId}/signals`, {
      signals: ['purchase'],
      text: 'ready to buy',
    });

    console.log('Lead updated via signals:', updated.lead);
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
