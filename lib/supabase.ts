import { getSession, signOut as nextAuthSignOut } from 'next-auth/react';

type SessionUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

async function currentUser(): Promise<SessionUser | null> {
  const session: any = await getSession();
  return session?.user || null;
}

export const supabase = {
  auth: {
    async getUser() {
      const user = await currentUser();
      return {
        data: {
          user: user
            ? {
                id: user.id || '',
                email: user.email || '',
                user_metadata: {
                  nombre: user.name || '',
                  name: user.name || '',
                  avatar_url: user.image || '',
                },
              }
            : null,
        },
        error: null,
      };
    },

    async getSession() {
      const session: any = await getSession();
      return {
        data: {
          session: session?.user
            ? {
                user: {
                  id: session.user.id || '',
                  email: session.user.email || '',
                  user_metadata: {
                    nombre: session.user.name || '',
                    name: session.user.name || '',
                    avatar_url: session.user.image || '',
                  },
                },
                access_token: 'nextauth',
              }
            : null,
        },
        error: null,
      };
    },

    onAuthStateChange(
      callback: (
        event: string,
        session: { user: any; access_token?: string | null } | null
      ) => void
    ) {
      currentUser().then((user) => {
        callback('SIGNED_IN', user ? { user, access_token: 'nextauth' } : null);
      });

      return {
        data: {
          subscription: {
            unsubscribe() {},
          },
        },
      };
    },

    async updateUser() {
      return { data: { user: await currentUser() }, error: null };
    },

    async signOut() {
      await nextAuthSignOut({ callbackUrl: '/auth' });
      return { error: null };
    },
  },
};

export type Usuario = {
  id: string;
  email: string;
};
