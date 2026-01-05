import { prisma } from '@omini/database';
import { createWorker, QUEUE_NAMES } from '@omini/queue';
import { getWhatsAppAdapter, type StatusEvent } from '@omini/whatsapp-bsp';

type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type StatusWebhookJob = {
  channelId: string;
  payload: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string>;
};

const statusRank: Record<MessageStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 1,
};

const shouldUpdateStatus = (current: MessageStatus, next: MessageStatus) => {
  if (current === next) return false;
  if (current === 'failed') return false;
  if (next === 'failed') {
    return current === 'pending' || current === 'sent';
  }

  return (statusRank[next] ?? 0) >= (statusRank[current] ?? 0);
};

const mergeStatusPayload = (existing: unknown, update: StatusEvent) => {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  return {
    ...base,
    statusUpdate: {
      status: update.status,
      providerMessageId: update.providerMessageId,
      occurredAt: update.occurredAt ? update.occurredAt.toISOString() : undefined,
      errorMessage: update.errorMessage,
      payload: update.rawPayload,
    },
  };
};

export const registerStatusEventsWorker = () =>
  createWorker<StatusWebhookJob>(QUEUE_NAMES.statusEvents, async (job) => {
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

    const currentStatus = message.status as MessageStatus;
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
