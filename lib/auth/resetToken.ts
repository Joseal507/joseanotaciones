import { randomBytes, createHash } from 'crypto';

// The raw token is high-entropy random data (256 bits) — unlike a human
// password, it doesn't need a slow KDF to resist guessing. A plain SHA-256
// digest is the correct primitive here: fast, deterministic (so we can
// look it up by hash), and the only thing ever stored in D1.
const TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function generateResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetTokenExpiry(fromNow: number = RESET_TOKEN_TTL_MS): string {
  return new Date(Date.now() + fromNow).toISOString();
}

export interface ResetTokenRow {
  expires_at: string;
  used_at?: string | null;
}

export function isTokenExpired(row: ResetTokenRow, now: number = Date.now()): boolean {
  return new Date(row.expires_at).getTime() <= now;
}

export function isTokenUsed(row: ResetTokenRow): boolean {
  return Boolean(row.used_at);
}

/** A token is only good for exactly one successful reset, before its expiry. */
export function isTokenValid(row: ResetTokenRow, now: number = Date.now()): boolean {
  return !isTokenUsed(row) && !isTokenExpired(row, now);
}
