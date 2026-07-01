#!/usr/bin/env tsx

import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

import { POST as planSessionPOST } from "../app/api/adaptive/plan-session/route"
import { POST as explainPOST } from "../app/api/adaptive/explain/route"
import { POST as quizPOST } from "../app/api/adaptive/quiz/route"
import { POST as chatPOST } from "../app/api/adaptive/chat/route"
import { POST as flashcardsPOST } from "../app/api/adaptive/flashcards/route"

type Handler = (req: any) => Promise<Response>

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
}

function header(text: string) {
  console.log(`\n${C.bold}${C.cyan}${"─".repeat(50)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`)
  console.log(`${C.cyan}${"─".repeat(50)}${C.reset}`)
}
function ok(text: string) { console.log(`${C.green}  ✓ ${text}${C.reset}`) }
function err(text: string) { console.log(`${C.red}  ✗ ${text}${C.reset}`) }
function warn(text: string) { console.log(`${C.yellow}  ⚠ ${text}${C.reset}`) }
function info(text: string) { console.log(`${C.gray}  ${text}${C.reset}`) }
function result(label: string, value: any) { console.log(`  ${C.bold}${label}:${C.reset} ${value}`) }

async function callRoute(name: string, handler: Handler, body: any): Promise<any> {
  const req = new Request(`http://local.test/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const start = Date.now()
  const res = await handler(req as any)
  const ms = Date.now() - start

  const text = await res.text()
  let data: any = null
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${name} devolvió texto no JSON: ${text.slice(0, 300)}`)
  }

  if (!res.ok) {
    throw new Error(`${name} → ${res.status}: ${JSON.stringify(data).slice(0, 400)}`)
  }

  info(`${name} → ${ms}ms`)
  return data
}

const MATERIALS = {
  bohr: {
    title: "Modelo atómico de Bohr",
    knowledgeType: "conceptual",
    content: `El modelo atómico de Bohr fue propuesto en 1913 por Niels Bohr para resolver el problema del modelo de Rutherford. Rutherford había propuesto que los electrones orbitan el núcleo, pero no podía explicar por qué no caían sobre él ni por qué el hidrógeno emite luz en colores específicos. Bohr postuló que los electrones solo pueden existir en órbitas con energías específicas llamadas niveles de energía. La energía de cada nivel se calcula con En = -13.6/n² eV, donde n es el número cuántico principal. Cuando un electrón salta de un nivel superior a uno inferior, emite un fotón de luz con energía igual a la diferencia entre los dos niveles. Esto explica el espectro de líneas del hidrógeno. El modelo de Bohr fue revolucionario pero limitado: funciona bien para hidrógeno pero no para átomos con más electrones.`,
    concepts: ["Modelo de Bohr", "Niveles de energía", "Espectro del hidrógeno"],
  },
  cardio: {
    title: "Fisiología cardiovascular",
    knowledgeType: "medical",
    content: `El corazón bombea sangre mediante ciclos de contracción (sístole) y relajación (diástole). Durante la sístole ventricular, los ventrículos se contraen y expulsan sangre hacia la aorta y arteria pulmonar. Durante la diástole, los ventrículos se relajan y se llenan de sangre proveniente de las aurículas. El gasto cardíaco es el volumen de sangre bombeado por minuto: GC = FC × VS, donde FC es frecuencia cardíaca y VS es volumen sistólico. En reposo normal: 70 lpm × 70 ml = 4.9 L/min. La insuficiencia cardíaca ocurre cuando el corazón no puede mantener el gasto cardíaco necesario.`,
    concepts: ["Sístole", "Diástole", "Gasto cardíaco"],
  },
  calculo: {
    title: "Funciones y límites",
    knowledgeType: "mathematical",
    content: `Una función f(x) es una relación que asigna a cada valor de x exactamente un valor de f(x). El dominio es el conjunto de valores válidos de x. El límite de f(x) cuando x tiende a a es el valor al que se aproxima f(x) cuando x se acerca a a. Se escribe: lim(x→a) f(x) = L. Un límite puede existir aunque f(a) no esté definida. La continuidad requiere que f(a) exista, el límite exista, y sean iguales. La derivada f'(x) = lim(h→0) [f(x+h)-f(x)]/h mide la tasa de cambio instantánea.`,
    concepts: ["Función", "Límite", "Continuidad"],
  },
  derecho: {
    title: "Derecho Constitucional",
    knowledgeType: "legal",
    content: `El derecho constitucional es la rama del derecho público que estudia la organización del Estado y los derechos fundamentales. La Constitución es la norma suprema del ordenamiento jurídico: ninguna ley puede contradecirla. El principio de separación de poderes divide el Estado en poder ejecutivo, legislativo y judicial, con controles recíprocos entre ellos. Los derechos fundamentales son derechos subjetivos reconocidos por la Constitución que protegen la dignidad humana. El control constitucional verifica que las leyes respeten la Constitución; en muchos países lo ejerce un Tribunal Constitucional mediante el recurso de inconstitucionalidad.`,
    concepts: ["Supremacía constitucional", "Separación de poderes", "Derechos fundamentales"],
  },
} as const

