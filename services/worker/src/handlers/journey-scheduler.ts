import { prisma } from '@omini/database';
import { QUEUE_NAMES, createQueue, defaultJobOptions } from '@omini/queue';

const journeyQueue = createQueue(QUEUE_NAMES.journeyRuns);

const resolveIntervalMs = () => {
  const raw = process.env.JOURNEY_SCHEDULER_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60000;
  }
  return Math.floor(parsed);
};

const parseScheduleAt = (config: Record<string, unknown>) => {
  const raw = config.scheduleAt;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
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

export const startJourneyScheduler = () => {
  const intervalMs = resolveIntervalMs();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const now = new Date();
      const triggers = await prisma.journeyTrigger.findMany({
        where: {
          type: 'time',
          enabled: true,
          journey: { status: 'active' },
        },
        include: { journey: true },
      });

      for (const trigger of triggers) {
        const config =
          trigger.config && typeof trigger.config === 'object' && !Array.isArray(trigger.config)
            ? (trigger.config as Record<string, unknown>)
            : {};
        const scheduleAt = parseScheduleAt(config);
        if (!scheduleAt || scheduleAt > now) {
          continue;
        }

        if (trigger.lastFiredAt && scheduleAt <= trigger.lastFiredAt) {
          continue;
        }

        const leadId = typeof config.leadId === 'string' ? config.leadId : null;
        const channelId = typeof config.channelId === 'string' ? config.channelId : null;

        const leads = leadId
          ? await prisma.lead.findMany({
              where: { id: leadId, organizationId: trigger.organizationId },
            })
          : await prisma.lead.findMany({
              where: buildLeadWhere(trigger.organizationId, {
                stages: Array.isArray(config.stages) ? config.stages : [],
                tagsAll: Array.isArray(config.tagsAll)
                  ? (config.tagsAll as string[])
                  : [],
                sources: Array.isArray(config.sources) ? (config.sources as string[]) : [],
                lastActiveWithinDays:
                  typeof config.lastActiveWithinDays === 'number'
                    ? Math.floor(config.lastActiveWithinDays)
                    : null,
              }),
            });

        for (const lead of leads) {
          await journeyQueue.add(
            'journey.trigger',
            {
              type: 'trigger',
              triggerType: 'time',
              triggerId: trigger.id,
              organizationId: trigger.organizationId,
              leadId: lead.id,
              contactId: lead.contactId ?? undefined,
              channelId: channelId ?? undefined,
              tags: lead.tags ?? [],
              stage: lead.stage,
            },
            defaultJobOptions
          );
        }

        await prisma.journeyTrigger.update({
          where: { id: trigger.id },
          data: { lastFiredAt: now },
        });
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  return {
    stop: () => clearInterval(timer),
    intervalMs,
  };
};
