import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../../scripts/mongoReplica.sh');
const SYSTEM_TOOLS = ['cat', 'dirname', 'mkdir'];
const sandboxes: string[] = [];

// PATH holds only these stubs, so the result can't depend on what this machine has installed.
const sandbox = (stubs: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'mongo-replica-'));
  sandboxes.push(dir);
  const calls = join(dir, 'calls.log');
  for (const tool of SYSTEM_TOOLS) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    symlinkSync(found.stdout.trim(), join(dir, tool));
  }
  const all = { sleep: '', pgrep: 'exit 1', ...stubs };
  for (const [name, body] of Object.entries(all)) {
    writeFileSync(join(dir, name), `#!/bin/bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const run = (env: Record<string, string> = {}) => {
    const result = spawnSync(SCRIPT, [], {
      encoding: 'utf8',
      env: { PATH: dir, ...env },
    });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
    };
  };
  return { dir, run };
};

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Answers `compose ps` with "running" once, then the given final state, as the setup container does.
const dockerWithSetupEnding = (finalState: string) => `
  if [ "$2" = "ps" ]; then
    seen="$(dirname "$0")/seen"
    if [ -f "$seen" ]; then echo "${finalState}"; else : > "$seen"; echo "running 0"; fi
  fi`;

test('with no MongoDB installed, it starts the Docker one and waits for its replica set', () => {
  const { run } = sandbox({ docker: dockerWithSetupEnding('exited 0') });

  const { status, output, calls } = run();

  expect(output).not.toContain('Permission denied');
  expect(status).toBe(0);
  expect(calls).toContain('docker compose up -d mongo mongo-init');
  expect(calls.match(/docker compose ps/g)).toHaveLength(2);
  expect(output).toContain('MongoDB replica set ready');
});

test('a Docker Mongo whose replica set setup failed is an error, not "ready"', () => {
  const { run } = sandbox({ docker: dockerWithSetupEnding('exited 1') });

  const { status, output } = run();

  expect(status).not.toBe(0);
  expect(output).toContain('docker compose logs mongo-init');
  expect(output).not.toContain('MongoDB replica set ready');
});

test('with neither MongoDB nor a running Docker, it says what to do', () => {
  const { run } = sandbox({ docker: 'exit 1' });

  const { status, output } = run();

  expect(status).not.toBe(0);
  expect(output).toContain('brew install mongodb-community');
  expect(output).toContain('Docker');
});

test('a local MongoDB uses wherever Homebrew really lives', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'brew-prefix-'));
  sandboxes.push(prefix);
  const { run } = sandbox({
    brew: `echo "${prefix}"`,
    mongod: '',
    mongosh: "echo 'Initialized'",
  });

  const { status, output, calls } = run();

  expect(output).not.toContain('Permission denied');
  expect(status).toBe(0);
  expect(calls).toContain('mongod --config');
  expect(existsSync(join(prefix, 'var/log/mongodb'))).toBe(true);
  expect(existsSync(join(prefix, 'var/mongodb'))).toBe(true);
});

test('a database URL that only works inside Docker is refused before anything starts', () => {
  const { run } = sandbox({ docker: '' });

  const { status, output, calls } = run({
    DATABASE_URL: 'mongodb://mongo:27017/tensrai_dashboard?replicaSet=rs0',
  });

  expect(status).not.toBe(0);
  expect(output).toContain('.env.local');
  expect(calls).not.toContain('docker');
});
