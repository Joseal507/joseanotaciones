#!/usr/bin/env tsx
// ========================================================
// STUDYAL — SIMULADOR PDF REAL (sin servidor)
// Uso: npx tsx scripts/simulate-pdf.ts <archivo.pdf> [novato|intermedio|experto]
// ========================================================

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
import { POST as flashcardsPOST } from "../app/api/adaptive/flashcards/route"

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", gray: "\x1b[90m", blue: "\x1b[34m",
}

function header(text: string) { 
  console.log(`\n${C.bold}${C.cyan}${"═".repeat(60)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`)
  console.log(`${C.cyan}${"═".repeat(60)}${C.reset}`)
}
const ok = (t: string) => console.log(`${C.green}  ✓ ${t}${C.reset}`)
const err = (t: string) => console.log(`${C.red}  ✗ ${t}${C.reset}`)
const warn = (t: string) => console.log(`${C.yellow}  ⚠ ${t}${C.reset}`)
const info = (t: string) => console.log(`${C.gray}  ${t}${C.reset}`)
const result = (label: string, value: any) => console.log(`  ${C.bold}${label}:${C.reset} ${value}`)

async function callHandler(name: string, handler: any, body: any) {
  const req = new Request(`http://local.test/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const start = Date.now()
  const res = await handler(req)
  const ms = Date.now() - start
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`${name} no devolvió JSON`) }
  if (!res.ok) throw new Error(`${name} → ${res.status}: ${JSON.stringify(data).slice(0,200)}`)
  info(`${name} → ${ms}ms`)
  return data
}

async function simulatePdf(filePath: string, studentLevel: string = "novato") {
  const fileName = path.basename(filePath)
  console.log(`\n${C.bold}${"═".repeat(60)}${C.reset}`)
  console.log(`${C.bold}  SIMULACIÓN REAL — ${fileName}${C.reset}`)
  console.log(`${C.bold}  Nivel: ${studentLevel}${C.reset}`)
  console.log(`${C.bold}${"═".repeat(60)}${C.reset}\n`)

  let errors = 0
  let materialText = ""
  let blueprint: any = null
  let plan: any = null
  let steps: any[] = []
  let explanation = ""
  const recallScores: number[] = []

  // 1. Extraer texto real
  header("1. Extracción de texto")
  try {
    // Suprimir warnings de pdf-parse
  const origWarn = console.warn
  console.warn = (...args: any[]) => {
    const msg = String(args[0] || '')
    if (msg.includes('Ran out of space') || msg.includes('TT: undefined') || msg.includes('font private')) return
    origWarn(...args)
  }
  const buffer = fs.readFileSync(filePath)
    const kind = path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "docx"
    const result = await extractText(buffer, kind as any, kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName)
    materialText = result.text || ""
    ok(`Extraído: ${materialText.length} caracteres (${result.method})`)
  } catch (e: any) {
    err(`Extracción falló: ${e.message}`)
    errors++
  }

  // 2. Blueprint real
  header("2. Blueprint (topics reales)")
  try {
    blueprint = await fetchAndBuildBlueprint({
      materialId: `sim_${Date.now()}`,
      materialTitle: fileName.replace(/\.[^.]+\$/, ""),
      materialContent: materialText,
    })
    const topics = blueprint.topics || []
    ok(`${topics.length} topics detectados`)
    topics.slice(0, 6).forEach((t: any, i: number) => {
      const kt = t.primaryKnowledgeType || t.knowledgeType || "?"
      console.log(`    ${i+1}. [${kt}] ${t.title}`)
    })
  } catch (e: any) {
    err(`Blueprint falló: ${e.message}`)
    errors++
  }

  // 3. Plan Session (Session Designer)
  header("3. Session Designer (pedagogía por topic)")
  const firstTopic = blueprint?.topics?.[0]
  if (firstTopic) {
    try {
      const planData = await callHandler("plan-session", planSessionPOST, {
        sessionBlueprint: {
          title: firstTopic.title,
          objective: `Dominar ${firstTopic.concepts?.map((c: any) => c.name).join(", ") || firstTopic.title}`,
          purpose: "understand",
        },
        topics: [firstTopic],
        sessionLength: "medium",
        sessionNumber: 1,
        previousEvidence: {},
      })
      plan = planData.pedagogicalPlan || {}
      steps = planData.steps || []
      ok(`${steps.length} pasos generados`)
      result("learningGoal", plan.learningGoal)
      result("bestSequence", (plan.bestSequence || []).join(" → "))
      result("depth", plan.depth)
      result("commonFailure", (plan.commonFailure || "").slice(0, 80))
    } catch (e: any) {
      err(`Plan session falló: ${e.message}`)
      errors++
    }
  }

  // 4. Explicación
  header("4. Explicación")
  const focus = firstTopic?.concepts?.[0]?.name || firstTopic?.title || "Concepto principal"
  try {
    const explainData = await callHandler("explain", explainPOST, {
      topicTitle: firstTopic?.title || "",
      targetConcepts: firstTopic?.concepts?.map((c: any) => c.name) || [focus],
      focusConcept: focus,
      contenido: materialText.slice(0, 8000),
      overallMastery: studentLevel === "experto" ? 80 : studentLevel === "intermedio" ? 35 : 0,
      sessionNumber: 1,
      actType: (plan.bestSequence || ["explain"])[0],
      knowledgeType: firstTopic?.primaryKnowledgeType || firstTopic?.knowledgeType || "conceptual",
      learningGoal: plan.learningGoal || "explain_concept",
      alreadyExplained: [],
      failureType: "none",
    })
    explanation = explainData.content || ""
    ok("Explicación generada")
    result("keyIdea", (explainData.keyIdea || "").slice(0, 70))
  } catch (e: any) {
    err(`Explain falló: ${e.message}`)
    errors++
  }

  // 5. Evaluador (3 niveles)
  header("5. Evaluador — 3 niveles de respuesta")
  const responses = {
    bad: "No sé nada de esto.",
    medium: "Creo que tiene algo que ver con eso.",
    good: "Es un proceso donde se contrae y relaja el corazón, moviendo sangre.",
  }
  for (const level of ["bad", "medium", "good"] as const) {
    try {
      const evalData = await callHandler("chat", chatPOST, {
        topicTitle: firstTopic?.title || "",
        targetConcepts: [focus],
        contenido: materialText.slice(0, 4000),
        message: responses[level],
        evaluateWithFeedback: true,
        stepType: "recall",
        recallPrompt: `Explica ${focus}`,
        overallMastery: studentLevel === "experto" ? 80 : studentLevel === "intermedio" ? 35 : 0,
        lastExplanation: explanation.slice(0, 1500),
      })
      const score = Number(evalData.score || 0)
      const failure = evalData.failureType || "none"
      console.log(`  [${level.padEnd(8)}] score: ${score} | failure: ${failure}`)
    } catch (e: any) {
      err(`Evaluador (${level}) falló: ${e.message}`)
      errors++
    }
  }

  // RESUMEN
  header("RESUMEN FINAL")
  result("Archivo", fileName)
  result("Topics detectados", blueprint?.topics?.length || 0)
  result("Pasos generados", steps.length)
  result("Secuencia", (plan.bestSequence || []).join(" → "))
  result("Errores", errors)

  if (errors === 0) {
    console.log(`\n${C.green}${C.bold}  SIMULACIÓN COMPLETA SIN ERRORES${C.reset}\n`)
  } else {
    console.log(`\n${C.red}${C.bold}  ${errors} ERRORES — REVISAR${C.reset}\n`)
  }

  return { file: fileName, errors, sequence: (plan?.bestSequence || []).join(" → "), kt: firstTopic?.primaryKnowledgeType || firstTopic?.knowledgeType }
}

// ── Entry Point ─────────────────────────────────────────────────
import * as fsSync from "fs"

const argPath = process.argv[2]
const argLevel = process.argv[3] || "novato"

if (!argPath) {
  console.log("Uso:")
  console.log("  npx tsx scripts/simulate-pdf.ts <archivo.pdf> [novato|intermedio|experto]")
  console.log("  npx tsx scripts/simulate-pdf.ts <directorio/> [novato]")
  process.exit(0)
}

async function main() {
  const stat = fsSync.statSync(argPath)
  
  if (stat.isDirectory()) {
    // Iterar todos los archivos del directorio
    const supported = [".pdf", ".docx", ".txt"]
    const files = fsSync.readdirSync(argPath)
      .filter(f => supported.includes(path.extname(f).toLowerCase()))
      .map(f => path.join(argPath, f))
      .sort()

    if (files.length === 0) {
      console.log(`No hay archivos PDF/DOCX en ${argPath}`)
      process.exit(1)
    }

    console.log(`\n  Procesando ${files.length} archivos...`)
    const results = []
    
    for (const f of files) {
      const r = await simulatePdf(f, argLevel)
      results.push(r)
    }

    // Resumen global
    console.log(`\n${C.bold}${"═".repeat(60)}${C.reset}`)
    console.log(`${C.bold}  REGRESIÓN GLOBAL${C.reset}`)
    console.log(`${"═".repeat(60)}`)
    
    const allOk = results.every(r => r.errors === 0)
    const seqs = new Set(results.map(r => r.sequence).filter(Boolean))
    
    results.forEach(r => {
      const icon = r.errors === 0 ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`
      const seq = (r.sequence || "").slice(0, 35).padEnd(35)
      console.log(`  ${icon} ${r.file.slice(0,30).padEnd(30)} | ${(r.kt||"?").padEnd(12)} | ${seq}`)
    })
    
    console.log()
    console.log(`  Archivos: ${results.length}`)
    console.log(`  Errores=0: ${allOk ? C.green+"YES"+C.reset : C.red+"NO"+C.reset}`)
    console.log(`  Secuencias únicas: ${seqs.size}`)
    
    if (!allOk) process.exit(1)
    
  } else {
    // Archivo individual
    await simulatePdf(argPath, argLevel)
  }
}

main().catch(e => {
  console.error(`\n${C.red}ERROR: ${e.message}${C.reset}`)
  process.exit(1)
})
// ═══════════════════════════════════════════════════════
// MODO DETALLADO: ver contenido completo de la sesión
// ═══════════════════════════════════════════════════════
export async function simulateFullSession(filePath: string, studentLevel: string = "novato") {
  console.log = console.log  // mantener output
}
