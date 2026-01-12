import { registerCrmWebhooksWorker } from './handlers/crm-webhooks.js';
import { startCampaignScheduler } from './handlers/campaign-scheduler.js';
import { registerCampaignSendsWorker } from './handlers/campaign-sends.js';
import { registerInboundEventsWorker } from './handlers/inbound-events.js';
import { registerAgentRepliesWorker } from './handlers/agent-replies.js';
import { registerOutboundMessagesWorker } from './handlers/outbound-messages.js';
import { registerStatusEventsWorker } from './handlers/status-events.js';
import { registerAnalyticsMetricsWorker, startAnalyticsScheduler } from './handlers/analytics-metrics.js';
import { registerKnowledgeSyncWorker, startKnowledgeSyncScheduler, } from './handlers/knowledge-sync.js';
import { registerJourneyRunsWorker } from './handlers/journey-runs.js';
import { startJourneyScheduler } from './handlers/journey-scheduler.js';
import { registerAiInsightsWorker, startAiInsightsScheduler } from './handlers/ai-insights.js';
const inboundWorker = registerInboundEventsWorker();
const agentRepliesWorker = registerAgentRepliesWorker();
const crmWorker = registerCrmWebhooksWorker();
const outboundWorker = registerOutboundMessagesWorker();
const statusWorker = registerStatusEventsWorker();
const campaignWorker = registerCampaignSendsWorker();
const campaignScheduler = startCampaignScheduler();
const analyticsWorker = registerAnalyticsMetricsWorker();
const analyticsScheduler = startAnalyticsScheduler();
const knowledgeWorker = registerKnowledgeSyncWorker();
const knowledgeScheduler = startKnowledgeSyncScheduler();
const journeyWorker = registerJourneyRunsWorker();
const journeyScheduler = startJourneyScheduler();
const aiInsightsWorker = registerAiInsightsWorker();
const aiInsightsScheduler = startAiInsightsScheduler();
inboundWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Inbound job ${job.id} completed`);
});
inboundWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Inbound job ${job?.id ?? 'unknown'} failed`, err);
});
agentRepliesWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Agent reply job ${job.id} completed`);
});
agentRepliesWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Agent reply job ${job?.id ?? 'unknown'} failed`, err);
});
crmWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`CRM job ${job.id} completed`);
});
crmWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`CRM job ${job?.id ?? 'unknown'} failed`, err);
});
outboundWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Outbound job ${job.id} completed`);
});
outboundWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Outbound job ${job?.id ?? 'unknown'} failed`, err);
});
statusWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Status job ${job.id} completed`);
});
statusWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Status job ${job?.id ?? 'unknown'} failed`, err);
});
analyticsWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Analytics job ${job.id} completed`);
});
analyticsWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Analytics job ${job?.id ?? 'unknown'} failed`, err);
});
knowledgeWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Knowledge job ${job.id} completed`);
});
knowledgeWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Knowledge job ${job?.id ?? 'unknown'} failed`, err);
});
journeyWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Journey job ${job.id} completed`);
});
journeyWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Journey job ${job?.id ?? 'unknown'} failed`, err);
});
aiInsightsWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`AI insights job ${job.id} completed`);
});
aiInsightsWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`AI insights job ${job?.id ?? 'unknown'} failed`, err);
});
campaignWorker.getBullWorker()?.on('completed', (job) => {
    console.log(`Campaign job ${job.id} completed`);
});
campaignWorker.getBullWorker()?.on('failed', (job, err) => {
    console.error(`Campaign job ${job?.id ?? 'unknown'} failed`, err);
});
console.log(`Campaign scheduler running every ${campaignScheduler.intervalMs}ms`);
console.log(`Analytics scheduler running every ${analyticsScheduler.intervalMs}ms`);
console.log(`Knowledge sync scheduler running every ${knowledgeScheduler.intervalMs}ms`);
console.log(`Journey scheduler running every ${journeyScheduler.intervalMs}ms`);
console.log(`AI insights scheduler running every ${aiInsightsScheduler.intervalMs}ms`);
console.log('Worker listening for jobs');
//# sourceMappingURL=index.js.map