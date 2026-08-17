// Server-to-server credential for Next.js -> cloudflare/studyal-api calls.
// Never NEXT_PUBLIC_*: this must never reach a browser bundle.
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET || '';

export const WORKER_SECRET_HEADER = 'x-studyal-worker-secret';

export function workerAuthHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra);
  if (WORKER_SHARED_SECRET) headers.set(WORKER_SECRET_HEADER, WORKER_SHARED_SECRET);
  return headers;
}
