// ═══════════════════════════════════════════════════════════════
// SessionMemory — La memoria viva de lo que pasó en cada sesión
// Es el hilo conductor entre sesiones: qué se aprendió,
// qué quedó pendiente, qué necesita la próxima sesión.
// ═══════════════════════════════════════════════════════════════

export interface ConceptState {
  name: string
  status: 'unseen' | 'explained' | 'attempted' | 'verified' | 'mastered'
  lastScore?: number
  attempts: number
  // Qué actividades se hicieron sobre este concepto
  activitiesDone: Array<'explain' | 'quiz' | 'recall' | 'flashcard' | 'case'>
  // Si el estudiante expresó dudas específicas
  studentDubts?: string
}

export interface SessionMemory {
  sessionId: string
  topicTitle: string
  targetConcepts: string[]

  // Estado de cada concepto durante la sesión
  conceptStates: Record<string, ConceptState>

  // Qué quedó pendiente (para la próxima sesión)
  pendingConcepts: string[]
  masteredConcepts: string[]

  // Dudas del estudiante no resueltas
  unresolvedDubts: string[]

  // Qué tipo de actividades funcionaron / no funcionaron
  whatWorked: string[]
  whatDidntWork: string[]

  // Resumen para pasar a la próxima sesión
  handoffNote: string

  completedAt?: number
}

const MEMORY_KEY_PREFIX = 'studyal_session_memory_'

export function createSessionMemory(sessionId: string, topicTitle: string, targetConcepts: string[]): SessionMemory {
  const conceptStates: Record<string, ConceptState> = {}
  for (const name of targetConcepts) {
    conceptStates[name] = {
      name,
      status: 'unseen',
      attempts: 0,
      activitiesDone: [],
    }
  }

  return {
    sessionId,
    topicTitle,
    targetConcepts,
    conceptStates,
    pendingConcepts: [...targetConcepts],
    masteredConcepts: [],
    unresolvedDubts: [],
    whatWorked: [],
    whatDidntWork: [],
    handoffNote: '',
  }
}

export function updateConceptState(
  memory: SessionMemory,
  conceptName: string,
  update: {
    activityType: 'explain' | 'quiz' | 'recall' | 'flashcard' | 'case'
    score?: number
    studentInput?: string
  }
): SessionMemory {
  const updated = { ...memory, conceptStates: { ...memory.conceptStates } }
  const state = updated.conceptStates[conceptName]
  if (!state) return memory

  const newState = { ...state }
  newState.attempts += 1

  // Agregar actividad si no está
  const actMap: Record<string, ConceptState['activitiesDone'][0]> = {
    explain: 'explain', micro_quiz: 'quiz', quiz_multiple_choice: 'quiz',
    active_recall: 'recall', repair: 'recall', micro_flashcards: 'flashcard',
    flashcard_quiz: 'flashcard', case_study: 'case',
  }
  const mappedActivity = actMap[update.activityType] || update.activityType as any
  if (!newState.activitiesDone.includes(mappedActivity)) {
    newState.activitiesDone = [...newState.activitiesDone, mappedActivity]
  }

  // Actualizar status
  if (update.activityType === 'explain' && newState.status === 'unseen') {
    newState.status = 'explained'
  } else if (update.score !== undefined) {
    newState.lastScore = update.score
    if (update.score >= 75) {
      newState.status = 'mastered'
    } else if (update.score >= 45) {
      newState.status = 'verified'
    } else {
      newState.status = 'attempted'
    }
  }

  // Detectar dudas del estudiante
  if (update.studentInput) {
    const dubtPatterns = ['no entiendo', 'no sé', 'qué es', '¿por qué', 'no recuerdo', 'duda', '?']
    const hasDubt = dubtPatterns.some(p => update.studentInput!.toLowerCase().includes(p))
    if (hasDubt && !newState.studentDubts) {
      newState.studentDubts = update.studentInput.slice(0, 200)
    }
  }

  updated.conceptStates[conceptName] = newState

  // Recalcular listas
  updated.masteredConcepts = Object.values(updated.conceptStates)
    .filter(s => s.status === 'mastered')
    .map(s => s.name)

  updated.pendingConcepts = Object.values(updated.conceptStates)
    .filter(s => s.status !== 'mastered')
    .map(s => s.name)

  return updated
}

export function buildHandoffNote(memory: SessionMemory): string {
  const mastered = memory.masteredConcepts
  const pending = memory.pendingConcepts
  const states = Object.values(memory.conceptStates)

  const explained = states.filter(s => s.status === 'explained').map(s => s.name)
  const attempted = states.filter(s => s.status === 'attempted' || s.status === 'verified').map(s => s.name)

  const parts: string[] = []

  if (mastered.length > 0) {
    parts.push(`DOMINADOS: ${mastered.join(', ')}`)
  }
  if (explained.length > 0) {
    parts.push(`EXPLICADOS pero no verificados: ${explained.join(', ')} — empezar la próxima con quiz sobre estos`)
  }
  if (attempted.length > 0) {
    const weakAttempted = states.filter(s => (s.status === 'attempted' || s.status === 'verified') && (s.lastScore || 0) < 60).map(s => `${s.name}(${s.lastScore}%)`)
    if (weakAttempted.length > 0) {
      parts.push(`NECESITAN REFUERZO: ${weakAttempted.join(', ')}`)
    }
  }
  if (memory.unresolvedDubts.length > 0) {
    parts.push(`DUDAS PENDIENTES: ${memory.unresolvedDubts.slice(0, 2).join('; ')}`)
  }

  return parts.join(' | ') || 'Primera sesión sobre este topic.'
}

export function saveSessionMemory(memory: SessionMemory) {
  if (typeof window === 'undefined') return
  try {
    const key = MEMORY_KEY_PREFIX + memory.topicTitle.slice(0, 30).replace(/\s/g, '_')
    localStorage.setItem(key, JSON.stringify({ ...memory, completedAt: Date.now() }))
  } catch {}
}

export function loadSessionMemory(topicTitle: string): SessionMemory | null {
  if (typeof window === 'undefined') return null
  try {
    const key = MEMORY_KEY_PREFIX + topicTitle.slice(0, 30).replace(/\s/g, '_')
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as SessionMemory
  } catch { return null }
}

// Lo que la próxima sesión debe priorizar
export function getPriorityForNextSession(memory: SessionMemory): {
  mustStartWith: string[]  // conceptos que se explicaron pero no se verificaron
  mustReinforce: string[]  // conceptos con score < 60
  canSkip: string[]        // conceptos ya dominados
  handoffNote: string
} {
  const states = Object.values(memory.conceptStates)

  const mustStartWith = states
    .filter(s => s.status === 'explained' && s.activitiesDone.length === 1)
    .map(s => s.name)

  const mustReinforce = states
    .filter(s => (s.status === 'attempted' || s.status === 'verified') && (s.lastScore || 0) < 60)
    .map(s => s.name)

  const canSkip = states
    .filter(s => s.status === 'mastered')
    .map(s => s.name)

  return {
    mustStartWith,
    mustReinforce,
    canSkip,
    handoffNote: buildHandoffNote(memory),
  }
}
