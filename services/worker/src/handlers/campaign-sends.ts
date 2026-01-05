import { prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

export type CampaignSendJob = {
  campaignId: string;
};

type LeadWithRelations = {
  id: string;
  contact?: {
    id: string;
    name?: string | null;
    phone?: string | null;
    identifiers: Array<{ platform: string; externalId: string }>;
  } | null;
  conversation?: {
    contact?: {
      id: string;
      name?: string | null;
      phone?: string | null;
      identifiers: Array<{ platform: string; externalId: string }>;
    } | null;
  } | null;
};

const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);

const normalizePhone = (phone: string) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

const resolveContact = (lead: LeadWithRelations) => lead.contact ?? lead.conversation?.contact ?? null;

const resolveRecipient = (contact: NonNullable<ReturnType<typeof resolveContact>>) => {
  if (contact.phone) {
    return normalizePhone(contact.phone);
  }

  const identifier = contact.identifiers.find((item) => item.platform === 'whatsapp');
  if (identifier?.externalId) {
    return normalizePhone(identifier.externalId);
  }

  return null;
};

const upsertConversation = async (input: {
  organizationId: string;
  channelId: string;
  contactId: string;
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
      platform: 'whatsapp',
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

const buildLeadWhere = (organizationId: string, segment: {
  stages: Array<unknown>;
  tagsAll: string[];
  sources: string[];
  lastActiveWithinDays: number | null;
}) => {
  const where: Record<string, unknown> = {
    organizationId,
  };

  if (segment.stages.length > 0) {
    where.stage = { in: segment.stages };
  }

  if (segment.tagsAll.length > 0) {
    where.tags = { hasEvery: segment.tagsAll };
  }

  if (segment.sources.length > 0) {
    where.source = { in: segment.sources };
  }

  if (segment.lastActiveWithinDays) {
    const cutoff = new Date(Date.now() - segment.lastActiveWithinDays * 24 * 60 * 60 * 1000);
    where.OR = [
      { lastActivityAt: { gte: cutoff } },
      { lastActivityAt: null, createdAt: { gte: cutoff } },
    ];
  }

  return where;
};

export const registerCampaignSendsWorker = () =>
  createWorker<CampaignSendJob>(QUEUE_NAMES.campaignSends, async ({ data }) => {
    if (!data?.campaignId) {
      throw new Error('Campaign send job missing campaignId');
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: data.campaignId },
      include: {
        segment: true,
        channel: true,
      },
    });

    if (!campaign) {
      throw new Error(`Campaign ${data.campaignId} not found`);
    }

    if (campaign.status === 'completed' || campaign.status === 'canceled') {
      return;
    }

    if (campaign.channel.platform !== 'whatsapp') {
      throw new Error('Campaign channel is not WhatsApp');
    }

    const segment = campaign.segment;
    const where = buildLeadWhere(campaign.organizationId, {
      stages: segment?.stages ?? [],
      tagsAll: segment?.tagsAll ?? [],
      sources: segment?.sources ?? [],
      lastActiveWithinDays: segment?.lastActiveWithinDays ?? null,
    });

    const pageSize = 200;
    let offset = 0;

    try {
      while (true) {
        const leads = await prisma.lead.findMany({
          where,
          take: pageSize,
          skip: offset,
          include: {
            contact: {
              include: { identifiers: true },
            },
            conversation: {
              include: {
                contact: {
                  include: { identifiers: true },
                },
              },
            },
          },
        });

        if (leads.length === 0) {
          break;
        }

        for (const lead of leads as unknown as LeadWithRelations[]) {
          const contact = resolveContact(lead);
          if (!contact) {
            await prisma.$transaction([
              prisma.campaignSend.create({
                data: {
                  organizationId: campaign.organizationId,
                  campaignId: campaign.id,
                  leadId: lead.id,
                  status: 'skipped',
                  errorMessage: 'missing_contact',
                },
              }),
              prisma.campaign.update({
                where: { id: campaign.id },
                data: { totalSkipped: { increment: 1 } },
              }),
            ]);
            continue;
          }

          const recipient = resolveRecipient(contact);
          if (!recipient) {
            await prisma.$transaction([
              prisma.campaignSend.create({
                data: {
                  organizationId: campaign.organizationId,
                  campaignId: campaign.id,
                  leadId: lead.id,
                  status: 'skipped',
                  errorMessage: 'missing_recipient',
                },
              }),
              prisma.campaign.update({
                where: { id: campaign.id },
                data: { totalSkipped: { increment: 1 } },
              }),
            ]);
            continue;
          }

          const conversation = await upsertConversation({
            organizationId: campaign.organizationId,
            channelId: campaign.channelId,
            contactId: contact.id,
            externalId: recipient,
          });

          const result = await prisma.$transaction(async (tx) => {
            const message = await tx.message.create({
              data: {
                organizationId: campaign.organizationId,
                conversationId: conversation.id,
                channelId: campaign.channelId,
                contactId: contact.id,
                platform: 'whatsapp',
                type: 'text',
                direction: 'outbound',
                status: 'pending',
                content: {
                  text: campaign.messageText,
                  campaignId: campaign.id,
                  campaignName: campaign.name,
                },
              },
            });

            const campaignSend = await tx.campaignSend.create({
              data: {
                organizationId: campaign.organizationId,
                campaignId: campaign.id,
                leadId: lead.id,
                messageId: message.id,
                status: 'queued',
              },
            });

            await tx.campaign.update({
              where: { id: campaign.id },
              data: { totalQueued: { increment: 1 } },
            });

            return { message, campaignSend };
          });

          await outboundQueue.add('wa.send', { messageId: result.message.id }, defaultJobOptions);
        }

        offset += leads.length;
      }

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'failed',
        },
      });

      throw error;
    }
  });
