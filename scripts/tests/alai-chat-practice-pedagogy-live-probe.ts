/** Explicit, opt-in live probe of tutor quality. Real provider + real route + real client reducers; synthetic materials; nothing persisted. */
import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage } from '../../lib/materialLanguage'
import { findPracticeStyleIssues, isEchoQuestion, extractAskedQuestion } from '../../lib/alai-chat/practice'
import { Client, install } from './alai-practice-harness'

const transcript: Array<{ who: string; text: string; verdict?: string }> = []
function material(id: string, rows: Array<[string, string, string]>) {
  const selection = buildSourceSelectionSnapshot([id], { [id]: [1, 2] })
  const payload = withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: selection.fingerprint, materialIds: [id], selectedPages: selection.selectedPages, topicsIndex: [{ id: 't', title: rows[0][1], order: 0 }],
    globalOrderedAnalysis: rows.map(([key, name, content], index) => ({ id: key, kind: 'concept', label: name, name, summary: content, content, importance: 90 - index, materialId: id, pages: [index < 3 ? 1 : 2], topicId: 't', globalOrder: index, sourceSpans: [{ page: index < 3 ? 1 : 2, quote: content }] })), uniqueConceptsIndex: [] } })
  return { selection, payload }
}
async function say(client: Client, who: string, text: string) {
  await client.send(text)
  const reply = client.lastAssistant('answer')!
  const ctx = reply.conversationContext!
  transcript.push({ who: 'ALUMNO', text })
  transcript.push({ who: 'ALAI', text: reply.content, verdict: `${ctx.practiceLastVerdict} · intentos=${ctx.practiceAttempts} · revelado=${ctx.practiceRevealed === true}` })
  return { reply: reply.content, ctx }
}
const leaks = (text: string, terms: RegExp[]) => terms.filter(term => term.test(text)).length
const moralizing = /acad[eé]mic|seriedad|respeto|comport|formal|profesional/i

