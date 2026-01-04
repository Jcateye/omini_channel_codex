import { prisma } from '@omini/database';
import { createApiKey } from '../services/api/src/auth.js';

const name = process.env.ORG_NAME ?? 'Default Org';
const slug = process.env.ORG_SLUG ?? 'default';
const apiKeyName = process.env.API_KEY_NAME ?? 'default';

const run = async () => {
  const organization = await prisma.organization.create({
    data: { name, slug },
  });

  const { apiKey, record } = await createApiKey(organization.id, apiKeyName);

  console.log('organization_id:', organization.id);
  console.log('organization_slug:', organization.slug);
  console.log('api_key_id:', record.id);
  console.log('api_key:', apiKey);
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