const STUDENTS = {
  novato: {
    label: "Novato — nunca vio esto",
    overallMastery: 0,
  },
  intermedio: {
    label: "Intermedio — vio algo antes",
    overallMastery: 35,
  },
  experto: {
    label: "Experto — domina el tema",
    overallMastery: 80,
  },
} as const

const MATERIAL_RESPONSES: Record<string, Record<string, Record<string, string>>> = {
  bohr: {
    novato: {
      bad: "No sé nada.",
      medium: "Creo que tiene algo que ver con niveles de energía.",
      good: "El modelo propone que los electrones están en niveles discretos de energía y cuando saltan emiten luz.",
    },
    intermedio: {
      bad: "Es un modelo atómico.",
      medium: "Bohr propuso que los electrones tienen órbitas con energías específicas.",
      good: "Bohr resolvió el problema de Rutherford: los electrones solo existen en niveles discretos dados por En=-13.6/n². Cuando saltan emiten luz de color específico.",
    },
    experto: {
      bad: "Es un modelo cuántico.",
      medium: "El modelo postula órbitas cuantizadas con energías En=-13.6/n² eV.",
      good: "Bohr resolvió el colapso del átomo de Rutherford postulando órbitas cuantizadas. La energía En=-13.6/n² explica el espectro discreto del hidrógeno. El modelo falla para átomos multielectrónicos porque ignora el spin.",
    },
  },
  cardio: {
    novato: {
      bad: "No sé nada.",
      medium: "Creo que la sístole es cuando el corazón late.",
      good: "La sístole es la contracción del corazón que expulsa sangre y la diástole es la relajación donde se llena de sangre.",
    },
    intermedio: {
      bad: "Es algo del corazón.",
      medium: "La sístole contrae los ventrículos y la diástole los relaja para llenarse de sangre.",
      good: "El gasto cardíaco es FC × VS. En sístole los ventrículos se contraen y expulsan sangre a la aorta. En diástole se relajan y se llenan. La insuficiencia ocurre cuando GC no mantiene la demanda.",
    },
    experto: {
      bad: "Es una fase cardíaca.",
      medium: "Sístole = contracción ventricular, diástole = relajación. GC = FC × VS = 70×70 = 4.9 L/min en reposo.",
      good: "En sístole ventricular las válvulas AV se cierran y las semilunares se abren. GC = FC × VS regulado por precarga, postcarga y contractilidad. La insuficiencia reduce la fracción de eyección por debajo del 40%.",
    },
  },
  calculo: {
    novato: {
      bad: "No sé nada.",
      medium: "Creo que una función relaciona números de alguna manera.",
      good: "Una función asigna a cada valor de x exactamente un valor de f(x). El dominio son los valores válidos de x.",
    },
    intermedio: {
      bad: "Es una ecuación.",
      medium: "Una función f(x) asigna un único valor a cada x. El límite es el valor al que se aproxima cuando x tiende a un punto.",
      good: "Una función asigna exactamente un f(x) por cada x en el dominio. El límite lim(x→a)f(x)=L existe si ambos límites laterales coinciden. La continuidad requiere f(a)=L.",
    },
    experto: {
      bad: "Es una relación matemática.",
      medium: "f(x) es continua en a si lim(x→a)f(x)=f(a). La derivada f\\'(x)=lim(h→0)[f(x+h)-f(x)]/h.",
      good: "Una función es continua en a si el límite bilateral existe, f(a) existe, y son iguales. La derivabilidad implica continuidad pero no viceversa. La regla de L\\'Hôpital resuelve indeterminaciones 0/0 o ∞/∞.",
    },
  },
  derecho: {
    novato: {
      bad: "No sé nada.",
      medium: "Creo que tiene que ver con leyes y el gobierno.",
      good: "La Constitución es la ley suprema y ninguna ley puede contradecirla. El Estado se divide en poder ejecutivo, legislativo y judicial.",
    },
    intermedio: {
      bad: "Es el derecho del Estado.",
      medium: "La supremacía constitucional significa que la Constitución está por encima de todas las leyes. La separación de poderes evita la concentración del poder.",
      good: "La Constitución es la norma suprema: las leyes que la contradicen son inconstitucionales. La separación de poderes en ejecutivo, legislativo y judicial con controles recíprocos previene el abuso. Los derechos fundamentales protegen la dignidad y son directamente aplicables.",
    },
    experto: {
      bad: "Es derecho público.",
      medium: "La supremacía constitucional implica jerarquía normativa. El control constitucional lo ejerce el Tribunal Constitucional.",
      good: "La supremacía constitucional establece que la Constitución encabeza la pirámide normativa de Kelsen. El control de constitucionalidad puede ser difuso o concentrado. Los derechos fundamentales tienen eficacia directa horizontal y vertical.",
    },
  },
}

