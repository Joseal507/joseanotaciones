import { readFileSync } from 'node:fs'
import path from 'node:path'
async function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
async function main() {
  await loadEnv()
  const { workerAuthHeaders } = await import('../lib/worker/auth')
  const apiUrl = process.env.STUDYAL_API_URL
  const res = await fetch(`${apiUrl}/users/by-email?email=${encodeURIComponent('studyal496@gmail.com')}`, { headers: workerAuthHeaders() as any })
  const data = await res.json() as any
  const userId = data?.user?.id
  console.log('userId', userId)
  const { getMaterial, getMaterialText } = await import('../lib/materials/repository')
  const material = await getMaterial('mat_51698c0cfba451ccfe67ae4f', userId)
  console.log('material found for this user:', !!material)
  console.log(JSON.stringify(material, null, 2))
  const text = await getMaterialText('mat_51698c0cfba451ccfe67ae4f')
  console.log('material_texts row exists:', !!text, text ? (text.raw_text||'').length : null)
}
main()
