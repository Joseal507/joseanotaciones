// Focused contracts for the new auth/security surfaces that don't require
// a live Worker/D1/Google session: password hashing correctness and the R2
// ownership-prefix check used by /api/delete-file. Live end-to-end flows
// (Google login, register+login round trip, Worker secret gate, cross-user
// Settings/R2 access) require deployed infra and are documented as
// not-executed-here in the mission report.
import { hashPassword, verifyPassword, passwordStrengthError } from '../../lib/auth/password';
import { ownsR2Key } from '../../lib/materials/ownership';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`PASS: ${message}`);
  }
}

async function run() {
  // ── Password hashing ──
  const plain = 'correctHorse123';
  const hash = await hashPassword(plain);

  assert(!hash.includes(plain), 'hash never contains the plaintext password as a substring');
  assert(hash.startsWith('scrypt$'), 'hash is self-describing (algo prefix)');

  const hash2 = await hashPassword(plain);
  assert(hash !== hash2, 'hashing the same password twice yields different output (random salt)');

  assert(await verifyPassword(plain, hash), 'verifyPassword accepts the correct password');
  assert(!(await verifyPassword('wrongPassword123', hash)), 'verifyPassword rejects an incorrect password');
  assert(await verifyPassword(plain, hash2), 'the second (differently-salted) hash of the same password also verifies correctly');

  assert(!(await verifyPassword(plain, 'not-a-real-hash')), 'verifyPassword rejects a malformed encoded hash instead of throwing');
  assert(!(await verifyPassword(plain, 'bcrypt$10$abc$def')), 'verifyPassword rejects a hash tagged with an unsupported algo');

  assert(passwordStrengthError('short1') !== null, 'passwordStrengthError rejects passwords under 8 chars');
  assert(passwordStrengthError('alllettersnonumber') !== null, 'passwordStrengthError rejects passwords without a digit');
  assert(passwordStrengthError('12345678') !== null, 'passwordStrengthError rejects passwords without a letter');
  assert(passwordStrengthError('validPass123') === null, 'passwordStrengthError accepts a reasonable password');

  // ── R2 ownership prefix check (delete-file) ──
  const userA = 'user-aaa';
  const userB = 'user-bbb';

  assert(ownsR2Key(`materials/${userA}/mat_1/source.pdf`, userA), 'owner can delete their own material key');
  assert(!ownsR2Key(`materials/${userA}/mat_1/source.pdf`, userB), "a different user CANNOT delete userA's material key");
  assert(ownsR2Key(`partner-files/${userA}/123_x_file.png`, userA), 'owner can delete their own partner-upload key');
  assert(!ownsR2Key(`partner-files/${userA}/123_x_file.png`, userB), "a different user CANNOT delete userA's partner-upload key");
  assert(!ownsR2Key('some-other-namespace/user-aaa/file', userA), 'a key outside the known owned namespaces is always rejected');
  assert(!ownsR2Key('materials', userA), 'a malformed key with no owner segment is rejected, not treated as ownerless');
  assert(!ownsR2Key('', userA), 'an empty key is rejected');
  assert(!ownsR2Key(`materials/${userA}/mat_1/source.pdf`, ''), 'an empty caller id is rejected');

  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

run();
