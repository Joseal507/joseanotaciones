// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v3/tutor
// 
// El endpoint principal del tutor v3.
// 
// Flujo:
// 1. Cargar graph + session
// 2. Si hay respuesta del estudiante → evaluar (código puro o LLM según tipo)
// 3. Actualizar SessionState con evento (código puro)
// 4. State Machine decide siguiente micro (código puro)
// 5. Objective Selector decide qué hacer (código puro)
// 6. Content Generator genera contenido (LLM solo aquí)
// 7. Guardar SessionState y devolver
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../../lib/alai'
import { loadGraph } from '../../../../../lib/adaptive/v3/storage/graphStorage'
import { loadSession, saveSession } from '../../../../../lib/adaptive/v3/storage/sessionStorage'
import {
  initSessionState,
  recordEvent,
  recordTurn,
  selectNextMicro,
  advanceMicro,
  postponeMicro,
  shouldCloseSession,
  calculateSessionProgress,
} from '../../../../../lib/adaptive/v3/engine/stateMachine'
import { selectObjective, selectInteractionFormat } from '../../../../../lib/adaptive/v3/engine/objectiveSelector'
import { selectFormat, formatToInstruction } from '../../../../../lib/adaptive/v3/engine/formatSelector'
import {
  recordEvidence,
  rebuildProfile,
  emptyEvidenceProfile,
  isReadyToAdvanceEvidence,
  isMicroMastered,
  suggestNextObjectiveFromEvidence,
  getMissingEvidences,
  getProfileLabel,
  type EvidenceProfile,
} from '../../../../../lib/adaptive/v3/engine/evidenceEngine'
import { generateContent } from '../../../../../lib/adaptive/v3/engine/contentGenerator'
import { evaluateAnswer } from '../../../../../lib/adaptive/v3/engine/answerEvaluator'
import type { MicroEventType, Turn } from '../../../../../lib/adaptive/v3/types'

