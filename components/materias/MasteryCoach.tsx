'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  MaterialMastery,
  MasterySnapshot,
  MasteryEvent,
  ToolId,
  ExamDate,
  StudyMode,
  createEmptyMastery,
  loadMaterialMastery,
  saveMaterialMastery,
  getMasteryStorageKey,
  processEvent,
  calculateMasterySnapshot,
  createConcept,
  getDimensionColor,
  getForgettingRiskColor,
  getForgettingRiskLabel,
  getConceptScore,
  getToolDisplayName,
  getCognitiveState,
  cognitiveLabels,
  getCognitiveStateColor,
  buildWeeklyInsights,
  simulateBrainDecay,
  type CognitiveState,
} from '../../lib/masteryEngine';
import type { SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

interface Props {
  materiales: any[];
  tema: any;
  materia: any;
  sourceSelection: SourceSelectionSnapshot | null;
  onClose: () => void;
  onOpenTool: (tool: ToolId) => void;
  masteryState?: MaterialMastery | null;
  masterySnapshot?: MasterySnapshot | null;
  onInitMastery?: (materialIds: string[], materialNames: string[]) => void;
  onMasteryUpdate?: (mastery: MaterialMastery) => void;
}

const TOOL_EMOJI: Record<ToolId, string> = {
  repasar: '📖',
  analisis: '🔬',
  studymap: '🗺️',
  truquitos: '🧠',
  flashcards: '🎴',
  quiz: '🎯',
  examen: '📝',
  alai: '✨',
};

const EXAM_DATE_LABELS: Record<ExamDate, string> = {
  today: 'Hoy',
  tomorrow: 'Mañana',
  this_week: 'Esta semana',
  custom: 'Elegir fecha',
  just_studying: 'Solo estoy estudiando',
};

const MODE_LABELS: Record<StudyMode, { label: string; desc: string; emoji: string }> = {
  emergency: { label: 'Emergencia', desc: 'Solo lo esencial', emoji: '⚡' },
  fast: { label: 'Rápido', desc: 'Lo más importante', emoji: '⚡' },
  balanced: { label: 'Balanceado', desc: 'Teoría + práctica', emoji: '⚖️' },
  mastery: { label: 'Dominio total', desc: 'Todo en profundidad', emoji: '🏆' },
};

const DIM_LABELS = {
  understanding: 'Entender',
  memory: 'Recordar',
  application: 'Aplicar',
  explanation: 'Explicar',
  exam: 'Demostrar',
};

const DIM_ICONS = {
  understanding: '💡',
  memory: '🧠',
  application: '⚙️',
  explanation: '✏️',
  exam: '📝',
};

function RadialProgress({ value, size = 80, color, label }: {
  value: number; size?: number; color: string; label: string;
}) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={color} strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <text x={size/2} y={size/2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={size > 70 ? 16 : 13} fontWeight={900} fontFamily="var(--font-body)">
          {value}%
        </text>
      </svg>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>{label}</span>
    </div>
  );
}

