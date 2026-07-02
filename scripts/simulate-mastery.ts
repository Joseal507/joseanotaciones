#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════
// STUDYAL — SIMULADOR DE DOMINIO COMPLETO
// Simula todas las sesiones de un material hasta dominarlo
// Uso: npm run simulate-mastery <archivo.pdf> [novato|intermedio|experto]
// ═══════════════════════════════════════════════════════════════

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import * as fs from "fs"
import * as path from "path"
import { extractText } from "../lib/materials/extractors"
import { fetchAndBuildBlueprint } from "../lib/adaptive/blueprintBuilder"
import { generateAdaptiveProgram } from "../lib/adaptive/generator"
import { POST as planSessionPOST } from "../app/api/adaptive/plan-session/route"
import { POST as explainPOST } from "../app/api/adaptive/explain/route"
import { POST as quizPOST } from "../app/api/adaptive/quiz/route"
import { POST as chatPOST } from "../app/api/adaptive/chat/route"
import type { AdaptiveProgram, AdaptiveSession } from "../lib/adaptive/program"

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m", blue: "\x1b[34m",
  magenta: "\x1b[35m", white: "\x1b[37m",
}

const sep = (c = "─", n = 65) => console.log(C.gray + c.repeat(n) + C.reset)
const h1 = (t: string) => { sep("═"); console.log(`${C.bold}${C.cyan}  ${t}${C.reset}`); sep("═") }
const h2 = (t: string) => { console.log(`\n${C.bold}${C.blue}  ▶ ${t}${C.reset}`); sep() }
const ok = (t: string) => console.log(`${C.green}  ✓ ${t}${C.reset}`)
const warn = (t: string) => console.log(`${C.yellow}  ⚠ ${t}${C.reset}`)
const info = (t: string) => console.log(`${C.gray}  ${t}${C.reset}`)

