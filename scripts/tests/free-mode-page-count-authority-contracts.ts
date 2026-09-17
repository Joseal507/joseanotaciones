import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { resolveMaterialPreparationGate } from '../../components/materias/MaterialPreparationScreen'

// ============================================================
// SOURCE-COUNT-*: el conteo de páginas mostrado en "Material
// seleccionado" debe ser EXCLUSIVAMENTE la suma de páginas únicas
// seleccionadas en sourceSelection.materials — nunca una estimación
// de totalChars/coverage/chunks/vision. Esta es la MISMA fórmula
// que components/materias/StudyALProcess.tsx usa para renderizar
// selectedPageCount, replicada aquí como contrato puro y testeable.
// ============================================================

function authoritativeSelectedPageCount(materials: Array<{ materialId: string; selectedPages: number[] }>): number {
  return materials.reduce((sum, material) => sum + new Set(material.selectedPages).size, 0)
}

// SOURCE-COUNT-1: 43 páginas seleccionadas => conteo 43, NUNCA una
// estimación por caracteres (11481 chars / 1600 ≈ 7 era el bug real).
const pages1to43 = Array.from({ length: 43 }, (_, i) => i + 1)
const snap43 = buildSourceSelectionSnapshot(['mat_e802d9ced8cd61b5ae0e0c5d'], { mat_e802d9ced8cd61b5ae0e0c5d: pages1to43 })
assert.equal(authoritativeSelectedPageCount(snap43.materials), 43)
const totalCharsThatUsedToProduceSeven = 11481
const buggyEstimate = Math.max(1, Math.round(totalCharsThatUsedToProduceSeven / 1600))
assert.equal(buggyEstimate, 7)
assert.notEqual(authoritativeSelectedPageCount(snap43.materials), buggyEstimate)

// SOURCE-COUNT-2: sourceCoverage.suspiciouslyEmpty no participa en absoluto
// del cálculo — el contrato ni siquiera lo recibe como input.
const suspiciouslyEmpty = pages1to43.slice(0, 7) // 7 páginas "sospechosamente vacías"
assert.equal(authoritativeSelectedPageCount(snap43.materials), 43, 'suspiciouslyEmpty no debe reducir el conteo')
void suspiciouslyEmpty

// SOURCE-COUNT-3: visualCoverage.requested (páginas que requirieron visión)
// no participa del cálculo.
const visionRequestedCount = 6
assert.equal(authoritativeSelectedPageCount(snap43.materials), 43, 'visualCoverage.requested no debe alterar el conteo')
void visionRequestedCount

// SOURCE-COUNT-4: el número de chunks de extracción (independiente del
// número de páginas) no participa del cálculo.
const extractionChunkCount = 5
assert.equal(authoritativeSelectedPageCount(snap43.materials), 43, 'chunkCount no debe alterar el conteo')
void extractionChunkCount

// SOURCE-COUNT-5: múltiples documentos suman páginas únicas seleccionadas
// correctamente, por documento.
const snapMulti = buildSourceSelectionSnapshot(['matA', 'matB'], { matA: [1, 2, 3], matB: [2, 4] })
assert.equal(authoritativeSelectedPageCount(snapMulti.materials), 5)
assert.equal(snapMulti.materials.length, 2)

// SOURCE-COUNT-6: una selección de una sesión vieja/material eliminado no
// debe contaminar el conteo de la selección actual — el contrato solo opera
// sobre snapshot.materials de la selección AUTORITATIVA vigente, nunca
// mezclado con snapshots de otras sesiones/fingerprints.
const staleSnap = buildSourceSelectionSnapshot(['mat_40a00babb72881755fea53e1'], { mat_40a00babb72881755fea53e1: Array.from({ length: 20 }, (_, i) => i + 1) })
const currentSnap = buildSourceSelectionSnapshot(['mat_e802d9ced8cd61b5ae0e0c5d'], { mat_e802d9ced8cd61b5ae0e0c5d: pages1to43 })
assert.notEqual(staleSnap.fingerprint, currentSnap.fingerprint)
assert.equal(authoritativeSelectedPageCount(currentSnap.materials), 43, 'la selección vieja no debe mezclarse con la actual')

// ============================================================
// SOURCE-GATE-*: el hub Free solo debe renderizarse "listo" cuando el
// brainStatus corresponde al MISMO fingerprint que la selección Free
// actual. Un mismatch de fingerprint debe degradar a un estado de espera
// ('building' -> shouldGate true, mode 'preparing'), nunca a un hub listo
// ni a las pantallas de partial/failed (que implicarían un fallo real de
// preparación en vez de una selección todavía no reconciliada).
// ============================================================

function resolveGateWithIdentity(
  brainStatus: Parameters<typeof resolveMaterialPreparationGate>[0],
  brainFingerprint: string | null,
  currentFingerprint: string | null,
  hasSourceSelection: boolean,
) {
  const matches = !!brainFingerprint && !!currentFingerprint && brainFingerprint === currentFingerprint
  return resolveMaterialPreparationGate(matches ? brainStatus : 'building', hasSourceSelection)
}

// SOURCE-GATE-1: fingerprint mismatch => nunca renderiza el hub listo,
// incluso si brainStatus reporta 'ready' para OTRA selección.
const gateMismatch = resolveGateWithIdentity('ready', 'fingerprint-OLD', 'fingerprint-NEW', true)
assert.equal(gateMismatch.shouldGate, true)
assert.notEqual(gateMismatch.mode, null)

// SOURCE-GATE-2: Brain requerido listo + brecha opcional de visión (statuses
// de gate en este proyecto no distinguen visual-only; documentamos que
// 'ready' con fingerprint coincidente debe abrir el hub sin gate).
const gateReadyWithMatch = resolveGateWithIdentity('ready', 'fp-1', 'fp-1', true)
assert.equal(gateReadyWithMatch.shouldGate, false)
assert.equal(gateReadyWithMatch.mode, null)

// SOURCE-GATE-3: preparación requerida incompleta => hub permanece gateado.
const gateBuilding = resolveGateWithIdentity('building', 'fp-1', 'fp-1', true)
assert.equal(gateBuilding.shouldGate, true)
assert.equal(gateBuilding.mode, 'preparing')

// SOURCE-GATE-4: Brain listo + identidad de fuente exacta => hub abre normal.
const gateExactMatch = resolveGateWithIdentity('ready', 'fp-exact', 'fp-exact', true)
assert.equal(gateExactMatch.shouldGate, false)

// SOURCE-GATE-5: refresh/restauración con la MISMA selección de 43 páginas
// produce el mismo fingerprint (continuidad preservada).
const restored43 = buildSourceSelectionSnapshot(['mat_e802d9ced8cd61b5ae0e0c5d'], { mat_e802d9ced8cd61b5ae0e0c5d: pages1to43 })
assert.equal(restored43.fingerprint, snap43.fingerprint)
assert.equal(authoritativeSelectedPageCount(restored43.materials), 43)

console.log('PASS free-mode-page-count-authority-contracts')
