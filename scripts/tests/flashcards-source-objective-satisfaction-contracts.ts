import assert from 'node:assert/strict'
import { evaluateSourceObjectiveSatisfaction } from '../../lib/materialBrain/flashcards/sourceObjectiveSatisfaction'
import type { PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit } from '../../lib/materialBrain/types'

// ============================================================
// Contract suite: sourceObjectiveSatisfaction.ts.
//
// v2 — splits the single "grounding" check into two independent
// dimensions after a real, demonstrated false positive (CASE-B): a
// correct, heavily-paraphrased answer over a short single-sentence
// source was hard-rejected for near-zero lexical overlap.
//   - objectiveRecovery: does the ANSWER add real content beyond the
//     QUESTION? (never looks at source — this is what actually catches
//     the 4 real vacuous cards, independent of source vocabulary).
//   - sourceSupport: is that content backed by the source? For weak-
//     structure kinds this is EITHER 'supported' (positive evidence) OR
//     'ambiguous' (never 'rejected' on lexical grounds alone).
//
// The "bad card" fixtures use the REAL question/answer text of cards
// #6, #15, #17, #21, #23, #38, #46 recovered from the real persisted
// deck (fingerprint 8173bd9b56dc0127, runId mt9k53fl-i6ouh4). The
// trace format never persists the source KnowledgeUnit's own
// `statement` text, so the `statement`/`steps` given here are a
// faithful RECONSTRUCTION (informed by sibling real cards), not a claim
// of byte-exact extraction. The "good card" fixtures use REAL
// question/answer text from cards already classified "A" in the same
// real deck.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label.toLowerCase(), qualifiers: [] },
    importance: { tier: 'critical', signals: [], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    domainTags: [],
    ...extra,
  } as any
}
function pc(id: string, sourceUnitIds: string[], cognitiveType: PlannedCard['cognitiveType'], retrievalObjective = 'obj'): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective, cognitiveType, rationale: 'r', conceptClusterId: `cluster-${id}` } as any
}

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

