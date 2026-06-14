import { getSession } from 'next-auth/react';

export async function getCurrentSession() {
  return await getSession();
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession();
  return ((session?.user as any)?.id as string) || null;
}

export async function requireCurrentUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error('No hay sesión activa');
  return id;
}

