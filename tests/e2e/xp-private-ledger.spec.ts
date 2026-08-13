import { test, expect } from '@playwright/test';

test('XP ledger rejects anonymous identity and arbitrary legacy awards', async ({ request }) => {
  const eventResponse = await request.post('/api/xp', {
    data: {
      userId: 'another-user',
      email: 'another@example.com',
      eventId: 'community_post_created:forged-post',
      action: 'community_post_created',
      entityId: 'forged-post',
      amount: 999999,
    },
  });
  expect(eventResponse.status()).toBe(401);

  const legacyResponse = await request.post('/api/leaderboard', {
    data: { user_id: 'another-user', xp_total: 999999 },
  });
  expect(legacyResponse.status()).toBe(401);
});