export const maxDuration = 90

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      userId,
      materialId,
      sessionId,
      targetMinutes = 20,
      studentProfile,
      studentAnswer,
      lastInteractionId,
      evalPreference = 'mix_everything',
      initialKnowledgeLevel = 'some',
      sessionTopicTitles = [],  // ← nuevo: títulos de topics de esta sesión
    } = body

    if (!userId || !materialId) {
      return NextResponse.json({ success: false, error: 'userId y materialId requeridos' }, { status: 400 })
    }

    // ── 1. Cargar grafo ─────────────────────────────────────────
    const graph = await loadGraph(userId, materialId)
    if (!graph) {
      return NextResponse.json({
        success: false,
        error: 'No hay grafo. Ejecuta /api/adaptive/v3/build-graph primero',
      }, { status: 400 })
    }

    // ── 2. Cargar o crear sesión ────────────────────────────────
    let session = sessionId ? await loadSession(userId, materialId, sessionId) : null

    if (!session) {
      const newSessionId = sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // ─── Filtrar micros según los topics de la sesión (si se pasaron) ───
      let microIdsToTeach: string[] | undefined = undefined
      if (Array.isArray(sessionTopicTitles) && sessionTopicTitles.length > 0) {
        // Normalizar para comparación
        const normalize = (s: string) => String(s || '').toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

        // Palabras vacías (no aportan significado)
        const STOPWORDS = new Set(['de','la','el','los','las','y','o','del','al','a','en','entre','con','por','para','un','una','unos','unas','es','se','que','como','sus','su'])

        const significantWords = (s: string): Set<string> => {
          const words = normalize(s).split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w))
          return new Set(words)
        }

        // Matching por superposición de palabras significativas
        const overlapScore = (a: Set<string>, b: Set<string>): number => {
          if (a.size === 0 || b.size === 0) return 0
          let common = 0
          for (const w of a) if (b.has(w)) common++
          // Jaccard-like: común / min(a,b) — captura "subset" bien
          return common / Math.min(a.size, b.size)
        }

        const targetSets = sessionTopicTitles.map((t: string) => ({
          raw: t,
          words: significantWords(t),
          norm: normalize(t),
        }))

        // Matching más estricto para evitar falsos positivos con targets cortos.
        // "Ácido" NO debe matchear "Ácidos fuertes" ni "Cálculo de pH de ácido acético".
        // Solo debe matchear cuando el micro trata REALMENTE del target.
        const matched = graph.microConcepts.filter(m => {
          const microNorm = normalize(m.name)
          const microWords = significantWords(m.name)
          const topicNorm = normalize(m.topicGroup || '')
          const topicWords = significantWords(m.topicGroup || '')

          return targetSets.some((t: any) => {
            const targetWordCount = t.words.size
            const targetIsShort = targetWordCount <= 2  // "Ácido", "pH", "Base" son cortos

            // 1) Match exacto normalizado (siempre válido)
            if (microNorm === t.norm) return true
            if (topicNorm === t.norm) return true

            // 2) Substring: SOLO si el target es LARGO (≥3 palabras) para evitar falsos positivos
            if (!targetIsShort) {
              if (microNorm.includes(t.norm) || t.norm.includes(microNorm)) return true
              if (topicNorm && (topicNorm.includes(t.norm) || t.norm.includes(topicNorm))) return true
            }

            // 3) Superposición ALTA de palabras significativas
            // Para targets cortos exigir 100% (todas las palabras del target están en el micro)
            // Para targets largos, 70% basta
            const minOverlap = targetIsShort ? 1.0 : 0.7
            if (overlapScore(microWords, t.words) >= minOverlap) return true
            if (topicWords.size > 0 && overlapScore(topicWords, t.words) >= minOverlap) return true

            return false
          })
        })

        if (matched.length > 0) {
          microIdsToTeach = matched.map(m => m.id)
          console.log(`[tutor v3] Filtrado por sesión: ${matched.length}/${graph.microConcepts.length} micros`)
          console.log(`[tutor v3] Topics de sesión: ${sessionTopicTitles.join(' | ')}`)
          console.log(`[tutor v3] Micros elegidos: ${matched.map(m => m.name).join(' | ')}`)
        } else {
          console.log(`[tutor v3] ⚠ Ningún micro matcheó los topics. Usando TODOS.`)
          console.log(`[tutor v3] Topics buscados: ${sessionTopicTitles.join(' | ')}`)
        }
      }

      session = initSessionState({
        sessionId: newSessionId,
        userId,
        materialId,
        graph,
        targetMinutes,
        microIdsToTeach,
      })
      console.log(`[tutor v3] Nueva sesión: ${newSessionId} con ${(microIdsToTeach || graph.microConcepts.map(m => m.id)).length} micros`)
    }

    // ── 3. Si hay respuesta del estudiante, evaluar ─────────────
    let evaluation: any = null
    if (studentAnswer !== undefined && session.queue.activeMicroId) {
      const activeMicro = graph.microConcepts.find(m => m.id === session!.queue.activeMicroId)
      const lastTurn = session.recentTurns[session.recentTurns.length - 1]

      if (activeMicro && lastTurn) {
        const lastInteraction = (lastTurn.content as any).interaction ||
                                { interactionType: 'unknown', data: {} }

        // Buscar la interacción real (guardada en el turn anterior)
        // Como no la guardamos aún, la reconstruimos desde el último recentTurn
        evaluation = await evaluateAnswer({
          interaction: lastInteraction,
          studentAnswer,
          micro: activeMicro,
        })

        console.log(`[tutor v3] Evaluación: ${evaluation.outcome} (${evaluation.score}/100)`)

        // Registrar evento en el timeline del micro
        const activeState = session.microStates[activeMicro.id]
        const eventType: MicroEventType =
          evaluation.outcome === 'correct' ? 'answered_correctly' :
          evaluation.outcome === 'partial' ? 'answered_partially' :
          'answered_incorrectly'

        session.microStates[activeMicro.id] = recordEvent(
          activeState,
          eventType,
          session.currentTurn,
          {
            studentResponse: typeof studentAnswer === 'string' ? studentAnswer.slice(0, 200) : JSON.stringify(studentAnswer).slice(0, 200),
            outcome: evaluation.outcome,
          },
        )

        // ─── REGISTRAR EVIDENCIA MULTIDIMENSIONAL ───
        // Recuperar el perfil de evidencias (guardado en microStates)
        const activeStateAfter = session.microStates[activeMicro.id]
        const currentProfile: EvidenceProfile = (activeStateAfter as any).evidenceProfile ||
          emptyEvidenceProfile(activeMicro.id)

        // El formato usado está en el último turn
        const prevTurnForFormat = session.recentTurns[session.recentTurns.length - 1]
        const formatUsed = (prevTurnForFormat?.content as any)?.interaction?.interactionType ||
                          (prevTurnForFormat?.content as any)?.interaction?.type ||
                          'multiple_choice'

        const updatedProfile = recordEvidence(currentProfile, {
          formatUsed,
          outcome: evaluation.outcome,
          score: evaluation.score,
          turnNumber: session.currentTurn,
        })

        ;(session.microStates[activeMicro.id] as any).evidenceProfile = updatedProfile

        // Actualizar isReady basado en evidencias
        session.microStates[activeMicro.id].isReady = isReadyToAdvanceEvidence(updatedProfile, activeMicro)

        console.log(`[tutor v3] Evidencia registrada: ${formatUsed} → outcome=${evaluation.outcome}, score=${evaluation.score}`)
        console.log(`[tutor v3] Perfil de "${activeMicro.name}": mastery=${updatedProfile.masteryScore}%, evidencias=${updatedProfile.totalEvidences}`)
      }
    }

    // ── 4. Seleccionar siguiente micro (código puro) ────────────
    let nextMicroId = selectNextMicro(session, graph)

    if (!nextMicroId) {
      // No hay más micros — cerrar sesión
      await saveSession(session)
      return NextResponse.json({
        success: true,
        shouldCloseSession: true,
        page: {
          type: 'session_close',
          title: 'Sesión completada',
          content: {
            blocks: [
              { type: 'text', text: 'Has completado esta sesión. Excelente trabajo.' }
            ],
            tutorMessage: '¡Muy bien! Terminaste todos los microconceptos.',
          },
        },
        progress: calculateSessionProgress(session),
        summary: {
          totalCorrect: session.totalCorrect,
          totalIncorrect: session.totalIncorrect,
          microsCompleted: session.queue.completedMicroIds.length,
          microsTotal: session.queue.totalPlanned,
        },
      })
    }

    // ── 5. Verificar si el micro anterior está listo para avanzar ──
    // SOLO avanzar si isReady es true (basado en evidencias reales).
    // NUNCA postponer automáticamente — un tutor sigue enseñando aunque el estudiante falle.
    if (session.queue.activeMicroId && session.queue.activeMicroId !== nextMicroId) {
      const previousMicroState = session.microStates[session.queue.activeMicroId]
      if (previousMicroState?.isReady) {
        session.queue = advanceMicro(session, session.queue.activeMicroId)
        console.log(`[tutor v3] Micro completado: ${session.queue.activeMicroId}`)
      }
      // NOTA: eliminado el postpone automático por struggling.
      // El estudiante DEBE aprender el concepto antes de avanzar.
    }

    // Marcar el nuevo micro como activo
    session.queue.activeMicroId = nextMicroId
    let currentMicro = graph.microConcepts.find(m => m.id === nextMicroId)!
    let currentMicroState = session.microStates[nextMicroId]

    // ── 6. Seleccionar objetivo (el Objective Selector v2 maneja todo) ───
    const currentProfile: EvidenceProfile = (currentMicroState as any).evidenceProfile ||
      emptyEvidenceProfile(currentMicro.id)

    // El Objective Selector v2 ya razona sobre:
    // - Último outcome (fallo/parcial/correcto)
    // - Racha de aciertos/fallos
    // - Total de interacciones
    // - Tipo cognitivo del micro
    // - Importancia del micro
    // No necesita que le digamos qué evidencias faltan
    let objectiveDecision = selectObjective(currentMicroState, currentMicro, session, initialKnowledgeLevel)

    console.log(`[tutor v3] Perfil: mastery=${currentProfile.masteryScore}% | evidencias=${currentProfile.totalEvidences} | interacciones=${currentMicroState.totalInteractions}`)

    // ── 6b. Consolidar cuando el Objective Selector dice consolidate
    if (objectiveDecision.objective === 'consolidate') {
      console.log(`[tutor v3] ✓ Consolidando y avanzando: ${currentMicro.name}`)
      session.queue = advanceMicro(session, nextMicroId)

      // Seleccionar siguiente micro
      const nextNextMicroId = selectNextMicro(session, graph)

      if (!nextNextMicroId) {
        // No hay más micros, cerrar sesión
        await saveSession(session)
        return NextResponse.json({
          success: true,
          shouldCloseSession: true,
          page: {
            type: 'session_close',
            title: '¡Sesión completada!',
            content: {
              blocks: [
                { type: 'text', text: 'Has completado todos los microconceptos de esta sesión.' },
                { type: 'callout', variant: 'success', text: `Dominados ${session.queue.completedMicroIds.length} de ${session.queue.totalPlanned} conceptos.` }
              ],
              tutorMessage: '¡Excelente trabajo! Terminaste todos los conceptos.',
            },
          },
          progress: calculateSessionProgress(session),
          summary: {
            totalCorrect: session.totalCorrect,
            totalIncorrect: session.totalIncorrect,
            microsCompleted: session.queue.completedMicroIds.length,
            microsTotal: session.queue.totalPlanned,
          },
        })
      }

      // Cambiar a la siguiente micro
      session.queue.activeMicroId = nextNextMicroId
      currentMicro = graph.microConcepts.find(m => m.id === nextNextMicroId)!
      currentMicroState = session.microStates[nextNextMicroId]
      objectiveDecision = selectObjective(currentMicroState, currentMicro, session, initialKnowledgeLevel)
      console.log(`[tutor v3] → Nuevo micro activo: ${currentMicro.name}`)
    }
    // Seleccionar formato de interacción
    let interactionFormat: string = 'none'
    let formatReason = 'Sin interacción'

    if (!objectiveDecision.requiresQuestion && !objectiveDecision.requiresContent) {
      interactionFormat = 'none'
      formatReason = 'Objetivo no requiere interacción'
    } else if (objectiveDecision.forcedFormat) {
      interactionFormat = objectiveDecision.forcedFormat
      formatReason = `Forzado por Objective Selector: ${objectiveDecision.forcedFormat}`
    } else if (objectiveDecision.requiresQuestion) {
      // ─── AI SUGIERE EL MEJOR FORMATO, CÓDIGO LO FUERZA ───
      // Paso 1: La AI analiza lo que se enseñó y sugiere el formato
      // Paso 2: El código fuerza ese formato en la generación
      const recentFormats = session.recentTurns.slice(-3)
        .map(t => (t.content as any)?.interaction?.interactionType)
        .filter(Boolean)
      const lastFormat = recentFormats[recentFormats.length - 1] || ''

      // Determinar formatos disponibles según preferencia Y tipo cognitivo del micro
      const quickFormats = 'multiple_choice, true_false, fill_blank, fill_blank_bank, matching, ordering'
      const writeFormats = 'open_response, teach_back, explain_why'

      // Formatos avanzados sensibles al tipo cognitivo del micro
      const advancedByType: Record<string, string[]> = {
        mathematical: ['step_by_step_solver', 'complete_reaction_or_formula', 'calculator_check', 'find_the_error'],
        procedural: ['step_by_step_solver', 'find_the_error', 'ordering'],
        applicative: ['practical_case', 'prediction', 'step_by_step_solver'],
        causal: ['prediction', 'explain_why', 'practical_case'],
        comparative: ['classify_groups', 'matching', 'compare_contrast'],
        classificatory: ['classify_groups', 'matching'],
        analytical: ['practical_case', 'explain_why'],
      }
      const advancedForMicro = (advancedByType[currentMicro.cognitiveType] || []).join(', ')

      // Componer la lista según la preferencia
      let availableFormats: string
      if (evalPreference === 'quick_test') {
        availableFormats = advancedForMicro ? quickFormats + ', ' + advancedForMicro : quickFormats
      } else if (evalPreference === 'write_explain') {
        availableFormats = advancedForMicro ? writeFormats + ', ' + advancedForMicro : writeFormats
      } else {
        // mix_everything: todo disponible
        const allBase = quickFormats + ', ' + writeFormats
        availableFormats = advancedForMicro ? allBase + ', ' + advancedForMicro : allBase
      }

      // Deduplicar
      availableFormats = Array.from(new Set(availableFormats.split(', ').map(f => f.trim()).filter(Boolean))).join(', ')

      // Construir el último contenido enseñado para contexto
      const lastTeachingContent = session.recentTurns
        .filter(t => t.content.type === 'teaching')
        .slice(-1)
        .map(t => t.content.summary)
        .join(' ') || currentMicro.shortDescription

      // Contexto rico del micro para que el LLM elija con criterio
      const microResources = [
        currentMicro.formulas.length > 0 ? `${currentMicro.formulas.length} fórmula(s): ${currentMicro.formulas.map(f => f.expression).slice(0, 2).join(', ')}` : null,
        currentMicro.procedures.length > 0 ? `${currentMicro.procedures.length} procedimiento(s) con pasos ordenados` : null,
        currentMicro.examples.length > 0 ? `${currentMicro.examples.length} ejemplo(s) prácticos` : null,
        currentMicro.commonErrors.length > 0 ? `${currentMicro.commonErrors.length} error(es) común(es) documentado(s)` : null,
      ].filter(Boolean).join(' | ') || 'ninguno especial'

      // Guía por tipo cognitivo — qué formato es IDEAL para cada tipo
      const formatGuide: Record<string, string> = {
        definitional: 'multiple_choice, true_false (definiciones claras) → fill_blank si hay fórmula',
        conceptual: 'multiple_choice con distractores plausibles, o true_false con matiz',
        procedural: 'ordering (pasos), o step_by_step_solver, o find_the_error',
        mathematical: 'fill_blank con fórmula, complete_reaction_or_formula, o step_by_step_solver',
        causal: 'explain_why, prediction, o true_false con corrección',
        comparative: 'matching, classify_groups, o compare_contrast',
        classificatory: 'classify_groups, matching',
        chronological: 'ordering, matching (fecha↔evento)',
        applicative: 'practical_case, prediction, step_by_step_solver',
        analytical: 'practical_case, explain_why, open_response',
        narrative: 'multiple_choice, ordering (secuencia)',
      }
      const guideForType = formatGuide[currentMicro.cognitiveType] || 'cualquier formato apropiado'

      try {
        const formatSuggestion = await alaiRequest(async (client: any, modelFn: any) => {
          const res = await client.chat.completions.create({
            model: modelFn(),
            messages: [
              {
                role: 'system',
                content: 'Eres un experto en evaluación pedagógica. Eliges el formato IDEAL para evaluar un concepto específico, no rotas por rotar. Respondes con UNA SOLA PALABRA.',
              },
              {
                role: 'user',
                content: `CONCEPTO ENSEÑADO: "${currentMicro.name}"
TIPO COGNITIVO: ${currentMicro.cognitiveType}
IMPORTANCIA: ${currentMicro.importance}
DIFICULTAD: ${currentMicro.difficulty}/100

RECURSOS DISPONIBLES DEL MICRO: ${microResources}

CONTENIDO ENSEÑADO: ${lastTeachingContent.slice(0, 300)}

═══════════════════════════════════════
GUÍA POR TIPO COGNITIVO:
${guideForType}

Prioriza formatos que EXPLOTEN los recursos del micro:
- Si tiene fórmulas → fill_blank con fórmula, o complete_reaction_or_formula
- Si tiene procedimientos → ordering (pasos) o step_by_step_solver
- Si tiene ejemplos → practical_case o prediction
- Si tiene errores comunes → find_the_error o multiple_choice con distractor basado en el error
═══════════════════════════════════════

PREFERENCIA DEL ESTUDIANTE: ${evalPreference === 'quick_test' ? 'RÁPIDAS' : evalPreference === 'write_explain' ? 'ESCRIBIR' : 'MIXTAS'}
FORMATOS DISPONIBLES: ${availableFormats}
ÚLTIMO USADO (evitar repetir si hay alternativa igual de buena): ${lastFormat || 'ninguno'}

REGLA: elige el formato que MEJOR evalúe ESTE concepto, no uno al azar. Si un formato es claramente mejor, úsalo aunque coincida con el último.

Responde SOLO el nombre del formato. Una palabra.`,
              },
            ],
            temperature: 0.2,
            max_tokens: 20,
          })
          const raw = res?.choices?.[0]?.message?.content || ''
          return { text: raw.trim().toLowerCase().replace(/[^a-z_]/g, ''), provider: 'unknown', model: 'unknown' }
        })

        const suggested = formatSuggestion.text
        const validFormats = availableFormats.split(', ').map((f: string) => f.trim())

        if (validFormats.includes(suggested)) {
          interactionFormat = suggested
          formatReason = `AI sugirió: ${suggested} (para "${currentMicro.name}" tipo ${currentMicro.cognitiveType})`
        } else {
          // Fallback DETERMINISTA según tipo cognitivo del micro
          interactionFormat = pickBestFormatForType(currentMicro, validFormats, lastFormat)
          formatReason = `AI sugirió "${suggested}" (inválido), fallback por tipo ${currentMicro.cognitiveType}: ${interactionFormat}`
        }
      } catch (err: any) {
        // Si falla la llamada, usar fallback determinista
        const validFormats = availableFormats.split(', ').map((f: string) => f.trim())
        interactionFormat = pickBestFormatForType(currentMicro, validFormats, lastFormat)
        formatReason = `Error AI, fallback por tipo ${currentMicro.cognitiveType}: ${interactionFormat}`
      }
    } else {
      interactionFormat = 'none'
      formatReason = 'Solo contenido sin pregunta'
    }
    console.log(`[tutor v3] Format: ${interactionFormat} — ${formatReason}`)

    console.log(`[tutor v3] Micro: "${currentMicro.name}" | Objetivo: ${objectiveDecision.objective} | Format: ${interactionFormat}`)
    console.log(`[tutor v3] Razón: ${objectiveDecision.reason}`)

    // ── 7. Generar contenido (LLM solo aquí) ────────────────────
    // Extraer preguntas y contenido EXACTO previo para que el LLM no repita
    const avoidRepeating: string[] = []
    const recentMicroTurns = session.recentTurns.filter(t => t.microId === currentMicro.id)
    
    // Trackear formatos ya usados
    for (const turn of recentMicroTurns.slice(-5)) {
      const turnInteraction = (turn.content as any)?.interaction
      if (turnInteraction?.interactionType) {
        avoidRepeating.push('FORMATO: ' + turnInteraction.interactionType)
      }
    }

    for (const turn of recentMicroTurns.slice(-5)) {
      // Agregar resumen del contenido
      if (turn.content.summary) {
        avoidRepeating.push(turn.content.summary)
      }
      // Agregar pregunta exacta si la hubo
      const turnInteraction = (turn.content as any)?.interaction
      if (turnInteraction?.prompt) {
        avoidRepeating.push(`PREGUNTA YA HECHA: "${turnInteraction.prompt}"`)
      }
      // Agregar opciones si fue MCQ
      if (turnInteraction?.data?.options) {
        avoidRepeating.push(`OPCIONES YA USADAS: ${turnInteraction.data.options.join(', ')}`)
      }
    }

    // Contexto de transición narrativa
    const previousTurn = session.recentTurns[session.recentTurns.length - 1]
    const previousObjective = previousTurn?.objective
    const previousMicroId = previousTurn?.microId
    const previousMicro = previousMicroId && previousMicroId !== currentMicro.id
      ? graph.microConcepts.find((m: any) => m.id === previousMicroId)
      : undefined
    const isFirstInteraction = session.recentTurns.length === 0
    const isMicroChange = !!previousMicroId && previousMicroId !== currentMicro.id
    const isSessionClosing = shouldCloseSession(session)
    const lastOutcome = evaluation ? evaluation.outcome : null

    const generated = await generateContent({
      micro: currentMicro,
      microState: currentMicroState,
      objective: objectiveDecision.objective,
      interactionFormat,
      sessionState: session,
      studentProfile,
      avoidRepeating,
      lastStudentResponse: studentAnswer,
      evalPreference: evalPreference as any,
      previousObjective,
      previousMicro,
      lastOutcome,
      isFirstInteraction,
      isMicroChange,
      isSessionClosing,
    })

    // ── 8. Registrar el evento de introducción/enseñanza ────────
    if (objectiveDecision.objective === 'introduce') {
      const stateAfterIntroduce = recordEvent(
        session.microStates[currentMicro.id],
        'introduced',
        session.currentTurn,
        { contentShown: generated.tutorMessage },
      )
      // IMPORTANTE: marcar como explainedByTutor también para que no vuelva a introducir
      stateAfterIntroduce.evidence.introduced = true
      stateAfterIntroduce.evidence.explainedByTutor = true
      session.microStates[currentMicro.id] = stateAfterIntroduce
    } else if (['explain_deeper', 'illustrate_with_example', 'reveal_answer', 'reconstruct_from_error'].includes(objectiveDecision.objective)) {
      session.microStates[currentMicro.id] = recordEvent(
        currentMicroState,
        'explained_by_tutor',
        session.currentTurn,
        { contentShown: generated.tutorMessage, objectiveAtTime: objectiveDecision.objective },
      )
    }

    // ── 9. Registrar el turn ─────────────────────────────────────
    const turn: Turn = {
      turnNumber: session.currentTurn + 1,
      timestamp: Date.now(),
      microId: nextMicroId,
      objective: objectiveDecision.objective,
      content: {
        type: objectiveDecision.requiresQuestion ? 'question' : 'teaching',
        summary: generated.tutorMessage.slice(0, 100),
        interaction: generated.interaction,
      } as any,
    }
    session = recordTurn(session, turn)

    // Registrar el formato usado en el timeline del micro (para no repetir)
    if (interactionFormat !== 'none') {
      const currentMicroStateFinal = session.microStates[currentMicro.id]
      if (currentMicroStateFinal && currentMicroStateFinal.timeline.length > 0) {
        const lastEvent = currentMicroStateFinal.timeline[currentMicroStateFinal.timeline.length - 1]
        if (lastEvent && lastEvent.metadata) {
          (lastEvent.metadata as any).formatUsed = interactionFormat
        }
      }
    }

    // ── 10. Guardar sesión ──────────────────────────────────────
    await saveSession(session)

    // ── 11. Devolver respuesta ──────────────────────────────────
    const progress = calculateSessionProgress(session)

    return NextResponse.json({
      success: true,
      page: {
        type: objectiveDecision.suggestedContentType,
        title: generated.title,
        content: {
          tutorMessage: generated.tutorMessage,
          blocks: generated.blocks,
          keyIdea: generated.keyIdea,
        },
        interaction: generated.interaction,
      },
      systemInfo: {
        activeMicro: currentMicro.name,
        microId: currentMicro.id,
        masteryLevel: session.microStates[nextMicroId].masteryLevel,
        objective: objectiveDecision.objective,
        reason: objectiveDecision.reason,
        format: interactionFormat,
        progress: progress.percent,
        microsCompleted: progress.completed,
        microsTotal: progress.total,
        // ─── Perfil de evidencias del micro actual ───
        evidenceProfile: (session.microStates[nextMicroId] as any).evidenceProfile || null,
        missingEvidences: (session.microStates[nextMicroId] as any).evidenceProfile
          ? getMissingEvidences((session.microStates[nextMicroId] as any).evidenceProfile, currentMicro)
          : [],
      },
      evaluation,
      sessionId: session.sessionId,
      shouldCloseSession: shouldCloseSession(session),
      summary: {
        totalCorrect: session.totalCorrect,
        totalIncorrect: session.totalIncorrect,
        microsCompleted: session.queue.completedMicroIds.length,
        microsTotal: session.queue.totalPlanned,
      },
    })

  } catch (err: any) {
    console.error('[tutor v3]', err.message, err.stack)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK DETERMINISTA — elige el mejor formato según el micro
// ═══════════════════════════════════════════════════════════════
function pickBestFormatForType(micro: any, validFormats: string[], lastFormat: string | null): string {
  const type = micro.cognitiveType || 'conceptual'
  const hasFormulas = (micro.formulas || []).length > 0
  const hasProcedures = (micro.procedures || []).length > 0
  const hasCommonErrors = (micro.commonErrors || []).length > 0

  // Preferencias ordenadas por tipo cognitivo
  const preferences: Record<string, string[]> = {
    definitional: ['multiple_choice', 'true_false', 'fill_blank', 'open_response'],
    conceptual: ['multiple_choice', 'true_false', 'explain_why', 'open_response'],
    procedural: ['ordering', 'step_by_step_solver', 'find_the_error', 'multiple_choice'],
    mathematical: ['fill_blank', 'complete_reaction_or_formula', 'step_by_step_solver', 'multiple_choice'],
    causal: ['explain_why', 'prediction', 'true_false', 'multiple_choice'],
    comparative: ['matching', 'classify_groups', 'multiple_choice', 'true_false'],
    classificatory: ['classify_groups', 'matching', 'multiple_choice'],
    chronological: ['ordering', 'matching', 'multiple_choice'],
    applicative: ['practical_case', 'step_by_step_solver', 'prediction', 'open_response'],
    analytical: ['practical_case', 'explain_why', 'open_response'],
    narrative: ['ordering', 'multiple_choice', 'fill_blank'],
  }

  let preferred = preferences[type] || ['multiple_choice', 'true_false', 'fill_blank']

  // Boost: si el micro tiene fórmulas/procedimientos/errores, priorizar formatos que los exploten
  if (hasFormulas) preferred = ['fill_blank', 'complete_reaction_or_formula', ...preferred]
  if (hasProcedures) preferred = ['ordering', 'step_by_step_solver', 'find_the_error', ...preferred]
  if (hasCommonErrors) preferred = ['find_the_error', 'multiple_choice', ...preferred]

  // Filtrar por formatos disponibles y evitar el último usado si hay otras opciones
  const availablePreferred = preferred.filter(f => validFormats.includes(f))
  const notLast = availablePreferred.filter(f => f !== lastFormat)

  if (notLast.length > 0) return notLast[0]
  if (availablePreferred.length > 0) return availablePreferred[0]
  return validFormats[0] || 'multiple_choice'
}
