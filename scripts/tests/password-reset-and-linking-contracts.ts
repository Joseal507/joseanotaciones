// Focused contracts for password recovery + account linking. Diagnostic
// mission requested these specific cases; no live D1/Worker involved — the
// Worker boundary is mocked via global.fetch, exercising the REAL
// production functions (authorize(), password hashing, token predicates,
// source-level ownership contracts), not a reimplementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authOptions } from '../../lib/auth/options';
import { hashPassword, verifyPassword } from '../../lib/auth/password';
import {
  hashResetToken,
  generateResetToken,
  resetTokenExpiry,
  isTokenExpired,
  isTokenUsed,
  isTokenValid,
} from '../../lib/auth/resetToken';

process.env.STUDYAL_API_URL = 'http://fake-worker.test';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

let failures = 0;
function assertTrue(condition: boolean, message: string) {
  if (!condition) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

type MockRule = { match: (url: string) => boolean; body: any; ok?: boolean };
let rules: MockRule[] = [];
(global as any).fetch = async (url: string) => {
  const rule = rules.find(r => r.match(String(url)));
  return { ok: rule?.ok ?? true, json: async () => rule?.body ?? {}, text: async () => JSON.stringify(rule?.body ?? {}) } as any;
};

async function main() {
  const credentialsProviderConfig = (authOptions.providers as any[]).find(p => p.id === 'credentials');
  assertTrue(Boolean(credentialsProviderConfig), 'CredentialsProvider is registered on authOptions');
  // NextAuth's factory returns a stub authorize() — the real function lives
  // in .options (the object we passed to CredentialsProvider({...}) in
  // lib/auth/options.ts) and only gets merged in by NextAuth's internal
  // parseProviders() during a live request. Calling it directly here is the
  // correct way to exercise the REAL implementation deterministically.
  const credentialsProvider = { authorize: credentialsProviderConfig.options.authorize };

  // ── 1) Correct Credentials login succeeds ──
  const realHash = await hashPassword('CorrectHorse123');
  rules = [
    { match: u => u.includes('/users/by-email'), body: { ok: true, user: { id: 'user-1', email: 'a@x.com', name: 'A', image: null } } },
    { match: u => u.includes('/credentials/by-user'), body: { ok: true, credential: { password_hash: realHash } } },
  ];
  let result = await credentialsProvider.authorize({ email: 'a@x.com', password: 'CorrectHorse123' });
  assertTrue(result?.id === 'user-1', '1) correct Credentials login resolves the real users.id');

  // ── 2) Wrong password → rejected (NextAuth turns this into 401) ──
  result = await credentialsProvider.authorize({ email: 'a@x.com', password: 'wrongPassword' });
  assertTrue(result === null, '2) wrong password is rejected by authorize() (null -> NextAuth 401)');

  // ── 3) Google account with NO password_credentials: Google sign-in path never queries credentials ──
  const optionsSource = read('lib/auth/options.ts');
  const signInGoogleBlock = optionsSource.slice(
    optionsSource.indexOf('account?.provider === "google"'),
    optionsSource.indexOf('async jwt'),
  );
  assertTrue(
    !signInGoogleBlock.includes('/credentials/'),
    '3) Google sign-in never touches password_credentials — a Google-only account keeps working regardless of it',
  );

  // Also exercise it live: Google, verified email, fresh account -> allowed, no credentials lookup involved.
  rules = [
    { match: u => u.includes('/users/by-email'), body: { ok: true, user: null } },
    { match: u => u.includes('/users/upsert'), body: { ok: true } },
  ];
  const signIn = authOptions.callbacks!.signIn! as (args: any) => Promise<boolean>;
  const googleOk = await signIn({
    user: { email: 'google-only@x.com', name: 'G', image: null },
    account: { provider: 'google', providerAccountId: 'g-1' },
    profile: { email_verified: true },
  });
  assertTrue(googleOk === true, '3b) Google login for a Google-only account still succeeds end to end');

  // ── 4) An authenticated Google user's set-password call always targets THEIR OWN session-derived id ──
  const setPasswordSource = read('app/api/auth/set-password/route.ts');
  assertTrue(
    setPasswordSource.includes('getAuthenticatedStudyALUser'),
    '4) set-password requires a real authenticated session (not a client-supplied identity)',
  );
  assertTrue(
    /user_id:\s*user\.id/.test(setPasswordSource),
    '4b) set-password sends the SESSION user.id as user_id — never body.userId/body.user_id',
  );
  assertTrue(
    !/body\.user_id|body\.userId/.test(setPasswordSource),
    '4c) set-password never reads a caller-supplied user id from the request body',
  );

  // ── 5) Reset token expiry ──
  const expiredRow = { expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null };
  const freshRow = { expires_at: resetTokenExpiry(), used_at: null };
  assertTrue(isTokenExpired(expiredRow), '5) a token past its expires_at is detected as expired');
  assertTrue(!isTokenExpired(freshRow), '5b) a freshly issued token is not expired');
  assertTrue(!isTokenValid(expiredRow), '5c) an expired token is not valid regardless of used_at');

  // ── 6) Reset token is single-use ──
  const usedRow = { expires_at: resetTokenExpiry(), used_at: new Date().toISOString() };
  assertTrue(isTokenUsed(usedRow), '6) a token with used_at set is detected as used');
  assertTrue(!isTokenValid(usedRow), '6b) a used token is never valid again, even before its expiry');
  assertTrue(isTokenValid(freshRow), '6c) an unused, unexpired token IS valid (sanity check on the positive case)');

  // ── Token hashing: raw token is never derivable from what gets stored, and hashing is deterministic for lookup ──
  const rawToken = generateResetToken();
  const h1 = hashResetToken(rawToken);
  const h2 = hashResetToken(rawToken);
  assertTrue(h1 === h2, 'token hashing is deterministic (required for by-hash lookup)');
  assertTrue(!h1.includes(rawToken), 'the stored hash never contains the raw token as a substring');
  assertTrue(rawToken.length >= 64, 'raw token has real cryptographic entropy (32 bytes hex = 64 chars)');

  // ── 7 & 8) New password works, old password stops working (hash replacement semantics) ──
  const oldHash = await hashPassword('OldPassword123');
  assertTrue(await verifyPassword('OldPassword123', oldHash), '7) old password verifies against its own hash before rotation');
  const newHash = await hashPassword('NewPassword456');
  assertTrue(await verifyPassword('NewPassword456', newHash), '7b) new password verifies against the new hash');
  assertTrue(!(await verifyPassword('OldPassword123', newHash)), '8) old password no longer verifies once the stored hash is replaced');

  // ── 9) No plaintext password/token ever sent to the Worker or present in the schema ──
  const registerSource = read('app/api/auth/register/route.ts');
  const resetSource = read('app/api/auth/reset-password/route.ts');
  const forgotSource = read('app/api/auth/forgot-password/route.ts');
  for (const [name, src] of [['register', registerSource], ['reset-password', resetSource]] as const) {
    assertTrue(
      /credentials\/upsert[\s\S]{0,200}password_hash/.test(src),
      `9) ${name} sends password_hash (not raw password) to /credentials/upsert`,
    );
  }
  assertTrue(
    !/body:\s*JSON\.stringify\(\{[^}]*\bpassword\b(?!_hash)/.test(registerSource.replace(/password_hash/g, '')),
    '9b) register never puts a raw "password" field in a Worker request body',
  );
  assertTrue(
    forgotSource.includes('token_hash') && !forgotSource.includes('raw_token'),
    '9c) forgot-password stores token_hash, never the raw token, via the create call',
  );
  // Strip SQL line-comments before checking column definitions — the prose
  // in `-- comments` legitimately says "password"/"token" without that
  // being a schema column.
  const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, '');
  const migrationSchema = stripSqlComments(read('cloudflare/studyal-api/migrations/0006_password_credentials.sql'));
  assertTrue(
    migrationSchema.includes('password_hash') && !/\bpassword\b(?!_hash)/.test(migrationSchema),
    '9d) password_credentials table schema only has a password_hash column, never a plaintext "password" column',
  );
  const resetMigrationSchema = stripSqlComments(read('cloudflare/studyal-api/migrations/0007_password_reset_tokens.sql'));
  assertTrue(
    resetMigrationSchema.includes('token_hash') && !/\btoken\b(?!_hash)/.test(resetMigrationSchema),
    '9e) password_reset_tokens table schema only has a token_hash column, never a plaintext "token" column',
  );

  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error('FAIL (uncaught):', err);
  process.exit(1);
});
