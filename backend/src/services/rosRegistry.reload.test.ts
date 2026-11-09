import { afterEach, expect, test } from 'bun:test';
import { RosRegistry } from './rosRegistry.js';

const log: any = { info() {}, warn() {}, error() {}, debug() {} };
const robot = { id: 'r1', orgId: 'o1', ipAddress: '127.0.0.1', bridgePort: 1 };
const registries: RosRegistry[] = [];

afterEach(() => {
  while (registries.length > 0) registries.pop()?.stop();
});

test('an older reload that finishes last does not undo a newer one', async () => {
  // The first reload reads the addresses before the approval and is slow to return them.
  let releaseStaleRead: () => void = () => {};
  const staleRead = new Promise<void>(resolve => {
    releaseStaleRead = resolve;
  });
  let addressReads = 0;
  const prisma: any = {
    robot: { findMany: async () => [robot] },
    robotAddress: {
      findMany: async () => {
        addressReads += 1;
        if (addressReads === 1) {
          await staleRead;
          return [];
        }
        return [{ orgId: robot.orgId, ip: robot.ipAddress }];
      },
    },
  };
  const registry = new RosRegistry(prisma, log);
  registries.push(registry);

  const beforeApproval = registry.reloadFromDb();
  await new Promise(resolve => setImmediate(resolve));
  await registry.reloadFromDb();
  expect(registry.getManager('r1')).toBeDefined();

  releaseStaleRead();
  await beforeApproval;

  expect(registry.getManager('r1')).toBeDefined();
});
