import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import bcrypt from 'bcryptjs';

// Runs against a real Mongo replica set with the current schema pushed: see tenancy.integration.test.ts.
// Without the variable it registers no tests, so a plain `bun test src` stays database-free.
const url = process.env['TEST_DATABASE_URL'];

const BACKEND = resolve(import.meta.dirname, '../..');
const TSX = resolve(BACKEND, '../node_modules/.bin/tsx');
const STAFF_EMAIL = 'admin@tensrai.com';
const HASH_FILE = join(mkdtempSync(join(tmpdir(), 'staff-hash-')), 'default.hash');

if (url) {
  const { PrismaClient } = await import('@prisma/client');
  const { resetPasswordWithTemp } = await import('./user.service.js');
  const prisma = new PrismaClient({ datasourceUrl: url });

  const runScript = (script: string, input: string, env: Record<string, string> = {}) => {
    const result = spawnSync(TSX, [`scripts/${script}`], {
      cwd: BACKEND,
      input,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        DATABASE_URL: url,
        DEFAULT_STAFF_HASH_FILE: HASH_FILE,
        ...env,
      },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  const createDefaultStaff = (first: string, second = first) =>
    runScript('createStaff.ts', `${first}\n${second}\n`);
  const defaultStaff = () => prisma.user.findUnique({ where: { username: STAFF_EMAIL } });
  const seed = () => runScript('seed.ts', '');
  const commitHashOf = (password: string) => {
    const hash = bcrypt.hashSync(password, 4);
    writeFileSync(HASH_FILE, `${hash}\n`);
    return hash;
  };
  const clearStaff = async () => {
    rmSync(HASH_FILE, { force: true });
    await prisma.user.deleteMany({
      where: { OR: [{ role: 'STAFF' }, { username: STAFF_EMAIL }, { email: STAFF_EMAIL }] },
    });
  };

  beforeEach(clearStaff);
  afterEach(clearStaff);

  test('with no arguments it creates the default staff account with the typed password', async () => {
    const { status, output } = createDefaultStaff('Typed-password-1');

    expect(output).not.toContain('Typed-password-1');
    expect(status).toBe(0);
    const user = await defaultStaff();
    expect(user).toMatchObject({
      email: STAFF_EMAIL,
      role: 'STAFF',
      isActive: true,
      mustResetPassword: false,
    });
    expect(await bcrypt.compare('Typed-password-1', user?.passwordHash ?? '')).toBe(true);
  });

  test('running it again sets a new password and ends the account’s sessions', async () => {
    createDefaultStaff('Typed-password-1');
    const id = (await defaultStaff())?.id ?? '';
    const token = `staff-test-${Date.now()}`;
    await prisma.session.create({
      data: { id: token, token, userId: id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const { status } = createDefaultStaff('Typed-password-2');

    expect(status).toBe(0);
    const updated = await defaultStaff();
    expect(updated?.id).toBe(id);
    expect(await bcrypt.compare('Typed-password-2', updated?.passwordHash ?? '')).toBe(true);
    expect(await bcrypt.compare('Typed-password-1', updated?.passwordHash ?? '')).toBe(false);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
  });

  test('passwords that differ or are too short change nothing', async () => {
    const differ = createDefaultStaff('Typed-password-1', 'Typed-password-2');
    expect(differ.status).not.toBe(0);
    expect(differ.output).toContain('do not match');

    const short = createDefaultStaff('short');
    expect(short.status).not.toBe(0);
    expect(short.output).toContain('at least 8');

    const closed = runScript('createStaff.ts', '');
    expect(closed.status).not.toBe(0);

    expect(await defaultStaff()).toBeNull();
  });

  test('naming a user still issues a temporary password, without asking for one', async () => {
    const username = `named-staff-${Date.now()}`;
    const result = spawnSync(
      TSX,
      ['scripts/createStaff.ts', username, `${username}@example.test`],
      {
        cwd: BACKEND,
        input: '',
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', DATABASE_URL: url },
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Temporary password');
    await prisma.user.delete({ where: { username } });
  });

  test('the seed only creates accounts whose password is configured', async () => {
    const run = Date.now();
    const email = `unseeded-${run}@example.test`;
    const { status, output } = runScript('seed.ts', '', {
      SEED_ADMIN_USERNAME: `unseeded-${run}`,
      SEED_ADMIN_EMAIL: email,
      SEED_USER_USERNAME: `unseeded-user-${run}`,
      SEED_USER_EMAIL: `unseeded-user-${run}@example.test`,
    });

    expect(status).toBe(0);
    expect(await prisma.user.count({ where: { username: { contains: `-${run}` } } })).toBe(0);
    expect(output).not.toContain('default password');
  });

  test('a committed hash creates the default staff account with a temporary password', async () => {
    const hash = commitHashOf('Seeded-password-1');

    const { status, output } = seed();

    expect(output).not.toContain(hash);
    expect(status).toBe(0);
    const user = await defaultStaff();
    expect(user).toMatchObject({
      email: STAFF_EMAIL,
      role: 'STAFF',
      mustResetPassword: true,
      passwordHash: '',
      tempPasswordHash: hash,
    });
    const expiresIn = (user?.tempPasswordExpiry?.getTime() ?? 0) - Date.now();
    expect(expiresIn).toBeGreaterThan(71 * 60 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(72 * 60 * 60 * 1000);
  });

  test('a committed hash never changes the default account once it exists', async () => {
    createDefaultStaff('Typed-password-1');
    const before = await defaultStaff();
    commitHashOf('Seeded-password-1');

    expect(seed().status).toBe(0);

    const after = await defaultStaff();
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.tempPasswordHash).toBeNull();
    expect(after?.mustResetPassword).toBe(false);
  });

  test('a committed hash cannot bring the account back while other staff exist', async () => {
    const org = await prisma.organization.findFirstOrThrow();
    await prisma.user.create({
      data: {
        orgId: org.id,
        username: `other-staff-${Date.now()}`,
        email: `other-staff-${Date.now()}@example.test`,
        role: 'STAFF',
        passwordHash: '',
      },
    });
    commitHashOf('Seeded-password-1');

    expect(seed().status).toBe(0);

    expect(await defaultStaff()).toBeNull();
  });

  test('the demo admin’s default email leaves the default staff address free', async () => {
    const username = `demo-admin-${Date.now()}`;
    commitHashOf('Seeded-password-1');

    const { status } = runScript('seed.ts', '', {
      SEED_ADMIN_USERNAME: username,
      SEED_ADMIN_PASSWORD: 'Demo-password-1',
    });

    expect(status).toBe(0);
    expect(await defaultStaff()).toMatchObject({ role: 'STAFF', email: STAFF_EMAIL });
    await prisma.user.deleteMany({ where: { username } });
  });

  test('an older account on that address blocks the default, and staff:create takes it over', async () => {
    const username = `older-admin-${Date.now()}`;
    const org = await prisma.organization.findFirstOrThrow();
    await prisma.user.create({
      data: { orgId: org.id, username, email: STAFF_EMAIL, role: 'ADMIN', passwordHash: '' },
    });
    commitHashOf('Seeded-password-1');

    expect(seed().output).toContain('staff:create');
    expect(await prisma.user.count({ where: { role: 'STAFF' } })).toBe(0);

    expect(createDefaultStaff('Typed-password-1').output).toContain(`Sign in as ${username}`);
  });

  test('the committed password is replaced at first setup and cannot be kept', async () => {
    commitHashOf('Seeded-password-1');
    seed();
    const id = (await defaultStaff())?.id ?? '';
    const setPassword = (newPassword: string) =>
      resetPasswordWithTemp(prisma, id, {
        tempPassword: 'Seeded-password-1',
        newPassword,
        confirmPassword: newPassword,
      });

    await expect(setPassword('Seeded-password-1')).rejects.toThrow('different');
    await setPassword('Chosen-password-1');

    const user = await defaultStaff();
    expect(await bcrypt.compare('Chosen-password-1', user?.passwordHash ?? '')).toBe(true);
    expect(user?.tempPasswordHash).toBeNull();
    expect(user?.mustResetPassword).toBe(false);
  });

  test('a hash file holding anything else creates nothing and is not printed', async () => {
    writeFileSync(HASH_FILE, 'Plain-password-in-a-file\n');

    const { status, output } = seed();

    expect(status).not.toBe(0);
    expect(output).toContain('not a bcrypt hash');
    expect(output).not.toContain('Plain-password-in-a-file');
    expect(await defaultStaff()).toBeNull();
  });

  test('with no hash file and no staff the seed creates nothing and points at the commands', async () => {
    const { status, output } = seed();

    expect(status).toBe(0);
    expect(output).toContain('staff:create');
    expect(await defaultStaff()).toBeNull();

    createDefaultStaff('Typed-password-1');
    expect(seed().output).not.toContain('staff:create');
  });

  test('staff:default-password stores a slow hash of the typed password, never the password', () => {
    const password = 'A-long-enough-password-1';

    const { status, output } = runScript(
      'setDefaultStaffPassword.ts',
      `${password}\n${password}\n`
    );

    expect(status).toBe(0);
    expect(output).not.toContain(password);
    const stored = readFileSync(HASH_FILE, 'utf8').trim();
    expect(stored).not.toContain(password);
    expect(bcrypt.getRounds(stored)).toBe(14);
  });

  test('staff:default-password takes any password the sign-in rules allow', () => {
    const allowed = 'Twelve-chars';
    expect(runScript('setDefaultStaffPassword.ts', `${allowed}\n${allowed}\n`).status).toBe(0);
    expect(existsSync(HASH_FILE)).toBe(true);

    rmSync(HASH_FILE);
    const { status, output } = runScript('setDefaultStaffPassword.ts', 'short\nshort\n');

    expect(status).not.toBe(0);
    expect(output).toContain('at least 8');
    expect(existsSync(HASH_FILE)).toBe(false);
  });
}
