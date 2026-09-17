import assert from 'node:assert/strict'
import {
  certifyBlueprint,
  type BlueprintAuditReport,
  type BlueprintCertificationEvidence,
} from '../../app/api/adaptive/blueprint/route'

const blueprint = {
  sourceSelectionFingerprint: 'selection-stable',
  topics: [{ id: 'topic-1', title: 'Equilibrio', pages: [6] }],
  blocks: [{
    id: 'block-1',
    topicId: 'topic-1',
    pages: [6],
    sourceSpans: [{ page: 6, quote: 'La constante de equilibrio relaciona concentraciones.' }],
  }],
}
const quality = { status: 'complete', reasons: [] }
const represented: BlueprintCertificationEvidence = {
  pageDispositions: {
    'material-1:6': { status: 'represented', reason: 'Cubierta', charCount: 240 },
  },
}

function audit(message: string, overrides: Partial<BlueprintAuditReport> = {}): BlueprintAuditReport {
  return {
    passed: false,
    issues: [{ kind: 'omission', message }],
    uncoveredFragments: [message],
    status: 'warning',
    ...overrides,
  }
}

// 1 + 6 — dos formulaciones variables no pueden cambiar el hard gate.
const phrasingA = certifyBlueprint(blueprint, quality, audit('La página 6 omite la constante de equilibrio'), [], represented)
const phrasingB = certifyBlueprint(blueprint, quality, audit('Falta explicar K en p.6'), [], represented)
assert.equal(phrasingA.planGenerationAllowed, true)
assert.equal(phrasingB.planGenerationAllowed, true)
assert.equal(phrasingA.coverageCertified, phrasingB.coverageCertified)
assert.equal(phrasingA.auditStatus, 'warning')
assert.ok(phrasingA.auditWarnings.length > 0)

// 2 + 3 — JSON/contrato inválido o retry agotado es estado explícito, no blocker.
for (const status of ['invalid', 'unavailable'] as const) {
  const failure = certifyBlueprint(blueprint, quality, {
    passed: false,
    issues: [{ kind: 'audit_failure', message: 'Auditoría no disponible' }],
    uncoveredFragments: [],
    status,
  }, [], represented)
  assert.equal(failure.planGenerationAllowed, true)
  assert.equal(failure.auditStatus, status)
  assert.deepEqual(failure.certificationReasons, [])
}

// 4 — una página mínima/excluida no confirma la afirmación del auditor.
const excluded = certifyBlueprint(blueprint, quality, audit('Página 6 omitida'), [], {
  pageDispositions: {
    'material-1:6': { status: 'excluded_low_content', reason: 'Solo 20 chars', charCount: 20 },
  },
})
assert.equal(excluded.planGenerationAllowed, true)
assert.equal(excluded.auditStatus, 'warning')

// 5 + 7 — contenido académico determinísticamente descubierto sí bloquea.
const uncoveredEvidence: BlueprintCertificationEvidence = {
  pageDispositions: {
    'material-1:6': { status: 'uncovered_with_content', reason: '240 chars sin topic', charCount: 240 },
  },
}
const verified = certifyBlueprint(blueprint, quality, audit('Página 6 omite la constante de equilibrio'), [], uncoveredEvidence)
assert.equal(verified.planGenerationAllowed, false)
assert.equal(verified.coverageCertified, false)
assert.equal(verified.auditStatus, 'verified_issue')
assert.ok(verified.certificationReasons.some(reason => reason.includes('UNCOVERED_ACADEMIC_PAGE')))

// 6 — mismo blueprint/fingerprint/evidencia produce exactamente la misma certificación.
assert.deepEqual(
  certifyBlueprint(blueprint, quality, audit('Advertencia no verificable'), [], represented),
  certifyBlueprint(blueprint, quality, audit('Advertencia no verificable'), [], represented),
)

// 7 — fallos estructurales genuinos siguen bloqueando aun con audit aprobado.
const degraded = certifyBlueprint(blueprint, { status: 'degraded', reasons: ['Sin análisis usable'] }, {
  passed: true, issues: [], uncoveredFragments: [], status: 'passed',
}, [], represented)
assert.equal(degraded.planGenerationAllowed, false)

// 8 — la evidencia fuente existente se conserva y no se altera al certificar.
const beforeSpans = JSON.stringify(blueprint.blocks[0].sourceSpans)
certifyBlueprint(blueprint, quality, { passed: true, issues: [], uncoveredFragments: [], status: 'passed' }, [], represented)
assert.equal(JSON.stringify(blueprint.blocks[0].sourceSpans), beforeSpans)

console.log('blueprint-certification-stability-contracts: PASS')