function DimensionBar({ label, icon, value }: { label: string; icon: string; value: number }) {
  const color = getDimensionColor(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 14, width: 20 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)', width: 72, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${value}%`, background: color,
          borderRadius: 3, boxShadow: `0 0 8px ${color}66`,
          transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 900, color, width: 32, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

function ConceptChip({ concept, onClick }: { concept: any; onClick: () => void }) {
  const score = getConceptScore(concept);
  const color = getDimensionColor(score);
  const riskColor = getForgettingRiskColor(concept.forgettingRisk);

  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}44`,
        borderRadius: 8, padding: '6px 10px',
        display: 'flex', alignItems: 'center', gap: 6,
        cursor: 'pointer', transition: 'all 0.2s ease',
        textAlign: 'left',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = `${color}11`;
        (e.currentTarget as HTMLElement).style.borderColor = color;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
        (e.currentTarget as HTMLElement).style.borderColor = `${color}44`;
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600, lineHeight: 1.2 }}>
        {concept.name}
      </span>
      <span style={{
        marginLeft: 'auto', fontSize: 10, fontWeight: 900, color,
        background: `${color}22`, padding: '1px 5px', borderRadius: 4,
      }}>
        {score}%
      </span>
      {(concept.forgettingRisk === 'very_high' || concept.forgettingRisk === 'high') && (
        <span style={{ fontSize: 10, color: riskColor }} title={`Riesgo de olvido: ${getForgettingRiskLabel(concept.forgettingRisk)}`}>⚠️</span>
      )}
    </button>
  );
}


// ═══════════════════════════════════════════════════════════════
// TIMELINE CHART — Progreso visual
// ═══════════════════════════════════════════════════════════════
function TimelineChart({ timeline }: { timeline: any[] }) {
  if (!timeline || timeline.length < 2) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
        Completa al menos 2 herramientas para ver tu progreso
      </div>
    );
  }

  const last10 = timeline.slice(-10);
  const maxMastery = Math.max(...last10.map(e => e.overallMastery), 1);

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60, marginBottom: 8 }}>
        {last10.map((entry, i) => {
          const height = Math.max(4, (entry.overallMastery / 100) * 60);
          const toolEmojis: Record<string, string> = {
            repasar: '📖', analisis: '🔬', studymap: '🗺️', truquitos: '🧠',
            flashcards: '🎴', quiz: '🎯', examen: '📝', alai: '✨',
          };
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ fontSize: 8, color: 'var(--text-faint)' }}>{entry.overallMastery}%</div>
              <div
                title={`${toolEmojis[entry.tool] || '📚'} ${entry.overallMastery}%`}
                style={{
                  width: '100%', height, borderRadius: '3px 3px 0 0',
                  background: `linear-gradient(to top, var(--gold), #f59e0b)`,
                  boxShadow: '0 0 6px rgba(214,178,111,0.4)',
                  transition: 'height 0.5s ease',
                }}
              />
              <div style={{ fontSize: 10 }}>{toolEmojis[entry.tool] || '📚'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COGNITIVE STATE DISPLAY
// ═══════════════════════════════════════════════════════════════
function CognitiveStateBar({ concept }: { concept: any }) {
  const states: CognitiveState[] = ['sin_exposicion', 'reconoce', 'recuerda', 'aplica', 'explica_basico', 'puede_ensenar'];
  const currentState = getCognitiveState(concept);
  const currentIdx = states.indexOf(currentState);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>{concept.name}</span>
        <span style={{ fontSize: 10, color: getCognitiveStateColor(currentState), fontWeight: 800 }}>
          {cognitiveLabels[currentState]}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {states.map((state, i) => (
          <div key={state} style={{
            flex: 1, height: 5, borderRadius: 3,
            background: i <= currentIdx ? getCognitiveStateColor(state) : 'rgba(255,255,255,0.08)',
            transition: 'background 0.5s ease',
          }} title={cognitiveLabels[state]} />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSIS PANEL — Se muestra cuando proceso está completo
// ═══════════════════════════════════════════════════════════════
function DiagnosisPanel({ snapshot, mastery, onOpenTool }: {
  snapshot: MasterySnapshot;
  mastery: MaterialMastery;
  onOpenTool: (tool: ToolId) => void;
}) {
  const completedTools = Object.values(mastery.toolsCompleted).filter(Boolean).length;
  const allDone = completedTools >= 8;

  if (!allDone) return null;

  const passColor = snapshot.examPassProbability >= 80 ? '#4ade80'
    : snapshot.examPassProbability >= 60 ? '#fbbf24' : '#ef4444';

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(214,178,111,0.1), rgba(56,189,248,0.05))',
      border: '2px solid var(--gold)',
      borderRadius: 16, padding: 20, marginBottom: 16,
    }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--gold)', marginBottom: 16, textAlign: 'center' }}>
        🎓 DIAGNÓSTICO FINAL DEL PROCESO
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Dominio alcanzado', value: snapshot.overallMastery, color: 'var(--gold)' },
          { label: 'Para el examen', value: Math.round(snapshot.examReadiness), color: '#fbbf24' },
          { label: 'Retención 7 días', value: snapshot.retention7Days, color: '#38bdf8' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            textAlign: 'center', padding: 12,
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 10, border: `1px solid ${color}33`,
          }}>
            <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}%</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 8 }}>
          PROBABILIDAD DE APROBAR
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${snapshot.examPassProbability}%`,
              background: passColor, borderRadius: 4,
              transition: 'width 1s ease',
            }} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 900, color: passColor, minWidth: 40 }}>
            {snapshot.examPassProbability}%
          </span>
        </div>
      </div>

      {snapshot.weakConcepts.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: '#f97316', marginBottom: 6 }}>
            ⚠️ REFORZAR ANTES DEL EXAMEN:
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {snapshot.weakConcepts.slice(0, 4).map(c => (
              <span key={c.id} style={{
                padding: '3px 9px', borderRadius: 20,
                background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)',
                fontSize: 11, color: '#f97316', fontWeight: 700,
              }}>{c.name}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 8 }}>
        RECOMENDACIÓN FINAL:
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {snapshot.nextAction.message}
      </p>

      <button onClick={() => onOpenTool(snapshot.nextAction.tool)} style={{
        width: '100%', padding: '10px', borderRadius: 10,
        background: 'var(--gold)', border: 'none',
        color: '#000', fontSize: 13, fontWeight: 900, cursor: 'pointer',
      }}>
        {snapshot.nextAction.tool === 'flashcards' ? '🎴' : '📖'} Reforzar ahora → {getToolDisplayName(snapshot.nextAction.tool)}
      </button>
    </div>
  );
}

export default function MasteryCoach({
  materiales,
  tema,
  materia,
  sourceSelection,
  onClose,
  onOpenTool,
  masteryState: externalMasteryState,
  masterySnapshot: externalMasterySnapshot,
  onInitMastery,
  onMasteryUpdate,
}: Props) {
  const materialIds = useMemo(() =>
    materiales.map(m => String(m?.materialId || m?.id || '')).filter(Boolean),
    [materiales]
  );

  const sessionKey = useMemo(() => getMasteryStorageKey(materialIds), [materialIds]);

  const [mastery, setMastery] = useState<MaterialMastery>(() => {
    if (externalMasteryState) return externalMasteryState;
    const loaded = loadMaterialMastery(sessionKey);
    if (loaded) return loaded;
    return createEmptyMastery({
      materialIds,
      materialNames: materiales.map(m => m?.nombre || m?.name || 'Material'),
      sessionKey,
    });
  });

  const [snapshot, setSnapshot] = useState<MasterySnapshot>(() =>
    externalMasterySnapshot || calculateMasterySnapshot(externalMasteryState || mastery)
  );

  const [activeTab, setActiveTab] = useState<'coach' | 'concepts' | 'plan' | 'setup'>('coach');
  const [extracting, setExtracting] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<any>(null);
  const [showExamSetup, setShowExamSetup] = useState(!mastery.examDate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTimeout(() => setReady(true), 60);
  }, []);

  // Recalcular snapshot cuando cambia mastery
  // Sincronizar con el estado central SIEMPRE que cambie
  // El estado central es la fuente de verdad
  useEffect(() => {
    if (!externalMasteryState) return;
    setMastery(externalMasteryState);
  }, [externalMasteryState]);

  useEffect(() => {
    if (!externalMasterySnapshot) return;
    setSnapshot(externalMasterySnapshot);
  }, [externalMasterySnapshot]);

  useEffect(() => {
    const snap = calculateMasterySnapshot(mastery);
    setSnapshot(snap);
    saveMaterialMastery(mastery);
    // Notificar al estado central cuando el Coach actualiza configuración
    onMasteryUpdate?.(mastery);
  }, [mastery]);

  // Extraer conceptos si no se han extraído
  // Al montar el Coach, forzar sincronización con el estado central
  useEffect(() => {
    if (onInitMastery && materialIds.length) {
      // Esto actualiza masteryState en page.tsx que luego llega como externalMasteryState
      onInitMastery(
        materialIds,
        materiales.map((m: any) => m?.nombre || m?.name || 'Material')
      );
    }
  }, [sessionKey]);

  // Si externalMasteryState llega con conceptos, actualizar snapshot también
  useEffect(() => {
    if (!externalMasteryState?.concepts?.length) return;
    const snap = calculateMasterySnapshot(externalMasteryState);
    setSnapshot(snap);
  }, [externalMasteryState?.concepts?.length]);

  // Extraer conceptos automáticamente al montar
  // Si no tiene conceptos, extraer sin importar si fue inicializado antes
  useEffect(() => {
    if (extracting) return;
    if (!materialIds.length) return;
    if (!sourceSelection || !sourceSelection.materialIds.length) return;

    const currentMastery = externalMasteryState || mastery;
    const hasConceptos = currentMastery?.concepts?.length > 0;
    const wasExtracted = currentMastery?.conceptsExtracted;

    if (!hasConceptos && !wasExtracted) {
      // Pequeño delay para no bloquear el render inicial
      const timer = setTimeout(() => {
        extractConcepts();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [sessionKey, externalMasteryState]);

  const extractConcepts = useCallback(async () => {
    if (extracting || materialIds.length === 0) return;
    if (!sourceSelection || sourceSelection.materialIds.length === 0) return;
    setExtracting(true);

    try {
      console.log('%c🔍 Coach extrayendo conceptos...', 'background:#38bdf8;color:#000;padding:2px 6px;border-radius:4px;font-weight:900');

      // 1. Cargar el texto autorizado (respeta selectedPages) de todos los materiales
      const res = await fetch('/api/enfoques/teorico/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceSelection }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.success !== true || !data.materials || Object.keys(data.materials).length === 0) {
        console.warn('Coach: sin texto de materiales', data?.error);
        return;
      }
      if (data.sourceSelectionFingerprint !== sourceSelection.fingerprint) {
        console.warn('Coach: fingerprint de fuente no coincide, descartando respuesta');
        return;
      }

      // 2. Unir el texto (ya filtrado a las páginas seleccionadas) de todos los materiales
      const fullText = Object.entries(data.materials)
        .map(([id, m]: [string, any]) => {
          const name = m.nombre || id;
          const text = (m.text || '').trim();
          return text ? `[Material: ${name}]\n${text}` : '';
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      const totalChars = fullText.length;
      console.log(`%c📄 Coach: ${totalChars.toLocaleString()} chars del material`, 'color:#d6b26f;font-weight:700');

      if (!fullText.trim()) {
        console.warn('Coach: texto vacío después de cargar materiales');
        return;
      }

      // 3. Extraer conceptos con ALAI — máximo contexto posible
      const extractRes = await fetch('/api/mastery/extract-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialText: fullText.slice(0, 25000),
          materialId: materialIds[0],
          tema: tema?.nombre || '',
          materia: materia?.nombre || '',
        }),
      });

      const extractData = await extractRes.json();

      if (!extractData.success || !extractData.concepts?.length) {
        console.warn('Coach: no se extrajeron conceptos', extractData);
        return;
      }

      const newConcepts = extractData.concepts.map((name: string) =>
        createConcept(name, materialIds[0])
      );

      console.log(
        '%c✅ Coach: conceptos extraídos',
        'background:#4ade80;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
        newConcepts.map((c: any) => c.name)
      );

      // 4. Actualizar mastery con conceptos nuevos
      setMastery(prev => ({
        ...prev,
        concepts: newConcepts,
        conceptsExtracted: true,
        lastUpdated: Date.now(),
      }));

    } catch (err) {
      console.error('Coach: error extrayendo conceptos:', err);
    } finally {
      setExtracting(false);
    }
  }, [materialIds, extracting, tema, materia]);

  // Función para que las herramientas reporten eventos
  const reportToolEvent = useCallback((event: Omit<MasteryEvent, 'sessionKey'>) => {
    const fullEvent: MasteryEvent = {
      ...event,
      sessionKey,
      timestamp: Date.now(),
    };
    setMastery(prev => processEvent(prev, fullEvent));
  }, [sessionKey]);

  // Exponer reportToolEvent globalmente para que las herramientas lo usen
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__studyal_reportMasteryEvent = reportToolEvent;
      (window as any).__studyal_sessionKey = sessionKey;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__studyal_reportMasteryEvent;
        delete (window as any).__studyal_sessionKey;
      }
    };
  }, [reportToolEvent, sessionKey]);

  const updateExamDate = (date: ExamDate) => {
    setMastery(prev => ({ ...prev, examDate: date, lastUpdated: Date.now() }));
    if (date !== 'custom') setShowExamSetup(false);
  };

  const updateStudyMode = (mode: StudyMode) => {
    setMastery(prev => ({ ...prev, studyMode: mode, lastUpdated: Date.now() }));
  };

  const updateTargetScore = (score: number) => {
    setMastery(prev => ({ ...prev, targetScore: score, lastUpdated: Date.now() }));
  };

  const urgencyColor = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#fbbf24',
    low: '#4ade80',
  }[snapshot.nextAction.urgency];

  const completedTools = Object.values(mastery.toolsCompleted).filter(Boolean).length;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      display: 'flex', flexDirection: 'column',
      fontFamily: "var(--font-body)",
      overflow: 'hidden',
      opacity: ready ? 1 : 0,
      transform: ready ? 'none' : 'translateY(8px)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
    }}>
      {/* Fondo */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--gold) 6%, transparent), transparent 50%), radial-gradient(circle at 70% 80%, color-mix(in srgb, var(--blue) 4%, transparent), transparent 50%)',
      }} />

      {/* TOPBAR */}
      <div style={{
        position: 'relative', zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', borderBottom: '1px solid var(--border-color2)',
        background: 'var(--bg-primary)', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          border: '2px solid var(--text-primary)', background: 'var(--bg-card)',
          color: 'var(--text-primary)', borderRadius: 12, padding: '8px 14px',
          fontSize: 13, fontWeight: 800, cursor: 'pointer',
          boxShadow: '3px 3px 0 var(--text-primary)',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translate(-2px,-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '5px 5px 0 var(--text-primary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = '3px 3px 0 var(--text-primary)'; }}
        >← proceso</button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--gold)', letterSpacing: -0.5 }}>
            StudyAL Coach
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700 }}>
            Mastery Engine • {tema?.nombre || 'Material'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            padding: '6px 12px', borderRadius: 20,
            background: `${getDimensionColor(snapshot.overallMastery)}22`,
            border: `1.5px solid ${getDimensionColor(snapshot.overallMastery)}`,
            fontSize: 14, fontWeight: 900,
            color: getDimensionColor(snapshot.overallMastery),
          }}>
            {snapshot.overallMastery}% dominio
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--border-color2)',
        padding: '0 24px', flexShrink: 0,
        background: 'var(--bg-primary)', position: 'relative', zIndex: 9,
      }}>
        {(['coach', 'concepts', 'plan', 'setup'] as const).map(tab => {
          const labels = { coach: '🎯 Coach', concepts: '🧩 Conceptos', plan: '📅 Plan', setup: '⚙️ Config' };
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '12px 16px', border: 'none', background: 'transparent',
              color: isActive ? 'var(--gold)' : 'var(--text-faint)',
              fontSize: 13, fontWeight: 800, cursor: 'pointer',
              borderBottom: isActive ? '2px solid var(--gold)' : '2px solid transparent',
              transition: 'all 0.2s ease',
              marginBottom: -1,
            }}>
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', zIndex: 5 }}>

        {/* ══════════════ TAB COACH ══════════════ */}
        {activeTab === 'coach' && (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

            {/* Setup si no tiene fecha */}
            {!mastery.examDate && (
              <div style={{
                background: 'color-mix(in srgb, var(--gold) 8%, var(--bg-card))',
                border: '1.5px dashed var(--gold)',
                borderRadius: 14, padding: 16,
              }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--gold)', marginBottom: 10 }}>
                  ⚡ Para personalizar tu plan, dinos cuándo es tu examen
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(Object.keys(EXAM_DATE_LABELS) as ExamDate[]).map(d => (
                    <button key={d} onClick={() => updateExamDate(d)} style={{
                      padding: '7px 13px', borderRadius: 20,
                      border: '1.5px solid var(--border-color2)',
                      background: 'var(--bg-card)', color: 'var(--text-secondary)',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.color = 'var(--gold)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color2)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
                    >
                      {EXAM_DATE_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recomendación principal del coach */}
            <div style={{
              background: `${urgencyColor}12`,
              border: `2px solid ${urgencyColor}`,
              borderRadius: 16, padding: '18px 20px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: -20, right: -20,
                width: 100, height: 100, borderRadius: '50%',
                background: `${urgencyColor}08`,
              }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                  background: `${urgencyColor}22`, border: `1.5px solid ${urgencyColor}`,
                  display: 'grid', placeItems: 'center', fontSize: 22,
                }}>
                  {TOOL_EMOJI[snapshot.nextAction.tool]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: urgencyColor, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Siguiente paso recomendado
                    </span>
                    {snapshot.nextAction.conceptFocus && (
                      <span style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 20,
                        background: `${urgencyColor}22`, color: urgencyColor, fontWeight: 800,
                      }}>
                        📍 {snapshot.nextAction.conceptFocus}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)', fontWeight: 600 }}>
                    {snapshot.nextAction.message}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => onOpenTool(snapshot.nextAction.tool)} style={{
                      padding: '9px 18px', borderRadius: 10,
                      background: urgencyColor, border: 'none',
                      color: '#000', fontSize: 13, fontWeight: 900,
                      cursor: 'pointer', transition: 'transform 0.2s ease',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'none'}
                    >
                      {TOOL_EMOJI[snapshot.nextAction.tool]} Abrir {getToolDisplayName(snapshot.nextAction.tool)}
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      ~{snapshot.nextAction.estimatedMinutes} min
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Dominio general + 5 dimensiones */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

              {/* Dominio */}
              <div style={{
                background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                borderRadius: 14, padding: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 14 }}>
                  DOMINIO GENERAL
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <RadialProgress
                    value={snapshot.overallMastery}
                    size={90}
                    color={getDimensionColor(snapshot.overallMastery)}
                    label="Dominio"
                  />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(Object.entries(DIM_LABELS) as [keyof typeof DIM_LABELS, string][]).map(([key, label]) => (
                      <DimensionBar
                        key={key}
                        label={label}
                        icon={DIM_ICONS[key]}
                        value={snapshot[key]}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Predicciones */}
              <div style={{
                background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                borderRadius: 14, padding: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-secondary)' }}>
                  PREDICCIONES
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <RadialProgress value={Math.round(snapshot.examReadiness)} size={72} color="#fbbf24" label="Para examen" />
                  <RadialProgress value={snapshot.retention7Days} size={72} color="#38bdf8" label="7 días" />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Retención en 30 días</span>
                    <span style={{ color: getDimensionColor(snapshot.retention30Days), fontWeight: 900 }}>
                      {snapshot.retention30Days}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Objetivo</span>
                    <span style={{ color: 'var(--gold)', fontWeight: 900 }}>{mastery.targetScore}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-faint)', fontWeight: 700 }}>Herramientas</span>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 900 }}>{completedTools}/8</span>
                  </div>
                </div>

                {mastery.examDate && mastery.examDate !== 'just_studying' && (
                  <div style={{
                    padding: '8px 10px', borderRadius: 8,
                    background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
                    fontSize: 11, fontWeight: 700, color: 'var(--gold)',
                  }}>
                    📅 Examen: {EXAM_DATE_LABELS[mastery.examDate]}
                    {' '}·{' '}
                    <button onClick={() => updateExamDate('just_studying')} style={{
                      background: 'none', border: 'none', color: 'var(--text-faint)',
                      fontSize: 10, cursor: 'pointer', padding: 0,
                    }}>cambiar</button>
                  </div>
                )}
              </div>
            </div>

            {/* Herramientas grid */}
            <div style={{
              background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
              borderRadius: 14, padding: 16,
            }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 12 }}>
                HERRAMIENTAS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {(Object.keys(mastery.toolsCompleted) as ToolId[]).map(tool => {
                  const done = mastery.toolsCompleted[tool];
                  const isNext = snapshot.nextAction.tool === tool;
                  const toolData = mastery.toolsData[tool];
                  const borderColor = isNext ? urgencyColor : done ? '#4ade80' : 'var(--border-color2)';

                  return (
                    <button key={tool} onClick={() => onOpenTool(tool)} style={{
                      padding: '10px 8px', borderRadius: 10,
                      border: `1.5px solid ${borderColor}`,
                      background: done ? '#4ade8011' : isNext ? `${urgencyColor}11` : 'transparent',
                      cursor: 'pointer', transition: 'all 0.2s ease',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'none'}
                    >
                      <span style={{ fontSize: 18 }}>{TOOL_EMOJI[tool]}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: done ? '#4ade80' : isNext ? urgencyColor : 'var(--text-faint)' }}>
                        {getToolDisplayName(tool)}
                      </span>
                      {done && (
                        <span style={{ fontSize: 9, color: '#4ade80', fontWeight: 900 }}>✓ HECHO</span>
                      )}
                      {isNext && !done && (
                        <span style={{ fontSize: 9, color: urgencyColor, fontWeight: 900 }}>→ AHORA</span>
                      )}
                      {toolData.lastScore !== null && (
                        <span style={{ fontSize: 9, color: getDimensionColor(toolData.lastScore) }}>
                          {toolData.lastScore}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Conceptos críticos si hay */}
            {snapshot.criticalConcepts.length > 0 && (
              <div style={{
                background: 'rgba(239,68,68,0.06)', border: '1.5px solid rgba(239,68,68,0.3)',
                borderRadius: 14, padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#ef4444', marginBottom: 8 }}>
                  ⚠️ CONCEPTOS CRÍTICOS — requieren atención urgente
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {snapshot.criticalConcepts.map(c => (
                    <ConceptChip key={c.id} concept={c} onClick={() => { setSelectedConcept(c); setActiveTab('concepts'); }} />
                  ))}
                </div>
              </div>
            )}

            {/* Timeline de progreso */}
            {mastery.timeline && mastery.timeline.length >= 2 && (
              <div style={{
                background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                borderRadius: 14, padding: 16,
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  📈 PROGRESO DE ESTA SESIÓN
                </div>
                <TimelineChart timeline={mastery.timeline} />
              </div>
            )}

            {/* Insights semanales */}
            {(() => {
              const insights = buildWeeklyInsights(mastery);
              const toneColors = {
                positive: '#4ade80',
                warning: '#f97316',
                challenge: '#fbbf24',
                neutral: '#38bdf8',
              };
              const toneEmojis = {
                positive: '🌟',
                warning: '⚡',
                challenge: '🎯',
                neutral: '📊',
              };
              const c = toneColors[insights.tone];
              const e = toneEmojis[insights.tone];
              return (
                <div style={{
                  background: `${c}0d`,
                  border: `1.5px solid ${c}44`,
                  borderRadius: 14,
                  padding: 16,
                }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: c,
                    marginBottom: 10,
                  }}>
                    {e} ALAI recuerda
                  </div>
                  <p style={{
                    margin: '0 0 10px',
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}>
                    {insights.message}
                  </p>
                  {insights.details.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {insights.details.map((d, i) => (
                        <div key={i} style={{
                          fontSize: 11.5,
                          color: 'var(--text-muted)',
                          paddingLeft: 10,
                          borderLeft: `2px solid ${c}55`,
                        }}>
                          {d}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Simulación Cerebral (Brain Decay) */}
            {mastery.concepts.length > 0 && (() => {
              const decay = simulateBrainDecay(mastery, 20).slice(0, 5);
              const highRisk = decay.filter(d => d.lostPercent > 15);
              if (highRisk.length === 0) return null;
              
              return (
                <div style={{
                  background: 'rgba(239,68,68,0.05)',
                  border: '1.5px solid rgba(239,68,68,0.3)',
                  borderRadius: 14,
                  padding: 16,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#ef4444', marginBottom: 10 }}>
                    🧠 SIMULACIÓN: Si dejas de estudiar hoy...
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {highRisk.map((d, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: 8,
                        background: 'rgba(0,0,0,0.2)',
                      }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{d.concept}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                            En 20 días olvidarás el <span style={{ color: '#ef4444', fontWeight: 900 }}>{d.lostPercent}%</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: '#4ade80' }}>Hoy: {d.currentScore}%</span>
                          <span style={{ color: '#ef4444' }}>→</span>
                          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 900 }}>20d: {d.scoreIn20Days}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: '#f97316', fontWeight: 700 }}>
                    ⚡ ALAI recomienda: Repasa estos conceptos hoy para reiniciar su curva de olvido.
                  </div>
                </div>
              );
            })()}

            {/* Panel de diagnóstico final */}
            <DiagnosisPanel
              snapshot={snapshot}
              mastery={mastery}
              onOpenTool={onOpenTool}
            />

          </div>
        )}

        {/* ══════════════ TAB CONCEPTS ══════════════ */}
        {activeTab === 'concepts' && (
          <div style={{ padding: '20px 24px', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

            {extracting && (
              <div style={{
                background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 16,
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                  ALAI está analizando tu material...
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  Extrayendo conceptos clave para medir tu dominio real
                </div>
              </div>
            )}

            {mastery.concepts.length === 0 && !extracting && (
              <div style={{
                background: 'var(--bg-card)', border: '1.5px dashed var(--border-color2)',
                borderRadius: 14, padding: 20, textAlign: 'center',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🧩</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
                  Sin conceptos todavía
                </div>
                <button onClick={extractConcepts} style={{
                  padding: '9px 18px', borderRadius: 10,
                  border: '1.5px solid var(--gold)',
                  background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                  color: 'var(--gold)', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                }}>
                  ✨ Extraer conceptos con ALAI
                </button>
              </div>
            )}

            {/* Grupos de conceptos */}
            {[
              { label: '🏆 Dominados', concepts: snapshot.dominatedConcepts, color: '#4ade80' },
              { label: '📈 Intermedios', concepts: snapshot.intermediateConcepts, color: '#fbbf24' },
              { label: '⚠️ Débiles', concepts: snapshot.weakConcepts, color: '#f97316' },
              { label: '🚨 Críticos', concepts: snapshot.criticalConcepts, color: '#ef4444' },
            ].map(group => group.concepts.length > 0 && (
              <div key={group.label} style={{
                background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                borderRadius: 14, padding: 16, marginBottom: 12,
              }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: group.color, marginBottom: 10 }}>
                  {group.label} ({group.concepts.length})
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {group.concepts.map(c => (
                    <ConceptChip
                      key={c.id}
                      concept={c}
                      onClick={() => setSelectedConcept(selectedConcept?.id === c.id ? null : c)}
                    />
                  ))}
                </div>

                {/* Detalle del concepto seleccionado */}
                {selectedConcept && group.concepts.find(c => c.id === selectedConcept.id) && (
                  <div style={{
                    marginTop: 12, padding: 14,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border-color2)',
                    borderRadius: 10,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                      {selectedConcept.name}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
                      {(Object.entries(DIM_LABELS) as [keyof typeof DIM_LABELS, string][]).map(([dim, label]) => {
                        const val = selectedConcept[dim] as number;
                        return (
                          <div key={dim} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>{label}</div>
                            <div style={{ fontSize: 16, fontWeight: 900, color: getDimensionColor(val) }}>{val}%</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {selectedConcept.recommendedAction}
                    </div>
                    {selectedConcept.recommendedTool && (
                      <button onClick={() => onOpenTool(selectedConcept.recommendedTool)} style={{
                        padding: '7px 14px', borderRadius: 8,
                        border: '1.5px solid var(--gold)',
                        background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                        color: 'var(--gold)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                      }}>
                        {TOOL_EMOJI[selectedConcept.recommendedTool]} Trabajar con {getToolDisplayName(selectedConcept.recommendedTool)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ══════════════ TAB PLAN ══════════════ */}
        {activeTab === 'plan' && (
          <div style={{ padding: '20px 24px', maxWidth: 800, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            {!snapshot.studyPlan ? (
              <div style={{
                background: 'var(--bg-card)', border: '1.5px dashed var(--border-color2)',
                borderRadius: 14, padding: 24, textAlign: 'center',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>
                  ¿Cuándo es tu examen?
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 16 }}>
                  Con esa información ALAI genera tu plan de estudio personalizado
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {(['today', 'tomorrow', 'this_week', 'custom'] as ExamDate[]).map(d => (
                    <button key={d} onClick={() => updateExamDate(d)} style={{
                      padding: '9px 16px', borderRadius: 20,
                      border: '1.5px solid var(--border-color2)',
                      background: 'var(--bg-card)', color: 'var(--text-secondary)',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.color = 'var(--gold)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color2)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
                    >
                      {EXAM_DATE_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-secondary)' }}>
                  PLAN DE ESTUDIO — {EXAM_DATE_LABELS[mastery.examDate!]}
                </div>
                {snapshot.studyPlan.map((day, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                    borderRadius: 12, padding: '14px 16px',
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                      background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                      border: '1.5px solid color-mix(in srgb, var(--gold) 40%, transparent)',
                      display: 'grid', placeItems: 'center',
                      fontSize: 12, fontWeight: 900, color: 'var(--gold)',
                    }}>
                      D{day.day}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
                        {day.label}: {day.focus}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        {day.tools.map(t => (
                          <button key={t} onClick={() => onOpenTool(t)} style={{
                            padding: '4px 10px', borderRadius: 20,
                            border: '1px solid var(--border-color2)',
                            background: 'transparent', color: 'var(--text-secondary)',
                            fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.color = 'var(--gold)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color2)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
                          >
                            {TOOL_EMOJI[t]} {getToolDisplayName(t)}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        ~{day.estimatedMinutes} minutos
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TAB SETUP ══════════════ */}
        {activeTab === 'setup' && (
          <div style={{ padding: '20px 24px', maxWidth: 700, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Fecha de examen */}
            <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 12 }}>📅 Fecha del examen</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(Object.keys(EXAM_DATE_LABELS) as ExamDate[]).map(d => (
                  <button key={d} onClick={() => updateExamDate(d)} style={{
                    padding: '8px 14px', borderRadius: 20,
                    border: `1.5px solid ${mastery.examDate === d ? 'var(--gold)' : 'var(--border-color2)'}`,
                    background: mastery.examDate === d ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'transparent',
                    color: mastery.examDate === d ? 'var(--gold)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                    {EXAM_DATE_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            {/* Objetivo */}
            <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 12 }}>
                🎯 Objetivo: {mastery.targetScore}%
              </div>
              <input
                type="range" min={60} max={100} value={mastery.targetScore}
                onChange={e => updateTargetScore(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                <span>60% Aprobar</span>
                <span>80% Buena nota</span>
                <span>100% Perfecto</span>
              </div>
            </div>

            {/* Modo de estudio */}
            <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 12 }}>⚙️ Modo de estudio</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.keys(MODE_LABELS) as StudyMode[]).map(mode => {
                  const m = MODE_LABELS[mode];
                  const isActive = mastery.studyMode === mode;
                  return (
                    <button key={mode} onClick={() => updateStudyMode(mode)} style={{
                      padding: '10px 14px', borderRadius: 10,
                      border: `1.5px solid ${isActive ? 'var(--gold)' : 'var(--border-color2)'}`,
                      background: isActive ? 'color-mix(in srgb, var(--gold) 10%, transparent)' : 'transparent',
                      color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    }}>
                      <span style={{ fontSize: 16 }}>{m.emoji}</span>
                      <div>
                        <div style={{ fontWeight: 900 }}>{m.label}</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>{m.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tiempo disponible */}
            <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 12 }}>
                ⏱ Tiempo disponible: {mastery.dailyMinutes ? `${mastery.dailyMinutes} min/día` : 'Sin especificar'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[15, 30, 45, 60, 90, 120].map(min => (
                  <button key={min} onClick={() => setMastery(prev => ({ ...prev, dailyMinutes: min }))} style={{
                    padding: '7px 13px', borderRadius: 20,
                    border: `1.5px solid ${mastery.dailyMinutes === min ? 'var(--blue)' : 'var(--border-color2)'}`,
                    background: mastery.dailyMinutes === min ? 'color-mix(in srgb, var(--blue) 15%, transparent)' : 'transparent',
                    color: mastery.dailyMinutes === min ? 'var(--blue)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                    {min} min
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOOK para que las herramientas reporten eventos fácilmente
// ═══════════════════════════════════════════════════════════════
export function useMasteryReporter() {
  const reportEvent = useCallback((event: Omit<MasteryEvent, 'sessionKey' | 'timestamp'>) => {
    if (typeof window === 'undefined') return;
    const reporter = (window as any).__studyal_reportMasteryEvent;
    const sessionKey = (window as any).__studyal_sessionKey;
    if (reporter && sessionKey) {
      reporter({ ...event, sessionKey, timestamp: Date.now() });
    }
  }, []);

  return { reportEvent };
}
