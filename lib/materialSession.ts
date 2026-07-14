// ═══════════════════════════════════════════════════════════════
// MATERIAL SESSION — Storage único por material
//
// Reemplaza a: StudySession + MaterialMastery.adaptiveProgram
// Fuente única de verdad para: modo, programa adaptativo, setup, progreso.
// ═══════════════════════════════════════════════════════════════

const STORAGE_PREFIX = 'studyal_matses_v1_'

export interface MaterialSessionState {
  // Identificación estable (nunca cambia entre aperturas)
  stableKey: string
  temaId: string
  materialTitle: string

  // Modo actual
  processMode: 'adaptive' | 'free' | 'guided'
  processStyle?: 'book' | 'sessions'

  // Setup adaptativo
  setup?: {
    initialKnowledgeLevel: 'zero' | 'some' | 'good'
    sessionLength: 'short' | 'medium' | 'long'
    targetScore: number
    examDate?: string | null
    examDateCustom?: string
    evalPreference?: 'quick_test' | 'write_explain' | 'mix_everything'
    dailyMinutes?: number
  }

  // Programa adaptativo
  adaptiveProgram?: any
  materialBlueprint?: any
  hasSeenIntro?: boolean

  // Metadata
  createdAt: number
  lastOpenedAt: number
  lastUpdatedAt: number
}

// ─── Construir sessionCode estable desde material ──────────────
// Formato: studyalsesh_{temaId}_{nombreNormalizado}_{hash}
// Este código NUNCA cambia para el mismo material en el mismo tema.
export function buildStableKey(
  temaId: string,
  material: { id?: string; materialId?: string; content_hash?: string; nombre?: string; name?: string; pages_count?: number } | null
): string {
  if (!temaId) return ''
  if (!material) return ''

  // El materialId es único por upload — cada vez que subes un PDF se genera uno nuevo.
  // Esto garantiza que cada upload = sesión diferente, incluso con el mismo archivo.
  const matId = String(material.materialId || material.id || '').trim()
  if (!matId) return ''

  const nombre = String(material.nombre || material.name || '').trim().toLowerCase()
    .replace(/\.pdf$/, '').replace(/\.pptx?$/, '').replace(/\.docx?$/, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  return `studyalsesh_${temaId.slice(0, 20)}_${matId.slice(0, 30)}_${nombre.slice(0, 15)}`
}

// ─── Storage key en localStorage ───────────────────────────────
function storageKey(stableKey: string): string {
  return STORAGE_PREFIX + stableKey
}

// ─── Cargar estado del material ────────────────────────────────
export function loadMaterialSession(stableKey: string): MaterialSessionState | null {
  if (typeof window === 'undefined' || !stableKey) return null
  try {
    const raw = localStorage.getItem(storageKey(stableKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as MaterialSessionState
    if (parsed?.stableKey !== stableKey) return null
    return parsed
  } catch {
    return null
  }
}

// ─── Guardar estado del material ───────────────────────────────
export function saveMaterialSession(state: MaterialSessionState): void {
  if (typeof window === 'undefined' || !state?.stableKey) return
  try {
    const toSave: MaterialSessionState = {
      ...state,
      lastUpdatedAt: Date.now(),
    }
    localStorage.setItem(storageKey(state.stableKey), JSON.stringify(toSave))
  } catch {}
}

// ─── Actualizar solo algunos campos (patch) ────────────────────
export function patchMaterialSession(
  stableKey: string,
  patch: Partial<Omit<MaterialSessionState, 'stableKey' | 'createdAt'>>
): MaterialSessionState | null {
  if (!stableKey) return null
  const current = loadMaterialSession(stableKey)
  if (!current) return null

  const updated: MaterialSessionState = {
    ...current,
    ...patch,
    stableKey: current.stableKey,      // proteger
    createdAt: current.createdAt,      // proteger
    lastOpenedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  }
  saveMaterialSession(updated)
  return updated
}

// ─── Marcar como abierto (touch lastOpenedAt) ──────────────────
export function touchMaterialSession(stableKey: string): void {
  if (!stableKey) return
  const current = loadMaterialSession(stableKey)
  if (current) {
    saveMaterialSession({ ...current, lastOpenedAt: Date.now() })
  }
}

// ─── Crear estado inicial ──────────────────────────────────────
export function createMaterialSession(params: {
  stableKey: string
  temaId: string
  materialTitle: string
  processMode: 'adaptive' | 'free' | 'guided'
  processStyle?: 'book' | 'sessions'
  setup?: MaterialSessionState['setup']
  adaptiveProgram?: any
  materialBlueprint?: any
}): MaterialSessionState {
  const now = Date.now()
  const state: MaterialSessionState = {
    stableKey: params.stableKey,
    temaId: params.temaId,
    materialTitle: params.materialTitle,
    processMode: params.processMode,
    processStyle: params.processStyle,
    setup: params.setup,
    adaptiveProgram: params.adaptiveProgram,
    materialBlueprint: params.materialBlueprint,
    createdAt: now,
    lastOpenedAt: now,
    lastUpdatedAt: now,
  }
  saveMaterialSession(state)
  return state
}

// ─── Eliminar (cuando el usuario borra el material) ────────────
export function deleteMaterialSession(stableKey: string): void {
  if (typeof window === 'undefined' || !stableKey) return
  try {
    localStorage.removeItem(storageKey(stableKey))
  } catch {}
}

// ─── Debug: listar todas las sesiones guardadas ────────────────
export function listAllMaterialSessions(): MaterialSessionState[] {
  if (typeof window === 'undefined') return []
  const results: MaterialSessionState[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const raw = localStorage.getItem(key)
        if (raw) {
          try { results.push(JSON.parse(raw)) } catch {}
        }
      }
    }
  } catch {}
  return results
}
