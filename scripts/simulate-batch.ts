#!/usr/bin/env tsx
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import * as fs from "fs"
import * as path from "path"
import { extractText } from "../lib/materials/extractors"
import { fetchAndBuildBlueprint } from "../lib/adaptive/blueprintBuilder"
import { generateAdaptiveProgram } from "../lib/adaptive/generator"

import { updateAdaptiveProgramAfterSession } from "../lib/adaptive/updater"
import { POST as planSessionPOST } from "../app/api/adaptive/plan-session/route"
import { POST as explainPOST } from "../app/api/adaptive/explain/route"
import { POST as quizPOST } from "../app/api/adaptive/quiz/route"
import { POST as chatPOST } from "../app/api/adaptive/chat/route"
import type { AdaptiveProgram, AdaptiveSession } from "../lib/adaptive/program"

// ── Silenciar warnings basura ─────────────────────────────────
const originalWarn = console.warn
const originalError = console.error
console.warn = (...args: any[]) => {
  const msg = String(args[0] || '')
  if (msg.includes('DeprecationWarning') || msg.includes('url.parse') ||
      msg.includes('Buffer()') || msg.includes('DEP00')) return
  originalWarn(...args)
}
console.error = (...args: any[]) => {
  const msg = String(args[0] || '')
  if (msg.includes('DeprecationWarning') || msg.includes('pdf-parse')) return
  originalError(...args)
}

const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 999)

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m",
}

interface SessionReport {
  sessionNumber: number
  title: string
  purpose: string
  knowledgeType: string
  learningGoal: string
  sequence: string[]
  quizScore: number
  quizGenerated: boolean
  quizQuestionsCount: number
  recallScore: number
  finalScore: number
  repairsActivated: number
  failureType: string
  conceptsDominated: string[]
  weakConcepts: string[]
  advancedWhileConfused: boolean
  repeatedQuizConcept: boolean
  quizzesPerConcept: Record<string, number>
}

interface MaterialReport {
  file: string
  chars: number
  topics: number
  sessionsGenerated: number
  sessionsSimulated: number
  overallScore: number
  status: "PASS" | "PARTIAL" | "FAIL"
  knowledgeTypesUsed: string[]
  learningGoalsUsed: string[]
  conceptsDominated: string[]
  weakConcepts: string[]
  problems: string[]
  sessions: SessionReport[]
}