async function main() {
  // ── Falcons ────────────────────────────────────────────────────────
  const falcons = material('mat-falcons', [
    ['what', 'Atlanta Falcons', 'Los Atlanta Falcons son un equipo de fútbol americano profesional con sede en Atlanta, Georgia, fundado en 1965.'],
    ['greatness', 'La grandeza de un equipo', 'La grandeza de un equipo no depende solo de los campeonatos: también se mide por su legado, la influencia de sus jugadores, la conexión con la afición y su capacidad de inspirar a otros.'],
    ['si', 'Super Bowl LI', 'En el Super Bowl LI, celebrado en 2017, los Falcons perdieron ante los New England Patriots tras liderar por 28-3 en el tercer cuarto.'],
    ['fans', 'Cultura de la afición de Atlanta', 'La afición de Atlanta es conocida por su lealtad y por el lema Rise Up, que une a la ciudad alrededor del equipo.'],
  ])
  install(falcons.payload, falcons.selection, undefined, true)
  const client = new Client(); await client.switchTo('answer')
  const q1 = client.visible('answer')[0].content; transcript.push({ who: 'ALAI', text: q1, verdict: 'start' })
  assert.match(q1, /\?/); assert.ok(q1.length <= 260, `first question is concise (${q1.length} chars)`)
  assert.deepEqual(findPracticeStyleIssues(q1), [], `first question is natural: ${q1}`)
  const r1 = await say(client, 'a1', 'Los atlanta falcons son un equipo de futbol americano y fueron fundados en 1965 en atlanta georgia')
  assert.equal(r1.ctx.practiceLastVerdict, 'correct', 'a correct answer is accepted')
  const asked2 = extractAskedQuestion(r1.reply)
  // steer the session to the greatness concept regardless of the model's phrasing
  const wantGreatness = true // reproduce the reported session: whatever Q2 is, the student answers as in the real conversation
  transcript.push({ who: 'NOTA', text: `pregunta 2: ${asked2}` })
  if (wantGreatness) {
    const coreTerms = [/legado/i, /influencia/i, /afici[oó]n/i, /inspir/i]
    const n1 = await say(client, 'a2', 'la grandeza es una paquetada es disq bum ass shi')
    assert.notEqual(n1.ctx.practiceLastVerdict, 'correct'); assert.doesNotMatch(n1.reply, moralizing, 'nonsense is not moralized')
    assert.ok(leaks(n1.reply, coreTerms) <= 1, `first miss does not dump the full answer (${leaks(n1.reply, coreTerms)}/4 core terms)`)
    assert.deepEqual(n1.ctx.practiceCurrentTargetIds, r1.ctx.practiceCurrentTargetIds)
    const n2 = await say(client, 'a3', 'el unico factor que define la grandeza de un equipo es los campeonatos')
    assert.notEqual(n2.ctx.practiceLastVerdict, 'correct'); assert.ok(leaks(n2.reply, coreTerms) <= 2, `second miss scaffolds without dumping (${leaks(n2.reply, coreTerms)}/4)`)
    const n3 = await say(client, 'a4', 'no sé')
    assert.equal(n3.ctx.practiceRevealed === true || n3.ctx.practiceAttempts! >= 3, true, 'third miss teaches')
    assert.equal(isEchoQuestion(n3.reply), false, 'after explaining, ALAI does not ask the student to repeat it')
    const ok = await say(client, 'a5', 'También importa lo que el equipo significa para su gente y el impacto que deja en los jugadores y en la ciudad.')
    transcript.push({ who: 'NOTA', text: `comprensión semántica → ${ok.ctx.practiceLastVerdict}` })
    assert.match(String(ok.ctx.practiceLastVerdict), /correct|partial/)
  }
  const styleHits = transcript.filter(t => t.who === 'ALAI').flatMap(t => findPracticeStyleIssues(t.text))
  transcript.push({ who: 'NOTA', text: `incidencias de estilo en toda la sesión: ${styleHits.length}` })
  assert.ok(styleHits.length <= 1, `tone stays natural (${styleHits.join(', ')})`)
  const falconsTranscript = [...transcript]; transcript.length = 0

  // ── Chemistry: the 120° misconception ──────────────────────────────
  const chem = material('mat-q', [
    ['sp3', 'Hibridación sp3', 'En la hibridación sp3 los cuatro orbitales híbridos forman ángulos de 109.5 grados entre sí y la geometría del carbono es tetraédrica.'],
    ['sp2', 'Hibridación sp2', 'En la hibridación sp2 los tres orbitales híbridos forman ángulos de 120 grados y la geometría es trigonal plana.'],
    ['sp', 'Hibridación sp', 'En la hibridación sp los dos orbitales híbridos forman ángulos de 180 grados y la geometría es lineal.'],
    ['sigma-pi', 'Enlaces sigma y pi', 'Un doble enlace contiene un enlace sigma y un enlace pi formado por orbitales p paralelos.'],
  ])
  install(chem.payload, chem.selection, undefined, true)
  const cc = new Client(); await cc.switchTo('answer')
  transcript.push({ who: 'ALAI', text: cc.visible('answer')[0].content, verdict: 'start' })
  const c1 = await say(cc, 'c1', '120°')
  assert.notEqual(c1.ctx.practiceLastVerdict, 'correct'); assert.ok(c1.reply.length < 700, `no lecture dump (${c1.reply.length} chars)`)
  assert.ok(!/109[.,]5/.test(c1.reply) || c1.ctx.practiceAttempts! >= 2, 'the expected value is not handed over on the first miss')
  const c2 = await say(cc, 'c2', 'sigo pensando que son 120')
  assert.notEqual(c2.ctx.practiceLastVerdict, 'correct')
  const c3 = await say(cc, 'c3', 'no sé')
  assert.equal(isEchoQuestion(c3.reply), false, 'after the explanation, no repeat-it question')
  const c4 = await say(cc, 'c4', 'son 109.5 grados porque son cuatro orbitales y la geometría es tetraédrica')
  assert.match(String(c4.ctx.practiceLastVerdict), /correct|partial/)
  console.log(JSON.stringify({ falcons: falconsTranscript, chemistry: transcript }, null, 2))
  console.log('LIVE PASS alai-chat-practice-pedagogy: Falcons + chemistry sessions')
}
main().catch(error => { console.error(JSON.stringify({ falcons: transcript }, null, 2)); console.error(error); process.exit(1) })
