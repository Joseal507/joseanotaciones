import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { MaterialBrain, MaterialBrainLookupStatus } from './types'
import { MATERIAL_BRAIN_BUILDER_VERSION } from './build'

// ============================================================
// Persistencia — clave = fingerprint + builderVersion (§10).
//
// DECISIÓN DE FASE 1 (documentada, no definitiva): el store
// concreto de esta fase es un backend de archivos local bajo
// `.materialBrainCache/`, NO la tabla D1 que ya usa
// lib/materials/repository.ts (getMaterialResult/saveMaterialResult)
// para el caché de Análisis. No se tocó esa infraestructura porque
// wiring a una tabla D1 nueva requiere migraciones que esta fase no
// puede verificar con seguridad ("no reemplaces sistemas sanos
// innecesariamente"). La interfaz `MaterialBrainStore` está
// diseñada para que ese backend real se conecte después sin tocar
// build.ts/index.ts — ver "decisiones abiertas" del reporte final.
// ============================================================

export interface MaterialBrainStore {
  get(fingerprint: string): Promise<MaterialBrain | null>
  set(fingerprint: string, brain: MaterialBrain): Promise<void>
}

const CACHE_DIR = path.join(process.cwd(), '.materialBrainCache')

function fileFor(fingerprint: string): string {
  return path.join(CACHE_DIR, `${fingerprint}.json`)
}

export class FileMaterialBrainStore implements MaterialBrainStore {
  async get(fingerprint: string): Promise<MaterialBrain | null> {
    const file = fileFor(fingerprint)
    if (!existsSync(file)) return null
    try {
      const raw = await readFile(file, 'utf8')
      return JSON.parse(raw) as MaterialBrain
    } catch {
      return null
    }
  }

  async set(fingerprint: string, brain: MaterialBrain): Promise<void> {
    if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(fileFor(brain.scope.fingerprint), JSON.stringify(brain, null, 2), 'utf8')
    void fingerprint
  }
}

export class InMemoryMaterialBrainStore implements MaterialBrainStore {
  private map = new Map<string, MaterialBrain>()
  async get(fingerprint: string): Promise<MaterialBrain | null> {
    return this.map.get(fingerprint) || null
  }
  async set(fingerprint: string, brain: MaterialBrain): Promise<void> {
    this.map.set(fingerprint, brain)
  }
}

/**
 * RESTORE FIRST → GENERATE ONLY WHEN ABSENCE IS PROVEN (AGENTS.md),
 * aplicado también a Brains 'partial': un Brain con builderVersion
 * vieja, o cuyo fingerprint no matchea, NUNCA se sirve como si
 * estuviera listo — cuenta como ausente y dispara reconstrucción.
 */
export async function lookupMaterialBrain(
  store: MaterialBrainStore,
  fingerprint: string,
): Promise<{ status: MaterialBrainLookupStatus; brain: MaterialBrain | null }> {
  const cached = await store.get(fingerprint)
  if (!cached) return { status: 'missing', brain: null }
  if (cached.scope.fingerprint !== fingerprint) return { status: 'missing', brain: null }
  if (cached.meta.builderVersion !== MATERIAL_BRAIN_BUILDER_VERSION) return { status: 'missing', brain: null }
  return { status: cached.meta.status, brain: cached }
}
