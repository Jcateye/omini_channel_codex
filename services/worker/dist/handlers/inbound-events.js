import { applyLeadRules } from '@omini/core';
import { prisma, Prisma } from '@omini/database';
import { createQueue, createWorker, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';
import { getWhatsAppAdapter } from '@omini/whatsapp-bsp';
import { enqueueJourneyTrigger } from './journey-runs.js';
const crmQueue = createQueue(QUEUE_NAMES.crmWebhooks);
const agentRepliesQueue = createQueue(QUEUE_NAMES.agentReplies);
const normalizePhone = (phone) => phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
const applyConversionUpdate = (currentStage, updates) => {
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
const loadOrganizationSettings = async (organizationId) => {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
    });
    return organization?.settings ?? {};
};
const getLeadRulesFromSettings = (settings) => {
    const raw = settings.leadRules;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((rule) => rule && typeof rule === 'object');
};
const shouldSendCrmEvent = (settings, eventType) => {
    const raw = settings.crmWebhook;
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
const enqueueCrmWebhook = async (organizationId, eventType, payload, settings) => {
    if (!shouldSendCrmEvent(settings, eventType)) {
        return;
    }
    await crmQueue.add('crm.webhook', {
        organizationId,
        eventType,
        payload,
    }, defaultJobOptions);
};
const findOrCreateContact = async (organizationId, phone, name) => {
    const identifier = await prisma.contactIdentifier.findUnique({
        where: {
            organizationId_platform_externalId: {
                organizationId,
                platform: 'whatsapp',
                externalId: phone,
            },
        },
        include: { contact: true },
    });
    if (identifier?.contact) {
        const updates = {};
        if (!identifier.contact.name && name) {
            updates.name = name;
        }
        if (!identifier.contact.phone) {
            updates.phone = phone;
        }
        if (Object.keys(updates).length > 0) {
            await prisma.contact.update({
                where: { id: identifier.contact.id },
                data: updates,
            });
        }
        return identifier.contact;
    }
    return prisma.contact.create({
        data: {
            organizationId,
            name: name ?? null,
            phone,
            identifiers: {
                create: {
                    organization: { connect: { id: organizationId } },
                    platform: 'whatsapp',
                    externalId: phone,
                    handle: phone,
                },
            },
        },
    });
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
            lastMessageAt: input.lastMessageAt,
        },
        update: {
            lastMessageAt: input.lastMessageAt,
            status: 'open',
        },
    });
};
const findOrCreateLead = async (organizationId, contactId, conversationId) => {
    const existing = await prisma.lead.findFirst({
        where: {
            organizationId,
            conversationId,
        },
    });
    if (existing) {
        const lead = await prisma.lead.update({
            where: { id: existing.id },
            data: { lastActivityAt: new Date() },
        });
        return { lead, created: false };
    }
    const lead = await prisma.lead.create({
        data: {
            organizationId,
            contactId,
            conversationId,
            stage: 'new',
            lastActivityAt: new Date(),
        },
    });
    return { lead, created: true };
};
const extractMessageText = (message) => message?.text?.trim();
const handleMessageEvent = async (channel, parsed) => {
    const settings = await loadOrganizationSettings(channel.organizationId);
    const leadRules = getLeadRulesFromSettings(settings);
    const normalizedPhone = normalizePhone(parsed.senderExternalId);
    const contact = await findOrCreateContact(channel.organizationId, normalizedPhone, parsed.senderName);
    const conversation = await upsertConversation({
        organizationId: channel.organizationId,
        channelId: channel.id,
        contactId: contact.id,
        externalId: normalizedPhone,
        lastMessageAt: parsed.timestamp,
    });
    const messageData = {
        organizationId: channel.organizationId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: contact.id,
        platform: 'whatsapp',
        type: 'text',
        direction: 'inbound',
        status: 'delivered',
        content: { text: parsed.text ?? '' },
        rawPayload: parsed.rawPayload,
        sentAt: parsed.timestamp,
    };
    if (typeof parsed.externalId === 'string') {
        messageData.externalId = parsed.externalId;
    }
    const inboundMessage = await prisma.message.create({
        data: messageData,
    });
    const { lead, created } = await findOrCreateLead(channel.organizationId, contact.id, conversation.id);
    const previousTags = lead.tags ?? [];
    const previousStage = lead.stage;
    let updatedLead = lead;
    let ruleResult = null;
    let appliedUpdates = null;
    if (leadRules.length > 0) {
        const messageText = extractMessageText(parsed);
        const ruleContext = { signals: [] };
        if (messageText) {
            ruleContext.text = messageText;
        }
        ruleResult = applyLeadRules({
            tags: lead.tags,
            stage: lead.stage,
            score: lead.score,
            source: lead.source,
            metadata: lead.metadata && typeof lead.metadata === 'object' && !Array.isArray(lead.metadata)
                ? lead.metadata
                : null,
        }, leadRules, ruleContext);
        if (Object.keys(ruleResult.updates).length > 0) {
            const updates = applyConversionUpdate(lead.stage, ruleResult.updates);
            appliedUpdates = updates;
            updatedLead = await prisma.lead.update({
                where: { id: lead.id },
                data: updates,
            });
        }
    }
    const tagsChanged = previousTags.length !== (updatedLead.tags ?? []).length ||
        previousTags.some((tag) => !(updatedLead.tags ?? []).includes(tag));
    const stageChanged = previousStage !== updatedLead.stage;
    const baseTrigger = {
        type: 'trigger',
        triggerType: 'inbound_message',
        organizationId: channel.organizationId,
        leadId: updatedLead.id,
        contactId: contact.id,
        channelId: channel.id,
        conversationId: conversation.id,
        messageId: inboundMessage.id,
        tags: updatedLead.tags ?? [],
        stage: updatedLead.stage,
    };
    if (typeof parsed.text === 'string') {
        baseTrigger.text = parsed.text;
    }
    await enqueueJourneyTrigger(baseTrigger);
    if (tagsChanged) {
        const tagTrigger = { ...baseTrigger, triggerType: 'tag_change' };
        await enqueueJourneyTrigger(tagTrigger);
    }
    if (stageChanged) {
        const stageTrigger = { ...baseTrigger, triggerType: 'stage_change' };
        await enqueueJourneyTrigger(stageTrigger);
    }
    if (created) {
        await enqueueCrmWebhook(channel.organizationId, 'lead.created', {
            lead: updatedLead,
            contact,
            conversation,
            matchedRules: ruleResult?.matchedRules ?? [],
            changes: appliedUpdates && Object.keys(appliedUpdates).length > 0
                ? appliedUpdates
                : undefined,
        }, settings);
        const replyContext = {
            organizationId: channel.organizationId,
            channelId: channel.id,
            conversationId: conversation.id,
            contactId: contact.id,
            leadId: updatedLead.id,
            messageId: inboundMessage.id,
            platform: channel.platform,
        };
        const replyJob = {
            context: { ...replyContext },
        };
        replyJob.context.provider = channel.provider;
        if (typeof parsed.text === 'string') {
            replyJob.context.text = parsed.text;
        }
        replyJob.context.tags = updatedLead.tags ?? [];
        replyJob.context.stage = updatedLead.stage;
        if (updatedLead.source !== undefined) {
            replyJob.context.source = updatedLead.source;
        }
        await agentRepliesQueue.add('agent.reply', replyJob, defaultJobOptions);
        return;
    }
    if (ruleResult && Object.keys(ruleResult.updates).length > 0) {
        await enqueueCrmWebhook(channel.organizationId, 'lead.updated', {
            lead: updatedLead,
            contact,
            conversation,
            matchedRules: ruleResult.matchedRules,
            changes: appliedUpdates ?? ruleResult.updates,
        }, settings);
    }
    const replyContext = {
        organizationId: channel.organizationId,
        channelId: channel.id,
        conversationId: conversation.id,
        contactId: contact.id,
        leadId: updatedLead.id,
        messageId: inboundMessage.id,
        platform: channel.platform,
    };
    const replyJob = {
        context: { ...replyContext },
    };
    replyJob.context.provider = channel.provider;
    if (typeof parsed.text === 'string') {
        replyJob.context.text = parsed.text;
    }
    replyJob.context.tags = updatedLead.tags ?? [];
    replyJob.context.stage = updatedLead.stage;
    if (updatedLead.source !== undefined) {
        replyJob.context.source = updatedLead.source;
    }
    await agentRepliesQueue.add('agent.reply', replyJob, defaultJobOptions);
};
export const registerInboundEventsWorker = () => createWorker(QUEUE_NAMES.inboundEvents, async ({ data }) => {
    if (!data?.channelId) {
        throw new Error('Inbound webhook missing channelId');
    }
    const channel = await prisma.channel.findUnique({
        where: { id: data.channelId },
    });
    if (!channel) {
        throw new Error(`Channel ${data.channelId} not found`);
    }
    if (channel.platform !== 'whatsapp') {
        return;
    }
    if (!channel.provider) {
        throw new Error(`Channel ${channel.id} missing provider`);
    }
    const adapter = getWhatsAppAdapter(channel.provider.toLowerCase());
    if (!adapter) {
        throw new Error(`Unsupported WhatsApp provider: ${channel.provider}`);
    }
    const parsed = adapter.parseInbound(data.payload);
    if (!parsed) {
        return;
    }
    await handleMessageEvent(channel, parsed);
});
//# sourceMappingURL=inbound-events.js.map