async function callRoute(name: string, handler: any, body: any): Promise<any> {
  const req = new Request(`http://local/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const res = await handler(req)
  const data = await res.json()
  if (!res.ok) throw new Error(`${name}: ${JSON.stringify(data).slice(0, 150)}`)
  return data
}

function simulateResponse(concept: string, explanation: string, sessionScore: number): string {
  const sentences = explanation.split(/\.\s+/).filter(s => s.trim().length > 20)
  if (sessionScore >= 70) {
    return sentences.slice(0, 3).join('. ') + '. Lo entiendo porque ' + (sentences[3] || 'se relaciona con lo anterior')
  }
  if (sessionScore >= 40) {
    return `${concept} es ${sentences[0] || 'un concepto importante'}. ${sentences[1] || ''}`
  }
  return `Creo que ${concept} tiene que ver con ${sentences[0]?.slice(0, 80) || 'este tema'}. No estoy seguro.`
}

async function runSession(
  session: AdaptiveSession,
  materialText: string,
  blueprint: any,
  sessionNumber: number,
  previousScore: number,
  exposureByConcept: Map<string, number> = new Map(),
): Promise<SessionReport> {
  const topicTitle = session.title || session.topicTitle || "Topic"
  const concepts = session.targetConcepts || []
  const materialSlice = materialText.slice(0, 8000)
  const blueprintTopics = blueprint.topics || []
  const matchingTopic = blueprintTopics.find((t: any) =>
    t.title === topicTitle || concepts.some((c: string) =>
      (t.concepts || []).some((bc: any) => bc.name === c))
  ) || blueprintTopics[Math.min(sessionNumber - 1, blueprintTopics.length - 1)] || blueprintTopics[0]

  const knowledgeType = matchingTopic?.primaryKnowledgeType || "conceptual"
  let learningGoal = "explain_concept"
  let sequence: string[] = []
  let quizScore = 0
  let recallScore = 0
  let repairsActivated = 0
  let failureType = "none"
  let explanation = ""
  const quizzesPerConcept: Record<string, number> = {}
  let repeatedQuizConcept = false

  // 1. Plan de sesión
  try {
    const planData = await callRoute("plan-session", planSessionPOST, {
      sessionBlueprint: {
        title: topicTitle,
        objective: session.objective || `Dominar ${concepts.slice(0,2).join(", ")}`,
        purpose: session.purpose || "understand",
      },
      topics: [matchingTopic || {
        id: `t${sessionNumber}`, title: topicTitle,
        primaryKnowledgeType: knowledgeType, knowledgeType,
        concepts: concepts.map((c: string) => ({ name: c, definition: "", difficulty: 50 })),
        difficulty: 60,
      }],
      sessionLength: "medium", sessionNumber,
      previousEvidence: concepts.reduce((acc: any, c: string) => { acc[c] = previousScore; return acc }, {}),
    })
    const plan = planData.pedagogicalPlan || {}
    learningGoal = plan.learningGoal || "explain_concept"
    sequence = plan.bestSequence || []
  } catch {}

  // 2. Explicación
  try {
    const explainData = await callRoute("explain", explainPOST, {
      topicTitle, targetConcepts: concepts, focusConcept: concepts[0] || topicTitle,
      contenido: materialSlice, overallMastery: previousScore, sessionNumber,
      actType: "explain", knowledgeType, learningGoal,
      alreadyExplained: [], failureType: "none",
    })
    explanation = explainData.content || ""
  } catch {}

  // 3. Quiz — garantizar que haya contenido para generar preguntas
  // Si explanation está vacía, usar materialSlice directamente
  const quizContext = explanation.length > 100
    ? explanation.slice(0, 2000)
    : materialSlice.slice(0, 2000)

  let quizGenerated = false
  let quizQuestionsCount = 0

  // Aprendizaje real: exposición por concepto (accesible en quiz y recall)
  const focusConceptForExposure = concepts[0] || topicTitle
  let exposure = exposureByConcept.get(focusConceptForExposure) || 0
  // Si es sesión de repair, el estudiante ya ha visto el concepto antes
  // Aumentar exposición virtual para simular consolidación
  if (session.purpose === 'repair' || String(session.title || '').toLowerCase().includes('refuerzo')) {
    exposure = Math.max(exposure, 2)
  }

  try {
    const quizData = await callRoute("quiz", quizPOST, {
      topicTitle, targetConcepts: concepts, focusConcept: concepts[0] || topicTitle,
      contenido: materialSlice, lastExplanation: quizContext,
      overallMastery: previousScore, sessionNumber, count: 2,
      actType: "micro_quiz", knowledgeType, learningGoal, previousTypes: [],
    })
    const questions = quizData.questions || []
    quizQuestionsCount = questions.length
    quizGenerated = questions.length > 0

    const focusConcept = concepts[0] || topicTitle
    quizzesPerConcept[focusConcept] = (quizzesPerConcept[focusConcept] || 0) + 1
    if (quizzesPerConcept[focusConcept] > 2) repeatedQuizConcept = true

    const isRepair = (session.purpose === 'repair')
    // Base: sessionNumber da progreso general, exposure da bonus por concepto repetido
    let correctProb = Math.min(0.4 + (sessionNumber * 0.05) + (exposure * 0.1), 0.85)
    if (isRepair) correctProb = Math.min(0.9, correctProb + 0.1)
    const correctCount = questions.filter(() => Math.random() < correctProb).length
    quizScore = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0

    if (quizScore < 50) repairsActivated++
  } catch { quizScore = 0; quizGenerated = false }

  // 4. Recall
  try {
    const studentResponse = simulateResponse(concepts[0] || topicTitle, explanation, quizScore + exposure * 10)
    const evalData = await callRoute("chat", chatPOST, {
      topicTitle, targetConcepts: concepts, contenido: materialSlice,
      message: studentResponse, evaluateWithFeedback: true,
      stepType: "active_recall",
      recallPrompt: `Explica ${concepts[0] || topicTitle} con tus propias palabras`,
      overallMastery: previousScore, lastExplanation: explanation.slice(0, 1500),
    })
    recallScore = Number(evalData.score || 0)
    failureType = evalData.failureType || "none"
    if (recallScore < 60) repairsActivated++
  } catch (err: any) {
    console.error(`[Recall ERROR] ${err?.message?.slice(0, 200)}`)
    recallScore = 40
  }

  const finalScore = Math.round((quizScore * 0.4) + (recallScore * 0.6))
  const conceptsDominated = finalScore >= 60 ? concepts.slice(0, 3) : []
  const weakConcepts = finalScore < 60 ? concepts.slice(0, 3) : []
  const advancedWhileConfused = recallScore < 40

  return {
    sessionNumber, title: topicTitle.slice(0, 50), purpose: session.purpose || "understand",
    knowledgeType, learningGoal, sequence, quizScore, quizGenerated, quizQuestionsCount,
    recallScore, finalScore, repairsActivated, failureType, conceptsDominated, weakConcepts,
    advancedWhileConfused, repeatedQuizConcept, quizzesPerConcept,
  }
}

async function simulateMaterial(filePath: string): Promise<MaterialReport> {
  const fileName = path.basename(filePath)
  const problems: string[] = []

  // Extraer texto
  const buffer = fs.readFileSync(filePath)
  const kind = path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "docx"
  const extracted = await extractText(buffer, kind as any,
    kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName)
  const materialText = extracted.text || ""

  // Blueprint
  const blueprint = await fetchAndBuildBlueprint({
    materialId: `batch_${Date.now()}`,
    materialTitle: fileName.replace(/\.[^.]+$/, ""),
    materialContent: materialText,
  })
  const topics = blueprint.topics || []

  // Programa
  let program: AdaptiveProgram
  try {
    program = await generateAdaptiveProgram(null, {
      sessionLength: "medium", targetScore: 80,
      examDate: "in_1_week", initialKnowledgeLevel: "zero", dailyMinutes: 30,
    }, blueprint, null, null)
  } catch {
    program = {
      id: `p_${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(),
      materialIds: [], status: "active",
      setup: { sessionLength: "medium", targetScore: 80, examDate: "in_1_week", initialKnowledgeLevel: "zero", dailyMinutes: 30 },
      sessions: topics.slice(0, 5).map((t: any, i: number) => ({
        id: `s${i}`, sessionNumber: i+1, title: t.title, topicTitle: t.title,
        objective: `Dominar ${t.title}`, purpose: i < 2 ? "understand" : "apply",
        status: "available", targetConcepts: (t.concepts||[]).map((c:any)=>c.name).slice(0,4),
        steps: [], estimatedMinutes: 22, expectedDomainGain: 18,
        evidenceGoal: "", blueprintConfidence: 70, sessionFormat: "discovery",
      })) as any[],
      currentSessionIndex: 0, strategy: {} as any, materialBlueprint: blueprint,
    }
  }

  const maxSess = Math.min(program.sessions.length, MAX_SESSIONS)
  process.stdout.write(`  ${C.cyan}${fileName}${C.reset} | ${topics.length} topics | ${program.sessions.length} sesiones → simulando ${maxSess}`)

  // Simular sesiones usando el updater real (programa adaptativo vivo)
  let overallScore = 0
  const sessionReports: SessionReport[] = []
  const allConceptsDominated: string[] = []
  const allWeakConcepts: string[] = []
  let activeProgram = program
  let i = 0
  const exposureByConcept: Map<string, number> = new Map()

  while (i < Math.min(activeProgram.sessions.length, maxSess)) {
    const currentSession = activeProgram.sessions[i]
    const result = await runSession(currentSession, materialText, blueprint, i + 1, overallScore, exposureByConcept)

    overallScore = Math.round((overallScore * i + result.finalScore) / (i + 1))
    sessionReports.push(result)
    allConceptsDominated.push(...result.conceptsDominated)
    allWeakConcepts.push(...result.weakConcepts)

    // Registrar exposición de conceptos tocados
    const conceptsInThisSession = [
      ...(currentSession.targetConcepts || []),
      ...result.conceptsDominated,
      ...result.weakConcepts,
    ]
    for (const c of conceptsInThisSession) {
      const prev = exposureByConcept.get(c) || 0
      exposureByConcept.set(c, prev + 1)
    }

    // Marcar sesión como completada con domainBefore/domainAfter honestos
    // domainGain honesto: si score < 60, el dominio sube poco o nada
    const domainBefore = i === 0 ? 0 : overallScore
    const rawGain = result.finalScore >= 80 ? 18
      : result.finalScore >= 70 ? 12
      : result.finalScore >= 60 ? 8
      : result.finalScore >= 50 ? 3
      : 0  // score < 50 = no sube = updater activa repair
    const domainAfter = Math.min(100, domainBefore + rawGain)

    const updatedSessions = activeProgram.sessions.map((s, idx) => {
      if (idx === i) {
        return {
          ...s,
          status: 'completed' as const,
          domainBefore,
          domainAfter,
          conceptsImproved: result.conceptsDominated,
          conceptsStillWeak: result.weakConcepts,
          completedAt: Date.now(),
        }
      }
      return s
    })

    const programWithResults = {
      ...activeProgram,
      sessions: updatedSessions,
      currentSessionIndex: i,
      updatedAt: Date.now(),
    }

    // Replan real
    const sessionsBefore = activeProgram.sessions.length
    const domainGainDebug = domainAfter - domainBefore
    activeProgram = updateAdaptiveProgramAfterSession(programWithResults as any, null as any)
    const sessionsAfter = activeProgram.sessions.length
    const repairCount = activeProgram.sessions.filter((s: any) => s.purpose === 'repair').length
    process.stdout.write(`[S${i+1} gain:${domainGainDebug} sessions:${sessionsBefore}→${sessionsAfter} repairs:${repairCount}]`)

    // Detectar problemas
    if (result.repeatedQuizConcept) problems.push(`P1 [S${i+1}] Quiz repetido del mismo concepto`)
    if (result.advancedWhileConfused && result.repairsActivated === 0) problems.push(`P2 [S${i+1}] Recall <40 sin repair`)
    if (result.recallScore < 40) problems.push(`P3 [S${i+1}] Recall muy bajo: ${result.recallScore}`)
    if (!result.quizGenerated) problems.push(`P5 [S${i+1}] Sin quiz generado — sesión sin evaluación`)

    process.stdout.write(".")
    await new Promise(r => setTimeout(r, 200))
    i++
  }

  program = activeProgram

  // Conceptos débiles al final sin sesión de refuerzo
  const finalWeak = [...new Set(allWeakConcepts)].filter(c => !allConceptsDominated.includes(c))
  const hasRepairSession = program.sessions.some(s =>
    s.purpose === "repair" || s.purpose === "consolidate" || s.purpose === "memorize"
  )
  if (finalWeak.length > 0 && !hasRepairSession && maxSess >= program.sessions.length) {
    problems.push(`P4 Conceptos débiles sin refuerzo: ${finalWeak.slice(0,3).join(", ")}`)
  }

  const status: "PASS" | "PARTIAL" | "FAIL" =
    problems.length === 0 && overallScore >= 80 ? "PASS" :
    overallScore >= 65 ? "PARTIAL" : "FAIL"

  const color = status === "PASS" ? C.green : status === "PARTIAL" ? C.yellow : C.red
  console.log(` | ${color}${status} ${overallScore}/100${C.reset}`)

  return {
    file: fileName, chars: materialText.length, topics: topics.length,
    sessionsGenerated: program.sessions.length, sessionsSimulated: maxSess,
    overallScore, status,
    knowledgeTypesUsed: [...new Set(sessionReports.map(s => s.knowledgeType))],
    learningGoalsUsed: [...new Set(sessionReports.map(s => s.learningGoal))],
    conceptsDominated: [...new Set(allConceptsDominated)],
    weakConcepts: [...new Set(finalWeak)],
    problems, sessions: sessionReports,
  }
}

