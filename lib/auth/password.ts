import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// N/r/p per Node's documented scrypt guidance for interactive logins.
// Encoded as a self-describing string so params can change later without
// invalidating hashes already stored for existing users.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derivedKey = await scrypt(password, salt, expected.length, { N, r, p });
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}

export function passwordStrengthError(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (password.length > 128) return 'La contraseña es demasiado larga';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'La contraseña debe incluir letras y números';
  return null;
}
