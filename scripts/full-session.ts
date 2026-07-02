#!/usr/bin/env tsx

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import * as fs from "fs"
import * as path from "path"
import { extractText } from "../lib/materials/extractors"
import { fetchAndBuildBlueprint } from "../lib/adaptive/blueprintBuilder"
import { POST as planSessionPOST } from "../app/api/adaptive/plan-session/route"
import { POST as explainPOST } from "../app/api/adaptive/explain/route"
import { POST as quizPOST } from "../app/api/adaptive/quiz/route"
import { POST as chatPOST } from "../app/api/adaptive/chat/route"

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m", blue: "\x1b[34m", magenta: "\x1b[35m",
}

const sep = (c = "─") => console.log(C.gray + c.repeat(65) + C.reset)
const h1 = (t: string) => { console.log(); sep("═"); console.log(`${C.bold}${C.cyan}  ${t}${C.reset}`); sep("═") }
const h2 = (t: string) => { console.log(); console.log(`${C.bold}${C.blue}  ▶ ${t}${C.reset}`); sep() }
const ok = (t: string) => console.log(`${C.green}  ✓ ${t}${C.reset}`)
const box = (label: string, text: string, color = C.gray) =>
  console.log(`\n  ${C.bold}${label}${C.reset}\n  ${color}${text.split('\n').join('\n  ')}${C.reset}`)

async function callRoute(name: string, handler: any, body: any) {
  const req = new Request(`http://local/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const res = await handler(req)
  const data = await res.json()
  if (!res.ok) throw new Error(`${name}: ${JSON.stringify(data).slice(0, 200)}`)
  return data
}

async function main() {
  const filePath = process.argv[2] || "scripts/fixtures/acidos_nucleicos.pdf"
  const fileName = path.basename(filePath)

  h1(`SESIÓN ADAPTATIVA COMPLETA — ${fileName}`)

  // 1. Extraer texto
  h2("Paso 1: Extracción de texto")
  const buffer = fs.readFileSync(filePath)
  const kind = path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "docx"
  const extracted = await extractText(buffer, kind as any,
    kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName)
  const text = extracted.text || ""
  ok(`${text.length} chars extraídos (${extracted.method})`)
  console.log(`  ${C.gray}Muestra: ${text.slice(0, 150).replace(/\n/g, ' ')}...${C.reset}`)

  // 2. Blueprint
  h2("Paso 2: Análisis del material (Blueprint)")
  const blueprint = await fetchAndBuildBlueprint({
    materialId: `full_${Date.now()}`,
    materialTitle: fileName.replace(/\.[^.]+$/, ""),
    materialContent: text,
  })
  const topics = blueprint.topics || []
  ok(`${topics.length} topics identificados`)
  topics.forEach((t: any, i: number) => {
    const concepts = (t.concepts || []).map((c: any) => c.name).slice(0, 4).join(", ")
    console.log(`    ${C.bold}${i+1}. ${t.title}${C.reset}`)
    console.log(`       Conceptos: ${C.gray}${concepts}${C.reset}`)
    if (t.commonMistakes?.length) console.log(`       Error común: ${C.yellow}${t.commonMistakes[0]}${C.reset}`)
  })

  // 3. Sesión para el primer topic
  const topic = topics[0]
  const concepts = (topic.concepts || []).map((c: any) => c.name)
  const focus = concepts[0] || topic.title
  const materialSlice = text.slice(0, 8000)

  h2(`Paso 3: Session Designer para "${topic.title}"`)
  const planData = await callRoute("plan-session", planSessionPOST, {
    sessionBlueprint: {
      title: topic.title,
      objective: `Dominar: ${concepts.slice(0,3).join(", ")}`,
      purpose: "understand",
    },
    topics: [topic],
    sessionLength: "medium",
    sessionNumber: 1,
    previousEvidence: {},
  })

  const plan = planData.pedagogicalPlan || {}
  const steps = planData.steps || []

  console.log(`\n  ${C.bold}Plan pedagógico:${C.reset}`)
  console.log(`    learningGoal:   ${C.cyan}${plan.learningGoal}${C.reset}`)
  console.log(`    bestSequence:   ${C.cyan}${(plan.bestSequence || []).join(" → ")}${C.reset}`)
  console.log(`    depth:          ${C.cyan}${plan.depth}${C.reset}`)
  console.log(`    commonFailure:  ${C.yellow}${(plan.commonFailure || "").slice(0, 80)}${C.reset}`)
  console.log(`    masteryEvidence:${C.green}${(plan.masteryEvidence || "").slice(0, 80)}${C.reset}`)
  console.log(`\n  ${C.bold}Pasos de la sesión:${C.reset}`)
  steps.forEach((s: any, i: number) =>
    console.log(`    ${i+1}. [${C.magenta}${s.type}${C.reset}] ${s.title?.slice(0, 55)}`)
  )

  // 4. Explicación completa
  h2(`Paso 4: Explicación de "${focus}"`)
  const explainData = await callRoute("explain", explainPOST, {
    topicTitle: topic.title,
    targetConcepts: concepts,
    focusConcept: focus,
    contenido: materialSlice,
    overallMastery: 0,
    sessionNumber: 1,
    actType: (plan.bestSequence || ["explain"])[0],
    knowledgeType: topic.primaryKnowledgeType || "conceptual",
    learningGoal: plan.learningGoal || "explain_concept",
    alreadyExplained: [],
    failureType: "none",
  })

  const explanation = explainData.content || ""
  box("EXPLICACIÓN COMPLETA:", explanation, C.reset)
  if (explainData.keyIdea) console.log(`\n  ${C.bold}💡 Para recordar:${C.reset} ${C.yellow}${explainData.keyIdea}${C.reset}`)
  if (explainData.recallPrompt) console.log(`  ${C.bold}❓ Pregunta de recall:${C.reset} ${C.cyan}${explainData.recallPrompt}${C.reset}`)

  // 5. Quiz generado
  h2(`Paso 5: Quiz sobre "${focus}"`)
  const quizData = await callRoute("quiz", quizPOST, {
    topicTitle: topic.title,
    targetConcepts: concepts,
    focusConcept: focus,
    contenido: materialSlice,
    lastExplanation: explanation.slice(0, 2000),
    overallMastery: 0,
    sessionNumber: 1,
    count: 2,
    actType: "micro_quiz",
    knowledgeType: topic.primaryKnowledgeType || "conceptual",
    learningGoal: plan.learningGoal || "explain_concept",
    previousTypes: [],
  })

  const questions = quizData.questions || []
  questions.forEach((q: any, i: number) => {
    console.log(`\n  ${C.bold}Q${i+1}: ${q.question}${C.reset}`)
    const opts = q.options || []
    const correct = q.correctAnswer ?? 0
    opts.forEach((o: string, j: number) => {
      const mark = j === correct ? `${C.green}✓${C.reset}` : " "
      console.log(`    ${mark} ${String.fromCharCode(65+j)}. ${o}`)
    })
    if (q.explanation) console.log(`    ${C.gray}→ ${q.explanation.slice(0, 100)}${C.reset}`)
  })

  // 6. Evaluador — respuesta basada en la explicación real
  h2("Paso 6: Evaluador (respuesta buena del estudiante)")
  // Generar respuesta usando las primeras oraciones de la explicación real
  const explainSentences = explanation.split(/\.\s+/).filter(s => s.trim().length > 20)
  const goodResponse = explainSentences.length >= 2
    ? explainSentences.slice(0, 2).join('. ') + '.'
    : explanation.slice(0, 200)

  const evalData = await callRoute("chat", chatPOST, {
    topicTitle: topic.title,
    targetConcepts: concepts,
    contenido: materialSlice,
    message: goodResponse,
    evaluateWithFeedback: true,
    stepType: "recall",
    recallPrompt: explainData.recallPrompt || `Explica ${focus}`,
    overallMastery: 0,
    lastExplanation: explanation.slice(0, 1500),
  })

  console.log(`\n  ${C.bold}Respuesta simulada:${C.reset} "${goodResponse.slice(0, 80)}..."`)
  console.log(`\n  ${C.bold}Score:${C.reset} ${C.cyan}${evalData.score}${C.reset} | failureType: ${C.yellow}${evalData.failureType || "none"}${C.reset}`)
  if (evalData.correctThings) box("✓ LO QUE ESTUVO BIEN:", evalData.correctThings, C.green)
  if (evalData.wrongOrMissing) box("✗ LO QUE FALTÓ:", evalData.wrongOrMissing, C.yellow)
  if (evalData.keyIdea) console.log(`\n  ${C.bold}💡 Para recordar:${C.reset} ${C.cyan}${evalData.keyIdea}${C.reset}`)

  // DIAGNÓSTICO FINAL
  h1("DIAGNÓSTICO DEL SISTEMA")
  console.log(`\n  ${C.bold}Material:${C.reset}       ${fileName}`)
  console.log(`  ${C.bold}Topics:${C.reset}         ${topics.length}`)
  console.log(`  ${C.bold}Topic principal:${C.reset} ${topic.title}`)
  console.log(`  ${C.bold}Conceptos:${C.reset}      ${concepts.slice(0,4).join(", ")}`)
  console.log(`  ${C.bold}Estrategia:${C.reset}     ${(plan.bestSequence || []).join(" → ")}`)
  console.log(`  ${C.bold}Score evaluador:${C.reset} ${evalData.score}/100`)
  console.log()

  // ¿Qué hay que mejorar?
  const issues: string[] = []
  if (!explanation || explanation.length < 100) issues.push("❌ Explicación muy corta o vacía")
  if (!explainData.keyIdea || explainData.keyIdea.trim().length < 5) issues.push("⚠️ keyIdea muy corta o vacía — cerebras trunca el JSON")
  if (!explainData.recallPrompt || explainData.recallPrompt.trim().length < 5) issues.push("⚠️ recallPrompt vacío — cerebras trunca el JSON")
  if (questions.length < 2) issues.push("❌ Pocas preguntas generadas")
  if ((plan.bestSequence || []).length < 3) issues.push("❌ Secuencia muy corta")
  if (evalData.score < 30) issues.push("⚠️ Evaluador muy estricto — calibrar")
  // commonMistakes en blueprint es opcional — plan-session genera su propio commonFailure
  // Solo advertir si plan-session tampoco tiene commonFailure
  if (!topic.commonMistakes?.length && !plan.commonFailure) {
    issues.push("⚠️ Sin errores comunes detectados — el sistema no puede anticipar fallos")
  }

  if (issues.length === 0) {
    console.log(`  ${C.green}${C.bold}✓ SESIÓN ÓPTIMA — lista para producción${C.reset}`)
  } else {
    console.log(`  ${C.yellow}${C.bold}MEJORAS NECESARIAS:${C.reset}`)
    issues.forEach(i => console.log(`    ${i}`))
  }
  console.log()
}

main().catch(e => {
  console.error(`\n${C.red}ERROR: ${e.message}${C.reset}`)
  process.exit(1)
})
