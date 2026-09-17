'use client';

// ============================================================
// MaterialPreparationScreen — pantalla de preparación inicial
// del Free Mode. Aparece mientras Material Brain está idle/building/extracting
// para una selección confirmada. Puramente presentacional.
//
// NO hace fetch.
// NO importa Material Brain APIs.
// NO crea SourceSelectionSnapshot.
// NO llama lifecycle.
//
// onRetry llama brainLifecycle.recheck() desde el padre.
// ============================================================

import type { BrainLifecycleStatus } from '../../lib/materialBrain/useMaterialBrainLifecycle';
import type { MaterialPreparationClientSummary } from '../../lib/materialBrain/useMaterialBrainLifecycle';
import { canUseFreeTool, type FreeTool, type MaterialCapabilities } from '../../lib/materialBrain/capabilities';
import { isAcademicallyStable } from '../../lib/materialBrain/academicStability';

// ── Política pura: resolveMaterialPreparationGate ──
// Testeable sin DOM, sin React, sin fetch.
//
// P0 tool-readiness fix: brainStatus === 'ready' only means the
// SELECTED SOURCE is fully, faithfully represented (capabilities.ts:
// sourceReady) — it does NOT mean every tool can run. A tool whose
// contract needs real unit/relation enrichment (Flashcards needs
// units, Quiz/Exam/StudyMap/Truquitos need full enrichment stability)
// can still be unsafe to open the instant brainStatus flips to
// 'ready'. When a specific `tool` is given, the gate additionally
// consults `canUseFreeTool` — the single canonical per-tool
// authority — never a bespoke boolean. `tool: null` means "generic
// hub/browse" surface, which only ever needs source-level readiness.

export type PreparationGateMode = 'preparing' | 'extracting' | 'partial' | 'failed';

export interface PreparationGateResult {
  shouldGate: boolean;
  mode: PreparationGateMode | null;
}

// PHASE 2 HOTFIX: the Free hub's own entry gate (openFree, tool=null)
// must reflect StudyalMaterialEnjoyer readiness, never Material Brain
// — Free Mode no longer primes Material Brain at bare hub entry (see
// Phase 2), so any gate still keyed off brainStatus/academicStability
// here would wait forever on a status that will never arrive. This is
// a small, PURE, directly-testable function (unlike the inline gate
// TemaView.tsx used before this hotfix) so the exact transition —
// missing/checking/generating -> gated 'preparing', ready -> not
// gated, failed -> gated 'failed' — has deterministic coverage.
export function resolveFreeHubMaterialEnjoyerGate(
  hasSourceSelection: boolean,
  enjoyerStatus: 'idle' | 'checking' | 'generating' | 'ready' | 'failed' | undefined,
  enjoyerFingerprintMatches: boolean,
): PreparationGateResult {
  if (!hasSourceSelection) return { shouldGate: false, mode: null };
  // A stale/mismatched Enjoyer (fingerprint from a DIFFERENT selection,
  // e.g. still catching up right after the user changed pages) must
  // never be read as "ready" — treated exactly like 'checking'.
  const effectiveStatus = enjoyerFingerprintMatches ? enjoyerStatus : 'checking';
  if (effectiveStatus === 'ready') return { shouldGate: false, mode: null };
  if (effectiveStatus === 'failed') return { shouldGate: true, mode: 'failed' };
  return { shouldGate: true, mode: 'preparing' };
}