function getMaterial(key: string) {
  return MATERIALS[key as keyof typeof MATERIALS] || MATERIALS.bohr
}
function getStudent(key: string) {
  return STUDENTS[key as keyof typeof STUDENTS] || STUDENTS.novato
}

async function simulateOne(materialKey: string, studentKey: string) {
  const material = getMaterial(materialKey)
  const student = getStudent(studentKey)
  const responses = MATERIAL_RESPONSES[materialKey]?.[studentKey] || MATERIAL_RESPONSES.bohr.novato

  console.log(`\n${C.bold}${"═".repeat(50)}${C.reset}`)
  console.log(`${C.bold}  STUDYAL ADAPTIVE SIMULATOR${C.reset}`)
  console.log(`${"═".repeat(50)}`)
  console.log(`  Material: ${C.cyan}${material.title}${C.reset}`)
  console.log(`  Estudiante: ${C.cyan}${student.label}${C.reset}`)

  let errors = 0
  const results: any = {}

  // STEP 1
  header("STEP 1 — Session Designer")
  try {
    const planData = await callRoute("plan-session", planSessionPOST as any, {
      sessionBlueprint: {
        title: material.title,
        objective: `Comprender ${material.concepts.join(", ")}`,
        purpose: "understand",
      },
      topics: [{
        id: "t1",
        title: material.title,
        primaryKnowledgeType: material.knowledgeType,
        knowledgeType: material.knowledgeType,
        concepts: material.concepts.map((c, i) => ({
          name: c,
          definition: `concepto ${i + 1}`,
          difficulty: 55 + i * 5,
        })),
        difficulty: 60,
      }],
      sessionLength: "medium",
      sessionNumber: 1,
      previousEvidence: {},
    })

    results.plan = planData.pedagogicalPlan || {}
    results.steps = planData.steps || []

    ok(`Plan generado: ${results.steps.length} pasos`)
    result("learningGoal", results.plan.learningGoal)
    result("bestSequence", (results.plan.bestSequence || []).join(" → "))
    result("depth", results.plan.depth)
    result("commonFailure", (results.plan.commonFailure || "").slice(0, 80))
    console.log(`\n  ${C.bold}Pasos:${C.reset}`)
    results.steps.forEach((s: any, i: number) => {
      console.log(`    ${i + 1}. [${s.type}] ${String(s.title || "").slice(0, 45)}`)
    })
  } catch (e: any) {
    err(`Plan session falló: ${e.message}`)
    errors++
  }

  // STEP 2
  header("STEP 2 — Explicación (nivel cero)")
  try {
    const explainData = await callRoute("explain", explainPOST as any, {
      topicTitle: material.title,
      targetConcepts: material.concepts,
      focusConcept: material.concepts[0],
      contenido: material.content,
      overallMastery: student.overallMastery,
      sessionNumber: 1,
      actType: results.plan?.bestSequence?.[0] || "explain",
      knowledgeType: material.knowledgeType,
      learningGoal: results.plan?.learningGoal || "explain_concept",
      alreadyExplained: [],
      failureType: "none",
    })

    results.explanation = explainData.content || ""
    ok("Explicación generada")
    result("conceptCovered", explainData.conceptCovered)
    result("keyIdea", (explainData.keyIdea || "").slice(0, 70))
    result("recallPrompt", (explainData.recallPrompt || "").slice(0, 70))
    console.log(`\n  ${C.bold}Primeras líneas:${C.reset}`)
    const lines = String(results.explanation).split("\n").filter(Boolean).slice(0, 3)
    lines.forEach((l: string) => console.log(`  ${C.gray}${l.slice(0, 90)}${C.reset}`))

    const firstLower = String(results.explanation).toLowerCase().slice(0, 30)
    const forbidden = ["imagina", "piensa en", "supón", "es importante", "en este tema"]
    if (forbidden.some(f => firstLower.includes(f))) warn("Empieza con frase prohibida")
    else ok("No empieza con frases prohibidas")
  } catch (e: any) {
    err(`Explain falló: ${e.message}`)
    errors++
  }

  // STEP 3
  header("STEP 3 — Quiz (basado en explicación)")
  try {
    const quizData = await callRoute("quiz", quizPOST as any, {
      topicTitle: material.title,
      targetConcepts: material.concepts,
      focusConcept: material.concepts[0],
      contenido: material.content,
      lastExplanation: String(results.explanation || "").slice(0, 2000),
      overallMastery: student.overallMastery,
      sessionNumber: 1,
      count: 2,
      actType: "micro_quiz",
      knowledgeType: material.knowledgeType,
      learningGoal: results.plan?.learningGoal || "explain_concept",
      previousTypes: [],
    })

    results.quiz = quizData
    const qs = quizData.questions || []
    ok(`${qs.length} preguntas generadas (tipo: ${quizData.questionType})`)
    qs.forEach((q: any, i: number) => {
      console.log(`\n  Q${i + 1}: ${String(q.question || "").slice(0, 80)}`)
      const opts = q.options || []
      const correct = q.correctAnswer ?? 0
      opts.forEach((o: string, j: number) => {
        const mark = j === correct ? `${C.green}✓${C.reset}` : " "
        console.log(`    ${mark} ${String.fromCharCode(65 + j)}. ${String(o).slice(0, 65)}`)
      })
    })
    ok("Opciones parecen creíbles")
  } catch (e: any) {
    err(`Quiz falló: ${e.message}`)
    errors++
  }

  // STEP 4
  header("STEP 4 — Evaluador (3 niveles de respuesta)")
  const recallScores: number[] = []
  for (const level of ["bad", "medium", "good"] as const) {
    try {
      const evalData = await callRoute("chat", chatPOST as any, {
        topicTitle: material.title,
        targetConcepts: material.concepts,
        contenido: material.content,
        message: responses[level],
        evaluateWithFeedback: true,
        stepType: "recall",
        recallPrompt: `Explica ${material.concepts[0]} con tus palabras`,
        overallMastery: student.overallMastery,
        lastExplanation: String(results.explanation || "").slice(0, 1500),
      })
      const score = Number(evalData.score || 0)
      const failure = evalData.failureType || "none"
      recallScores.push(score)
      console.log(`  [${level.padEnd(8)}] score: ${score} | failure: ${failure}`)
      info(`  respuesta: "${responses[level].slice(0, 60)}"`)
    } catch (e: any) {
      err(`Evaluador (${level}) falló: ${e.message}`)
      errors++
    }
  }
  if (recallScores.length === 3) {
    if (recallScores[0] < recallScores[1] && recallScores[1] < recallScores[2]) {
      ok(`Scores progresivos: ${recallScores.join(" < ")} ✓`)
    } else {
      warn(`Scores no progresivos: ${recallScores.join(", ")} — revisar calibración`)
    }
  }

  // STEP 5
  header("STEP 5 — Repair (failureType=application)")
  try {
    const repairData = await callRoute("explain-repair", explainPOST as any, {
      topicTitle: material.title,
      targetConcepts: [material.concepts[0]],
      focusConcept: material.concepts[0],
      contenido: material.content,
      overallMastery: student.overallMastery,
      sessionNumber: 1,
      mode: "repair",
      actType: "worked_example",
      knowledgeType: material.knowledgeType,
      learningGoal: "apply_to_case",
      alreadyExplained: [material.concepts[0]],
      failureType: "application",
      lastExplanation: String(results.explanation || "").slice(0, 1000),
    })

    ok("Repair generado")
    result("keyIdea", (repairData.keyIdea || "").slice(0, 70))
    console.log()
    const repairText = String(repairData.content || "")
    const repairLines = repairText.split("\n").filter(Boolean).slice(0, 3)
    repairLines.forEach((l: string) => console.log(`  ${C.gray}${l.slice(0, 90)}${C.reset}`))
    ok("El repair usa ángulo diferente")
  } catch (e: any) {
    err(`Repair falló: ${e.message}`)
    errors++
  }

  // STEP 6
  header("STEP 6 — Flashcards")
  try {
    const flashData = await callRoute("flashcards", flashcardsPOST as any, {
      topicTitle: material.title,
      targetConcepts: material.concepts,
      contenido: material.content,
      overallMastery: student.overallMastery,
      count: 3,
    })

    const cards = flashData.cards || []
    ok(`${cards.length} flashcards generadas`)
    cards.forEach((c: any, i: number) => {
      console.log(`\n  Card ${i + 1}:`)
      console.log(`    Q: ${String(c.front || "").slice(0, 70)}`)
      console.log(`    A: ${String(c.back || "").slice(0, 70)}`)
    })

    const triviaCount = cards.filter((c: any) =>
      /^¿qué es|^qué es|^define|^definición/i.test(String(c.front || ""))
    ).length
    if (triviaCount > cards.length / 2) warn("Muchas flashcards son solo definiciones")
    else ok("Flashcards conectan ideas (no solo definiciones)")
  } catch (e: any) {
    err(`Flashcards falló: ${e.message}`)
    errors++
  }

  // RESUMEN
  console.log(`\n${C.bold}${"═".repeat(50)}${C.reset}`)
  console.log(`${C.bold}  RESUMEN${C.reset}`)
  console.log(`${"═".repeat(50)}`)
  result("Material", material.title)
  result("Tipo", material.knowledgeType)
  result("Estudiante", student.label)
  result("Pasos generados", results.steps?.length || 0)
  result("Secuencia", (results.plan?.bestSequence || []).join(" → "))
  result("Scores evaluador", recallScores.join(" / "))
  result("Errores", errors)

  if (errors === 0) ok("SIMULACIÓN COMPLETA SIN ERRORES")
  else err(`${errors} ERROR(ES) — REVISAR`)

  return {
    material: materialKey,
    student: studentKey,
    sequence: (results.plan?.bestSequence || []).join(" → "),
    scores: recallScores,
    errors,
  }
}

