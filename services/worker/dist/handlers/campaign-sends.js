import { prisma, Prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
const outboundQueue = createQueue(QUEUE_NAMES.outboundMessages);
const normalizePhone = (phone) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
const resolveContact = (lead) => lead.contact ?? lead.conversation?.contact ?? null;
const resolveRecipient = (contact) => {
    if (contact.phone) {
        return normalizePhone(contact.phone);
    }
    const identifier = contact.identifiers.find((item) => item.platform === 'whatsapp');
    if (identifier?.externalId) {
        return normalizePhone(identifier.externalId);
    }
    return null;
};
const upsertConversation = async (input) => {
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
const buildLeadWhere = (organizationId, segment) => {
    const where = {
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
const isDuplicateCampaignSend = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
export const registerCampaignSendsWorker = () => createWorker(QUEUE_NAMES.campaignSends, async ({ data }) => {
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
            const latest = await prisma.campaign.findUnique({
                where: { id: campaign.id },
                select: { status: true },
            });
            if (latest?.status === 'canceled') {
                return;
            }
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
            for (const lead of leads) {
                const existing = await prisma.campaignSend.findUnique({
                    where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
                    select: { id: true },
                });
                if (existing) {
                    continue;
                }
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
                try {
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
                catch (error) {
                    if (isDuplicateCampaignSend(error)) {
                        continue;
                    }
                    throw error;
                }
            }
            offset += leads.length;
        }
        await prisma.campaign.updateMany({
            where: { id: campaign.id, status: { not: 'canceled' } },
            data: {
                status: 'completed',
                completedAt: new Date(),
            },
        });
    }
    catch (error) {
        await prisma.campaign.updateMany({
            where: { id: campaign.id, status: { not: 'canceled' } },
            data: {
                status: 'failed',
            },
        });
        throw error;
    }
});
//# sourceMappingURL=campaign-sends.js.map