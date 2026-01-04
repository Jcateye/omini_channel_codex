import { registerCrmWebhooksWorker } from './handlers/crm-webhooks.js';
import { registerInboundEventsWorker } from './handlers/inbound-events.js';

const inboundWorker = registerInboundEventsWorker();
const crmWorker = registerCrmWebhooksWorker();

inboundWorker.getBullWorker()?.on('completed', (job) => {
  console.log(`Inbound job ${job.id} completed`);
});

inboundWorker.getBullWorker()?.on('failed', (job, err) => {
  console.error(`Inbound job ${job?.id ?? 'unknown'} failed`, err);
});

crmWorker.getBullWorker()?.on('completed', (job) => {
  console.log(`CRM job ${job.id} completed`);
});

crmWorker.getBullWorker()?.on('failed', (job, err) => {
  console.error(`CRM job ${job?.id ?? 'unknown'} failed`, err);
});

console.log('Worker listening for jobs');
