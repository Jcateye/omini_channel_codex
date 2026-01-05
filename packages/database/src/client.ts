import prismaPackage from '@prisma/client';

const { PrismaClient } = prismaPackage as typeof import('@prisma/client');

export const prisma = new PrismaClient();
