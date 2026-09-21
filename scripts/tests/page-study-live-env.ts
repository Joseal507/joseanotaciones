// Must be the FIRST import of the live probe: remembers the secret exactly as lib/worker/auth captures it at module load.
export const CAPTURED_WORKER_SECRET = process.env.WORKER_SHARED_SECRET
