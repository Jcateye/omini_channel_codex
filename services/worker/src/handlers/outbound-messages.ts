import { prisma } from '@omini/database';
import { createWorker, QUEUE_NAMES } from '@omini/queue';
import { getWhatsAppAdapter } from '@omini/whatsapp-bsp';

export type OutboundMessageJob = {
  messageId: string;
};

const resolveRecipient = (
  content: Record<string, unknown> | null,
  contact: { phone?: string | null } | null
) => {
  const to = typeof content?.to === 'string' ? content.to.trim() : '';
  if (to) {
    return to;
  }

  if (contact?.phone) {
    return contact.phone;
  }

  return null;
};

export const registerOutboundMessagesWorker = () =>
  createWorker<OutboundMessageJob>(QUEUE_NAMES.outboundMessages, async (job) => {
    if (!job.data?.messageId) {
      throw new Error('Outbound message missing messageId');
    }

    const message = await prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: {
        channel: true,
        contact: true,
      },
    });

    if (!message) {
      throw new Error(`Message ${job.data.messageId} not found`);
    }

    if (message.direction !== 'outbound') {
      return;
    }

    if (message.channel.platform !== 'whatsapp') {
      return;
    }

    if (!message.channel.provider) {
      throw new Error(`Channel ${message.channelId} missing provider`);
    }

    const provider = message.channel.provider.toLowerCase();
    const adapter = getWhatsAppAdapter(provider);
    if (!adapter?.sendText) {
      throw new Error(`Unsupported WhatsApp provider: ${message.channel.provider}`);
    }

    const content =
      message.content && typeof message.content === 'object' && !Array.isArray(message.content)
        ? (message.content as Record<string, unknown>)
        : null;

    const text = typeof content?.text === 'string' ? content.text.trim() : '';
    if (!text) {
      throw new Error('Outbound message missing text');
    }

    const to = resolveRecipient(content, message.contact);
    if (!to) {
      throw new Error('Outbound message missing recipient');
    }

    try {
      const result = await adapter.sendText({
        to,
        text,
        channel: {
          id: message.channel.id,
          externalId: message.channel.externalId,
          credentials: message.channel.credentials as Record<string, unknown>,
          settings:
            message.channel.settings && typeof message.channel.settings === 'object'
              ? (message.channel.settings as Record<string, unknown>)
              : null,
          metadata:
            message.channel.metadata && typeof message.channel.metadata === 'object'
              ? (message.channel.metadata as Record<string, unknown>)
              : null,
        },
      });

      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'sent',
          externalId: result.providerMessageId,
          sentAt: new Date(),
          rawPayload: {
            request: {
              to,
              text,
            },
            response: result.rawResponse ?? null,
          },
        },
      });

      const campaignSend = await prisma.campaignSend.findFirst({
        where: { messageId: message.id },
      });

      if (campaignSend) {
        await prisma.$transaction([
          prisma.campaignSend.update({
            where: { id: campaignSend.id },
            data: {
              status: 'sent',
              errorMessage: null,
            },
          }),
          prisma.campaign.update({
            where: { id: campaignSend.campaignId },
            data: { totalSent: { increment: 1 } },
          }),
        ]);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isFinalAttempt = job.attempts + 1 >= job.maxAttempts;

      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: isFinalAttempt ? 'failed' : message.status,
          rawPayload: {
            error: errorMessage,
            attempt: job.attempts + 1,
            provider,
          },
        },
      });

      if (isFinalAttempt) {
        const campaignSend = await prisma.campaignSend.findFirst({
          where: { messageId: message.id },
        });

        if (campaignSend) {
          await prisma.$transaction([
            prisma.campaignSend.update({
              where: { id: campaignSend.id },
              data: {
                status: 'failed',
                errorMessage,
              },
            }),
            prisma.campaign.update({
              where: { id: campaignSend.campaignId },
              data: { totalFailed: { increment: 1 } },
            }),
          ]);
        }
      }

      throw error;
    }
  });
