import { supabase } from './supabase';

const isBrowser = () => typeof window !== 'undefined';

async function getToken(): Promise<string | null> {
  try {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    return session?.access_token || null;
  } catch {
    return null;
  }
}

export async function syncGetAll() {
  try {
    const token = await getToken();
    if (!token) return null;

    const res = await fetch('/api/sync', {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.data : null;
  } catch {
    return null;
  }
}

export async function syncSave(tipo: string, datos: any) {
  try {
    const token = await getToken();
    if (!token) return false;

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tipo, datos }),
    });

    const data = await res.json();
    return data.success;
  } catch {
    return false;
  }
}