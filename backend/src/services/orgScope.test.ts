import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { GLOBAL_MODELS, scopeArgs, scopedPrisma } from './orgScope.js';

const ORG = 'org-a';

test('every model either belongs to an organization or is explicitly global', () => {
  const unowned = Prisma.dmmf.datamodel.models
    .filter(model => !GLOBAL_MODELS.has(model.name))
    .filter(model => !model.fields.some(field => field.name === 'orgId'))
    .map(model => model.name);
  expect(unowned).toEqual([]);
});

test('leaves global models untouched', () => {
  const args = { where: { token: 't' } };
  expect(scopeArgs('Session', 'deleteMany', args, ORG)).toBe(args);
  expect(scopeArgs('Organization', 'findMany', args, ORG)).toBe(args);
});

test('scopes a model nobody has listed, so a new model cannot slip through', () => {
  expect(scopeArgs('SomeFutureModel', 'findMany', {}, ORG)).toEqual({ where: { orgId: ORG } });
  expect(scopeArgs('RobotMap', 'updateMany', { where: { robotId: 'r1' }, data: {} }, ORG)).toEqual({
    where: { robotId: 'r1', orgId: ORG },
    data: {},
  });
});

test('confines reads and writes of tenant models to the organization', () => {
  expect(scopeArgs('Robot', 'findMany', undefined, ORG)).toEqual({ where: { orgId: ORG } });
  expect(scopeArgs('Robot', 'findUnique', { where: { id: 'r1' } }, ORG)).toEqual({
    where: { id: 'r1', orgId: ORG },
  });
  expect(scopeArgs('Map', 'count', { where: { name: 'x' } }, ORG)).toEqual({
    where: { name: 'x', orgId: ORG },
  });
  for (const operation of ['update', 'updateMany', 'delete', 'deleteMany', 'findFirst']) {
    const { where } = scopeArgs('MissionRun', operation, { where: { id: 'm' }, data: {} }, ORG);
    expect([operation, where]).toEqual([operation, { id: 'm', orgId: ORG }]);
  }
});

test('a caller cannot widen a read to another organization', () => {
  expect(scopeArgs('User', 'findMany', { where: { orgId: 'org-b' } }, ORG)).toEqual({
    where: { orgId: ORG },
  });
  expect(scopeArgs('User', 'findMany', { where: { OR: [{ orgId: 'org-b' }] } }, ORG)).toEqual({
    where: { OR: [{ orgId: 'org-b' }], orgId: ORG },
  });
});

test('stamps the organization on created rows', () => {
  expect(scopeArgs('Robot', 'create', { data: { name: 'r' } }, ORG)).toEqual({
    data: { name: 'r', orgId: ORG },
  });
  expect(scopeArgs('Robot', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] }, ORG)).toEqual({
    data: [
      { name: 'a', orgId: ORG },
      { name: 'b', orgId: ORG },
    ],
  });
  expect(
    scopeArgs('Map', 'upsert', { where: { id: 'm' }, create: { name: 'n' }, update: {} }, ORG)
  ).toEqual({ where: { id: 'm', orgId: ORG }, create: { name: 'n', orgId: ORG }, update: {} });
});

test('refuses to move a row to another organization', () => {
  expect(() =>
    scopeArgs('Robot', 'update', { where: { id: 'r' }, data: { orgId: 'org-b' } }, ORG)
  ).toThrow('orgId cannot be changed');
  expect(() =>
    scopeArgs('Map', 'upsert', { where: {}, create: {}, update: { orgId: 'org-b' } }, ORG)
  ).toThrow('orgId cannot be changed');
  expect(() =>
    scopeArgs('Robot', 'update', { where: {}, data: { orgId: ORG } }, ORG)
  ).not.toThrow();
});

test('fails closed on an operation it does not know', () => {
  expect(() => scopeArgs('Robot', 'createManyAndReturn', { data: [] }, ORG)).toThrow('not allowed');
});

test('the client extension runs every query through scopeArgs, one client per organization', async () => {
  const extensions: any[] = [];
  const prisma: any = { $extends: (extension: object) => extensions.push(extension) && extension };

  const clientA = scopedPrisma(prisma, ORG) as any;
  expect(scopedPrisma(prisma, ORG)).toBe(clientA);
  expect(scopedPrisma(prisma, 'org-b')).not.toBe(clientA);
  expect(extensions).toHaveLength(2);

  let received: unknown;
  await clientA.query.$allModels.$allOperations({
    model: 'Robot',
    operation: 'findMany',
    args: { where: { name: 'x' } },
    query: (args: unknown) => {
      received = args;
    },
  });
  expect(received).toEqual({ where: { name: 'x', orgId: ORG } });
});
