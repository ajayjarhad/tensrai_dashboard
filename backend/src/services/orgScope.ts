import type { PrismaClient } from '@prisma/client';

// Everything belongs to an organization unless it is listed here, so a new model without an orgId
// fails on its first query rather than leaking. orgScope.test.ts holds every model to this rule.
// Only top-level queries are intercepted: nested `include` and nested writes are not scoped.
export const GLOBAL_MODELS = new Set(['Organization', 'Session']);

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

// The fields scoping reads and writes. Prisma types args as one union across every model and
// operation, and hands the result straight back to the query, so the args type passes through.
type ScopableArgs = { data?: unknown; update?: unknown; where?: object; create?: object };

export const scopeArgs = <Args>(
  model: string,
  operation: string,
  args: Args,
  orgId: string
): Args => {
  if (GLOBAL_MODELS.has(model)) return args;
  const fields = args as ScopableArgs | undefined;

  if (FILTERED_OPERATIONS.has(operation)) {
    assertNoOrgChange(fields?.data, orgId);
    assertNoOrgChange(fields?.update, orgId);
    const scoped: ScopableArgs = { ...fields, where: { ...fields?.where, orgId } };
    if (operation === 'upsert') scoped.create = { ...fields?.create, orgId };
    return scoped as Args;
  }
  if (operation === 'create') {
    return { ...fields, data: { ...(fields?.data as object), orgId } } as Args;
  }
  if (operation === 'createMany') {
    const rows = [fields?.data].flat() as object[];
    return { ...fields, data: rows.map(row => ({ ...row, orgId })) } as Args;
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
