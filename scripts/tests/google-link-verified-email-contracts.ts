// Behavioral contract for the account-linking gate in lib/auth/options.ts's
// signIn callback: Google may only reuse an EXISTING users.id when Google
// itself attests email_verified===true. Invokes the real callback with a
// mocked global.fetch — no live Google/D1/Worker needed.
import assert from 'node:assert/strict';
import { authOptions } from '../../lib/auth/options';

process.env.STUDYAL_API_URL = 'http://fake-worker.test';

type MockRule = { match: (url: string) => boolean; body: any; ok?: boolean };
let rules: MockRule[] = [];
let calls: string[] = [];

(global as any).fetch = async (url: string) => {
  calls.push(String(url));
  const rule = rules.find(r => r.match(String(url)));
  return { ok: rule?.ok ?? true, json: async () => rule?.body ?? {} } as any;
};

const signIn = authOptions.callbacks!.signIn! as (args: any) => Promise<boolean>;

async function main() {
  // 1) Google, UNVERIFIED email, an account already owns that email -> BLOCKED
  calls = [];
  rules = [{ match: u => u.includes('/users/by-email'), body: { ok: true, user: { id: 'existing-user-1', email: 'victim@x.com' } } }];
  let result = await signIn({
    user: { email: 'victim@x.com', name: 'Attacker-controlled Google profile', image: null },
    account: { provider: 'google', providerAccountId: 'g-attacker' },
    profile: { email_verified: false },
  });
  assert.equal(result, false, 'Google sign-in with UNVERIFIED email must NOT link to a pre-existing account');
  assert.ok(!calls.some(u => u.includes('/users/upsert')), 'a blocked linking attempt must never reach /users/upsert');
  console.log('PASS: unverified Google email cannot take over an existing account');

  // 2) Google, VERIFIED email, an account already owns that email -> ALLOWED (the safe linking case)
  calls = [];
  rules = [
    { match: u => u.includes('/users/by-email'), body: { ok: true, user: { id: 'existing-user-1', email: 'real@x.com' } } },
    { match: u => u.includes('/users/upsert'), body: { ok: true } },
  ];
  result = await signIn({
    user: { email: 'real@x.com', name: 'Real Owner', image: null },
    account: { provider: 'google', providerAccountId: 'g-real' },
    profile: { email_verified: true },
  });
  assert.equal(result, true, 'Google sign-in with a VERIFIED email may link to the matching existing account');
  assert.ok(calls.some(u => u.includes('/users/upsert')), 'an allowed link must reach /users/upsert to reuse the same users.id');
  console.log('PASS: verified Google email links safely to the existing account with the same email');

  // 3) Google, UNVERIFIED email, NO existing account -> ALLOWED (fresh signup, nothing to take over)
  calls = [];
  rules = [
    { match: u => u.includes('/users/by-email'), body: { ok: true, user: null } },
    { match: u => u.includes('/users/upsert'), body: { ok: true } },
  ];
  result = await signIn({
    user: { email: 'brandnew@x.com', name: 'New', image: null },
    account: { provider: 'google', providerAccountId: 'g-new' },
    profile: { email_verified: false },
  });
  assert.equal(result, true, 'a fresh Google signup (no pre-existing user for that email) is allowed even if unverified');
  console.log('PASS: fresh Google signup with no prior account is not blocked by the linking gate');

  // 4) Credentials provider never touches the Google-only gate or re-upserts
  calls = [];
  rules = [];
  result = await signIn({
    user: { id: 'cred-user-1', email: 'x@x.com', name: 'X', image: null },
    account: { provider: 'credentials' },
  });
  assert.equal(result, true, 'credentials sign-in returns true unconditionally (already password-verified in authorize())');
  assert.equal(calls.length, 0, 'credentials sign-in must not call the Worker at all from signIn');
  console.log('PASS: credentials sign-in skips the Google-only linking gate entirely');

  // 5) Ownership check itself fails (network/Worker error) -> fail CLOSED
  calls = [];
  (global as any).fetch = async () => { throw new Error('network down'); };
  result = await signIn({
    user: { email: 'whoever@x.com', name: 'Who', image: null },
    account: { provider: 'google', providerAccountId: 'g-x' },
    profile: { email_verified: false },
  });
  assert.equal(result, false, 'if we cannot verify whether linking would take over an account, sign-in must fail closed');
  console.log('PASS: a failed ownership check fails closed, not open');

  console.log('\n✅ ALL PASS — google-link-verified-email-contracts');
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
