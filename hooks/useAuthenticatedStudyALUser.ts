'use client';

import { useSession } from 'next-auth/react';
import { authenticatedStudyALUserFromSession } from '../lib/auth/studyalUserShared';

export function useAuthenticatedStudyALUser() {
  const { data, status } = useSession();
  return {
    user: authenticatedStudyALUserFromSession(data),
    status,
    authenticated: status === 'authenticated',
  };
}
