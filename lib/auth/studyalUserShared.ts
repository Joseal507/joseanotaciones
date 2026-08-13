import type { Session } from 'next-auth';

export interface AuthenticatedStudyALUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
}

export function authenticatedStudyALUserFromSession(
  session: Session | null | undefined,
): AuthenticatedStudyALUser | null {
  const user = session?.user as (Session['user'] & { id?: string }) | undefined;
  const id = String(user?.id || '').trim();
  if (!id) return null;
  return { id, email: user?.email || null, name: user?.name || null, image: user?.image || null };
}
