import { test, expect } from '@playwright/test';

test('private operations stay unauthorized across refresh without canonical login', async ({ page }) => {
  for (const endpoint of ['/api/agenda', '/api/horario', '/api/study-profile', '/api/user-profile']) {
    const response = await page.request.get(endpoint);
    expect(response.status(), endpoint).toBe(401);
  }
  await page.goto('/auth-v2');
  await page.reload();
  const response = await page.request.post('/api/agenda', {
    data: { user_id: 'another-user', email: 'another@example.com', asignaciones: [], objetivos: [] },
  });
  expect(response.status()).toBe(401);
});
