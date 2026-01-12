import { prisma } from '@omini/database';
import { computeLeadAttribution } from '../services/worker/src/handlers/attribution-utils.js';

const parseArgValue = (prefix: string) => {
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
};

const daysRaw = parseArgValue('--days=');
const lookbackRaw = parseArgValue('--lookback-days=');
const orgId = parseArgValue('--org=');

const days = daysRaw ? Number(daysRaw) : 30;
const lookbackDays = lookbackRaw ? Number(lookbackRaw) : 7;

if (!Number.isFinite(days) || days <= 0) {
  console.error('Invalid --days value');
  process.exit(1);
}

if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
  console.error('Invalid --lookback-days value');
  process.exit(1);
}

const run = async () => {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const organizations = orgId
    ? await prisma.organization.findMany({ where: { id: orgId }, select: { id: true } })
    : await prisma.organization.findMany({ select: { id: true } });

  for (const organization of organizations) {
    const convertedLeads = await prisma.lead.findMany({
      where: {
        organizationId: organization.id,
        convertedAt: { gte: start, lt: end },
      },
      select: { id: true, convertedAt: true },
    });

    if (convertedLeads.length === 0) {
      console.log(`No conversions for org ${organization.id}`);
      continue;
    }

    await computeLeadAttribution(organization.id, convertedLeads, Math.floor(lookbackDays));
    console.log(`Backfilled ${convertedLeads.length} conversions for org ${organization.id}`);
  }
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
