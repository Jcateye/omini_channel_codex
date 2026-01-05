import { registerCrmWebhooksWorker } from './handlers/crm-webhooks.js';
import { startCampaignScheduler } from './handlers/campaign-scheduler.js';
import { registerCampaignSendsWorker } from './handlers/campaign-sends.js';
import { registerInboundEventsWorker } from './handlers/inbound-events.js';
import { registerAgentRepliesWorker } from './handlers/agent-replies.js';
import { registerOutboundMessagesWorker } from './handlers/outbound-messages.js';
import { registerStatusEventsWorker } from './handlers/status-events.js';

const inboundWorker = registerInboundEventsWorker();
const agentRepliesWorker = registerAgentRepliesWorker();
const crmWorker = registerCrmWebhooksWorker();
const outboundWorker = registerOutboundMessagesWorker();
const statusWorker = registerStatusEventsWorker();
const campaignWorker = registerCampaignSendsWorker();
const campaignScheduler = startCampaignScheduler();

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

campaignWorker.getBullWorker()?.on('completed', (job) => {
  console.log(`Campaign job ${job.id} completed`);
});

campaignWorker.getBullWorker()?.on('failed', (job, err) => {
  console.error(`Campaign job ${job?.id ?? 'unknown'} failed`, err);
});

console.log(`Campaign scheduler running every ${campaignScheduler.intervalMs}ms`);

console.log('Worker listening for jobs');
