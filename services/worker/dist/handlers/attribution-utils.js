import { prisma, Prisma } from '@omini/database';
const addDays = (value, days) => {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
};
export const computeLeadAttribution = async (organizationId, convertedLeads, lookbackDays) => {
    const models = ['first_touch', 'last_touch', 'linear'];
    for (const lead of convertedLeads) {
        if (!lead.convertedAt)
            continue;
        const cutoff = addDays(lead.convertedAt, -lookbackDays);
        const [campaignSends, journeySteps] = await Promise.all([
            prisma.campaignSend.findMany({
                where: {
                    organizationId,
                    leadId: lead.id,
                    createdAt: { gte: cutoff, lte: lead.convertedAt },
                    messageId: { not: null },
                },
                include: { message: true },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.journeyRunStep.findMany({
                where: {
                    organizationId,
                    messageId: { not: null },
                    createdAt: { gte: cutoff, lte: lead.convertedAt },
                    run: { leadId: lead.id },
                },
                include: {
                    message: true,
                    run: { select: { id: true, journeyId: true, channelId: true } },
                },
                orderBy: { createdAt: 'asc' },
            }),
        ]);
        const touchpointMap = new Map();
        for (const send of campaignSends) {
            const messageId = send.messageId ?? send.message?.id ?? null;
            const key = messageId ?? `campaign:${send.id}`;
            const touchedAt = send.message?.createdAt ?? send.createdAt;
            touchpointMap.set(key, {
                messageId,
                campaignId: send.campaignId ?? null,
                journeyId: null,
                journeyRunId: null,
                channelId: send.message?.channelId ?? null,
                touchedAt,
            });
        }
        for (const step of journeySteps) {
            const messageId = step.messageId ?? step.message?.id ?? null;
            const key = messageId ?? `journey:${step.id}`;
            const touchedAt = step.message?.createdAt ?? step.createdAt;
            touchpointMap.set(key, {
                messageId,
                campaignId: null,
                journeyId: step.run?.journeyId ?? null,
                journeyRunId: step.run?.id ?? null,
                channelId: step.message?.channelId ?? step.run?.channelId ?? null,
                touchedAt,
            });
        }
        const touchpoints = Array.from(touchpointMap.values()).sort((a, b) => a.touchedAt.getTime() - b.touchedAt.getTime());
        await prisma.attributionTouchpoint.deleteMany({
            where: {
                organizationId,
                leadId: lead.id,
                model: { in: models },
            },
        });
        if (touchpoints.length === 0) {
            await prisma.leadAttribution.deleteMany({
                where: { organizationId, leadId: lead.id, model: 'last_touch' },
            });
            continue;
        }
        const firstTouch = touchpoints[0];
        const lastTouch = touchpoints[touchpoints.length - 1];
        const linearWeight = 1 / touchpoints.length;
        const touchpointRows = [
            {
                organizationId,
                leadId: lead.id,
                model: 'first_touch',
                campaignId: firstTouch.campaignId,
                journeyId: firstTouch.journeyId,
                journeyRunId: firstTouch.journeyRunId,
                messageId: firstTouch.messageId,
                channelId: firstTouch.channelId,
                weight: 1,
                touchedAt: firstTouch.touchedAt,
            },
            {
                organizationId,
                leadId: lead.id,
                model: 'last_touch',
                campaignId: lastTouch.campaignId,
                journeyId: lastTouch.journeyId,
                journeyRunId: lastTouch.journeyRunId,
                messageId: lastTouch.messageId,
                channelId: lastTouch.channelId,
                weight: 1,
                touchedAt: lastTouch.touchedAt,
            },
            ...touchpoints.map((touchpoint) => ({
                organizationId,
                leadId: lead.id,
                model: 'linear',
                campaignId: touchpoint.campaignId,
                journeyId: touchpoint.journeyId,
                journeyRunId: touchpoint.journeyRunId,
                messageId: touchpoint.messageId,
                channelId: touchpoint.channelId,
                weight: linearWeight,
                touchedAt: touchpoint.touchedAt,
            })),
        ];
        await prisma.attributionTouchpoint.createMany({
            data: touchpointRows,
        });
        await prisma.leadAttribution.upsert({
            where: { leadId_model: { leadId: lead.id, model: 'last_touch' } },
            create: {
                organizationId,
                leadId: lead.id,
                campaignId: lastTouch.campaignId,
                journeyId: lastTouch.journeyId,
                messageId: lastTouch.messageId,
                channelId: lastTouch.channelId,
                model: 'last_touch',
                attributedAt: lead.convertedAt,
            },
            update: {
                campaignId: lastTouch.campaignId,
                journeyId: lastTouch.journeyId,
                messageId: lastTouch.messageId,
                channelId: lastTouch.channelId,
                attributedAt: lead.convertedAt,
            },
        });
    }
};
//# sourceMappingURL=attribution-utils.js.map