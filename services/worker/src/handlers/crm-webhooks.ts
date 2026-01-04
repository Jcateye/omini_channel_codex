import crypto from 'node:crypto';

import { prisma } from '@omini/database';
import { createWorker, QUEUE_NAMES } from '@omini/queue';

export type CrmWebhookJob = {
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

type CrmWebhookConfig = {
  url: string;
  secret?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  mode?: 'live' | 'mock';
  events?: string[];
};

const buildSignature = (secret: string, body: string) => {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hash}`;
};

const resolveConfig = async (organizationId: string): Promise<CrmWebhookConfig | null> => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });

  if (!org?.settings || typeof org.settings !== 'object') {
    return null;
  }

  const settings = org.settings as Record<string, unknown>;
  const raw = settings.crmWebhook as Record<string, unknown> | undefined;

  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const mode = raw.mode === 'mock' ? 'mock' : 'live';
  const url = typeof raw.url === 'string' ? raw.url : mode === 'mock' ? 'mock' : undefined;

  if (!url) {
    return null;
  }

  return {
    url,
    secret: typeof raw.secret === 'string' ? raw.secret : undefined,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    headers: typeof raw.headers === 'object' ? (raw.headers as Record<string, string>) : undefined,
    mode,
    events: Array.isArray(raw.events) ? (raw.events as string[]) : undefined,
  };
};

export const registerCrmWebhooksWorker = () =>
  createWorker<CrmWebhookJob>(QUEUE_NAMES.crmWebhooks, async ({ data }) => {
    const config = await resolveConfig(data.organizationId);

    const delivery = await prisma.webhookDelivery.create({
      data: {
        organizationId: data.organizationId,
        eventType: data.eventType,
        targetUrl: config?.url ?? 'unconfigured',
        payload: data.payload,
        status: 'pending',
        attempt: 1,
      },
    });

    if (!config || config.enabled === false) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          errorMessage: 'CRM webhook not configured or disabled',
        },
      });
      return;
    }

    if (config.mode === 'mock') {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'success',
          responseCode: 200,
          errorMessage: null,
        },
      });
      return;
    }

    const body = JSON.stringify({
      eventType: data.eventType,
      data: data.payload,
      sentAt: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-omini-event': data.eventType,
      ...config.headers,
    };

    if (config.secret) {
      headers['x-omini-signature'] = buildSignature(config.secret, body);
    }

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
      });

      const status = response.ok ? 'success' : 'failed';

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          responseCode: response.status,
          errorMessage: response.ok ? null : response.statusText,
        },
      });
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
