import { prisma } from '@omini/database';

const slug = process.env.ORG_SLUG ?? 'default';
const name = process.env.ORG_NAME ?? 'Default Org';

const ensureOrganization = async () => {
  const existing =
    (await prisma.organization.findUnique({ where: { slug } })) ??
    (await prisma.organization.findFirst());

  if (existing) {
    return existing;
  }

  return prisma.organization.create({
    data: {
      name,
      slug,
    },
  });
};

const ensureLead = async (organizationId: string) => {
  const existing = await prisma.lead.findFirst({
    where: { organizationId },
  });

  if (existing) {
    return existing;
  }

  const contact = await prisma.contact.create({
    data: {
      organizationId,
      name: 'Seed Lead',
      phone: '+12065550123',
      tags: ['seed'],
      metadata: { seed: true },
    },
  });

  return prisma.lead.create({
    data: {
      organizationId,
      contactId: contact.id,
      stage: 'new',
      tags: ['seed', 'pricing'],
      source: 'web',
      score: 8,
      metadata: {
        seed: true,
        assignmentQueue: 'sales',
      },
      lastActivityAt: new Date(),
    },
  });
};

const ensureKnowledgeSource = async (organizationId: string) => {
  const existing = await prisma.knowledgeSource.findFirst({
    where: { organizationId, name: 'Pricing FAQ' },
  });

  if (existing) {
    return existing;
  }

  return prisma.knowledgeSource.create({
    data: {
      organizationId,
      name: 'Pricing FAQ',
      description: 'Seeded FAQ content for pricing and plans.',
      kind: 'manual',
      config: { seed: true },
    },
  });
};

const ensureKnowledgeChunks = async (organizationId: string, sourceId: string) => {
  const existing = await prisma.knowledgeChunk.count({
    where: { organizationId, sourceId },
  });

  if (existing > 0) {
    return existing;
  }

  const chunks = [
    'Pricing starts at $199/month for the basic plan. Enterprise plans include dedicated support.',
    'Delivery rates improve when sending during business hours. Avoid late night sends.',
    'High-intent leads usually mention pricing, demos, or buying signals in inbound messages.',
  ];

  await prisma.knowledgeChunk.createMany({
    data: chunks.map((content, index) => ({
      organizationId,
      sourceId,
      content,
      metadata: { seed: true, chunkIndex: index },
    })),
  });

  return chunks.length;
};

const ensureCampaign = async (organizationId: string) => {
  const channel =
    (await prisma.channel.findFirst({
      where: { organizationId, platform: 'whatsapp' },
    })) ??
    (await prisma.channel.create({
      data: {
        organizationId,
        platform: 'whatsapp',
        provider: 'messagebird',
        name: 'Seed Channel',
        externalId: `seed-wa-${Date.now()}`,
        status: 'connected',
        credentials: { mock: true, bsp: 'messagebird', apiKey: 'seed' },
        settings: { mock: true },
      },
    }));

  const existing = await prisma.campaign.findFirst({
    where: { organizationId, name: 'Seed Campaign' },
  });

  if (existing) {
    return existing;
  }

  return prisma.campaign.create({
    data: {
      organizationId,
      channelId: channel.id,
      name: 'Seed Campaign',
      messageText: 'Hello from seeded campaign',
      status: 'running',
      cost: 500,
      revenue: 200,
      metadata: { seed: true },
    },
  });
};

const ensureAnalyticsRow = async (organizationId: string, campaignId: string) => {
  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const existing = await prisma.analyticsDaily.findFirst({
    where: {
      organizationId,
      date,
      campaignId,
      channelId: null,
    },
  });

  if (existing) {
    await prisma.analyticsDaily.update({
      where: { id: existing.id },
      data: {
        outboundSent: 120,
        outboundDelivered: 78,
        outboundFailed: 20,
        attributedConversions: 1,
        attributedRevenue: 200,
      },
    });
    return;
  }

  await prisma.analyticsDaily.create({
    data: {
      organizationId,
      date,
      campaignId,
      outboundSent: 120,
      outboundDelivered: 78,
      outboundFailed: 20,
      inboundCount: 8,
      responseCount: 5,
      leadCreated: 2,
      leadConverted: 1,
      attributedConversions: 1,
      attributedRevenue: 200,
    },
  });
};

const ensureOptimization = async (organizationId: string, campaignId: string) => {
  const existing = await prisma.campaignOptimization.findFirst({
    where: {
      organizationId,
      campaignId,
      type: 'delivery_rate_drop',
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.campaignOptimization.create({
    data: {
      organizationId,
      campaignId,
      type: 'delivery_rate_drop',
      title: 'Delivery rate below 80%',
      description: 'Review template quality, sender reputation, and timing.',
      status: 'pending',
      metrics: { deliveryRate: 0.65, outboundSent: 120 },
      action: { suggested: 'review_template' },
    },
  });
};

const ensureAgentRun = async (organizationId: string, leadId: string) => {
  const existing = await prisma.agentRun.findFirst({
    where: { organizationId, leadId, type: 'lead_scoring' },
  });

  if (existing) {
    return existing;
  }

  const run = await prisma.agentRun.create({
    data: {
      organizationId,
      type: 'lead_scoring',
      leadId,
      status: 'completed',
      input: { text: 'pricing for enterprise', signals: ['purchase'] },
      output: { updates: { stage: 'qualified', score: 18 } },
    },
  });

  await prisma.agentRunStep.createMany({
    data: [
      {
        runId: run.id,
        stepIndex: 0,
        stepType: 'memory',
        status: 'completed',
        input: { leadId },
        output: { count: 1 },
        finishedAt: new Date(),
      },
      {
        runId: run.id,
        stepIndex: 1,
        stepType: 'retrieval',
        status: 'completed',
        input: { query: 'pricing enterprise' },
        output: { count: 2 },
        finishedAt: new Date(),
      },
      {
        runId: run.id,
        stepIndex: 2,
        stepType: 'tool',
        status: 'completed',
        input: { toolId: 'internal.lead_scoring' },
        output: { updates: { stage: 'qualified', score: 18 } },
        finishedAt: new Date(),
      },
      {
        runId: run.id,
        stepIndex: 3,
        stepType: 'distribution',
        status: 'completed',
        input: { assignmentQueue: 'sales' },
        output: { assigned: true },
        finishedAt: new Date(),
      },
    ],
  });

  return run;
};

const seed = async () => {
  const organization = await ensureOrganization();
  const lead = await ensureLead(organization.id);
  const source = await ensureKnowledgeSource(organization.id);
  const chunkCount = await ensureKnowledgeChunks(organization.id, source.id);
  const campaign = await ensureCampaign(organization.id);
  await ensureAnalyticsRow(organization.id, campaign.id);
  await ensureOptimization(organization.id, campaign.id);

  await prisma.agentMemory.createMany({
    data: [
      {
        organizationId: organization.id,
        scope: 'lead',
        leadId: lead.id,
        content: { note: 'Lead asked about pricing last week.' },
        metadata: { seed: true },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      {
        organizationId: organization.id,
        scope: 'session',
        sessionId: 'seed-session',
        content: { note: 'Session context for enterprise interest.' },
        metadata: { seed: true },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ],
    skipDuplicates: true,
  });

  await ensureAgentRun(organization.id, lead.id);

  console.log('Seed complete');
  console.log('organization_id:', organization.id);
  console.log('lead_id:', lead.id);
  console.log('knowledge_source_id:', source.id);
  console.log('knowledge_chunks:', chunkCount);
  console.log('campaign_id:', campaign.id);
};

seed()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
