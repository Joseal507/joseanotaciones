import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getHorarioDB } from '../../lib/db'
import { authenticatedStudyALUserFromSession } from '../../lib/auth/studyalUserShared'

// ─── PARTE D: la causa raíz del refetch-storm es que useSession() produce un
// objeto `user` nuevo en cada resolución aunque el id no cambie. Se prueba
// aquí contra la función real (no un mock) para que la garantía no dependa
// de asunciones. ───
const sessionA = { user: { id: 'user-1', email: 'a@x.com', name: 'A', image: null } } as any
const userRefA1 = authenticatedStudyALUserFromSession(sessionA)
const userRefA2 = authenticatedStudyALUserFromSession(sessionA)
assert.notEqual(userRefA1, userRefA2, 'cada llamada debe producir un objeto nuevo (esto es lo que hace inestable la referencia)')
assert.equal(userRefA1?.id, userRefA2?.id, 'pero el id subyacente debe ser estable — por eso el effect debe depender de user?.id, no de user')

const sessionB = { user: { id: 'user-2', email: 'b@x.com', name: 'B', image: null } } as any
assert.notEqual(authenticatedStudyALUserFromSession(sessionB)?.id, userRefA1?.id, 'un id distinto sí debe distinguirse')

// ─── getHorarioDB: debe distinguir éxito / vacío / error, y respetar abort.
// Antes del fix, cualquier fallo se tragaba silenciosamente y devolvía
// HORARIO_VACIO — indistinguible de "cargó y está vacío". Ahora debe
// rechazar (throw) para que el caller pueda mostrar error/retry. ───
const HORARIO_VACIO = { lunes: [], martes: [], miercoles: [], jueves: [], viernes: [] }
const originalFetch = globalThis.fetch

async function withMockFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  globalThis.fetch = impl as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testSuccessWithData() {
  const horario = { ...HORARIO_VACIO, lunes: [{ id: 'c1', nombre: 'Cálculo', color: '#fff', horaInicio: '08:00', horaFin: '09:00' }] }
  await withMockFetch(
    async () => new Response(JSON.stringify({ horario }), { status: 200 }),
    async () => {
      const result = await getHorarioDB('user-1')
      assert.deepEqual(result, horario)
    },
  )
}

async function testSuccessEmpty() {
  await withMockFetch(
    async () => new Response(JSON.stringify({ horario: HORARIO_VACIO }), { status: 200 }),
    async () => {
      const result = await getHorarioDB('user-1')
      assert.deepEqual(result, HORARIO_VACIO, '200 + vacío debe resolver con horario vacío válido, no lanzar')
    },
  )
}

async function testHttpError() {
  await withMockFetch(
    async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 }),
    async () => {
      await assert.rejects(() => getHorarioDB('user-1'), /HORARIO_FETCH_FAILED/, 'un 500 debe rechazar, no devolver silenciosamente HORARIO_VACIO')
    },
  )
}

async function testNetworkError() {
  await withMockFetch(
    async () => { throw new TypeError('network down') },
    async () => {
      await assert.rejects(() => getHorarioDB('user-1'), /network down/, 'un fetch rechazado debe propagar el error, no tragarlo')
    },
  )
}

async function testAbort() {
  await withMockFetch(
    async (_url: any, init: any) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }),
    async () => {
      const controller = new AbortController()
      const pending = getHorarioDB('user-1', controller.signal)
      controller.abort()
      await assert.rejects(pending, (err: any) => err.name === 'AbortError')
    },
  )
}

// ─── Wiring: el loader canónico (StudyLoader) reemplaza el sistema separado
// "~ Cargando horario... ~", y el dependency array ya no usa el objeto
// `user` inestable. ───
const horarioPage = readFileSync('app/horario/page.tsx', 'utf8')
assert.match(horarioPage, /import StudyLoader from/, 'la página de Horario debe importar el loader canónico')
assert.match(horarioPage, /<StudyLoader label=/, 'el full-screen loading debe usar StudyLoader')
assert.doesNotMatch(horarioPage, /~ \{tr\('cargandoHorario'\)\} ~/, 'no debe quedar el sistema de loading separado "~ Cargando horario... ~"')
assert.match(horarioPage, /\[authStatus, authedUserId, retryTick\]/, 'el effect de carga debe depender de authedUserId (primitivo), no de user (objeto inestable)')
assert.match(horarioPage, /errorCarga/, 'debe existir un estado de error distinto de loading/empty')
assert.match(horarioPage, /AbortController/, 'debe proteger contra requests colgadas')

const horarioWidget = readFileSync('components/HorarioWidget.tsx', 'utf8')
assert.doesNotMatch(horarioWidget, /\[authStatus, user\]/, 'HorarioWidget no debe depender del objeto user inestable')
assert.match(horarioWidget, /\[authStatus, userId, retryTick\]/, 'HorarioWidget debe depender de userId (primitivo)')
assert.match(horarioWidget, /'idle' \| 'loading' \| 'success' \| 'error'/, 'HorarioWidget debe tener una state machine explícita')
assert.match(horarioWidget, /AbortController/, 'HorarioWidget debe proteger contra requests colgadas')

// ─── PARTE C: otros full-screen loaders migrados al canónico ───
for (const [path, oldPattern] of [
  ['app/perfil/page.tsx', /~ \{tr\('cargando'\)\} ~/],
  ['app/leaderboard/page.tsx', /~ cargando ~/],
  ['app/materias/page.tsx', /matBounce/],
] as const) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /import StudyLoader from/, `${path} debe importar el loader canónico`)
  assert.match(source, /<StudyLoader label=/, `${path} debe usar el loader canónico`)
  assert.doesNotMatch(source, oldPattern, `${path} no debe conservar su loader ad-hoc anterior`)
}

for (const path of ['app/loading.tsx', 'app/horario/loading.tsx', 'app/materias/loading.tsx', 'app/perfil/loading.tsx', 'app/agenda/loading.tsx', 'app/leaderboard/loading.tsx']) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /StudyLoader/, `${path} debe usar el loader canónico de ruta`)
}

Promise.resolve()
  .then(testSuccessWithData)
  .then(testSuccessEmpty)
  .then(testHttpError)
  .then(testNetworkError)
  .then(testAbort)
  .then(() => {
    console.log('loading-unification-horario-contracts: 20/20 PASS')
    console.log('getHorarioDB: success/empty/error/abort all distinguished')
    console.log('full-screen loaders migrated: Horario, Perfil, Leaderboard, Materias + 6 route-level loading.tsx')
  })
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
