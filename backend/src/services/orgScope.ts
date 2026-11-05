import type { PrismaClient } from '@prisma/client';

// Everything belongs to an organization unless it is listed here, so a new model without an orgId
// fails on its first query rather than leaking. orgScope.test.ts holds every model to this rule.
// Only top-level queries are intercepted: nested `include` and nested writes are not scoped.
export const GLOBAL_MODELS = new Set(['Organization', 'Account', 'Session', 'Verification']);

const FILTERED_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

const assertNoOrgChange = (data: unknown, orgId: string) => {
  if (data && typeof data === 'object' && 'orgId' in data && data.orgId !== orgId) {
    throw new Error('orgId cannot be changed through a scoped client');
  }
};

export const scopeArgs = (model: string, operation: string, args: any, orgId: string) => {
  if (GLOBAL_MODELS.has(model)) return args;

  if (FILTERED_OPERATIONS.has(operation)) {
    assertNoOrgChange(args?.data, orgId);
    assertNoOrgChange(args?.update, orgId);
    const scoped = { ...args, where: { ...args?.where, orgId } };
    if (operation === 'upsert') scoped.create = { ...args.create, orgId };
    return scoped;
  }
  if (operation === 'create') return { ...args, data: { ...args.data, orgId } };
  if (operation === 'createMany') {
    return { ...args, data: [args.data].flat().map((row: object) => ({ ...row, orgId })) };
  }
  // A new Prisma operation must be handled above before tenant models can use it.
  throw new Error(`${operation} is not allowed on ${model} through a scoped client`);
};

// A query-only extension leaves every model's shape unchanged, so the scoped client keeps the
// PrismaClient type and can be handed to any code that takes one.
export type ScopedPrisma = PrismaClient;

const createScopedClient = (prisma: PrismaClient, orgId: string): ScopedPrisma =>
  prisma.$extends({
    query: {
      $allModels: {
        $allOperations: ({ model, operation, args, query }) =>
          query(scopeArgs(model, operation, args, orgId)),
      },
    },
  }) as unknown as ScopedPrisma;

const clientsByPrisma = new WeakMap<PrismaClient, Map<string, ScopedPrisma>>();

// Every query through the returned client is confined to one organization.
export const scopedPrisma = (prisma: PrismaClient, orgId: string): ScopedPrisma => {
  let clients = clientsByPrisma.get(prisma);
  if (!clients) {
    clients = new Map();
    clientsByPrisma.set(prisma, clients);
  }
  let client = clients.get(orgId);
  if (!client) {
    client = createScopedClient(prisma, orgId);
    clients.set(orgId, client);
  }
  return client;
};