async function callRoute(name: string, handler: any, body: any): Promise<any> {
  const req = new Request(`http://local/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const res = await handler(req)
  const data = await res.json()
  if (!res.ok) throw new Error(`${name}: ${JSON.stringify(data).slice(0, 200)}`)
  return data
}

// ── Simula la respuesta del estudiante según su nivel y score previo ──
function generateStudentResponse(
  concept: string,
  explanation: string,
  level: string,
  sessionScore: number // qué tan bien va en esta sesión
): string {
  const sentences = explanation.split(/\.\s+/).filter(s => s.trim().length > 20)

  if (level === "experto" || sessionScore >= 80) {
    // Respuesta excelente: usa la explicación y agrega comprensión
    return sentences.slice(0, 3).join('. ') + '. Lo entiendo porque ' +
      (sentences[3] || 'se relaciona con el mecanismo descrito')
  }
  if (level === "intermedio" || sessionScore >= 50) {
    // Respuesta media: usa parte de la explicación
    return sentences.slice(0, 2).join('. ') + '.'
  }
  // Novato: respuesta básica que mejora con cada sesión
  if (sessionScore >= 40) {
    return `${concept} es ${sentences[0] || 'un concepto importante'}. ${sentences[1] || ''}`
  }
  return `Creo que ${concept} tiene que ver con ${sentences[0]?.slice(0, 80) || 'este tema'}. No estoy seguro de todos los detalles.`
}

// ── Simula una sesión completa ────────────────────────────────────
async function runSession(
  session: AdaptiveSession,
  materialText: string,
  blueprint: any,
  studentLevel: string,
  sessionNumber: number,
  previousScore: number
): Promise<{ score: number; conceptsLearned: string[]; failed: boolean }> {

  const topicTitle = session.title || session.topicTitle || "Topic"
  const concepts = session.targetConcepts || []
  const materialSlice = materialText.slice(0, 8000)

  // Buscar el topic en el blueprint
  const blueprintTopics = blueprint.topics || []
  const matchingTopic = blueprintTopics.find((t: any) =>
    t.title === topicTitle || concepts.some((c: string) => (t.concepts || []).some((bc: any) => bc.name === c))
  ) || blueprintTopics[sessionNumber - 1] || blueprintTopics[0]

  // 1. Plan de sesión
  let planData: any = {}
  try {
    planData = await callRoute("plan-session", planSessionPOST, {
      sessionBlueprint: {
        title: topicTitle,
        objective: session.objective || `Dominar ${concepts.slice(0,2).join(", ")}`,
        purpose: session.purpose || "understand",
      },
      topics: [matchingTopic || {
        id: `t${sessionNumber}`,
        title: topicTitle,
        primaryKnowledgeType: "conceptual",
        knowledgeType: "conceptual",
        concepts: concepts.map((c: string) => ({ name: c, definition: "", difficulty: 50 })),
        difficulty: 60,
      }],
      sessionLength: "medium",
      sessionNumber,
      previousEvidence: concepts.reduce((acc: any, c: string) => {
        acc[c] = previousScore
        return acc
      }, {}),
    })
  } catch (e: any) {
    warn(`Plan session falló: ${e.message.slice(0, 60)}`)
  }

  const plan = planData.pedagogicalPlan || {}
  const focusConcept = concepts[0] || topicTitle

  // 2. Explicación
  let explanation = ""
  let keyIdea = ""
  try {
    const explainData = await callRoute("explain", explainPOST, {
      topicTitle,
      targetConcepts: concepts,
      focusConcept,
      contenido: materialSlice,
      overallMastery: previousScore,
      sessionNumber,
      actType: (plan.bestSequence || ["explain"])[0],
      knowledgeType: matchingTopic?.primaryKnowledgeType || "conceptual",
      learningGoal: plan.learningGoal || "explain_concept",
      alreadyExplained: [],
      failureType: "none",
    })
    explanation = explainData.content || ""
    keyIdea = explainData.keyIdea || ""
  } catch (e: any) {
    warn(`Explain falló: ${e.message.slice(0, 60)}`)
  }

  // 3. Quiz
  let quizScore = 0
  try {
    const quizData = await callRoute("quiz", quizPOST, {
      topicTitle,
      targetConcepts: concepts,
      focusConcept,
      contenido: materialSlice,
      lastExplanation: explanation.slice(0, 2000),
      overallMastery: previousScore,
      sessionNumber,
      count: 2,
      actType: "micro_quiz",
      knowledgeType: matchingTopic?.primaryKnowledgeType || "conceptual",
      learningGoal: plan.learningGoal || "explain_concept",
      previousTypes: [],
    })
    // Simular respuestas al quiz
    const questions = quizData.questions || []
    const correctCount = questions.filter((_: any, i: number) => {
      // El estudiante responde correctamente según su nivel y sesión
      const correctProb = studentLevel === "experto" ? 0.9
        : studentLevel === "intermedio" ? 0.7
        : Math.min(0.4 + (sessionNumber * 0.15), 0.8)
      return Math.random() < correctProb
    }).length
    quizScore = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 50
  } catch (e: any) {
    warn(`Quiz falló: ${e.message.slice(0, 60)}`)
    quizScore = 50
  }

  // 4. Recall — evaluación semántica real
  let recallScore = 0
  let failureType = "none"
  try {
    // Asegurar que tenemos contexto para la respuesta
  const responseContext = explanation.length > 50 ? explanation : materialSlice.slice(0, 500)
  const studentResponse = generateStudentResponse(focusConcept, responseContext, studentLevel, quizScore)
    const evalData = await callRoute("chat", chatPOST, {
      topicTitle,
      targetConcepts: concepts,
      contenido: materialSlice,
      message: studentResponse,
      evaluateWithFeedback: true,
      stepType: "recall",
      recallPrompt: `Explica ${focusConcept} con tus propias palabras`,
      overallMastery: previousScore,
      lastExplanation: explanation.slice(0, 1500),
    })
    recallScore = Number(evalData.score || 0)
    failureType = evalData.failureType || "none"
  } catch (e: any) {
    warn(`Recall falló: ${e.message.slice(0, 60)}`)
    recallScore = 40
  }

  // Score final de la sesión
  const sessionScore = Math.round((quizScore * 0.4) + (recallScore * 0.6))
  const conceptsLearned = sessionScore >= 60 ? concepts.slice(0, 3) : []

  return {
    score: sessionScore,
    conceptsLearned: Array.isArray(conceptsLearned) ? conceptsLearned : [],
    failed: sessionScore < 40,
  }
}

// ── SIMULADOR PRINCIPAL ───────────────────────────────────────────
async function simulateMastery(filePath: string, studentLevel: string = "novato") {
  const fileName = path.basename(filePath)

  h1(`SIMULADOR DE DOMINIO COMPLETO — ${fileName}`)
  console.log(`  Nivel inicial: ${C.cyan}${studentLevel}${C.reset}`)
  console.log(`  Objetivo: dominar el material completo\n`)

  // 1. Extraer texto
  const buffer = fs.readFileSync(filePath)
  const kind = path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "docx"
  const extracted = await extractText(buffer, kind as any,
    kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName)
  const materialText = extracted.text || ""
  ok(`Texto extraído: ${materialText.length} chars (${extracted.method})`)

  // 2. Blueprint
  h2("Analizando material")
  const blueprint = await fetchAndBuildBlueprint({
    materialId: `mastery_${Date.now()}`,
    materialTitle: fileName.replace(/\.[^.]+$/, ""),
    materialContent: materialText,
  })
  const topics = blueprint.topics || []
  ok(`${topics.length} topics detectados`)
  topics.forEach((t: any, i: number) => {
    const concepts = (t.concepts || []).map((c: any) => c.name).slice(0, 3).join(", ")
    console.log(`    ${i+1}. ${C.bold}${t.title}${C.reset} → ${C.gray}${concepts}${C.reset}`)
  })

  // 3. Generar programa adaptativo
  h2("Generando programa de estudio")
  const setup = {
    sessionLength: "medium" as const,
    targetScore: 80,
    examDate: "in_1_week" as const,
    initialKnowledgeLevel: studentLevel === "experto" ? "review" : studentLevel === "intermedio" ? "some" : "zero",
    dailyMinutes: 30,
  }

  let program: AdaptiveProgram
  try {
    program = await generateAdaptiveProgram(null, setup, blueprint, null, null)
    ok(`Programa generado: ${program.sessions.length} sesiones`)
    program.sessions.forEach((s: any, i: number) => {
      console.log(`    ${i+1}. ${s.title?.slice(0, 50)} [${s.purpose}]`)
    })
  } catch (e: any) {
    warn(`Error generando programa: ${e.message.slice(0, 80)}`)
    // Crear programa manual desde los topics
    program = {
      id: `prog_${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      materialIds: [],
      setup,
      status: "active",
      sessions: topics.slice(0, 5).map((t: any, i: number) => ({
        id: `sess_${i}`,
        sessionNumber: i + 1,
        title: t.title,
        topicTitle: t.title,
        objective: `Dominar ${t.title}`,
        purpose: i === topics.length - 1 ? "simulate" : "understand",
        status: i === 0 ? "available" : "locked",
        targetConcepts: (t.concepts || []).map((c: any) => c.name).slice(0, 4),
        steps: [],
        estimatedMinutes: 22,
        expectedDomainGain: 18,
        evidenceGoal: "",
        blueprintConfidence: blueprint.confidence || 70,
        sessionFormat: "discovery",
      })) as any[],
      currentSessionIndex: 0,
      strategy: {} as any,
      materialBlueprint: blueprint,
    }
    ok(`Programa manual: ${program.sessions.length} sesiones`)
  }

  // 4. Simular todas las sesiones
  h2("Simulando sesiones de estudio")

  let overallScore = 0
  let totalConceptsLearned: string[] = []
  const sessionResults: Array<{
    session: string
    score: number
    concepts: string[]
    failed: boolean
  }> = []

  for (let i = 0; i < program.sessions.length; i++) {
    const session = program.sessions[i]
    const sessionNum = i + 1

    console.log(`\n  ${C.bold}${C.magenta}Sesión ${sessionNum}/${program.sessions.length}: ${session.title?.slice(0, 50)}${C.reset}`)

    const result = await runSession(
      session,
      materialText,
      blueprint,
      studentLevel,
      sessionNum,
      overallScore
    )

    // Actualizar score global
    overallScore = Math.round((overallScore * i + result.score) / (i + 1))
    totalConceptsLearned = [...new Set([...totalConceptsLearned, ...((result.conceptsLearned || []) as string[])])]

    const scoreColor = result.score >= 70 ? C.green : result.score >= 50 ? C.yellow : C.red
    console.log(`    Score: ${scoreColor}${result.score}/100${C.reset} | Conceptos: ${(result.conceptsLearned || []).slice(0, 3).join(", ") || "ninguno dominado"}`)
    if (result.failed) {
      warn(`    Necesita refuerzo — score bajo`)
    }

    sessionResults.push({
      session: session.title || `Sesión ${sessionNum}`,
      score: result.score,
      concepts: result.conceptsLearned || [],
      failed: result.failed,
    })

    // Pequeña pausa para no saturar la API
    await new Promise(r => setTimeout(r, 500))
  }

  // 5. DIAGNÓSTICO FINAL DE DOMINIO
  h1("DIAGNÓSTICO FINAL DE DOMINIO")

  const sessionsCompleted = sessionResults.length
  const sessionsPassed = sessionResults.filter(r => r.score >= 60).length
  const sessionsFailed = sessionResults.filter(r => r.failed).length
  const domainPercent = Math.round((sessionsPassed / sessionsCompleted) * 100)

  console.log(`\n  ${C.bold}Material:${C.reset}           ${fileName}`)
  console.log(`  ${C.bold}Nivel inicial:${C.reset}       ${studentLevel}`)
  console.log(`  ${C.bold}Sesiones completadas:${C.reset} ${sessionsCompleted}`)
  console.log(`  ${C.bold}Sesiones dominadas:${C.reset}  ${sessionsPassed}/${sessionsCompleted}`)
  console.log(`  ${C.bold}Dominio global:${C.reset}      ${overallScore}/100`)
  console.log(`  ${C.bold}Conceptos aprendidos:${C.reset} ${totalConceptsLearned.length}`)
  if (totalConceptsLearned.length > 0) {
    totalConceptsLearned.slice(0, 8).forEach(c =>
      console.log(`    ${C.green}✓${C.reset} ${c}`)
    )
  }

  console.log(`\n  ${C.bold}Resultado por sesión:${C.reset}`)
  sessionResults.forEach((r, i) => {
    const icon = r.score >= 70 ? `${C.green}✓` : r.score >= 50 ? `${C.yellow}~` : `${C.red}✗`
    console.log(`    ${icon}${C.reset} Sesión ${i+1}: ${r.session.slice(0, 40).padEnd(40)} ${r.score}/100`)
  })

  console.log()
  if (overallScore >= 75) {
    console.log(`  ${C.green}${C.bold}  ✓ MATERIAL DOMINADO — listo para el examen${C.reset}`)
  } else if (overallScore >= 55) {
    console.log(`  ${C.yellow}${C.bold}  ~ DOMINIO PARCIAL — revisar sesiones con score bajo${C.reset}`)
    const weak = sessionResults.filter(r => r.score < 60)
    weak.forEach(r => console.log(`    ${C.yellow}Revisar: ${r.session.slice(0, 50)}${C.reset}`))
  } else {
    console.log(`  ${C.red}${C.bold}  ✗ NECESITA MÁS ESTUDIO — dominio insuficiente${C.reset}`)
  }

  console.log(`\n  ${C.bold}¿Qué necesitas para dominar el 100%?${C.reset}`)
  if (sessionsFailed > 0) {
    console.log(`  ${C.yellow}• Repetir ${sessionsFailed} sesión(es) con score bajo${C.reset}`)
  }
  if (overallScore < 80) {
    console.log(`  ${C.yellow}• Hacer más práctica en: ${sessionResults.filter(r => r.score < 70).map(r => r.session.slice(0, 30)).join(", ")}${C.reset}`)
  }
  if (overallScore >= 80) {
    console.log(`  ${C.green}• Nada — ya dominaste el material ✓${C.reset}`)
  }
  console.log()
}

// ── Entry Point ───────────────────────────────────────────────────
const filePath = process.argv[2]
const level = process.argv[3] || "novato"

if (!filePath) {
  console.log("Uso: npm run simulate-mastery <archivo.pdf> [novato|intermedio|experto]")
  process.exit(0)
}

simulateMastery(filePath, level).catch(e => {
  console.error(`\n${C.red}ERROR: ${e.message}${C.reset}`)
  process.exit(1)
})
