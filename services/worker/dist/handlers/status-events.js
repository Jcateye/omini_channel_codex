import { prisma, Prisma } from '@omini/database';
import { createWorker, QUEUE_NAMES } from '@omini/queue';
import { getWhatsAppAdapter } from '@omini/whatsapp-bsp';
const statusRank = {
    pending: 0,
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 1,
};
const shouldUpdateStatus = (current, next) => {
    if (current === next)
        return false;
    if (current === 'failed')
        return false;
    if (next === 'failed') {
        return current === 'pending' || current === 'sent';
    }
    return (statusRank[next] ?? 0) >= (statusRank[current] ?? 0);
};
const mergeStatusPayload = (existing, update) => {
    const base = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing
        : {};
    const statusUpdate = {
        status: update.status,
        providerMessageId: update.providerMessageId,
        payload: update.rawPayload,
    };
    if (update.occurredAt) {
        statusUpdate.occurredAt = update.occurredAt.toISOString();
    }
    if (update.errorMessage) {
        statusUpdate.errorMessage = update.errorMessage;
    }
    return {
        ...base,
        statusUpdate,
    };
};
export const registerStatusEventsWorker = () => createWorker(QUEUE_NAMES.statusEvents, async (job) => {
    if (!job.data?.channelId) {
        throw new Error('Status webhook missing channelId');
    }
    const channel = await prisma.channel.findUnique({
        where: { id: job.data.channelId },
    });
    if (!channel) {
        throw new Error(`Channel ${job.data.channelId} not found`);
    }
    if (channel.platform !== 'whatsapp') {
        return;
    }
    if (!channel.provider) {
        throw new Error(`Channel ${channel.id} missing provider`);
    }
    const adapter = getWhatsAppAdapter(channel.provider.toLowerCase());
    if (!adapter?.parseStatus) {
        throw new Error(`Unsupported WhatsApp provider: ${channel.provider}`);
    }
    const statusEvent = adapter.parseStatus(job.data.payload);
    if (!statusEvent) {
        return;
    }
    const message = await prisma.message.findFirst({
        where: {
            channelId: channel.id,
            externalId: statusEvent.providerMessageId,
        },
    });
    if (!message) {
        return;
    }
    const currentStatus = message.status;
    const nextStatus = statusEvent.status;
    if (!shouldUpdateStatus(currentStatus, nextStatus)) {
        return;
    }
    await prisma.message.update({
        where: { id: message.id },
        data: {
            status: nextStatus,
            rawPayload: mergeStatusPayload(message.rawPayload, statusEvent),
        },
    });
});
//# sourceMappingURL=status-events.js.map