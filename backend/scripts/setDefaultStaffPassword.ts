import { writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { askForPassword, DEFAULT_STAFF_HASH_FILE } from './defaultStaff.js';

// The hash goes in a public repo, where anyone can try guesses against it offline, so it's slower to
// crack than the rest of the app's.
const HASH_COST = 14;

async function main() {
  const password = await askForPassword();
  writeFileSync(DEFAULT_STAFF_HASH_FILE, `${await bcrypt.hash(password, HASH_COST)}\n`);
  console.log(`Wrote the hash to ${DEFAULT_STAFF_HASH_FILE}. The password itself isn't saved.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
