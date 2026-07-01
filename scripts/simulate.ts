#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════
// StudyAL Adaptive Simulator
// Simula una sesión completa sin Next.js ni HTTP
// Uso: npx tsx scripts/simulate.ts [material] [student]
// ═══════════════════════════════════════════════════════════════

import * as fs from 'fs'
import * as path from 'path'

// ── Config ────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:3000'

// Respuestas por material y nivel
const MATERIAL_RESPONSES: Record<string, Record<string, Record<string, string>>> = {
  bohr: {
    novato:     { bad: 'No sé nada.', medium: 'Creo que tiene algo que ver con niveles de energía.', good: 'El modelo propone que los electrones están en niveles discretos de energía y cuando saltan emiten luz.' },
    intermedio: { bad: 'Es un modelo atómico.', medium: 'Bohr propuso que los electrones tienen órbitas con energías específicas.', good: 'Bohr resolvió el problema de Rutherford: los electrones solo existen en niveles discretos dados por En=-13.6/n². Cuando saltan emiten luz de color específico.' },
    experto:    { bad: 'Es un modelo cuántico.', medium: 'El modelo postula órbitas cuantizadas con energías En=-13.6/n² eV.', good: 'Bohr resolvió el colapso del átomo de Rutherford postulando órbitas cuantizadas. La energía En=-13.6/n² explica el espectro discreto del hidrógeno. El modelo falla para átomos multielectrónicos porque ignora el spin.' },
  },
  cardio: {
    novato:     { bad: 'No sé nada.', medium: 'Creo que la sístole es cuando el corazón late.', good: 'La sístole es la contracción del corazón que expulsa sangre y la diástole es la relajación donde se llena de sangre.' },
    intermedio: { bad: 'Es algo del corazón.', medium: 'La sístole contrae los ventrículos y la diástole los relaja para llenarse de sangre.', good: 'El gasto cardíaco es FC × VS. En sístole los ventrículos se contraen y expulsan sangre a la aorta. En diástole se relajan y se llenan. La insuficiencia ocurre cuando GC no mantiene la demanda.' },
    experto:    { bad: 'Es una fase cardíaca.', medium: 'Sístole = contracción ventricular, diástole = relajación. GC = FC × VS = 70×70 = 4.9 L/min en reposo.', good: 'En sístole ventricular las válvulas AV se cierran y las semilunares se abren. GC = FC × VS regulado por precarga, postcarga y contractilidad. La insuficiencia reduce la fracción de eyección por debajo del 40%.' },
  },
  derecho: {
    novato:     { bad: 'No sé nada.', medium: 'Creo que tiene que ver con leyes y el gobierno.', good: 'La Constitución es la ley suprema y ninguna ley puede contradecirla. El Estado se divide en poder ejecutivo, legislativo y judicial.' },
    intermedio: { bad: 'Es el derecho del Estado.', medium: 'La supremacía constitucional significa que la Constitución está por encima de todas las leyes. La separación de poderes evita la concentración del poder.', good: 'La Constitución es la norma suprema: las leyes que la contradicen son inconstitucionales. La separación de poderes en ejecutivo, legislativo y judicial con controles recíprocos previene el abuso. Los derechos fundamentales protegen la dignidad y son directamente aplicables.' },
    experto:    { bad: 'Es derecho público.', medium: 'La supremacía constitucional implica jerarquía normativa. El control constitucional lo ejerce el Tribunal Constitucional.', good: 'La supremacía constitucional establece que la Constitución encabeza la pirámide normativa de Kelsen. El control de constitucionalidad puede ser difuso (cualquier juez) o concentrado (Tribunal Constitucional). Los derechos fundamentales tienen eficacia directa horizontal y vertical.' },
  },
  calculo: {
    novato:     { bad: 'No sé nada.', medium: 'Creo que una función relaciona números de alguna manera.', good: 'Una función asigna a cada valor de x exactamente un valor de f(x). El dominio son los valores válidos de x.' },
    intermedio: { bad: 'Es una ecuación.', medium: 'Una función f(x) asigna un único valor a cada x. El límite es el valor al que se aproxima cuando x tiende a un punto.', good: 'Una función asigna exactamente un f(x) por cada x en el dominio. El límite lim(x→a)f(x)=L existe si ambos límites laterales coinciden. La continuidad requiere f(a)=L.' },
    experto:    { bad: 'Es una relación matemática.', medium: 'f(x) es continua en a si lim(x→a)f(x)=f(a). La derivada f\'(x)=lim(h→0)[f(x+h)-f(x)]/h.', good: 'Una función es continua en a si el límite bilateral existe, f(a) existe, y son iguales. La derivabilidad implica continuidad pero no viceversa. La regla de L\'Hôpital resuelve indeterminaciones 0/0 o ∞/∞.' },
  },
}