function generateMarkdown(reports: MaterialReport[]): string {
  const avgScore = Math.round(reports.reduce((s, r) => s + r.overallScore, 0) / reports.length)
  const passed = reports.filter(r => r.status === "PASS").length
  const allProblems = reports.flatMap(r => r.problems)

  const problemCount: Record<string, number> = {}
  allProblems.forEach(p => {
    const key = p.replace(/\[S\d+\]/g, '').trim()
    problemCount[key] = (problemCount[key] || 0) + 1
  })

  const globalPass = avgScore >= 65 && allProblems.filter(p => p.includes("P2") || p.includes("P3")).length === 0

  let md = `# StudyAL — Reporte Pedagógico Batch\n\n`
  md += `**Fecha:** ${new Date().toISOString().split('T')[0]}\n`
  md += `**Score promedio:** ${avgScore}/100\n`
  md += `**Materiales:** ${reports.length} | **PASS:** ${passed}/${reports.length}\n`
  md += `**Estado global:** ${globalPass ? "✅ PASS" : "⚠️ NECESITA MEJORAS"}\n\n`

  md += `## Resultados por material\n\n`
  md += `| Material | Chars | Topics | Sesiones | Score | Estado |\n`
  md += `|----------|-------|--------|----------|-------|--------|\n`
  for (const r of reports) {
    const icon = r.status === "PASS" ? "✅" : r.status === "PARTIAL" ? "⚠️" : "❌"
    md += `| ${r.file} | ${r.chars.toLocaleString()} | ${r.topics} | ${r.sessionsSimulated}/${r.sessionsGenerated} | ${r.overallScore}/100 | ${icon} ${r.status} |\n`
  }

  md += `\n## Problemas pedagógicos detectados\n\n`
  if (allProblems.length === 0) {
    md += `✅ No se detectaron problemas pedagógicos.\n`
  } else {
    const sorted = Object.entries(problemCount).sort(([,a],[,b]) => b - a)
    for (const [p, count] of sorted) {
      md += `- **${p}** (${count}x)\n`
    }
  }

  md += `\n## Detalle por material\n\n`
  for (const r of reports) {
    md += `### ${r.file}\n`
    md += `- **Score:** ${r.overallScore}/100 | **Estado:** ${r.status}\n`
    md += `- **KnowledgeTypes:** ${r.knowledgeTypesUsed.join(", ")}\n`
    md += `- **LearningGoals:** ${r.learningGoalsUsed.join(", ")}\n`
    md += `- **Conceptos dominados:** ${r.conceptsDominated.length > 0 ? r.conceptsDominated.slice(0,5).join(", ") : "ninguno"}\n`
    md += `- **Conceptos débiles:** ${r.weakConcepts.length > 0 ? r.weakConcepts.slice(0,5).join(", ") : "ninguno"}\n`

    if (r.problems.length > 0) {
      md += `- **Problemas:**\n`
      r.problems.forEach(p => md += `  - ${p}\n`)
    }

    md += `\n#### Sesiones\n\n`
    md += `| # | Título | KT | Quiz | Recall | Score | Failure | Repairs |\n`
    md += `|---|--------|----|------|--------|-------|---------|--------|\n`
    for (const s of r.sessions) {
      md += `| ${s.sessionNumber} | ${s.title.slice(0,30)} | ${s.knowledgeType.slice(0,10)} | ${s.quizScore} | ${s.recallScore} | ${s.finalScore} | ${s.failureType} | ${s.repairsActivated} |\n`
    }
    md += "\n"
  }

  md += `## Criterios PASS\n\n`
  md += `- Score promedio ≥ 80: ${avgScore >= 80 ? "✅" : "❌"} (${avgScore})\n`
  md += `- Recall < 40 sin repair: ${allProblems.filter(p => p.includes("P2")).length === 0 ? "✅" : "❌"}\n`
  md += `- Conceptos débiles sin refuerzo: ${allProblems.filter(p => p.includes("P4")).length === 0 ? "✅" : "❌"}\n`
  md += `- Quiz repetido mismo concepto: ${allProblems.filter(p => p.includes("P1")).length === 0 ? "✅" : "❌"}\n`

  return md
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════`)
  console.log(`  STUDYAL — SIMULACIÓN BATCH PEDAGÓGICA`)
  console.log(`═══════════════════════════════════════════════════${C.reset}\n`)

  const fixtures = "scripts/fixtures"
  const TARGET_FILES = process.env.BATCH_FILES
    ? process.env.BATCH_FILES.split(",")
    : ["clutch2.pdf"]

  const files = fs.readdirSync(fixtures)
    .filter(f => TARGET_FILES.includes(f))
    .map(f => path.join(fixtures, f))

  console.log(`  Materiales: ${files.length} | MAX_SESSIONS: ${MAX_SESSIONS === 999 ? 'todas' : MAX_SESSIONS}\n`)

  const reports: MaterialReport[] = []
  for (const file of files) {
    try {
      const report = await simulateMaterial(file)
      reports.push(report)
    } catch (e: any) {
      console.log(`  ${C.red}ERROR ${path.basename(file)}: ${e.message.slice(0,80)}${C.reset}`)
    }
  }

  // Guardar reportes
  fs.mkdirSync("reports", { recursive: true })
  fs.writeFileSync("reports/adaptive-batch-report.json", JSON.stringify(reports, null, 2))
  const md = generateMarkdown(reports)
  fs.writeFileSync("reports/adaptive-batch-report.md", md)

  // Resumen terminal
  const avgScore = Math.round(reports.reduce((s, r) => s + r.overallScore, 0) / reports.length)
  const passed = reports.filter(r => r.status === "PASS").length
  const allProblems = reports.flatMap(r => r.problems)

  console.log(`\n${C.bold}RESUMEN${C.reset}`)
  console.log(`  Score promedio: ${avgScore}/100`)
  console.log(`  PASS: ${passed}/${reports.length}`)
  if (allProblems.length > 0) {
    console.log(`  Problemas: ${allProblems.length}`)
    const unique = [...new Set(allProblems.map(p => p.replace(/\[S\d+\]/g,'').trim()))]
    unique.slice(0,5).forEach(p => console.log(`    • ${p}`))
  }
  console.log(`\n  ${C.green}Reporte guardado:${C.reset}`)
  console.log(`    reports/adaptive-batch-report.md`)
  console.log(`    reports/adaptive-batch-report.json\n`)
}

main().catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1) })
