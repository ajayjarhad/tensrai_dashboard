import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FirstTimePasswordSetupSchema } from '@tensrai/shared';

// Sign-in is by username only, so the username is the address people expect to type.
export const DEFAULT_STAFF = {
  username: 'admin@tensrai.ai',
  email: 'admin@tensrai.ai',
  displayName: 'Tensrai Admin',
  role: 'STAFF',
} as const;

// The bcrypt hash of this account's first password. It's committed, so a new deployment has a staff
// login without any setup. The variable lets tests use their own file.
export const DEFAULT_STAFF_HASH_FILE =
  process.env['DEFAULT_STAFF_HASH_FILE'] ??
  fileURLToPath(new URL('./defaultStaffPassword.hash', import.meta.url));

// One reader for both answers, because piped input can deliver them together. Its output goes nowhere,
// so what's typed is never shown.
export const askForPassword = async () => {
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  const reader = createInterface({
    input: process.stdin,
    output: silent,
    terminal: Boolean(process.stdin.isTTY),
  });
  const lines = reader[Symbol.asyncIterator]();
  const ask = async (label: string) => {
    process.stdout.write(label);
    const { value, done } = await lines.next();
    process.stdout.write('\n');
    if (done) throw new Error('No password entered, nothing changed');
    return value;
  };

  const newPassword = await ask(`Password for ${DEFAULT_STAFF.username}: `);
  const confirmPassword = await ask('Type it again: ');
  reader.close();

  const checked = FirstTimePasswordSetupSchema.safeParse({
    tempPassword: 'not used here',
    newPassword,
    confirmPassword,
  });
  if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? 'Invalid password');
  return newPassword;
};