const STUDENT_PROFILES = {
  novato: {
    label: 'Novato — nunca vio esto',
    overallMastery: 0,
  },
  intermedio: {
    label: 'Intermedio — vio algo antes',
    overallMastery: 35,
  },
  experto: {
    label: 'Experto — domina el tema',
    overallMastery: 80,
  },
}

const MATERIALS = {
  derecho: {
    title: 'Derecho Constitucional',
    content: `El derecho constitucional es la rama del derecho público que estudia la organización del Estado y los derechos fundamentales. La Constitución es la norma suprema del ordenamiento jurídico: ninguna ley puede contradecirla. El principio de separación de poderes divide el Estado en poder ejecutivo, legislativo y judicial, con controles recíprocos entre ellos. Los derechos fundamentales son derechos subjetivos reconocidos por la Constitución que protegen la dignidad humana: incluyen derechos civiles (libertad de expresión, derecho a la vida), políticos (voto, participación) y sociales (educación, salud). El control constitucional verifica que las leyes respeten la Constitución; en muchos países lo ejerce un Tribunal Constitucional mediante el recurso de inconstitucionalidad.`,
    knowledgeType: 'legal',
    concepts: ['Supremacía constitucional', 'Separación de poderes', 'Derechos fundamentales'],
  },
  bohr: {
    title: 'Modelo atómico de Bohr',
    content: `El modelo atómico de Bohr fue propuesto en 1913 por Niels Bohr para resolver el problema del modelo de Rutherford. Rutherford había propuesto que los electrones orbitan el núcleo, pero no podía explicar por qué no caían sobre él ni por qué el hidrógeno emite luz en colores específicos. Bohr postuló que los electrones solo pueden existir en órbitas con energías específicas llamadas niveles de energía. La energía de cada nivel se calcula con En = -13.6/n² eV, donde n es el número cuántico principal. Cuando un electrón salta de un nivel superior a uno inferior, emite un fotón de luz con energía igual a la diferencia entre los dos niveles. Esto explica el espectro de líneas del hidrógeno. El modelo de Bohr fue revolucionario pero limitado: funciona bien para hidrógeno pero no para átomos con más electrones.`,
    knowledgeType: 'conceptual',
    concepts: ['Modelo de Bohr', 'Niveles de energía', 'Espectro del hidrógeno'],
  },
  cardio: {
    title: 'Fisiología cardiovascular',
    content: `El corazón bombea sangre mediante ciclos de contracción (sístole) y relajación (diástole). Durante la sístole ventricular, los ventrículos se contraen y expulsan sangre hacia la aorta y arteria pulmonar. Durante la diástole, los ventrículos se relajan y se llenan de sangre proveniente de las aurículas. El gasto cardíaco es el volumen de sangre bombeado por minuto: GC = FC × VS, donde FC es frecuencia cardíaca y VS es volumen sistólico. En reposo normal: 70 lpm × 70 ml = 4.9 L/min. La insuficiencia cardíaca ocurre cuando el corazón no puede mantener el gasto cardíaco necesario.`,
    knowledgeType: 'medical',
    concepts: ['Sístole', 'Diástole', 'Gasto cardíaco'],
  },
  calculo: {
    title: 'Funciones y límites',
    content: `Una función f(x) es una relación que asigna a cada valor de x exactamente un valor de f(x). El dominio es el conjunto de valores válidos de x. El límite de f(x) cuando x tiende a a es el valor al que se aproxima f(x) cuando x se acerca a a. Se escribe: lim(x→a) f(x) = L. Un límite puede existir aunque f(a) no esté definida. La continuidad requiere que f(a) exista, el límite exista, y sean iguales. La derivada f'(x) = lim(h→0) [f(x+h)-f(x)]/h mide la tasa de cambio instantánea.`,
    knowledgeType: 'mathematical',
    concepts: ['Función', 'Límite', 'Continuidad'],
  },
}

// ── Helpers ────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function header(text: string) {
  console.log(`\n${C.bold}${C.cyan}${'─'.repeat(50)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`)
  console.log(`${C.cyan}${'─'.repeat(50)}${C.reset}`)
}