function main() {
  console.log('\n── sourceObjectiveSatisfaction contracts (v2 — objectiveRecovery / sourceSupport split) ──\n')

  // ================= REAL BAD CARDS (must NOT satisfy) =================

  test('REAL #6: vacuous answer must not satisfy', () => {
    const u = unit('u6', 'concept', 'Constante de equilibrio',
      'La constante de equilibrio (K) es la relación entre las concentraciones de productos y reactivos, elevadas a sus coeficientes estequiométricos, en el equilibrio.')
    const r = evaluateSourceObjectiveSatisfaction(pc('c6', [u.id], 'recall'),
      { question: '¿Qué es la constante de equilibrio en el contexto del equilibrio químico?', answer: 'La constante de equilibrio es un concepto fundamental en el equilibrio químico.' }, [u])
    assert.notEqual(r.status, 'satisfied')
    assert.ok(r.reasons.includes('objective_not_recovered'))
  })

  test('REAL #17: "existe una relación" without stating it must not satisfy', () => {
    const u = unit('u17', 'concept', 'Relación Kc y Kp',
      'La constante de equilibrio en términos de concentraciones (Kc) se relaciona con la constante de equilibrio en términos de presiones parciales (Kp) mediante la fórmula Kp = Kc(RT)^Δn.')
    const r = evaluateSourceObjectiveSatisfaction(pc('c17', [u.id], 'recall'),
      { question: '¿Qué relación existe entre la constante de equilibrio en términos de concentraciones (Kc) y la constante de equilibrio en términos de presiones parciales (Kp)?', answer: 'Existe una relación entre la constante de equilibrio en términos de concentraciones (Kc) y la constante de equilibrio en términos de presiones parciales (Kp).' }, [u])
    assert.notEqual(r.status, 'satisfied')
  })

  test('REAL #38: "pueden afectar" without saying how must not satisfy', () => {
    const u = unit('u38', 'concept', 'Efecto de la temperatura',
      'Los cambios en la temperatura desplazan el equilibrio hacia la reacción endotérmica cuando la temperatura aumenta, y hacia la reacción exotérmica cuando disminuye.')
    const r = evaluateSourceObjectiveSatisfaction(pc('c38', [u.id], 'recall'),
      { question: '¿Cómo afectan los cambios en la temperatura al equilibrio químico?', answer: 'Los cambios en la temperatura pueden afectar el equilibrio químico.' }, [u])
    assert.notEqual(r.status, 'satisfied')
  })

  test('REAL #46: "están sucediendo" without the actual claim must not satisfy — even though it shares SOME source vocabulary', () => {
    const u = unit('u46', 'concept', 'Acercamiento al equilibrio',
      'A medida que un sistema se aproxima al equilibrio, la velocidad de la reacción directa disminuye y la velocidad de la reacción inversa aumenta, hasta igualarse.')
    const r = evaluateSourceObjectiveSatisfaction(pc('c46', [u.id], 'recall'),
      { question: '¿Qué ocurre con las reacciones directa e inversa cuando un sistema se acerca al equilibrio?', answer: 'A medida que un sistema se aproxima al equilibrio, las reacciones directa e inversa están sucediendo.' }, [u])
    assert.notEqual(r.status, 'satisfied', JSON.stringify(r))
  })

  test('REAL #15: invented numeric scenario on a formula with no numeric example must not satisfy', () => {
    const u = unit('u15', 'formula', 'Expresión general de Kc', 'aA + bB <=> cC + dD',
      { expression: 'K_c = [C]^c[D]^d / ([A]^a[B]^b)', variables: [{ symbol: 'a', meaning: 'coeficiente de A' }, { symbol: 'b', meaning: 'coeficiente de B' }, { symbol: 'c', meaning: 'coeficiente de C' }, { symbol: 'd', meaning: 'coeficiente de D' }] })
    const r = evaluateSourceObjectiveSatisfaction(pc('c15', [u.id], 'application'),
      { question: 'Para la reacción 2A + B <=> 3C + D, si Kc=10, [A]=0.5M, [B]=0.2M, [D]=0.1M, y [C]=0.8M, ¿cuál es el coeficiente estequiométrico de C?',
        answer: 'La fórmula es Kc = [C]^c[D]^d/([A]^a[B]^b). Sustituyendo los valores: 10 = (0.8)^c(0.1)/(0.25*0.2). Esto no tiene una solución entera simple, pero se puede verificar que c=3.' }, [u])
    assert.equal(r.status, 'rejected')
    assert.ok(r.reasons.includes('quantitative_evidence_missing') || r.reasons.includes('quantitative_value_unsupported'))
  })

  test('REAL #21: numeric mismatch against reference value must not satisfy', () => {
    const u = unit('u21', 'formula', 'Kc para N2O4/NO2', 'A 100°C, la concentración en equilibrio de NO2 es 0.130 M y la de N2O4 es 0.0800 M, dando Kc = 0.212.',
      { expression: 'K_c = [NO2]^2 / [N2O4]', variables: [{ symbol: 'NO2', meaning: 'concentración de NO2' }, { symbol: 'N2O4', meaning: 'concentración de N2O4' }] })
    const r = evaluateSourceObjectiveSatisfaction(pc('c21', [u.id], 'application'),
      { question: 'Si la concentración de NO2 es 0.1 M y la de N2O4 es 0.05 M, ¿cuál es el valor de Kc a 100°C?',
        answer: 'Kc = (0.1)^2/0.05 = 0.2. (El valor de referencia es 0.212, pero el cálculo con los datos proporcionados es 0.2).' }, [u])
    assert.equal(r.status, 'rejected')
    assert.equal(r.reasons.includes('quantitative_value_unsupported'), true)
  })

  test('REAL #23: procedure answer that does not recover the real steps must not satisfy', () => {
    const u = unit('u23', 'process', 'Obtención de concentraciones de sólidos/líquidos', 'Procedimiento para expresar la concentración de un sólido o líquido puro.',
      { steps: [
        { order: 1, text: 'Identificar la fase de la sustancia (sólido o líquido puro).' },
        { order: 2, text: 'Consultar la densidad y la masa molar de la sustancia en tablas de referencia.' },
        { order: 3, text: 'Calcular la concentración molar dividiendo la densidad entre la masa molar.' },
      ] })
    const r = evaluateSourceObjectiveSatisfaction(pc('c23', [u.id], 'procedure'),
      { question: '¿Cuáles son los pasos para obtener las concentraciones de sólidos y líquidos?',
        answer: 'El proceso para obtener las concentraciones de sólidos y líquidos consiste en multiplicar la densidad de la sustancia por su masa molar.' }, [u])
    assert.notEqual(r.status, 'satisfied', JSON.stringify(r))
  })

  // ================= CASE-B (the false positive this redesign fixes) =================

  test('CASE-B: aggressive-but-correct paraphrase over a SHORT source statement must NOT be rejected for vocabulary difference', () => {
    const u = unit('u-b2', 'fact', 'Catalizador',
      'La presencia de un catalizador permite alcanzar el equilibrio más rápido, pero no cambia la constante de equilibrio.')
    const r = evaluateSourceObjectiveSatisfaction(pc('cb2', [u.id], 'recall'),
      { question: '¿Qué ocurre con K cuando se introduce un catalizador?',
        answer: 'K permanece igual aunque el catalizador acelere el proceso, con evidencia directa del material.' }, [u])
    assert.equal(r.evidence.objectiveRecovery.signal, 'fast_pass', 'the answer states a real consequence the question does not contain — must not be "vacuous"')
    assert.notEqual(r.status, 'rejected', JSON.stringify(r))
    assert.ok(r.status === 'satisfied' || r.status === 'ambiguous')
  })

  // ================= REAL GOOD CARDS (>=15, must satisfy) =================

  const goodCases: { name: string; unit: KnowledgeUnit; cognitiveType: PlannedCard['cognitiveType']; question: string; answer: string }[] = [
    { name: '#1', unit: unit('g1', 'concept', 'Cociente de reacción vs K', 'Si el cociente de reacción (Q) es mayor que la constante de equilibrio (K), hay demasiados productos y el equilibrio se desplaza hacia la izquierda (hacia los reactivos).'), cognitiveType: 'recall', question: '¿Qué sucede si el cociente de reacción (Q) es mayor que la constante de equilibrio (K)?', answer: 'Si el cociente de reacción (Q) es mayor que la constante de equilibrio (K), hay demasiados productos y el equilibrio se desplaza a la izquierda.' },
    { name: '#3', unit: unit('g3', 'concept', 'Cantidades en equilibrio', 'Una vez que se alcanza el equilibrio, la cantidad de cada reactivo y de cada producto permanece constante en el tiempo.'), cognitiveType: 'recall', question: '¿Qué sucede con la cantidad de cada reactivo y producto una vez que se ha alcanzado el equilibrio?', answer: 'Una vez que se alcanzó el equilibrio, la cantidad de cada reactivo y de cada producto permanece constante.' },
    { name: '#4', unit: unit('g4', 'concept', 'Representación del equilibrio', 'En un sistema en equilibrio, las reacciones directa e inversa ocurren a la misma velocidad, y su ecuación se escribe con una flecha doble para indicar reversibilidad.'), cognitiveType: 'recall', question: '¿Cómo se representa la ecuación de un sistema en equilibrio químico?', answer: 'En un sistema en equilibrio, las reacciones directa e inversa ocurren a la misma velocidad, y su ecuación se escribe con una flecha doble.' },
    { name: '#19', unit: unit('g19', 'fact', 'Proporciones en equilibrio', 'Sin importar si se comienza con N2 y H2 o si se comienza con NH3, se tendrán las mismas proporciones de las tres sustancias en el equilibrio, siempre que la estequiometría inicial sea equivalente.'), cognitiveType: 'recall', question: '¿Qué sucede con las proporciones de N2, H2 y NH3 en equilibrio si se comienza con N2 y H2 o con NH3?', answer: 'Sin importar si se comienza con N2 y H2 o si se comienza con NH3, se tendrán las mismas proporciones de las tres sustancias en el equilibrio.' },
    { name: '#20', unit: unit('g20', 'concept', 'Keq de reacción neta', 'La constante de equilibrio para una reacción neta realizada en dos o más etapas es el producto de las constantes de equilibrio de cada etapa individual.'), cognitiveType: 'recall', question: '¿Cómo se calcula la constante de equilibrio para una reacción neta que se realiza en dos o más etapas?', answer: 'La constante de equilibrio para una reacción neta realizada en dos o más etapas es el producto de las constantes de equilibrio para las etapas individuales.' },
    { name: '#22', unit: unit('g22', 'concept', 'Concentraciones sólidos/líquidos', 'Las concentraciones de sólidos y líquidos puros son esencialmente constantes y no varían durante la reacción.'), cognitiveType: 'recall', question: '¿Cómo se describen las concentraciones de sólidos y líquidos en el contexto del equilibrio químico?', answer: 'Las concentraciones de sólidos y líquidos son esencialmente constantes.' },
    { name: '#24', unit: unit('g24', 'formula', 'Expresión PbCl2', 'La expresión de equilibrio para la disolución de PbCl2 es Kc = [Pb2+][Cl-]^2.', { expression: 'K_c = [Pb^{2+}][Cl^-]^2', variables: [{ symbol: 'Pb^{2+}', meaning: 'concentración de iones plomo(II)' }, { symbol: 'Cl^-', meaning: 'concentración de iones cloruro' }] }), cognitiveType: 'recall', question: '¿Cuál es la expresión de equilibrio para la reacción PbCl2(s) <=> Pb2+(ac) + 2Cl-(ac)?', answer: 'La expresión de equilibrio es Kc = [Pb^{2+}][Cl^-]^2. Donde Kc es la constante de equilibrio, [Pb^{2+}] es la concentración de iones plomo(II), y [Cl^-] es la concentración de iones cloruro.' },
    { name: '#25', unit: unit('g25', 'fact', 'CO2 sobre sólido', 'Mientras que algo de CaCO3 o CaO permanezca en el sistema, la cantidad de CO2 sobre el sólido permanecerá igual a temperatura constante.'), cognitiveType: 'recall', question: '¿Qué sucede con la cantidad de CO2 sobre el sólido en el sistema CaCO3/CaO mientras haya CaCO3 o CaO presente?', answer: 'Mientras que algo de CaCO3 o CaO permanezca en el sistema, la cantidad de CO2 sobre el sólido permanecerá igual.' },
    { name: '#26', unit: unit('g26', 'example', 'Reacción heterogénea CaCO3', 'La reacción CaCO3(s) <=> CO2(g) + CaO(s) es un ejemplo de reacción heterogénea porque involucra reactivos y productos en distintas fases.'), cognitiveType: 'comprehension', question: '¿Cómo ilustra la reacción CaCO3(s) <=> CO2(g) + CaO(s) el concepto de reacción heterogénea?', answer: 'Esta reacción ilustra una reacción heterogénea porque involucra reactivos y productos en diferentes fases (sólido y gas).' },
    { name: '#34', unit: unit('g34', 'concept', 'Cociente de reacción', 'El cociente de la reacción (Q) proporciona la misma relación matemática que la expresión de equilibrio, pero aplicada a un sistema que no está necesariamente en equilibrio.'), cognitiveType: 'recall', question: '¿Qué es el cociente de la reacción (Q)?', answer: 'El cociente de la reacción (Q) proporciona la misma relación que la expresión de equilibrio, pero se aplica a un sistema que no se encuentra en equilibrio.' },
    { name: '#36', unit: unit('g36', 'fact', 'Q igual a K', 'Si el cociente de la reacción (Q) es igual a la constante de equilibrio (K), el sistema se encuentra en equilibrio.'), cognitiveType: 'recall', question: '¿Qué indica que el sistema se encuentra en equilibrio en relación con Q y K?', answer: 'Si el cociente de la reacción (Q) es igual a la constante de equilibrio (K), el sistema se encuentra en equilibrio.' },
    { name: '#37', unit: unit('g37', 'concept', 'Principio de Le Châtelier', 'El Principio de Le Châtelier establece que si un sistema en equilibrio es perturbado por un cambio en temperatura, presión o concentración, el sistema desplazará su posición de equilibrio para contrarrestar el efecto de la perturbación.'), cognitiveType: 'recall', question: '¿Qué establece el Principio de Le Châtelier?', answer: 'El Principio de Le Châtelier establece que si un sistema en equilibrio es perturbado por un cambio en la temperatura, presión o concentración de uno de los componentes, el sistema desplazará su posición de equilibrio para contrarrestar el efecto de la perturbación.' },
    { name: '#40', unit: unit('g40', 'concept', 'Catalizadores y velocidad', 'Los catalizadores aumentan la velocidad de las reacciones directa e inversa por igual, sin modificar la posición del equilibrio.'), cognitiveType: 'recall', question: '¿Cuál es el efecto de los catalizadores en las velocidades de reacción?', answer: 'Los catalizadores aumentan la velocidad de las reacciones directa e inversa.' },
    { name: '#43', unit: unit('g43', 'definition', 'Delta n', 'Δn es la diferencia entre los moles de gas del producto y los moles de gas del reactivo en la reacción balanceada.', { term: 'Δn' }), cognitiveType: 'comprehension', question: '¿Qué representa Δn en la fórmula de la relación entre Kp y Kc?', answer: 'Δn es la diferencia entre los moles del producto gaseoso y los moles del reactivo gaseoso.' },
    { name: '#47', unit: unit('g47', 'concept', 'Reacción generalizada', 'Una reacción generalizada se representa como aA + bB <=> cC + dD, donde a, b, c, d son coeficientes estequiométricos y A, B, C, D son las especies químicas involucradas.'), cognitiveType: 'recall', question: '¿Cómo se representa una reacción generalizada?', answer: 'Una reacción generalizada se representa como aA + bB <=> cC + dD, donde a, b, c, d son coeficientes estequiométricos y A, B, C, D son las especies químicas.' },
    { name: '#49', unit: unit('g49', 'fact', 'Presión y concentración', 'En un sistema cerrado, si la concentración de un gas se duplica, su presión parcial también se duplica, ya que son magnitudes proporcionales.'), cognitiveType: 'recall', question: 'Si la concentración de un gas en un sistema cerrado se duplica, ¿qué le sucede a su presión?', answer: 'La presión también se duplica, ya que la presión es proporcional a la concentración para los gases en un sistema cerrado.' },
  ]
  for (const c of goodCases) {
    test(`REAL ${c.name}: real accepted card must satisfy`, () => {
      const r = evaluateSourceObjectiveSatisfaction(pc(`c-${c.name}`, [c.unit.id], c.cognitiveType), { question: c.question, answer: c.answer }, [c.unit])
      assert.equal(r.status, 'satisfied', JSON.stringify(r))
    })
  }
  test(`sanity: ${goodCases.length} real positive controls collected (>=15 required)`, () => {
    assert.ok(goodCases.length >= 15, `only ${goodCases.length}`)
  })

  // ================= REQUIRED SYNTHETIC CONTRACTS (1-9) =================

  test('1. question and answer almost identical + correct source -> objective_not_recovered', () => {
    const u = unit('s1', 'concept', 'X', 'X es igual a Y más uno.')
    const r = evaluateSourceObjectiveSatisfaction(pc('cs1', [u.id], 'recall'),
      { question: '¿Cuánto es X?', answer: 'X es lo que es X.' }, [u])
    assert.equal(r.status, 'rejected')
    assert.ok(r.reasons.includes('objective_not_recovered'))
  })

  test('2. answer shares many words with source but only repeats the question -> rejected', () => {
    const u = unit('s2', 'concept', 'Relación A-B', 'A y B están relacionados mediante la fórmula A = 2B + 1.')
    const r = evaluateSourceObjectiveSatisfaction(pc('cs2', [u.id], 'recall'),
      { question: '¿Cuál es la relación entre A y B?', answer: 'Existe una relación entre A y B.' }, [u])
    assert.notEqual(r.status, 'satisfied')
  })

  test('3. aggressive-but-correct paraphrase, low lexical overlap -> NOT rejected for source support', () => {
    const u = unit('s3', 'concept', 'Causa X', 'X causa Y porque Z ocurre primero.')
    const r = evaluateSourceObjectiveSatisfaction(pc('cs3', [u.id], 'recall'),
      { question: '¿Por qué X causa Y?', answer: 'Y ocurre como consecuencia directa de X, dado que Z se produce antes en la secuencia.' }, [u])
    assert.notEqual(r.status, 'rejected', JSON.stringify(r))
  })

  test('4. same kind of paraphrase over a weak/thin source -> ambiguous when it cannot be demonstrated', () => {
    const u = unit('s4', 'concept', 'Tema amplio', 'Este es un enunciado breve y limitado que abarca poco contenido sobre el tema.')
    const r = evaluateSourceObjectiveSatisfaction(pc('cs4', [u.id], 'recall'),
      { question: '¿Qué establece el material sobre este tema?', answer: 'El material aborda este asunto de forma sucinta.' }, [u])
    assert.equal(r.status, 'ambiguous', JSON.stringify(r))
  })

  test('5. answer adds a claim with no traceable support -> a wild tangent cannot be proven wrong deterministically -> ambiguous, never falsely rejected', () => {
    const u = unit('s5', 'concept', 'Punto de ebullición del agua', 'El agua hierve a 100 grados Celsius al nivel del mar.')
    const r = evaluateSourceObjectiveSatisfaction(pc('cs5', [u.id], 'recall'),
      { question: '¿A qué temperatura hierve el agua al nivel del mar?', answer: 'El fenómeno depende completamente de la composición isotópica del hidrógeno presente y de fenómenos cuánticos de tunelaje molecular poco estudiados en la literatura contemporánea.' }, [u])
    assert.equal(r.status, 'ambiguous', JSON.stringify(r))
  })

  test('6. formula structured equivalent -> satisfied', () => {
    const u = unit('s6f', 'formula', 'Ley de Ohm', 'La ley de Ohm relaciona voltaje, corriente y resistencia.', { expression: 'V = I * R', variables: [{ symbol: 'V', meaning: 'voltaje' }, { symbol: 'I', meaning: 'corriente' }, { symbol: 'R', meaning: 'resistencia' }] })
    const r = evaluateSourceObjectiveSatisfaction(pc('cs6f', [u.id], 'recall'),
      { question: '¿Cuál es la ley de Ohm?', answer: 'La ley de Ohm es V = I * R, donde V es el voltaje, I es la corriente, y R es la resistencia.' }, [u])
    assert.equal(r.status, 'satisfied')
    assert.equal(r.evidence.sourceSupport.structuralCheck, 'formula_symbols')
  })

  test('7. procedure using real steps -> satisfied', () => {
    const u = unit('s7p', 'process', 'Preparar una solución', 'Procedimiento para preparar una solución de concentración conocida.', { steps: [
      { order: 1, text: 'Pesar la cantidad exacta de soluto requerida.' },
      { order: 2, text: 'Disolver el soluto en una porción del solvente.' },
      { order: 3, text: 'Aforar hasta el volumen final deseado.' },
    ] })
    const r = evaluateSourceObjectiveSatisfaction(pc('cs7p', [u.id], 'procedure'),
      { question: '¿Cuáles son los pasos para preparar una solución?', answer: 'Primero se pesa la cantidad exacta de soluto, luego se disuelve el soluto en el solvente, y finalmente se afora hasta el volumen final.' }, [u])
    assert.equal(r.status, 'satisfied')
  })

  test('8. procedure ignoring the real steps -> rejected', () => {
    const u = unit('s8p', 'process', 'Preparar una solución', 'Procedimiento para preparar una solución de concentración conocida.', { steps: [
      { order: 1, text: 'Pesar la cantidad exacta de soluto requerida.' },
      { order: 2, text: 'Disolver el soluto en una porción del solvente.' },
      { order: 3, text: 'Aforar hasta el volumen final deseado.' },
    ] })
    const r = evaluateSourceObjectiveSatisfaction(pc('cs8p', [u.id], 'procedure'),
      { question: '¿Cuáles son los pasos para preparar una solución?', answer: 'El proceso consiste en combinar el soluto con el solvente hasta obtener la concentración deseada.' }, [u])
    assert.equal(r.status, 'rejected')
    assert.ok(r.reasons.includes('cognitive_operation_not_satisfied'))
  })

  test('9. numerical data unsupported -> rejected', () => {
    const u = unit('s9', 'formula', 'Fuerza', 'La fórmula de la fuerza es F = m * a.', { expression: 'F = m * a', variables: [{ symbol: 'F', meaning: 'fuerza' }, { symbol: 'm', meaning: 'masa' }, { symbol: 'a', meaning: 'aceleración' }] })
    const r = evaluateSourceObjectiveSatisfaction(pc('cs9', [u.id], 'application'),
      { question: 'Si un objeto de 7 kg experimenta una fuerza de 21 N, ¿cuál es su aceleración?', answer: 'a = F/m = 21/7 = 3 m/s^2.' }, [u])
    assert.equal(r.status, 'rejected')
    assert.ok(r.reasons.includes('quantitative_evidence_missing') || r.reasons.includes('quantitative_value_unsupported'))
  })

  test('quantitative card using exclusively explicit source values -> satisfied', () => {
    const u = unit('s10', 'formula', 'Fuerza', 'Un objeto de 2 kg experimenta una fuerza de 10 N.', { expression: 'F = m * a', variables: [{ symbol: 'F', meaning: 'fuerza' }, { symbol: 'm', meaning: 'masa' }, { symbol: 'a', meaning: 'aceleración' }] })
    const r = evaluateSourceObjectiveSatisfaction(pc('cs10', [u.id], 'application'),
      { question: 'Si un objeto de 2 kg experimenta una fuerza de 10 N, ¿cuál es su aceleración?', answer: 'a = F/m = 10/2 = 5 m/s^2.' }, [u])
    assert.equal(r.status, 'satisfied')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-source-objective-satisfaction-contracts: ALL PASS')
}

main()