export function resolveMaterialPreparationGate(
  brainStatus: BrainLifecycleStatus | undefined,
  hasSourceSelection: boolean,
  tool: FreeTool | null = null,
  capabilities: MaterialCapabilities | null = null,
  // P0 "preparar antes de entrar a Free Mode": when true (used for the
  // HUB-level gate, tool=null), entry additionally requires
  // academicStability to be terminal (stable_rich/stable_degraded) —
  // never merely sourceReady/brainStatus==='ready'. The condition for
  // opening Free Mode itself is academicStability ∈ {stable_rich,
  // stable_degraded}, exactly like a tool's own gate, just without a
  // specific tool's narrower capability.
  requireStability = false,
): PreparationGateResult {
  // Sin selección activa → no hay nada que preparar, no gatear
  if (!hasSourceSelection) {
    return { shouldGate: false, mode: null };
  }

  switch (brainStatus) {
    case 'ready':
      // Source is represented, but THIS tool may still need more
      // (units/enrichment) — still 'preparing' from the user's point
      // of view, never a technical detail, and never Retry-able (it is
      // real, ongoing background work, not a failure).
      if (tool && !canUseFreeTool(tool, capabilities)) {
        return { shouldGate: true, mode: 'preparing' };
      }
      if (!tool && requireStability) {
        if (capabilities?.academicStability === 'failed') return { shouldGate: true, mode: 'failed' };
        if (!isAcademicallyStable(capabilities?.academicStability || 'preparing')) {
          return { shouldGate: true, mode: 'preparing' };
        }
      }
      return { shouldGate: false, mode: null };
    case 'extracting':
      return { shouldGate: true, mode: 'extracting' };
    case 'idle':
    case 'building':
    case undefined:
      return { shouldGate: true, mode: 'preparing' };
    case 'partial':
      return { shouldGate: true, mode: 'partial' };
    case 'failed':
      return { shouldGate: true, mode: 'failed' };
    default:
      // Defensive: unknown status → gate conservatively
      return { shouldGate: true, mode: 'preparing' };
  }
}

// ── SESSION_RESUME_UX: new-vs-resume copy decision ──
//
// Pure, directly testable — same convention as resolveMaterialPreparationGate/
// resolveFreeHubMaterialEnjoyerGate above. This does NOT decide readiness
// (that's still the *Gate functions — Material Brain/Enjoyer status is
// unchanged by this); it only decides which COPY to show while gated.
//
// Ownership: `hasResumeSessionId` and `resumeSessionExists` must both be
// derived from TemaView's EXISTING resumeSessionId + activeSessions/
// getSessionById lookups — the same server-synced session store
// (lib/studySessions.ts: localStorage cache kept in sync with the server
// via syncToServer/lookupSessionByIdFromServer) TemaView already uses as
// the sole authority for session identity elsewhere. Never re-derive this
// from raw localStorage access or a heuristic — a session id that does not
// resolve to a real persisted record is NOT a resumable session, even if
// present in the URL/return-seed (e.g. a stale/deleted session link).
export function resolvePreparationCopyVariant(
  hasResumeSessionId: boolean,
  resumeSessionExists: boolean,
): 'new' | 'resume' {
  return hasResumeSessionId && resumeSessionExists ? 'resume' : 'new';
}

// ── Componente visual ──

interface MaterialPreparationScreenProps {
  mode: PreparationGateMode;
  onRetry?: () => void;
  onBack?: () => void;
  preparation?: MaterialPreparationClientSummary | null;
  // SESSION_RESUME_UX: true when the material being prepared belongs to an
  // EXISTING, persisted, resumable session (see resolvePreparationCopyVariant
  // above) — swaps the 'preparing' mode's copy to resume-specific language.
  // Purely presentational: does not change shouldGate/mode, does not touch
  // Enjoyer/Brain readiness, causes no fetch.
  isResumingSession?: boolean;
}

