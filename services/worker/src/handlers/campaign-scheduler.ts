import { prisma } from '@omini/database';
import { createQueue, defaultJobOptions, QUEUE_NAMES } from '@omini/queue';

const campaignQueue = createQueue(QUEUE_NAMES.campaignSends);

const resolveIntervalMs = () => {
  const raw = process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30000;
  }
  return Math.floor(parsed);
};

export const startCampaignScheduler = () => {
  const intervalMs = resolveIntervalMs();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const now = new Date();
      const dueCampaigns = await prisma.campaign.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: {
            lte: now,
          },
        },
        select: { id: true },
      });

      for (const campaign of dueCampaigns) {
        const updated = await prisma.campaign.updateMany({
          where: { id: campaign.id, status: 'scheduled' },
          data: { status: 'running', startedAt: now },
        });

        if (updated.count > 0) {
          await campaignQueue.add(
            'campaign.send',
            { campaignId: campaign.id },
            defaultJobOptions
          );
        }
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
