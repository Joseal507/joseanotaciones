import { NextRequest, NextResponse } from 'next/server'
import { alai, safeParseJson } from '../../../../lib/alai'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// PARTE B — chat ALAI dentro de la sesión. SEGURIDAD PEDAGÓGICA (por diseño,
// no por convención): esta ruta es de solo lectura respecto al estado
// académico — no recibe ni puede escribir demonstratedFactKeys, mastery,
// targetObjectiveIds, factKeys, ni completar/desbloquear nada. Es
// exclusivamente generación de texto asesor; el marcado de asistencia
// (chatAssistedRef) vive enteramente en el cliente (page.tsx), igual que el
// hint existente — esta ruta ni siquiera sabe que ese marcado existe.

interface TaughtStep {
  id: string
  title: string
  content: string
  keyPoint?: string
}

interface SessionChatRequest {
  message: string
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  sessionTitle?: string
  materialTitle?: string
  academicDomain?: string
  studentProfile?: { knowledgeLevel?: string; mainConcern?: string } | null
  taughtSteps?: TaughtStep[]
  activeQuestion?: { questionText?: string; format?: string } | null
  activeRecovery?: {
    conceptLabel?: string
    originalQuestionText?: string
    studentAnswerDisplay?: string
    correctAnswerDisplay?: string
    errorType?: string
    reteachContent?: string
  } | null
}

const MAX_MESSAGE_LENGTH = 2000
const MAX_HISTORY_TURNS = 8
const MAX_TAUGHT_STEPS = 40

function buildStudentProfileBlock(profile: SessionChatRequest['studentProfile']): string {
  if (!profile || typeof profile !== 'object') return ''
  const knowledgeLevel = typeof profile.knowledgeLevel === 'string' ? profile.knowledgeLevel.trim() : ''
  const mainConcern = typeof profile.mainConcern === 'string' ? profile.mainConcern.trim() : ''
  if (!knowledgeLevel && !mainConcern) return ''
  return [
    '════ PERFIL DEL ESTUDIANTE (señal real, úsala para el registro de tu respuesta) ════',
    knowledgeLevel ? `Nivel declarado: ${knowledgeLevel}` : '',
    mainConcern ? `Contexto/preocupación: ${mainConcern}` : '',
  ].filter(Boolean).join('\n')
}

function buildActiveQuestionBlock(activeQuestion: SessionChatRequest['activeQuestion']): string {
  if (!activeQuestion || typeof activeQuestion.questionText !== 'string' || !activeQuestion.questionText.trim()) return ''
  return `════ PREGUNTA DE EVALUACIÓN ACTIVA AHORA MISMO ════
"${activeQuestion.questionText}" (formato: ${activeQuestion.format || 'desconocido'})
El estudiante puede pedirte ayuda para razonar esto. Guía el razonamiento con el contenido ya enseñado — NO le entregues la respuesta literal como un dato aislado a copiar, ayúdalo a entender el concepto que la pregunta evalúa.`
}

