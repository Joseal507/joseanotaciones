
// ═══════════════════════════════════════════════════════════════
// StudyAL — User Profile para el Adaptativo
// Conecta los datos del usuario (universidad, carrera, etc.)
// con el motor adaptativo para personalizar el aprendizaje.
// ═══════════════════════════════════════════════════════════════

export interface UserProfile {
  userId?: string
  nombre?: string
  email?: string

  // Contexto académico
  tipoEstudiante?: 'universitario' | 'preparatoria' | 'posgrado' | 'autodidacta' | 'profesional' | string
  universidad?: string
  escuela?: string
  carrera?: string
  edad?: number
  esMenor?: boolean

  // Objetivo de estudio
  objetivo?: string  // ej: "aprobar examen final", "aprender para trabajo", "certificación"

  // Contexto inferido
  academicLevel: 'basico' | 'intermedio' | 'avanzado'
  studyContext: 'exam_prep' | 'learning' | 'professional' | 'unknown'
  languagePreference: 'es' | 'en'
}

// ── Inferir nivel académico desde datos del usuario ──────────
export function inferAcademicLevel(profile: Partial<UserProfile>): UserProfile['academicLevel'] {
  const tipo = (profile.tipoEstudiante || '').toLowerCase()
  const carrera = (profile.carrera || '').toLowerCase()

  if (tipo.includes('posgrado') || tipo.includes('maestr') || tipo.includes('doctor')) {
    return 'avanzado'
  }
  if (tipo.includes('universitario') || tipo.includes('universidad')) {
    return 'intermedio'
  }
  if (tipo.includes('preparatoria') || tipo.includes('bachiller') || tipo.includes('secundaria')) {
    return 'basico'
  }
  if (tipo.includes('profesional') || tipo.includes('trabajo')) {
    return 'avanzado'
  }
  return 'intermedio'
}

// ── Inferir contexto de estudio ──────────────────────────────
export function inferStudyContext(profile: Partial<UserProfile>): UserProfile['studyContext'] {
  const objetivo = (profile.objetivo || '').toLowerCase()

  if (
    objetivo.includes('examen') || objetivo.includes('exam') ||
    objetivo.includes('aprobar') || objetivo.includes('parcial') ||
    objetivo.includes('final') || objetivo.includes('certif')
  ) {
    return 'exam_prep'
  }
  if (
    objetivo.includes('trabajo') || objetivo.includes('laboral') ||
    objetivo.includes('profesional') || objetivo.includes('empresa')
  ) {
    return 'professional'
  }
  if (
    objetivo.includes('aprender') || objetivo.includes('entender') ||
    objetivo.includes('conocer') || objetivo.includes('curiosidad')
  ) {
    return 'learning'
  }
  return 'unknown'
}

// ── Construir UserProfile completo ───────────────────────────
export function buildUserProfile(raw: any): UserProfile {
  const partial: Partial<UserProfile> = {
    userId: raw?.user_id || raw?.id,
    nombre: raw?.nombre || raw?.name,
    email: raw?.email,
    tipoEstudiante: raw?.tipo_estudiante || raw?.tipoEstudiante,
    universidad: raw?.universidad,
    escuela: raw?.escuela,
    carrera: raw?.carrera,
    edad: raw?.edad ? Number(raw.edad) : undefined,
    esMenor: raw?.es_menor === 1 || raw?.esMenor === true,
    objetivo: raw?.objetivo,
    languagePreference: 'es',
  }

  return {
    ...partial,
    academicLevel: inferAcademicLevel(partial),
    studyContext: inferStudyContext(partial),
    languagePreference: 'es',
  }
}

// ── Personalizar dificultad según perfil ────────────────────
export function getProfileDifficultyOffset(profile: UserProfile): number {
  // Posgrado/profesional → contenido más exigente
  if (profile.academicLevel === 'avanzado') return +10
  // Preparatoria → contenido más accesible
  if (profile.academicLevel === 'basico') return -15
  return 0
}

// ── Personalizar el prompt según perfil ─────────────────────
export function buildProfileContext(profile: UserProfile): string {
  const parts: string[] = []

  if (profile.tipoEstudiante) {
    parts.push(`Tipo de estudiante: ${profile.tipoEstudiante}`)
  }
  if (profile.carrera) {
    parts.push(`Carrera: ${profile.carrera}`)
  }
  if (profile.universidad || profile.escuela) {
    parts.push(`Institución: ${profile.universidad || profile.escuela}`)
  }
  if (profile.objetivo) {
    parts.push(`Objetivo: ${profile.objetivo}`)
  }
  if (profile.academicLevel) {
    const levelLabel = {
      basico: 'nivel básico (preparatoria)',
      intermedio: 'nivel universitario',
      avanzado: 'nivel avanzado (posgrado/profesional)',
    }[profile.academicLevel]
    parts.push(`Nivel académico: ${levelLabel}`)
  }

  if (parts.length === 0) return ''
  return `CONTEXTO DEL ESTUDIANTE:\n${parts.join('\n')}`
}

// ── Ajustar estrategia según contexto de estudio ────────────
export function getProfileStrategyAdjustment(
  profile: UserProfile,
  daysToExam: number | null,
): {
  urgencyBoost: boolean
  focusOnApplication: boolean
  shorterSessions: boolean
  emphasizeMemory: boolean
} {
  const isExamPrep = profile.studyContext === 'exam_prep'
  const isProfessional = profile.studyContext === 'professional'
  const isBasic = profile.academicLevel === 'basico'
  const examSoon = daysToExam !== null && daysToExam <= 7

  return {
    urgencyBoost: isExamPrep && examSoon,
    focusOnApplication: isProfessional,
    shorterSessions: isBasic,
    emphasizeMemory: isExamPrep,
  }
}

// ── Storage del perfil en cliente ───────────────────────────
const PROFILE_KEY = 'studyal_user_profile_adaptive'

export function cacheUserProfile(profile: UserProfile): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {}
}

export function loadCachedUserProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}
