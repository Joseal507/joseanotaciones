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
  loadMaterialMastery,
  saveMaterialMastery,
  extractMasteryFromSession,
  getMicrosNeedingRetention,
  getCoverageReport as getGlobalCoverageReport,
} from '../../../../../lib/adaptive/v3/storage/materialMasteryStorage'
import {
  initSessionState,
  recordEvent,
  recordTurn,
  selectNextMicro,
  advanceMicro,
  markMicroAsNeedsReinforcement,
  postponeMicro,
  shouldCloseSession,
  calculateSessionProgress,
  MAX_INTERACTIONS_PER_MICRO,
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
import { loadQuestionBank } from '../../../../../lib/adaptive/v3/storage/questionBankStorage'
import { pickNextQuestion } from '../../../../../lib/adaptive/v3/graph/questionBank'
import {
  computeMicroCoverage,
  computeCoverageReport,
  getMicrosNeedingWork,
} from '../../../../../lib/adaptive/v3/engine/coverageTracker'
import type { BankedQuestion, QuestionBank } from '../../../../../lib/adaptive/v3/graph/questionBank'
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
      sessionPurpose = 'understand',  // propósito pedagógico de la sesión
      sessionFormat = 'discovery',    // formato de la sesión
      assignedMicroIds = [],          // ← restricción determinista de micros por sesión
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

    // ── 2. Cargar mastery global + banco de preguntas + sesión ──
    // El mastery global acumula el progreso de TODAS las sesiones anteriores
    const materialMastery = await loadMaterialMastery(userId, materialId)
    // Cargar el banco de preguntas pre-generado del material
    const questionBank = await loadQuestionBank(userId, materialId)
    if (questionBank) {
      const totalQ = Object.values(questionBank).reduce((s: number, b: any) => s + (b.totalQuestions || 0), 0)
      console.log(`[tutor v3] Banco cargado: ${totalQ} preguntas en ${Object.keys(questionBank).length} micros`)
    }
    const priorMastery = materialMastery?.micros || {}
    if (Object.keys(priorMastery).length > 0) {
      console.log(`[tutor v3] Mastery previo cargado: ${Object.keys(priorMastery).length} micros conocidos`)
    }

    let session = sessionId ? await loadSession(userId, materialId, sessionId) : null

    // ── Si la sesión existe pero tiene más micros de los asignados, restringirla ──
    // Esto corrige el caso donde la sesión fue creada con el grafo completo
    // y luego se intenta usar con assignedMicroIds más restrictivos
    if (session && Array.isArray(assignedMicroIds) && assignedMicroIds.length > 0) {
      const validGraphIds = new Set(graph.microConcepts.map((m: any) => m.id))
      const validAssigned = assignedMicroIds.filter((id: string) => validGraphIds.has(id))
      if (validAssigned.length > 0) {
        const assignedSet = new Set(validAssigned)
        const sessionHasExtraIds =
          session.queue.pendingMicroIds.some((id: string) => !assignedSet.has(id)) ||
          (session.queue.activeMicroId && !assignedSet.has(session.queue.activeMicroId))

        if (sessionHasExtraIds) {
          // Filtrar la sesión existente para que solo tenga los micros asignados
          const filteredPending = session.queue.pendingMicroIds.filter((id: string) => assignedSet.has(id))
          const filteredPostponed = session.queue.postponedMicroIds.filter((id: string) => assignedSet.has(id))
          const filteredCompleted = session.queue.completedMicroIds.filter((id: string) => assignedSet.has(id))
          const filteredActive = session.queue.activeMicroId && assignedSet.has(session.queue.activeMicroId)
            ? session.queue.activeMicroId
            : null

          // Solo restringir si quedan micros pendientes válidos
          if (filteredPending.length > 0 || filteredCompleted.length > 0) {
            session = {
              ...session,
              requiredMicroIds: validAssigned,
              retentionMicroIds: (session as any).retentionMicroIds || [],
              queue: {
                ...session.queue,
                pendingMicroIds: filteredPending,
                postponedMicroIds: filteredPostponed,
                completedMicroIds: filteredCompleted,
                activeMicroId: filteredActive,
                totalPlanned: filteredPending.length + filteredCompleted.length + filteredPostponed.length,
              },
            }
            console.log(`[tutor v3] ✅ Sesión restringida a ${validAssigned.length} micros asignados (era ${graph.microConcepts.length} globales)`)
          }
        }
      }
    }

    if (!session) {
      const newSessionId = sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // ─── Restricción primaria: assignedMicroIds deterministas del programa ───
      // Si el programa tiene micros asignados a esta sesión, usarlos directamente.
      // Esto evita el filtrado semántico que puede fallar con falsos negativos.
      let microIdsToTeach: string[] | undefined = undefined
      if (Array.isArray(assignedMicroIds) && assignedMicroIds.length > 0) {
        // Validar que los IDs existan en el grafo actual
        const validGraphIds = new Set(graph.microConcepts.map((m: any) => m.id))
        const validAssigned = assignedMicroIds.filter((id: string) => validGraphIds.has(id))
        if (validAssigned.length > 0) {
          microIdsToTeach = validAssigned
          console.log(`[tutor v3] ✅ Restricción determinista: ${validAssigned.length}/${graph.microConcepts.length} micros asignados`)
        } else {
          console.log(`[tutor v3] ⚠ assignedMicroIds no matchearon el grafo — usando filtrado semántico`)
        }
      }

      // ─── Filtrar micros según los topics de la sesión (fallback semántico) ───
      if (!microIdsToTeach && Array.isArray(sessionTopicTitles) && sessionTopicTitles.length > 0) {
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
        priorMastery,  // ← inyectar mastery de sesiones anteriores
      })
      ;(session as any).requiredMicroIds = microIdsToTeach || graph.microConcepts.map((m: any) => m.id)
      ;(session as any).retentionMicroIds = []
      console.log(`[tutor v3] Nueva sesión: ${newSessionId} con ${(microIdsToTeach || graph.microConcepts.map(m => m.id)).length} micros`)

      // ── SPACED REPETITION: micros dominados en sesiones previas para repasar ──
      // Combinar: micros dominados + micros que necesitan retention check
      const dominatedPriorMicros = Object.entries(priorMastery)
        .filter(([_, m]: any) => m.isReady && m.answeredCorrectly >= 2)
        .map(([id]: any) => id)
        .filter((id: string) => !(microIdsToTeach || []).includes(id))
      const retentionMicros = materialMastery
        ? getMicrosNeedingRetention(materialMastery, 20) // 20 horas = al día siguiente
            .filter((id: string) => !(microIdsToTeach || []).includes(id))
        : []
      const allReviewMicros = [...new Set([...retentionMicros, ...dominatedPriorMicros])].slice(0, 3)
      if (allReviewMicros.length > 0) {
        ;(session as any).spacedReviewMicros = allReviewMicros
        ;(session as any).reviewedSoFar = []
        console.log(`[tutor v3] Review: ${allReviewMicros.length} micros (${retentionMicros.length} retention + ${dominatedPriorMicros.length} spaced)`)
      }
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
    // Spaced repetition: repasar micros dominados de sesiones previas al inicio
    const spacedReviewMicros: string[] = (session as any).spacedReviewMicros || []
    const reviewedSoFar: string[] = (session as any).reviewedSoFar || []
    const pendingReview = spacedReviewMicros.filter((id: string) => !reviewedSoFar.includes(id))
    const isEarlyInSession = session.currentTurn <= 4

    if (isEarlyInSession && pendingReview.length > 0 && studentAnswer === undefined) {
      const reviewMicroId = pendingReview[0]
      const reviewMicro = graph.microConcepts.find(m => m.id === reviewMicroId)
      if (reviewMicro) {
        ;(session as any).reviewedSoFar = [...reviewedSoFar, reviewMicroId]
        ;(session as any).isSpacedReview = true
        ;(session as any).spacedReviewMicroId = reviewMicroId
        console.log(`[tutor v3] Spaced review: repasando ${reviewMicro.name}`)
      }
    } else {
      ;(session as any).isSpacedReview = false

      // ── INTERLEAVING: mezclar preguntas de micros ya completados ──
      // Cada 4 preguntas correctas del micro actual, insertar 1 pregunta
      // de un micro ya completado en esta sesión (interleaving científico)
      const completedInSession = session.queue.completedMicroIds
      const currentMicroCorrects = session.microStates[session.queue.activeMicroId || '']?.evidence?.answeredCorrectly || 0
      const interleaveCount = (session as any).interleaveCount || 0
      const shouldInterleave = completedInSession.length > 0 &&
        currentMicroCorrects > 0 &&
        currentMicroCorrects % 4 === 0 &&
        interleaveCount < completedInSession.length &&
        !studentAnswer

      if (shouldInterleave) {
        const interleaveIdx = interleaveCount % completedInSession.length
        const interleaveMicroId = completedInSession[interleaveIdx]
        const interleaveMicro = graph.microConcepts.find(m => m.id === interleaveMicroId)
        if (interleaveMicro) {
          ;(session as any).interleaveCount = interleaveCount + 1
          ;(session as any).isInterleaving = true
          ;(session as any).interleaveMicroId = interleaveMicroId
          console.log(`[tutor v3] Interleaving: pregunta de ${interleaveMicro.name} para reforzar retención`)
        }
      } else {
        ;(session as any).isInterleaving = false
      }
    }

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
      const previousMicroId = session.queue.activeMicroId
      const previousMicroState = session.microStates[previousMicroId]
      if (previousMicroState?.isReady) {
        // Si el micro avanzó por fusible (muchos intentos), marcarlo para refuerzo posterior
        if (previousMicroState.totalInteractions >= MAX_INTERACTIONS_PER_MICRO) {
          session = markMicroAsNeedsReinforcement(session, previousMicroId)
          console.log(`[tutor v3] ⚠ Micro atascado → refuerzo posterior: ${previousMicroId}`)
        }
        session.queue = advanceMicro(session, previousMicroId)
        console.log(`[tutor v3] Micro completado: ${previousMicroId}`)
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

    // Detectar si es sesión de examen/simulación
    const isExamSession = sessionPurpose === 'simulate' ||
      sessionFormat === 'exam_simulation' ||
      sessionPurpose === 'repair'

    // ── EXAMEN FINAL: incluir TODOS los micros del programa ──────
    // Si es sesión de examen, el examen debe cubrir TODO el material
    // no solo los micros de esta sesión — garantiza aprendizaje completo
    if (isExamSession && Object.keys(priorMastery).length > 0) {
      const allDominatedMicroIds = Object.keys(priorMastery)
        .filter((id: string) => (priorMastery[id] as any)?.answeredCorrectly >= 1)
      for (const microId of allDominatedMicroIds) {
        const microExists = graph.microConcepts.some(m => m.id === microId)
        const notAlreadyQueued = !session.queue.pendingMicroIds.includes(microId)
        const notCompleted = !session.queue.completedMicroIds.includes(microId)
        if (microExists && notAlreadyQueued && notCompleted) {
          session.queue.pendingMicroIds.push(microId)
        }
      }
      if (allDominatedMicroIds.length > 0) {
        console.log(`[tutor v3] Examen final: ${session.queue.pendingMicroIds.length} micros totales del programa`)
      }
    }

    // ── COVERAGE CHECK: garantizar cobertura completa en examen ──
    if (isExamSession && questionBank) {
      const covCheckMap: Record<string, any> = {}
      for (const m of graph.microConcepts) {
        const st = session.microStates[m.id]
        const bank = (questionBank as Record<string, any>)[m.id]
        const requiredEvidences = bank?.requiredEvidences || 3
        covCheckMap[m.id] = computeMicroCoverage(m, {
          taught: !!st?.evidence?.introduced,
          correctAnswers: st?.evidence?.answeredCorrectly || 0,
          totalAnswers: (st?.evidence?.answeredCorrectly || 0) + (st?.evidence?.answeredIncorrectly || 0),
          requiredEvidences,
        })
      }
      const covReport = computeCoverageReport(graph, covCheckMap)
      console.log(`[tutor v3] 📊 Cobertura: ${covReport.masteredMicros}/${covReport.totalMicros} dominados (${covReport.materialLearned}%)`)

      if (!covReport.isComplete && covReport.weakMicros.length > 0) {
        for (const weak of covReport.weakMicros) {
          if (!session.queue.pendingMicroIds.includes(weak.microId) &&
              !session.queue.completedMicroIds.includes(weak.microId)) {
            session.queue.pendingMicroIds.push(weak.microId)
          }
        }
        console.log(`[tutor v3] Examen: +${covReport.weakMicros.length} micros débiles`)
      }
    }

    // El Objective Selector v2 ya razona sobre:
    // - Último outcome (fallo/parcial/correcto)
    // - Racha de aciertos/fallos
    // - Total de interacciones
    // - Tipo cognitivo del micro
    // - Importancia del micro
    // No necesita que le digamos qué evidencias faltan
    let objectiveDecision = selectObjective(currentMicroState, currentMicro, session, initialKnowledgeLevel, evalPreference)

    // Pre-quiz eliminado — el AskWidget ya está visible durante enseñanza
    // El estudiante puede preguntar dudas en cualquier momento
    ;(session as any).isPreQuiz = false

    // ── OVERRIDE para sesiones de examen ──────────────────────────
    // En exam_simulation: saltar toda la enseñanza, ir directo a verificar
    // El estudiante ya debería saber el material — esto mide si lo sabe
    if (isExamSession) {
      const lastOutcomeForExam = session.recentTurns
        .filter(t => t.microId === currentMicro.id)
        .slice(-1)[0]
      const lastOutcomeVal = (lastOutcomeForExam?.content as any)?.interaction ? 'pending' : null

      // En modo examen: NUNCA introducir, SIEMPRE verificar o dar feedback mínimo
      if (objectiveDecision.objective === 'introduce' ||
          objectiveDecision.objective === 'explain_deeper' ||
          objectiveDecision.objective === 'illustrate_with_example') {
        objectiveDecision = {
          ...objectiveDecision,
          objective: 'verify_understanding',
          reason: 'Sesión de examen — evaluar sin enseñar',
          requiresQuestion: true,
          requiresContent: false,
          suggestedContentType: 'question',
        }
      }
    }

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
      objectiveDecision = selectObjective(currentMicroState, currentMicro, session, initialKnowledgeLevel, evalPreference)
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
      // En sesión de examen: forzar formatos de evaluación sin ayuda
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

      // Formatos que requieren escritura larga — excluir en quick_test
      const WRITE_FORMATS = new Set(['open_response', 'teach_back', 'explain_why', 'practical_case', 'step_by_step_solver', 'prediction', 'compare_contrast'])
      // Formatos que son rápidos — excluir en write_explain
      const QUICK_FORMATS_SET = new Set(['multiple_choice', 'true_false', 'fill_blank', 'fill_blank_bank', 'matching', 'ordering', 'classify_groups', 'find_the_error', 'complete_reaction_or_formula', 'calculator_check'])

      // Componer la lista según la preferencia
      let availableFormats: string
      if (evalPreference === 'quick_test') {
        // Solo formatos rápidos — filtrar cualquier formato de escritura del advancedForMicro
        const advancedQuick = (advancedByType[currentMicro.cognitiveType] || [])
          .filter(f => !WRITE_FORMATS.has(f)).join(', ')
        availableFormats = advancedQuick ? quickFormats + ', ' + advancedQuick : quickFormats
      } else if (evalPreference === 'write_explain') {
        // Solo formatos de escritura — filtrar rápidos del advancedForMicro
        const advancedWrite = (advancedByType[currentMicro.cognitiveType] || [])
          .filter(f => !QUICK_FORMATS_SET.has(f)).join(', ')
        availableFormats = advancedWrite ? writeFormats + ', ' + advancedWrite : writeFormats
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
          interactionFormat = pickBestFormatForType(currentMicro, validFormats, lastFormat, evalPreference)
          formatReason = `AI sugirió "${suggested}" (inválido), fallback por tipo ${currentMicro.cognitiveType}: ${interactionFormat}`
        }
      } catch (err: any) {
        // Si falla la llamada, usar fallback determinista
        const validFormats = availableFormats.split(', ').map((f: string) => f.trim())
        interactionFormat = pickBestFormatForType(currentMicro, validFormats, lastFormat, evalPreference)
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
    // Usar TODOS los turns del micro, no solo los últimos 5
    for (const turn of recentMicroTurns) {
      const turnInteraction = (turn.content as any)?.interaction
      if (turnInteraction?.interactionType) {
        avoidRepeating.push('FORMATO: ' + turnInteraction.interactionType)
      }
    }

    // Usar TODOS los turns del micro, no solo los últimos 5
    for (const turn of recentMicroTurns) {
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

    // ═══════════════════════════════════════════════════════════
    // Intentar usar el BANCO DE PREGUNTAS pre-generado
    // Solo si el objetivo es verify_understanding y hay banco disponible
    // ═══════════════════════════════════════════════════════════
    let bankedQuestion: BankedQuestion | null = null
    const usedQIds: string[] = (session as any).usedQuestionIds || []
    const usedFactKeys: string[] = (session as any).usedFactKeys || []

    if (objectiveDecision.objective === 'verify_understanding' &&
        interactionFormat !== 'none' &&
        questionBank &&
        questionBank[currentMicro.id]) {
      const bank = questionBank[currentMicro.id] as QuestionBank

      // Conectar el motor de evidencias al selector del banco:
      // priorizar preguntas que cubran la evidencia faltante del micro
      const currentEvidenceProfile = (currentMicroState as any).evidenceProfile || emptyEvidenceProfile(currentMicro.id)
      const missingEvidenceList = getMissingEvidences(currentEvidenceProfile, currentMicro)
      const preferredEvidenceType = missingEvidenceList.length > 0 ? missingEvidenceList[0] : undefined

      bankedQuestion = pickNextQuestion(
        bank,
        usedQIds,
        interactionFormat,
        undefined,
        usedFactKeys,
        preferredEvidenceType,
      )

      if (bankedQuestion) {
        console.log(`[tutor v3] 📚 BANCO: usando pregunta ${bankedQuestion.id} (${bankedQuestion.format}, ${bankedQuestion.cognitiveAngle}) | evidencia faltante=${preferredEvidenceType || 'ninguna'}`)
      } else {
        console.log(`[tutor v3] Banco agotado para ${currentMicro.name} — usando LLM`)
      }
    }

    // Si tenemos pregunta del banco, la usamos directamente sin LLM
    // Solo pedimos al LLM el tutorMessage de transición (contexto pedagógico)
    let generated: any
    if (bankedQuestion) {
      // Registrar pregunta como usada
      ;(session as any).usedQuestionIds = [...usedQIds, bankedQuestion.id]
      ;(session as any).usedFactKeys = [...usedFactKeys, bankedQuestion.factKey].slice(-12)

      // Generar solo el tutorMessage de transición (breve, sin pregunta)
      const transitionMsg = await generateContent({
        micro: currentMicro,
        microState: currentMicroState,
        objective: 'connect_to_previous',  // solo transición
        interactionFormat: 'none',
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
        isExamSession,
        isSpacedReview: !!(session as any).isSpacedReview,
        isInterleaving: !!(session as any).isInterleaving,
        isPreQuiz: false,
      })

      generated = {
        title: currentMicro.name,
        tutorMessage: transitionMsg.tutorMessage || 'Continuemos.',
        blocks: [],
        keyIdea: undefined,
        interaction: {
          id: bankedQuestion.id,
          interactionType: bankedQuestion.format,
          prompt: bankedQuestion.prompt,
          data: bankedQuestion.data,
        },
        metadata: {
          objective: objectiveDecision.objective,
          microId: currentMicro.id,
          generatedAt: Date.now(),
        },
      }
    } else {
      // Fallback: generar con LLM (comportamiento original)
      generated = await generateContent({
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
        isExamSession,
        isSpacedReview: !!(session as any).isSpacedReview,
        isInterleaving: !!(session as any).isInterleaving,
        isPreQuiz: !!(session as any).isPreQuiz,
        alternativeStrategy: (objectiveDecision as any).alternativeStrategy || null,
        failingEvidenceType: (objectiveDecision as any).failingEvidenceType || null,
      })
    }

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

    // ── 10. Guardar sesión + actualizar mastery global ─────────
    await saveSession(session)
    // Actualizar mastery global con el progreso de esta sesión
    const updatedMaterialMastery = extractMasteryFromSession(
      session, materialMastery, userId, materialId, graph
    )
    await saveMaterialMastery(updatedMaterialMastery)
    console.log(`[tutor v3] Mastery global actualizado: ${Object.keys(updatedMaterialMastery.micros).length} micros`)

    // ── 11. Calcular coverage global + progreso ──────────────
    const progress = calculateSessionProgress(session)

    // Coverage GLOBAL del material (acumulada entre sesiones)
    // Fuente de verdad: updatedMaterialMastery, no session.microStates local
    let coverageReport: any = null
    coverageReport = getGlobalCoverageReport(updatedMaterialMastery)

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
      coverageReport,  // ← reporte de cobertura global del material
    })

  } catch (err: any) {
    console.error('[tutor v3]', err.message, err.stack)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK DETERMINISTA — elige el mejor formato según el micro
// ═══════════════════════════════════════════════════════════════
function pickBestFormatForType(micro: any, validFormats: string[], lastFormat: string | null, evalPreference?: string): string {
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

  // Filtrar por evalPreference antes de elegir
  const WRITE_ONLY = ['open_response', 'teach_back', 'explain_why', 'practical_case', 'step_by_step_solver', 'prediction', 'compare_contrast']
  const QUICK_ONLY = ['multiple_choice', 'true_false', 'fill_blank', 'fill_blank_bank', 'matching', 'ordering', 'classify_groups', 'find_the_error', 'complete_reaction_or_formula']
  if (evalPreference === 'quick_test') {
    preferred = preferred.filter(f => !WRITE_ONLY.includes(f))
  } else if (evalPreference === 'write_explain') {
    preferred = preferred.filter(f => !QUICK_ONLY.includes(f))
  }

  // Filtrar por formatos disponibles y evitar el último usado si hay otras opciones
  const availablePreferred = preferred.filter(f => validFormats.includes(f))
  const notLast = availablePreferred.filter(f => f !== lastFormat)

  if (notLast.length > 0) return notLast[0]
  if (availablePreferred.length > 0) return availablePreferred[0]
  return validFormats[0] || 'multiple_choice'
}
