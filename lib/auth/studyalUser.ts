import { getServerSession } from 'next-auth';
import { authOptions } from './options';
import { authenticatedStudyALUserFromSession, type AuthenticatedStudyALUser } from './studyalUserShared';

export { authenticatedStudyALUserFromSession, type AuthenticatedStudyALUser } from './studyalUserShared';

export async function getAuthenticatedStudyALUser(): Promise<AuthenticatedStudyALUser | null> {
  return authenticatedStudyALUserFromSession(await getServerSession(authOptions));
}

export async function requireAuthenticatedStudyALUser(): Promise<AuthenticatedStudyALUser> {
  const user = await getAuthenticatedStudyALUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}
