import fastify from 'fastify';

export const ORG_A = '64b000000000000000000a01';
export const ORG_B = '64b000000000000000000b02';

const baseUser = {
  username: 'tester',
  email: 'tester@example.com',
  displayName: null,
  isActive: true,
  mustResetPassword: false,
  orgId: ORG_A as string | null,
};

export const TEST_USERS = {
  admin: { ...baseUser, id: 'u-admin', role: 'ADMIN' },
  user: { ...baseUser, id: 'u-user', role: 'USER' },
  disabled: { ...baseUser, id: 'u-disabled', role: 'USER', isActive: false },
  needsReset: { ...baseUser, id: 'u-reset', role: 'USER', mustResetPassword: true },
  noOrg: { ...baseUser, id: 'u-no-org', role: 'USER', orgId: null },
  otherOrgUser: { ...baseUser, id: 'u-other', role: 'USER', orgId: ORG_B },
  otherOrgAdmin: { ...baseUser, id: 'u-other-admin', role: 'ADMIN', orgId: ORG_B },
} as const;

type TestUserKey = keyof typeof TEST_USERS;

export const asUser = (key: TestUserKey) => ({ 'x-test-user': key });

// Same cast as index.ts: fastify's default export has no call signature under NodeNext.
const createFastify = fastify as unknown as () => any;

// A Fastify app whose session comes from the x-test-user header (none means logged out),
// standing in for the auth plugin. request.db passes straight through to app.prisma: org
// scoping of queries is covered by orgScope.test.ts, so the fakes below filter by org themselves
// where a test needs ownership to matter.
export const createTestApp = () => {
  const app = createFastify();
  app.decorateRequest('getCurrentUser', async function (this: any) {
    return TEST_USERS[this.headers['x-test-user'] as TestUserKey] ?? null;
  });
  app.decorateRequest('orgId', null);
  app.decorateRequest('db', {
    getter(this: any) {
      return this.server.prisma;
    },
  });
  return app;
};

type FakeRobot = { id: string; orgId: string };

// In-memory stand-in for prisma.robot; a malformed id throws like the real driver does.
export const fakeRobotModel = (rows: FakeRobot[]) => ({
  findFirst: async ({ where }: { where: Partial<FakeRobot> }) => {
    if (where.id === 'bad') throw new Error('Malformed ObjectID');
    return rows.find(row => row.id === where.id && row.orgId === where.orgId) ?? null;
  },
  findUnique: async ({ where }: { where: { id: string } }) =>
    rows.find(row => row.id === where.id) ?? null,
  findMany: async () => rows,
});