function ok(text: string) { console.log(`${C.green}  ✓ ${text}${C.reset}`) }
function err(text: string) { console.log(`${C.red}  ✗ ${text}${C.reset}`) }
function info(text: string) { console.log(`${C.gray}  ${text}${C.reset}`) }
function warn(text: string) { console.log(`${C.yellow}  ⚠ ${text}${C.reset}`) }
function result(label: string, value: any) {
  console.log(`  ${C.bold}${label}:${C.reset} ${value}`)
}

async function post(endpoint: string, body: any): Promise<any> {
  const start = Date.now()
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - start
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${endpoint} → ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  info(`${endpoint} → ${ms}ms`)
  return data
}

// ── SIMULADOR PRINCIPAL ─────────────────────────────────────────
async function simulate(materialKey: string, studentKey: string) {
  const material = MATERIALS[materialKey as keyof typeof MATERIALS] || MATERIALS.bohr
  const student = STUDENT_PROFILES[studentKey as keyof typeof STUDENT_PROFILES] || STUDENT_PROFILES.novato

  console.log(`\n${C.bold}${'═'.repeat(50)}${C.reset}`)
  console.log(`${C.bold}  STUDYAL ADAPTIVE SIMULATOR${C.reset}`)
  console.log(`${'═'.repeat(50)}`)
  console.log(`  Material: ${C.cyan}${material.title}${C.reset}`)
  console.log(`  Estudiante: ${C.cyan}${student.label}${C.reset}`)
  console.log(`  Servidor: ${BASE_URL}`)

  let totalMs = 0
  let errors = 0
  const results: Record<string, any> = {}

  // ════ STEP 1: PLAN SESSION ════════════════════════════════════
  header('STEP 1 — Session Designer')
  try {
    const planData = await post('/api/adaptive/plan-session', {
      sessionBlueprint: {
        title: material.title,
        objective: `Dominar ${material.concepts[0]}`,
        purpose: 'understand',
      },
      topics: [{
        id: 't1',
        title: material.title,
        primaryKnowledgeType: material.knowledgeType,
        knowledgeType: material.knowledgeType,
        concepts: material.concepts.map((c, i) => ({
          name: c, definition: `concepto ${i+1}`, difficulty: 55 + i*10
        })),
        difficulty: 60,
      }],
      sessionLength: 'medium',
      sessionNumber: 1,
      previousEvidence: {},
    })

    const plan = planData.pedagogicalPlan || {}
    results.plan = plan
    results.steps = planData.steps || []

    ok(`Plan generado: ${results.steps.length} pasos`)
    result('learningGoal', plan.learningGoal)
    result('bestSequence', (plan.bestSequence || []).join(' → '))
    result('depth', plan.depth)
    result('commonFailure', (plan.commonFailure || '').slice(0, 70))
    console.log()
    console.log(`  ${C.bold}Pasos:${C.reset}`)
    results.steps.forEach((s: any, i: number) => {
      console.log(`    ${i+1}. [${s.type}] ${s.title?.slice(0, 45)}`)
    })

    // Verificar que la secuencia es correcta para el tipo de material
    const seq = plan.bestSequence || []
    if (material.knowledgeType === 'mathematical' && !seq.includes('worked_example') && !seq.includes('guided_practice')) {
      warn('Material matemático sin worked_example ni guided_practice')
    }
    if (material.knowledgeType === 'medical' && !seq.includes('cause_effect') && !seq.includes('case_study')) {
      warn('Material médico sin cause_effect ni case_study')
    }

  } catch(e: any) {
    err(`Plan session falló: ${e.message}`)
    errors++
  }

  // ════ STEP 2: EXPLAIN ═════════════════════════════════════════
  header('STEP 2 — Explicación (nivel cero)')
  try {
    const explainData = await post('/api/adaptive/explain', {
      topicTitle: material.title,
      targetConcepts: material.concepts,
      focusConcept: material.concepts[0],
      contenido: material.content,
      overallMastery: student.overallMastery,
      sessionNumber: 1,
      actType: 'context',
      knowledgeType: material.knowledgeType,
      learningGoal: results.plan?.learningGoal || 'explain_concept',
      alreadyExplained: [],
      failureType: 'none',
    })

    results.explanation = explainData.content || ''
    ok('Explicación generada')
    result('conceptCovered', explainData.conceptCovered)
    result('keyIdea', (explainData.keyIdea || '').slice(0, 70))
    result('recallPrompt', (explainData.recallPrompt || '').slice(0, 70))
    console.log()
    console.log(`  ${C.bold}Primeras líneas:${C.reset}`)
    const lines = results.explanation.split('\n').filter((l: string) => l.trim()).slice(0, 3)
    lines.forEach((l: string) => console.log(`  ${C.gray}${l.slice(0, 85)}${C.reset}`))

    // Verificar que no empieza con frases prohibidas
    const forbidden = ['imagina', 'piensa en', 'supón', 'es importante']
    const firstWord = results.explanation.toLowerCase().slice(0, 30)
    if (forbidden.some(f => firstWord.includes(f))) {
      warn('La explicación empieza con frase prohibida')
    } else {
      ok('No empieza con frases prohibidas')
    }

  } catch(e: any) {
    err(`Explain falló: ${e.message}`)
    errors++
  }

  // ════ STEP 3: QUIZ ════════════════════════════════════════════
  header('STEP 3 — Quiz (basado en explicación)')
  try {
    const quizData = await post('/api/adaptive/quiz', {
      topicTitle: material.title,
      targetConcepts: material.concepts,
      focusConcept: material.concepts[0],
      contenido: material.content,
      lastExplanation: results.explanation?.slice(0, 2000) || '',
      overallMastery: student.overallMastery,
      sessionNumber: 1,
      count: 2,
      actType: 'micro_quiz',
      knowledgeType: material.knowledgeType,
      learningGoal: results.plan?.learningGoal || 'explain_concept',
      previousTypes: [],
    })

    results.quiz = quizData
    const qs = quizData.questions || []
    ok(`${qs.length} preguntas generadas (tipo: ${quizData.questionType})`)

    qs.forEach((q: any, i: number) => {
      console.log(`\n  Q${i+1}: ${q.question?.slice(0, 75)}`)
      const opts = q.options || []
      const correct = q.correctAnswer ?? 0
      opts.forEach((o: string, j: number) => {
        const marker = j === correct ? `${C.green}✓${C.reset}` : ' '
        console.log(`    ${marker} ${String.fromCharCode(65+j)}. ${o.slice(0, 60)}`)
      })
    })

    // Verificar que las opciones no son absurdas
    if (qs.length > 0) {
      const allOpts = (qs[0].options || []).join(' ').toLowerCase()
      if (allOpts.includes('legislación laboral') || allOpts.includes('no tiene importancia')) {
        warn('Opciones incorrectas pueden ser demasiado obvias')
      } else {
        ok('Opciones parecen creíbles')
      }
    }

  } catch(e: any) {
    err(`Quiz falló: ${e.message}`)
    errors++
  }

  // ════ STEP 4: EVALUADOR — 3 niveles ══════════════════════════
  header('STEP 4 — Evaluador (3 niveles de respuesta)')

  const recallScores: number[] = []
  const materialResponses = MATERIAL_RESPONSES[materialKey] || MATERIAL_RESPONSES.bohr
  const studentResponses = materialResponses[studentKey] || materialResponses.novato
  for (const [level, response] of Object.entries(studentResponses)) {
    try {
      const evalData = await post('/api/adaptive/chat', {
        topicTitle: material.title,
        targetConcepts: material.concepts,
        contenido: material.content,
        message: response,
        evaluateWithFeedback: true,
        stepType: 'recall',
        recallPrompt: `Explica ${material.concepts[0]} con tus palabras`,
        overallMastery: student.overallMastery,
        lastExplanation: results.explanation?.slice(0, 1500) || '',
      })

      const score = evalData.score || 0
      const failure = evalData.failureType || 'none'
      recallScores.push(score)

      const color = score >= 75 ? C.green : score >= 45 ? C.yellow : C.red
      console.log(`  [${level.padEnd(8)}] ${color}score: ${score}${C.reset} | failure: ${failure}`)
      info(`  respuesta: "${response.slice(0, 60)}"`)

    } catch(e: any) {
      err(`Evaluador (${level}) falló: ${e.message}`)
      errors++
    }
  }

  // Verificar que los scores son progresivos
  if (recallScores.length === 3) {
    if (recallScores[0] < recallScores[1] && recallScores[1] < recallScores[2]) {
      ok(`Scores progresivos: ${recallScores.join(' < ')} ✓`)
    } else {
      warn(`Scores no progresivos: ${recallScores.join(', ')} — revisar calibración`)
    }
  }

  // ════ STEP 5: REPAIR (si falló) ═══════════════════════════════
  header('STEP 5 — Repair (failureType=application)')
  try {
    const repairData = await post('/api/adaptive/explain', {
      topicTitle: material.title,
      targetConcepts: [material.concepts[0]],
      focusConcept: material.concepts[0],
      contenido: material.content,
      overallMastery: student.overallMastery,
      sessionNumber: 1,
      mode: 'repair',
      actType: 'worked_example',
      knowledgeType: material.knowledgeType,
      learningGoal: 'apply_to_case',
      alreadyExplained: [material.concepts[0]],
      failureType: 'application',
      lastExplanation: results.explanation?.slice(0, 1000) || '',
    })

    ok('Repair generado')
    result('keyIdea', (repairData.keyIdea || '').slice(0, 70))
    console.log()
    const repairLines = (repairData.content || '').split('\n').filter((l: string) => l.trim()).slice(0, 3)
    repairLines.forEach((l: string) => console.log(`  ${C.gray}${l.slice(0, 85)}${C.reset}`))

    // Verificar que el repair es diferente a la explicación original
    const explainWords = new Set((results.explanation || '').toLowerCase().split(/\s+/).slice(0, 20))
    const repairStart = (repairData.content || '').toLowerCase().split(/\s+/).slice(0, 20)
    const overlap = repairStart.filter(w => explainWords.has(w)).length
    if (overlap > 15) {
      warn('El repair puede estar repitiendo la misma explicación')
    } else {
      ok('El repair usa ángulo diferente')
    }

  } catch(e: any) {
    err(`Repair falló: ${e.message}`)
    errors++
  }

  // ════ STEP 6: FLASHCARDS ══════════════════════════════════════
  header('STEP 6 — Flashcards')
  try {
    const flashData = await post('/api/adaptive/flashcards', {
      topicTitle: material.title,
      targetConcepts: material.concepts,
      contenido: material.content,
      overallMastery: student.overallMastery,
      count: 3,
    })

    const cards = flashData.cards || []
    ok(`${cards.length} flashcards generadas`)
    cards.forEach((c: any, i: number) => {
      console.log(`\n  Card ${i+1}:`)
      console.log(`    ${C.bold}Q:${C.reset} ${(c.front || '').slice(0, 70)}`)
      console.log(`    ${C.bold}A:${C.reset} ${(c.back || '').slice(0, 70)}`)
    })

    // Verificar que las preguntas no son solo "¿Qué es X?"
    const triviaCount = cards.filter((c: any) =>
      /^¿qué es|^qué es|^define|^definición/i.test(c.front || '')
    ).length
    if (triviaCount > cards.length / 2) {
      warn('Muchas flashcards son solo definiciones — deberían conectar ideas')
    } else {
      ok('Flashcards conectan ideas (no solo definiciones)')
    }

  } catch(e: any) {
    err(`Flashcards falló: ${e.message}`)
    errors++
  }

  // ════ RESUMEN FINAL ════════════════════════════════════════════
  console.log(`\n${C.bold}${'═'.repeat(50)}${C.reset}`)
  console.log(`${C.bold}  RESUMEN${C.reset}`)
  console.log(`${'═'.repeat(50)}`)
  result('Material', material.title)
  result('Tipo', material.knowledgeType)
  result('Estudiante', student.label)
  result('Pasos generados', results.steps?.length || 0)
  result('Secuencia', (results.plan?.bestSequence || []).join(' → '))
  result('Scores evaluador', recallScores.join(' / '))
  result('Errores', errors === 0 ? `${C.green}0${C.reset}` : `${C.red}${errors}${C.reset}`)

  if (errors === 0) {
    console.log(`\n${C.green}${C.bold}  ✓ SIMULACIÓN COMPLETA SIN ERRORES${C.reset}`)
  } else {
    console.log(`\n${C.red}${C.bold}  ✗ ${errors} ERROR(ES) — REVISAR${C.reset}`)
  }
  console.log()
}

// ── Entry point ────────────────────────────────────────────────
const materialArg = process.argv[2] || 'bohr'
const studentArg = process.argv[3] || 'novato'
simulate(materialArg, studentArg).catch(e => {
  console.error(`\n${C.red}ERROR FATAL: ${e.message}${C.reset}`)
  process.exit(1)
})