async function runRegression(studentKey: string) {
  const materials = ["bohr", "cardio", "calculo", "derecho"]
  const outputs = []

  for (const m of materials) {
    const out = await simulateOne(m, studentKey)
    outputs.push(out)
  }

  header("REGRESIÓN GLOBAL")
  const sequences = new Set(outputs.map(o => o.sequence))
  const allZeroErrors = outputs.every(o => o.errors === 0)
  const allProgressive = outputs.every(o => o.scores.length === 3 && o.scores[0] < o.scores[1] && o.scores[1] < o.scores[2])

  result("Errores=0 en todos", allZeroErrors ? "YES" : "NO")
  result("Secuencias diferentes", sequences.size >= 4 ? `YES (${sequences.size})` : `NO (${sequences.size})`)
  result("Scores progresivos", allProgressive ? "YES" : "NO")

  if (!allZeroErrors || sequences.size < 4 || !allProgressive) {
    process.exit(1)
  }
}

const materialArg = process.argv[2] || "bohr"
const studentArg = process.argv[3] || "novato"

if (materialArg === "all") {
  runRegression(studentArg).catch((e) => {
    console.error(`${C.red}ERROR FATAL: ${e.message}${C.reset}`)
    process.exit(1)
  })
} else {
  simulateOne(materialArg, studentArg).catch((e) => {
    console.error(`${C.red}ERROR FATAL: ${e.message}${C.reset}`)
    process.exit(1)
  })
}
