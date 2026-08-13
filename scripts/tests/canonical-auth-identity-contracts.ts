import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authenticatedStudyALUserFromSession } from '../../lib/auth/studyalUserShared';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const session = { expires: '2099-01-01T00:00:00.000Z', user: { id: 'canonical-user', email: 'canonical@example.com', name: 'Canonical', image: null } };
const first = authenticatedStudyALUserFromSession(session);
assert.deepEqual(first, { id: 'canonical-user', email: 'canonical@example.com', name: 'Canonical', image: null });
assert.deepEqual(authenticatedStudyALUserFromSession(JSON.parse(JSON.stringify(session))), first);
assert.equal(authenticatedStudyALUserFromSession(null), null);
assert.equal(authenticatedStudyALUserFromSession({ ...session, user: { ...session.user, id: '' } }), null);

for (const file of ['app/api/agenda/route.ts', 'app/api/horario/route.ts', 'app/api/study-profile/route.ts']) {
  const source = read(file);
  assert.match(source, /getAuthenticatedStudyALUser/);
  assert.match(source, /status: 401/);
  assert.match(source, /status: 503/);
  assert.doesNotMatch(source, /body\.user_id|body\.userId|body\.email/);
}
const profile = read('app/api/user-profile/route.ts');
assert.match(profile, /getAuthenticatedStudyALUser/);
assert.match(profile, /user_id: user\.id/);
assert.match(profile, /email: user\.email/);
assert.doesNotMatch(profile, /body\.user_id \|\| body\.id|searchParams\.get\('userId'\)/);
for (const name of ['posts', 'likes', 'guardados', 'comentarios', 'ratings']) {
  const source = read(`app/api/comunidad/${name}/route.ts`);
  assert.match(source, /getAuthenticatedStudyALUser/);
  assert.match(source, /user_id: user\.id/);
  assert.match(source, /status: 401/);
}
const xp = read('hooks/useXP.ts');
assert.match(xp, /getSession/);
assert.doesNotMatch(xp, /access_token|Authorization|supabase\.auth/);
for (const file of ['app/agenda/page.tsx', 'app/horario/page.tsx', 'components/HorarioWidget.tsx']) {
  const source = read(file);
  assert.match(source, /useAuthenticatedStudyALUser/);
  assert.doesNotMatch(source, /supabase\.auth/);
}
console.log('canonical-auth-identity-contracts: A-J PASS; impersonation blocked; auth errors remain errors');
