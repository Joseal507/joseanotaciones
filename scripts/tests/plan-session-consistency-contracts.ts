import assert from 'node:assert/strict'
import { validatePlanSessionConsistency } from '../../lib/adaptive/planSessionConsistency'

const validJourney = {
  chapters: [
    { id: 'chapter-1', chapterNumber: 1 },
    { id: 'chapter-2', chapterNumber: 2 },
    { id: 'chapter-3', chapterNumber: 3 },
  ],
}

{
  const report = validatePlanSessionConsistency({
    journey: validJourney,
    sessionContent: { '1': { sessionId: 'chapter-1' }, '2': { sessionId: 'chapter-2' } },
  })
  assert.equal(report.valid, true, 'un journey y sessionContent consistentes deben reportar valid=true')
  assert.deepEqual(report.issues, [])
  console.log('plan-session-consistency: happy path PASS')
}

{
  const report = validatePlanSessionConsistency({
    journey: { chapters: [{ id: 'chapter-1', chapterNumber: 1 }, { id: 'chapter-1-dup', chapterNumber: 1 }] },
    sessionContent: {},
  })
  assert.equal(report.valid, false)
  assert.ok(report.issues.some(issue => issue.code === 'DUPLICATE_CHAPTER_NUMBER'))
  console.log('plan-session-consistency: DUPLICATE_CHAPTER_NUMBER detected PASS')
}

{
  const report = validatePlanSessionConsistency({
    journey: { chapters: [{ chapterNumber: 1 }] },
    sessionContent: {},
  })
  assert.equal(report.valid, false)
  assert.ok(report.issues.some(issue => issue.code === 'MISSING_CHAPTER_ID'))
  console.log('plan-session-consistency: MISSING_CHAPTER_ID detected PASS')
}

{
  // "Plan dice sesión 2 disponible pero backend session not found" — sessionContent
  // huérfano de un journey ANTERIOR (el journey actual ya no tiene chapterNumber=5).
  const report = validatePlanSessionConsistency({
    journey: validJourney,
    sessionContent: { '5': { sessionId: 'chapter-5-old' } },
  })
  assert.equal(report.valid, false)
  assert.ok(report.issues.some(issue => issue.code === 'ORPHAN_SESSION_CONTENT' && issue.chapterNumber === 5))
  console.log('plan-session-consistency: ORPHAN_SESSION_CONTENT (plan regenerado) detected PASS')
}

{
  // Journey regenerado: chapterNumber=2 ahora tiene un id DISTINTO, pero el
  // sessionContent viejo (bajo la clave '2') sigue referenciando el id anterior.
  const report = validatePlanSessionConsistency({
    journey: validJourney,
    sessionContent: { '2': { sessionId: 'chapter-2-STALE-ID' } },
  })
  assert.equal(report.valid, false)
  assert.ok(report.issues.some(issue => issue.code === 'SESSION_CONTENT_CHAPTER_MISMATCH'))
  console.log('plan-session-consistency: SESSION_CONTENT_CHAPTER_MISMATCH (journey regenerado sin invalidar contenido) detected PASS')
}

{
  // Sin journey en absoluto (sesión recién creada, aún sin plan) -> no debe lanzar,
  // debe reportar simplemente sin chapters (vacío pero válido — nada que reconciliar).
  const report = validatePlanSessionConsistency({ journey: null, sessionContent: null })
  assert.equal(report.valid, true)
  console.log('plan-session-consistency: sin journey (aún no generado) no lanza, reporta valid PASS')
}

console.log('plan-session-consistency-contracts: ALL PASS')