export default function MaterialPreparationScreen({
  mode,
  onRetry,
  onBack,
  preparation,
  isResumingSession,
}: MaterialPreparationScreenProps) {
  if (mode === 'failed') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        fontFamily: 'var(--font-body)',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 440,
          width: '100%',
          textAlign: 'center',
        }}>
          {/* Icon */}
          <div style={{
            fontSize: 48,
            marginBottom: 20,
            opacity: 0.9,
          }}>
            ❌
          </div>

          {/* Title */}
          <h2 style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--text-primary)',
            margin: '0 0 10px',
            lineHeight: 1.3,
          }}>
            No pudimos procesar una parte del material
          </h2>

          {/* Subtitle */}
          <p style={{
            fontSize: 14,
            color: 'var(--text-muted)',
            margin: '0 0 32px',
            lineHeight: 1.5,
          }}>
            Agotamos las opciones seguras de recuperación automática. Puedes intentarlo nuevamente.
          </p>

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  padding: '12px 28px',
                  borderRadius: 12,
                  border: '2px solid var(--gold)',
                  background: 'var(--gold)',
                  color: '#111',
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(214,178,111,0.4)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                Reintentar
              </button>
            )}
            {onBack && (
              <button
                onClick={onBack}
                style={{
                  padding: '12px 28px',
                  borderRadius: 12,
                  border: '2px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--text-muted)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                ← Volver
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── mode === 'preparing' | 'extracting' ──
  const isExtracting = mode === 'extracting';
  const isResuming = mode === 'partial';
  const completed = preparation?.completedRequiredSections || 0;
  const total = preparation?.totalRequiredSections || 0;
  // SESSION_RESUME_UX: only the plain 'preparing' mode gets the
  // resume-specific copy — 'extracting'/'partial'/'failed' already have
  // their own distinct, accurate language and are untouched.
  const showResumeCopy = isResumingSession && mode === 'preparing';
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      fontFamily: 'var(--font-body)',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 440,
        width: '100%',
        textAlign: 'center',
      }}>
        {/* Animated loader */}
        <div style={{
          marginBottom: 28,
          display: 'flex',
          justifyContent: 'center',
        }}>
          <div style={{
            width: 48,
            height: 48,
            border: '3px solid var(--border-color)',
            borderTopColor: 'var(--gold)',
            borderRadius: '50%',
            animation: 'mbp-spin 0.9s linear infinite',
          }} />
        </div>

        {/* Title */}
        <h2 style={{
          fontSize: 22,
          fontWeight: 800,
          color: 'var(--text-primary)',
          margin: '0 0 8px',
          lineHeight: 1.3,
        }}>
          {isExtracting
            ? 'Extrayendo el contenido del material…'
            : isResuming ? 'Terminando de preparar tu material…'
            : showResumeCopy ? 'Cargando tu sesión…'
            : 'Preparando tu material…'}
        </h2>

        {/* Subtitle */}
        <p style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          margin: '0 0 32px',
          lineHeight: 1.5,
        }}>
          {isExtracting
            ? 'Estamos procesando el contenido seleccionado.'
            : isResuming ? 'Estamos completando las últimas partes.'
            : showResumeCopy ? 'Estamos retomando donde lo dejaste.'
            : 'Estamos preparando tus herramientas de estudio.'}
        </p>

        {/*
          P0 fix ("no quiero un progreso falso"): completedRequiredSections/
          totalRequiredSections measures SOURCE representation only
          (sourceCoverage) — it reaches N/N as soon as the fast base is
          built, well before academic stability. Showing "N de N" here
          while academicStability is still 'preparing' falsely reads as
          "almost done" when real enrichment/retry work remains with no
          reliable leaf-level progress metric wired to the client yet.
          Only show the real, still-incomplete count; once complete,
          fall back to an honest indeterminate message.
        */}
        {total > 0 && completed < total && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '-18px 0 26px', fontWeight: 700 }}>
            {completed} de {total} secciones listas
          </p>
        )}
        {total > 0 && completed >= total && !isExtracting && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '-18px 0 26px', fontWeight: 700 }}>
            Analizando el contenido en profundidad…
          </p>
        )}

        {/* Steps */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'flex-start',
          maxWidth: 320,
          margin: '0 auto',
        }}>
          <StepRow icon="✓" label={showResumeCopy ? 'Material encontrado' : 'Material seleccionado'} state="done" />
          <StepRow
            icon="●"
            label={isExtracting ? 'Extrayendo contenido del PDF' : showResumeCopy ? 'Restaurando tu progreso' : 'Comprendiendo conceptos y relaciones'}
            state="active"
          />
          <StepRow icon="○" label={showResumeCopy ? 'Cargando tus herramientas' : 'Preparando tus herramientas'} state="pending" />
        </div>
      </div>

      <style>{`
        @keyframes mbp-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes mbp-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

function StepRow({ icon, label, state }: {
  icon: string;
  label: string;
  state: 'done' | 'active' | 'pending';
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontSize: 14,
      fontWeight: state === 'active' ? 700 : 500,
      color: state === 'done'
        ? '#4ade80'
        : state === 'active'
          ? 'var(--text-primary)'
          : 'var(--text-faint)',
      fontFamily: 'var(--font-body)',
    }}>
      <span style={{
        fontSize: state === 'done' ? 16 : 14,
        width: 20,
        textAlign: 'center',
        flexShrink: 0,
        ...(state === 'active' ? {
          color: 'var(--gold)',
          animation: 'mbp-pulse 1.5s ease-in-out infinite',
        } : {}),
      }}>
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}
