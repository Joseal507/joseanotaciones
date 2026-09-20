// Must be the FIRST import of a test: lib/worker/auth captures the secret at module load.
process.env.WORKER_SHARED_SECRET = 'page-study-test-secret'
process.env.STUDYAL_API_URL = 'https://worker.test'
export {}
