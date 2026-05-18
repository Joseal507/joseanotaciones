import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Lock dummy: no bloquea nada — evita el bug del NavigatorLock
const noopLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn();

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sb-pmnmxwdriluiwieankuh-auth-token',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    lock: noopLock,
  },
});

export type Usuario = {
  id: string;
  email: string;
};