function buildActiveRecoveryBlock(activeRecovery: SessionChatRequest['activeRecovery']): string {
  if (!activeRecovery || typeof activeRecovery !== 'object') return ''
  const { conceptLabel, originalQuestionText, studentAnswerDisplay, correctAnswerDisplay, errorType, reteachContent } = activeRecovery
  if (!conceptLabel && !originalQuestionText) return ''
  return `════ RECOVERY ACTIVO (el estudiante falló esto y está en proceso de recuperación) ════
Concepto que falló: ${conceptLabel || 'desconocido'}
Pregunta original: ${originalQuestionText || ''}
${studentAnswerDisplay ? `Respondió: ${studentAnswerDisplay}` : ''}
${correctAnswerDisplay ? `Respuesta correcta: ${correctAnswerDisplay}` : ''}
${errorType ? `Tipo de error detectado: ${errorType}` : ''}
${reteachContent ? `Reexplicación actual mostrada:\n${reteachContent}` : ''}
Puedes explicar por qué su respuesta fue incorrecta y ayudarlo a entender el error. Si está en medio de una VERIFICACIÓN activa (pregunta de recovery sin responder aún), aplica la misma regla que para preguntas de evaluación: guía el razonamiento, no entregues la respuesta literal como dato aislado.`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as SessionChatRequest
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ success: false, error: 'EMPTY_MESSAGE' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ success: false, error: 'MESSAGE_TOO_LONG' }, { status: 400 })
    }

    const taughtSteps = Array.isArray(body.taughtSteps)
      ? body.taughtSteps
        .filter((step): step is TaughtStep => Boolean(step && typeof step.id === 'string' && typeof step.title === 'string' && typeof step.content === 'string'))
        .slice(0, MAX_TAUGHT_STEPS)
      : []

    const chatHistory = Array.isArray(body.chatHistory)
      ? body.chatHistory
        .filter((turn): turn is { role: 'user' | 'assistant'; content: string } =>
          Boolean(turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'))
        .slice(-MAX_HISTORY_TURNS)
      : []

    const contentBlock = taughtSteps.length > 0
      ? taughtSteps.map(step => `[Paso: ${step.title}]${step.keyPoint ? ` (idea clave: ${step.keyPoint})` : ''}\n${step.content}`).join('\n\n')
      : '(Ningún paso enseñado disponible todavía en esta sesión.)'

    const historyBlock = chatHistory.length > 0
      ? chatHistory.map(turn => `${turn.role === 'user' ? 'Estudiante' : 'ALAI'}: ${turn.content}`).join('\n')
      : '(Sin mensajes previos en este chat.)'

    const prompt = `Eres ALAI, el tutor de StudyAL. El estudiante está en medio de una sesión de estudio y te escribe por el chat lateral, sin abandonar la sesión. Responde de forma clara, breve y pedagógica.

════ MATERIAL Y SESIÓN ════
Material: ${body.materialTitle || 'Material'}
Sesión: ${body.sessionTitle || ''}
${body.academicDomain ? `Dominio académico: ${body.academicDomain}` : ''}

${buildStudentProfileBlock(body.studentProfile)}

════ CONTENIDO YA ENSEÑADO EN ESTA SESIÓN (tu fuente principal) ════
${contentBlock}

${buildActiveQuestionBlock(body.activeQuestion)}

${buildActiveRecoveryBlock(body.activeRecovery)}

════ HISTORIAL DEL CHAT (más reciente al final) ════
${historyBlock}

════ PREGUNTA ACTUAL DEL ESTUDIANTE ════
${message}

════ INSTRUCCIONES ════
- Responde PRINCIPALMENTE desde "CONTENIDO YA ENSEÑADO" arriba — es tu fuente de verdad.
- NUNCA presentes contenido inventado como si viniera del material. Si necesitas añadir conocimiento general/externo que NO está en lo ya enseñado, dilo explícitamente en tu respuesta (p.ej. "esto no está en el material, pero en general...") y marca usedExternalKnowledge=true.
- Si tu respuesta se apoya en un paso concreto ya enseñado, inclúyelo en "references" usando su título EXACTO tal como aparece arriba entre corchetes "[Paso: ...]". Nunca inventes un título de paso que no esté en la lista.
- Sé breve: 2-5 oraciones, salvo que el estudiante pida explícitamente más detalle o un ejemplo extenso.
- Nunca marques, completes ni alteres progreso, mastery o evaluaciones — solo respondes texto.

Devuelve SOLO JSON sin markdown ni fences:
{
  "reply": "tu respuesta al estudiante",
  "references": [{"stepTitle": "título exacto de un paso ya enseñado, si aplica"}],
  "usedExternalKnowledge": false
}`

    const result = await alai({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens: 500,
      json: true,
      taskType: 'session_chat',
      stage: 'normal',
    })

    const parsed = safeParseJson(result.text) as { reply?: unknown; references?: unknown; usedExternalKnowledge?: unknown } | null
    const reply = parsed && typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : (typeof result.text === 'string' && result.text.trim() ? result.text.trim() : 'No pude generar una respuesta en este momento. Intenta reformular tu pregunta.')

    const taughtStepsByTitle = new Map(taughtSteps.map(step => [step.title, step]))
    const rawReferences = Array.isArray(parsed?.references) ? parsed!.references as unknown[] : []
    const references = rawReferences
      .map(entry => {
        const stepTitle = entry && typeof entry === 'object' && 'stepTitle' in entry ? String((entry as Record<string, unknown>).stepTitle || '') : ''
        const step = taughtStepsByTitle.get(stepTitle)
        // Solo se resuelve contra taughtSteps REALMENTE enviados por el
        // cliente (pasos ya enseñados) — nunca se confía en un id que el LLM
        // haya podido inventar, y nunca puede apuntar a contenido que el
        // cliente no haya declarado como ya enseñado.
        return step ? { stepId: step.id, stepTitle: step.title } : null
      })
      .filter((ref): ref is { stepId: string; stepTitle: string } => Boolean(ref))

    return NextResponse.json({
      success: true,
      reply,
      references,
      usedExternalKnowledge: Boolean(parsed?.usedExternalKnowledge),
      provider: result.provider,
      model: result.model,
    })
  } catch (err: any) {
    console.error('[session-chat] Error:', err?.message)
    return NextResponse.json({
      success: false,
      error: 'SESSION_CHAT_GENERATION_FAILED',
      reply: 'No pude responder en este momento. Intenta de nuevo en unos segundos.',
    }, { status: 503 })
  }
}
