'use client';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { useAuthorizedSource } from '../../lib/materials/useAuthorizedSource';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';
import {
  beginFreeAnalysis,
  completeFreeAnalysis,
  failFreeAnalysis,
  initialFreeAnalysisState,
  recoverInterruptedFreeAnalysis,
  updateFreeAnalysisEntry,
  type DurableFreeAnalysisState,
} from '../../lib/freeAnalysisState';

const BODY = "'Inter', system-ui, -apple-system, sans-serif";
const HAND = BODY;

type NivelEstudio = 'secundaria' | 'universidad' | 'medicina' | 'doctorado';

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema?: any;
  materia?: any;
  onClose: () => void;
  onGuardarApunte?: (titulo: string, contenido: string) => void;
  materialId?: string;
  nivel?: NivelEstudio;
  onMasteryEvent?: (event: any) => void;
  masteryContext?: any;
  sessionId?: string | null;
  sourceSelection?: SourceSelectionSnapshot;
}

type Analisis = {
  titulo: string;
  nivel_detectado?: string;
  probabilidad_examen?: { concepto: string; probabilidad: 'alta' | 'media' | 'baja'; razon: string }[];

  // Profesor ALAI
  objetivos?: string[];
  si_no_sabes_nada?: string;
  mapa_inicial?: string;
  cobertura_material?: { elemento: string; por_que_importa: string }[];
  clase_narrativa?: { titulo: string; explicacion: string; ejemplo: string; checkpoint: string }[];
  panorama_completo?: string;
  preguntas_profesor?: { pregunta: string; que_evalua: string; respuesta_esperada: string }[];
  ya_puedes_explicar?: string[];
  vocabulario_base?: { termino: string; explicacion: string; por_que_aparece: string }[];
  clases?: {
    titulo: string;
    idea_central: string;
    explicacion: string;
    ejemplo_guiado: string;
    pregunta_reflexion: string;
  }[];
  historia_completa?: string;
  conexiones_clave?: { titulo: string; explicacion: string }[];
  errores_comunes?: { error: string; correccion: string; mini_ejemplo: string }[];
  para_examen?: { punto: string; por_que: string }[];
  comprobacion?: { pregunta: string; respuesta_esperada: string }[];
  resumen_final_profesor?: string;
  preguntas_sugeridas?: string[];
  desde_cero?: string[];
  ensenanza_guiada?: {
    concepto: string;
    explicacion_simple: string;
    explicacion_profunda: string;
    ejemplo: string;
    por_que_importa: string;
  }[];
  conexiones?: { titulo: string; explicacion: string; de?: string; a?: string; como?: string }[];
  aplicacion_real?: { caso: string; explicacion: string }[];
  confusiones?: { error: string; correccion: string; truco: string }[];
  examen?: string[];
  resumen_30s?: string;
  preguntale_alai?: string;

  // Compatibilidad vieja
  vision_general?: string | string[];
  conceptos?: { nombre: string; definicion_simple: string; definicion_tecnica: string; por_que_importa: string; ejemplo_concreto: string }[];
  ejemplos?: { titulo: string; problema: string; razonamiento: string; respuesta: string }[];
  analogias?: { concepto: string; analogia: string }[];
  resumen_final?: string[];
  autoevaluacion?: { pregunta: string; respuesta_esperada: string }[];
  idioma?: 'es' | 'en';
  docNames?: string[];
};


function cleanMarkdownText(text: string): string {
  return String(text || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();
}

function fixFormulas(t: string): string {
  return String(t || '')
    .replace(/-rac\{13\.6\s*(?:eV|\\\\text\{eV\})\}\{n\^?2\}/gi, '-13.6 eV/n²')
    .replace(/\\\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\bE_n\b/g, 'Eₙ')
    .replace(/\bn\^2\b/g, 'n²')
    .replace(/\bc\^2\b/g, 'c²')
    .replace(/\\\\text\{eV\}/g, 'eV');
}

function dedupeOraciones(texto: string): string {
  if (!texto) return texto;
  const oraciones = texto.split(/(?<=[.!?])\s+/);
  const vistas = new Set<string>();
  const resultado: string[] = [];
  for (const or of oraciones) {
    const key = or.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!key || vistas.has(key)) continue;
    vistas.add(key);
    resultado.push(or.trim());
  }
  return resultado.join(' ');
}

function renderAnswerBlocks(text: string) {
  const clean = cleanMarkdownText(text);
  const blocks = clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  if (!blocks.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blocks.map((block, idx) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const first = lines[0] || '';
        const rest = lines.slice(1);

        const looksTitle = idx === 0 && first.length < 80 && !first.endsWith('.') && !first.includes('?');

        if (looksTitle) {
          return (
            <div key={idx}>
              <div style={{
                fontFamily: BODY,
                fontSize: 18,
                fontWeight: 900,
                color: 'var(--text-primary)',
                marginBottom: rest.length ? 6 : 0,
              }}>
                {first}
              </div>
              {rest.length > 0 && (
                <div style={{ fontFamily: BODY, fontSize: 15, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                  {rest.join(' ')}
                </div>
              )}
            </div>
          );
        }

        return (
          <p key={idx} style={{ fontFamily: BODY, fontSize: 15, lineHeight: 1.65, color: 'var(--text-primary)', margin: 0 }}>
            {block}
          </p>
        );
      })}
    </div>
  );
}

const STEPS = [
  { emoji: '📄', label: 'leyendo materiales...' },
  { emoji: '🧩', label: 'entendiendo conceptos...' },
  { emoji: '🎨', label: 'estructurando explicación...' },
  { emoji: '✨', label: 'puliendo detalles...' },
];

export default function AnalisisTeorico({ materiales, seleccion, tema, materia, onClose, onGuardarApunte, nivel: nivelProp, masteryContext, sessionId, sourceSelection }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [nivel, setNivel] = useState<NivelEstudio>(nivelProp || 'universidad');
  // nivel detectado automáticamente por ALAI
  const [stepIdx, setStepIdx] = useState(0);
  const [leidas, setLeidas] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<string>('vision');
  const [showSelfCheck, setShowSelfCheck] = useState<Record<number, boolean>>({});
  const [profesorMaterialText, setProfesorMaterialText] = useState('');
  const [dudaInput, setDudaInput] = useState('');
  const [dudaLoading, setDudaLoading] = useState(false);
  const [dudaError, setDudaError] = useState('');
  const [dudaRespuesta, setDudaRespuesta] = useState('');
  const [showCheckAnswers, setShowCheckAnswers] = useState<Record<number, boolean>>({});
  const [continuityReady, setContinuityReady] = useState(false);
  const [durableState, setDurableState] = useState<DurableFreeAnalysisState<Analisis>>(
    () => initialFreeAnalysisState<Analisis>(nivelProp || 'universidad'),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mountedRef = useRef(true);
  const durableStateRef = useRef(durableState);
  const generationControllerRef = useRef<AbortController | null>(null);
  const generationLockedRef = useRef(false);
  const doubtControllerRef = useRef<AbortController | null>(null);
  const doubtAttemptRef = useRef(0);
  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
  const { result: authorizedSource, status: authorizedStatus, error: authorizedError } = useAuthorizedSource(effectiveSourceSelection, 'AnalisisTeorico');

  const analysisRequestKey = `${sessionId || 'missing-session'}::${effectiveSourceSelection.fingerprint}::${nivel}`;

  const persistDurableState = useCallback((next: DurableFreeAnalysisState<Analisis>) => {
    durableStateRef.current = next;
    setDurableState(next);
    if (continuityReady && sessionId) {
      writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'analysis', next);
    }
  }, [continuityReady, sessionId, effectiveSourceSelection.fingerprint]);

  useEffect(() => {
    const restored = readFreeToolState<DurableFreeAnalysisState<Analisis>>(
      sessionId,
      effectiveSourceSelection.fingerprint,
      'analysis',
    );
    const base = restored?.state || initialFreeAnalysisState<Analisis>(nivelProp || 'universidad');
    const recovered = recoverInterruptedFreeAnalysis(base);
    const requestedType = nivelProp || recovered.selectedType || 'universidad';
    const next = recovered.selectedType === requestedType
      ? recovered
      : { ...recovered, selectedType: requestedType };
    durableStateRef.current = next;
    setDurableState(next);
    setNivel(requestedType);
    if (restored && next !== restored.state && sessionId) {
      writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'analysis', next);
    }
    setContinuityReady(true);
  }, [sessionId, effectiveSourceSelection.fingerprint, nivelProp]);

  useEffect(() => {
    durableStateRef.current = durableState;
  }, [durableState]);

  useEffect(() => {
    if (!continuityReady) return;
    const entry = durableStateRef.current.resultsByType[nivel];
    if (!entry) return;
    setAnalisis(entry.result || null);
    setActiveSection(entry.activeSection || 'vision');
    setLeidas(new Set(entry.readSections || []));
    setShowSelfCheck(entry.shownSelfChecks || {});
    setShowCheckAnswers(entry.shownCheckAnswers || {});
    setDudaInput(entry.doubtDraft || '');
    setDudaRespuesta(entry.doubtAnswer || '');
    setDudaError(entry.doubtError || '');
    setError(entry.status === 'recoverable' ? (entry.error || 'La generación se interrumpió.') : null);
    setLoading(entry.status === 'generating');
  }, [continuityReady, nivel]);

  useEffect(() => {
    if (!continuityReady || !sessionId) return;
    const timer = window.setTimeout(() => {
      const next = updateFreeAnalysisEntry(durableStateRef.current, nivel, {
        activeSection,
        readSections: Array.from(leidas),
        shownSelfChecks: showSelfCheck,
        shownCheckAnswers: showCheckAnswers,
        doubtDraft: dudaInput,
        doubtAnswer: dudaRespuesta,
        doubtError: dudaError,
      });
      persistDurableState(next);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [continuityReady, sessionId, nivel, activeSection, leidas, showSelfCheck, showCheckAnswers, dudaInput, dudaRespuesta, dudaError, persistDurableState]);

  // nivel detectado automáticamente por ALAI desde M0

  // ═══ Animación de steps ═══
  useEffect(() => {
    if (!loading) return;
    const intv = setInterval(() => {
      setStepIdx(i => (i + 1) % STEPS.length);
    }, 1400);
    return () => clearInterval(intv);
  }, [loading]);

  const runAnalysis = useCallback(async () => {
      if (!continuityReady || generationLockedRef.current) return;
      if (!sessionId) {
        setLoading(false);
        setError('No se pudo identificar la sesión Free para guardar este análisis.');
        return;
      }
      const current = durableStateRef.current.resultsByType[nivel];
      if (current?.status === 'completed' && current.result) return;
      const started = beginFreeAnalysis(durableStateRef.current, nivel);
      if (started === durableStateRef.current) return;
      const attempt = started.resultsByType[nivel]?.attempt || 0;
      persistDurableState(started);
      generationControllerRef.current?.abort();
      const controller = new AbortController();
      generationControllerRef.current = controller;
      generationLockedRef.current = true;
      try {
        setLoading(true);
        setError(null);

        if (authorizedStatus === 'error' || !authorizedSource) {
          throw new Error(authorizedError || 'No se pudo resolver la fuente autorizada.');
        }

        const documentos = effectiveSourceSelection.materials.map(selection => {
          const source = authorizedSource.materials[selection.materialId];
          return {
            id: selection.materialId,
            nombre: source.nombre,
            contenido: source.text,
            tipo: source.kind,
            pages: selection.selectedPages,
          };
        });

        if (!documentos.length) {
          throw new Error('No hay contenido legible para analizar.');
        }

        const materialTextForQuestions = documentos
          .map((doc: any, i: number) => `[Material ${i + 1}: ${doc.nombre}${doc.pages?.length ? ` | páginas ${doc.pages.join(', ')}` : ''}]\n${doc.contenido}`)
          .join('\n\n---\n\n');

        if (mountedRef.current) setProfesorMaterialText(materialTextForQuestions);

        const res = await fetch('/api/analizar-teorico', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            documentos,
            materia: materia?.nombre || materia?.name || '',
            tema: tema?.nombre || tema?.name || '',
            nivel,
            masteryContext,
            selectedPages: documentos.reduce((acc: any, doc: any) => {
              if (doc.pages?.length) acc[doc.id] = doc.pages;
              return acc;
            }, {}),
            materialId: `source_${effectiveSourceSelection.fingerprint}_${nivel}`,
          }),
          signal: controller.signal,
        });

        const data = await res.json();
        if (!mountedRef.current || controller.signal.aborted || generationControllerRef.current !== controller) return;

        if (!res.ok || !data.success || !data.analisis || typeof data.analisis !== 'object') {
          throw new Error(data?.error || 'El proveedor devolvió un análisis incompatible.');
        }
        const completed = completeFreeAnalysis(durableStateRef.current, nivel, attempt, data.analisis as Analisis);
        if (completed === durableStateRef.current) return;
        persistDurableState(completed);
        setAnalisis(data.analisis);
      } catch (caught: unknown) {
        if (controller.signal.aborted || generationControllerRef.current !== controller) return;
        const message = caught instanceof Error ? caught.message : 'Error de conexión';
        const failed = failFreeAnalysis(durableStateRef.current, nivel, attempt, message);
        persistDurableState(failed);
        setError(message);
      } finally {
        if (generationControllerRef.current === controller) {
          generationControllerRef.current = null;
          generationLockedRef.current = false;
          if (mountedRef.current) setLoading(false);
        }
      }
  }, [continuityReady, sessionId, nivel, authorizedStatus, authorizedSource, authorizedError, effectiveSourceSelection, materia, tema, masteryContext, persistDurableState]);

  // ═══ Restore primero; solo genera si el tipo actual está realmente ausente ═══
  useEffect(() => {
    if (!continuityReady || authorizedStatus === 'loading' || authorizedStatus === 'idle') return;
    const entry = durableStateRef.current.resultsByType[nivel];
    if (entry?.status === 'completed' && entry.result) {
      setAnalisis(entry.result);
      setLoading(false);
      setError(null);
      return;
    }
    if (entry?.status === 'recoverable') {
      setLoading(false);
      setError(entry.error || 'La generación se interrumpió.');
      return;
    }
    void runAnalysis();
  }, [analysisRequestKey, continuityReady, authorizedStatus, nivel, runAnalysis]);

  useEffect(() => {
    if (!authorizedSource) return;
    const text = effectiveSourceSelection.materials.map((selection, index) => {
      const source = authorizedSource.materials[selection.materialId];
      if (!source) return '';
      const pageLabel = selection.selectedPages.length ? ` | páginas ${selection.selectedPages.join(', ')}` : '';
      return `[Material ${index + 1}: ${source.nombre}${pageLabel}]\n${source.text}`;
    }).filter(Boolean).join('\n\n---\n\n');
    setProfesorMaterialText(text);
  }, [authorizedSource, effectiveSourceSelection]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationControllerRef.current?.abort();
      generationControllerRef.current = null;
      generationLockedRef.current = false;
      doubtControllerRef.current?.abort();
      doubtControllerRef.current = null;
      const entry = durableStateRef.current.resultsByType[nivel];
      if (entry?.status === 'generating' && sessionId) {
        const recoverable = recoverInterruptedFreeAnalysis(durableStateRef.current);
        writeFreeToolState(sessionId, effectiveSourceSelection.fingerprint, 'analysis', recoverable);
      }
    };
  }, [sessionId, effectiveSourceSelection.fingerprint, nivel]);

  // ═══ Scroll spy ═══
  useEffect(() => {
    if (!analisis || !scrollRef.current) return;
    const onScroll = () => {
      const scrollEl = scrollRef.current!;
      const sections = Object.entries(sectionRefs.current);
      let current = sections[0]?.[0] || 'vision';
      for (const [id, el] of sections) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight / 3) current = id;
      }
      setActiveSection(current);
    };
    const el = scrollRef.current;
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [analisis]);

  // ═══ Bloqueo zoom navegador ═══
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['+','-','=','0'].includes(e.key)) e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true } as any);
      document.removeEventListener('keydown', onKey, { capture: true } as any);
    };
  }, []);

  const toggleLeida = (id: string) => {
    setLeidas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const preguntarDuda = async () => {
    const question = dudaInput.trim();
    if (!question || dudaLoading) return;

    const attempt = doubtAttemptRef.current + 1;
    doubtAttemptRef.current = attempt;
    doubtControllerRef.current?.abort();
    const controller = new AbortController();
    doubtControllerRef.current = controller;

    setDudaLoading(true);
    setDudaError('');
    setDudaRespuesta('');

    try {
      const res = await fetch('/api/alai-studyal-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: `Responde como Profesor ALAI usando esta estructura clara: 1) Respuesta corta, 2) Por qué importa en este material, 3) Cómo se conecta con el tema, 4) Dato clave para recordar. Usa el material como fuente principal. Si hay un término técnico, defínelo primero. Duda del estudiante: ${question}`,
          materialText: profesorMaterialText,
          history: [],
          materia: materia?.nombre || materia?.name || '',
          tema: tema?.nombre || tema?.name || '',
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!mountedRef.current || controller.signal.aborted || doubtAttemptRef.current !== attempt) return;
      if (!res.ok || !data.success) throw new Error(data?.error || 'No se pudo responder la duda.');

      setDudaRespuesta(String(data.answer || '').trim() || 'No pude generar una respuesta clara.');
    } catch (e: any) {
      if (!controller.signal.aborted && doubtAttemptRef.current === attempt) {
        setDudaError(e?.message || 'No se pudo responder la duda.');
      }
    } finally {
      if (doubtAttemptRef.current === attempt) {
        doubtControllerRef.current = null;
        setDudaLoading(false);
      }
    }
  };

  const sectionsList = useMemo(() => {
    if (!analisis) return [];
    const list: { id: string; emoji: string; label: string }[] = [];
    if (analisis.objetivos?.length) list.push({ id: 'objetivos', emoji: '🎯', label: 'Qué aprenderás' });
    if (analisis.si_no_sabes_nada) list.push({ id: 'cero', emoji: '🌱', label: 'Desde cero' });
    if (analisis.mapa_inicial || analisis.desde_cero?.length || analisis.vision_general) list.push({ id: 'mapa', emoji: '🧭', label: 'Mapa mental' });
    if (analisis.cobertura_material?.length || analisis.vocabulario_base?.length) list.push({ id: 'cobertura', emoji: '📌', label: 'Todo lo importante' });
    if (analisis.clase_narrativa?.length || analisis.clases?.length || analisis.ensenanza_guiada?.length || analisis.conceptos?.length) list.push({ id: 'clase', emoji: '👨‍🏫', label: 'Clase completa' });
    if (analisis.panorama_completo || analisis.historia_completa) list.push({ id: 'panorama', emoji: '🧠', label: 'Panorama completo' });
    if (analisis.conexiones_clave?.length || analisis.conexiones?.length) list.push({ id: 'conexiones', emoji: '🔗', label: 'Conexiones' });
    if ((analisis.errores_comunes || []).filter((e: any) => e?.error || e?.correccion || e?.mini_ejemplo).length || (analisis.confusiones || []).filter((e: any) => e?.error || e?.correccion || e?.truco).length) list.push({ id: 'confusiones', emoji: '⚠️', label: 'Confusiones' });
    if (analisis.para_examen?.length || analisis.examen?.length || analisis.resumen_final?.length) list.push({ id: 'examen', emoji: '📝', label: 'Para examen' });
    if ((analisis as any).probabilidad_examen?.length) list.push({ id: 'prob-examen', emoji: '🔥', label: 'Probabilidad examen' });
    if (analisis.preguntas_profesor?.length || analisis.comprobacion?.length || analisis.autoevaluacion?.length) list.push({ id: 'comprobacion', emoji: '✅', label: 'Comprueba' });
    if (analisis.ya_puedes_explicar?.length) list.push({ id: 'explicar', emoji: '🎓', label: 'Ya puedes explicar' });
    if (analisis.resumen_final_profesor || analisis.resumen_30s) list.push({ id: 'resumen-final', emoji: '⚡', label: 'Resumen final' });
    list.push({ id: 'preguntale', emoji: '💬', label: 'Pregúntale a ALAI' });
    return list;
  }, [analisis]);

  const totalSecciones = sectionsList.length;
  const progreso = totalSecciones > 0 ? Math.round((leidas.size / totalSecciones) * 100) : 0;

  useEffect(() => {
    if (!continuityReady || !sessionId || totalSecciones === 0) return;
    const completed = leidas.size >= totalSecciones;
    const current = durableStateRef.current.resultsByType[nivel];
    if (!current || current.completed === completed) return;
    persistDurableState(updateFreeAnalysisEntry(durableStateRef.current, nivel, { completed }));
  }, [continuityReady, sessionId, nivel, leidas, totalSecciones, persistDurableState]);


  // ═══ LOADING SCREEN ═══
  if (loading) {
    return (
      <div style={overlayStyle}>
        <BgCuaderno />
        <div style={{
          position: 'fixed', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 24, zIndex: 10,
        }}>
          <div style={{
            fontFamily: HAND, fontSize: 32, fontWeight: 800,
            color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 44, animation: 'lupa 2s ease-in-out infinite' }}>🔬</span>
            <span>Analizando tu material…</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {STEPS.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={i} style={{
                  fontFamily: HAND, fontSize: 22,
                  color: active ? 'var(--gold)' : done ? 'var(--text-muted)' : 'var(--text-faint)',
                  display: 'flex', alignItems: 'center', gap: 10,
                  opacity: done ? 0.6 : 1,
                  transition: 'all 0.3s',
                }}>
                  <span style={{ fontSize: 24 }}>{done ? '✅' : active ? s.emoji : '⬜'}</span>
                  <span>{s.label}</span>
                  {active && <span style={{ display: 'inline-block', animation: 'dotPulse 1s infinite' }}>...</span>}
                </div>
              );
            })}
          </div>

          <div style={{
            fontFamily: BODY, fontSize: 16, color: 'var(--text-faint)',
            fontStyle: 'italic', marginTop: 14,
          }}>
            esto puede tardar unos 15-30 segundos ✨
          </div>
        </div>
        <Styles />
      </div>
    );
  }

  // ═══ ERROR SCREEN ═══
  if (error) {
    return (
      <div style={overlayStyle}>
        <BgCuaderno />
        <div style={{
          position: 'fixed', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 20, zIndex: 10,
        }}>
          <div style={{ fontSize: 60 }}>😅</div>
          <div style={{ fontFamily: HAND, fontSize: 28, color: 'var(--text-primary)', textAlign: 'center', maxWidth: 500 }}>
            ups, algo salió mal
          </div>
          <div style={{ fontFamily: BODY, fontSize: 15, color: 'var(--text-muted)', maxWidth: 500, textAlign: 'center' }}>
            {error}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={onClose} style={btnPrimario}>← Volver al proceso</button>
            {durableState.resultsByType[nivel]?.status === 'recoverable' && (
              <button
                onClick={() => void runAnalysis()}
                style={btnPrimario}
                data-testid="analysis-retry"
              >reintentar análisis</button>
            )}
          </div>
        </div>
        <Styles />
      </div>
    );
  }

  if (!analisis) return null;

  // ═══ MAIN UI ═══
  return (
    <div style={overlayStyle}>
      <BgCuaderno />

      {/* ═══ TOP BAR ═══ */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1.5px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 16,
      }} className="analysis-topbar">
        <button onClick={onClose} style={{
          background: 'transparent', border: '1.5px solid var(--text-primary)',
          color: 'var(--text-primary)', padding: '6px 16px',
          borderRadius: 10, fontFamily: HAND, fontSize: 18, fontWeight: 700,
          cursor: 'pointer', boxShadow: '2px 3px 0 var(--text-primary)',
          transition: 'transform .2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >← Volver al proceso</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>🔬</span>
            <div style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{analisis.titulo}</div>
          </div>
          <div style={{
            fontFamily: BODY, fontSize: 13, color: 'var(--text-muted)',
            fontStyle: 'italic', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span>análisis de {materiales.length} {materiales.length === 1 ? 'material' : 'materiales'}</span>
            {(analisis as any)?.nivel_detectado && (
              <span style={{
                background: 'color-mix(in srgb, var(--gold) 20%, var(--bg-card))',
                border: '1px solid var(--gold)',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}>
                {String((analisis as any).nivel_detectado) === 'secundaria'
                  ? '📘 Secundaria'
                  : String((analisis as any).nivel_detectado) === 'medicina'
                  ? '🩺 Medicina'
                  : String((analisis as any).nivel_detectado) === 'doctorado'
                  ? '🔬 Doctorado'
                  : '🎓 Universidad'}
              </span>
            )}
          </div>
        </div>

        {/* Progreso */}
        <div className="analysis-progress" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
          <div style={{
            fontFamily: BODY, fontSize: 14, color: 'var(--text-muted)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>progreso</span>
            <span style={{ color: 'var(--gold)', fontWeight: 800 }}>{progreso}%</span>
          </div>
          <div style={{
            height: 6, background: 'color-mix(in srgb, var(--text-primary) 12%, transparent)',
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${progreso}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--gold), color-mix(in srgb, var(--gold) 70%, #fff))',
              borderRadius: 3, transition: 'width 0.4s',
            }} />
          </div>
        </div>
      </div>

      {/* ═══ LAYOUT ═══ */}
      <div style={{
        position: 'fixed', top: 78, left: 0, right: 0, bottom: 0,
        display: 'flex', zIndex: 5,
      }} className="analysis-layout">
        {/* ─── SIDEBAR ÍNDICE ─── */}
        <aside className="analysis-sidebar" style={{
          width: 240, flexShrink: 0,
          padding: '20px 14px',
          overflowY: 'auto',
          background: 'transparent',
        }}>
          <div style={{
            position: 'relative',
            background: '#fde047',
            border: '1.5px solid #78350f',
            borderRadius: 4,
            padding: '34px 14px 18px',
            boxShadow: '0 8px 18px rgba(0,0,0,0.45), 0 3px 6px rgba(0,0,0,0.25)',
            transform: 'rotate(-1.5deg)',
          }}>
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              width: 70, height: 14,
              transform: 'translateX(-50%) rotate(-4deg)',
              background: 'rgba(245,245,240,0.7)',
              border: '1px solid rgba(0,0,0,0.12)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
            }} />
            <div style={{
              fontFamily: HAND, fontSize: 18, fontWeight: 900,
              color: '#422006', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              📋 <span>Índice</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sectionsList.map(s => {
                const isLeida = leidas.has(s.id);
                const isActive = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: isActive ? 'rgba(66,32,6,0.15)' : 'transparent',
                      border: 'none', textAlign: 'left',
                      padding: '6px 8px', borderRadius: 4,
                      cursor: 'pointer',
                      fontFamily: HAND, fontSize: 17, fontWeight: 700,
                      color: '#422006',
                      transition: 'background 0.2s, transform 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateX(0)'; }}
                  >
                    <span style={{ fontSize: 14, opacity: isLeida ? 1 : 0.4 }}>
                      {isLeida ? '✅' : '⬜'}
                    </span>
                    <span style={{ fontSize: 16 }}>{s.emoji}</span>
                    <span style={{
                      flex: 1,
                      textDecoration: isLeida ? 'line-through' : 'none',
                      opacity: isLeida ? 0.65 : 1,
                    }}>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            marginTop: 18, padding: '10px 12px',
            fontFamily: BODY, fontSize: 13,
            color: 'var(--text-faint)', fontStyle: 'italic',
            textAlign: 'center', lineHeight: 1.3,
          }}>
            tip: marca como leído al terminar cada sección 📌
          </div>
        </aside>

        {/* ─── CONTENIDO ─── */}
        <main ref={scrollRef} className="analysis-main" style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 32px 80px',
        }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>

            {/* Hero Profesor ALAI */}
            <div style={{
              marginBottom: 28,
              padding: '22px 26px',
              borderRadius: 14,
              border: '2px solid var(--text-primary)',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 24%, var(--bg-card)), var(--bg-card))',
              boxShadow: '5px 6px 0 var(--text-primary), 0 12px 34px rgba(0,0,0,0.28)',
              transform: 'rotate(-0.6deg)',
            }}>
              <div style={{ fontFamily: HAND, fontSize: 42, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>
                👨‍🏫 Profesor ALAI
              </div>
              <div style={{ ...parrafo, marginTop: 10, marginBottom: 0, color: 'var(--text-muted)' }}>
                Después de repasar, esta clase convierte el material seleccionado en una explicación clara: primero entiendes la base, luego las ideas grandes, después las conexiones, y al final compruebas si realmente lo aprendiste.
              </div>
            </div>

            {/* Qué vas a aprender */}
            {analisis.objetivos?.length ? (
              <Seccion
                id="objetivos" emoji="🎯" titulo="¿Qué vas a aprender?"
                setRef={(el: any) => { sectionRefs.current['objetivos'] = el; }}
                leida={leidas.has('objetivos')}
                onToggleLeida={() => toggleLeida('objetivos')}
                onGuardar={() => onGuardarApunte?.(`🎯 Qué vas a aprender — ${analisis.titulo}`, analisis.objetivos!.map((b, i) => `${i+1}. ${b}`).join('\n'))}
              >
                <div style={{ ...miniCard, background: 'color-mix(in srgb, var(--gold) 16%, var(--bg-card))', borderColor: 'var(--gold)', marginBottom: 14 }}>
                  <strong style={miniLabel}>Meta:</strong> al final debes poder explicar este material sin leer el documento.
                </div>
                <ul style={{ paddingLeft: 24, margin: 0 }}>
                  {analisis.objetivos.map((b, i) => (
                    <li key={i} style={{ ...parrafo, marginBottom: 10 }}>{b}</li>
                  ))}
                </ul>
              </Seccion>
            ) : null}

            {/* Si no sabes nada */}
            {analisis.si_no_sabes_nada && (
              <Seccion
                id="cero" emoji="🌱" titulo="Si no sabes nada del tema"
                setRef={(el: any) => { sectionRefs.current['cero'] = el; }}
                leida={leidas.has('cero')}
                onToggleLeida={() => toggleLeida('cero')}
                onGuardar={() => onGuardarApunte?.(`🌱 Desde cero — ${analisis.titulo}`, analisis.si_no_sabes_nada || '')}
              >
                <div>
                  {dedupeOraciones(String(analisis.si_no_sabes_nada || '')).split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/).map((s, i) => (
                    <p key={i} style={{ ...parrafo, fontSize: 17, marginBottom: 10 }}>{s.trim()}</p>
                  ))}
                </div>
              </Seccion>
            )}

            {/* Mapa mental */}
            <Seccion
              id="mapa" emoji="🧭" titulo="Mapa mental del material"
              setRef={(el: any) => { sectionRefs.current['mapa'] = el; }}
              leida={leidas.has('mapa')}
              onToggleLeida={() => toggleLeida('mapa')}
              onGuardar={() => {
                const texto = analisis.mapa_inicial || (analisis.desde_cero?.length
                  ? analisis.desde_cero.join('\n\n')
                  : (Array.isArray(analisis.vision_general) ? analisis.vision_general.join('\n\n') : String(analisis.vision_general || ''))
                );
                onGuardarApunte?.(`🧭 Mapa mental — ${analisis.titulo}`, texto);
              }}
            >
              {(analisis.mapa_inicial
                ? [analisis.mapa_inicial]
                : (analisis.desde_cero?.length
                  ? analisis.desde_cero
                  : (Array.isArray(analisis.vision_general) ? analisis.vision_general : String(analisis.vision_general || '').split(/\n\n+/).filter(Boolean)))
              ).map((p: string, i: number) => (
                <p key={i} style={{...parrafo, marginBottom: 18}}>{p}</p>
              ))}
            </Seccion>

            {/* Cobertura */}
            {((analisis.cobertura_material?.length || 0) > 0 || (analisis.vocabulario_base?.length || 0) > 0) && (
              <Seccion
                id="cobertura" emoji="📌" titulo="Todo lo importante del material"
                setRef={(el: any) => { sectionRefs.current['cobertura'] = el; }}
                leida={leidas.has('cobertura')}
                onToggleLeida={() => toggleLeida('cobertura')}
                onGuardar={() => {
                  const items = analisis.cobertura_material?.length
                    ? analisis.cobertura_material
                    : (analisis.vocabulario_base || []).map((v: any) => ({ elemento: v.termino, por_que_importa: v.por_que_aparece || v.explicacion }));
                  onGuardarApunte?.(`📌 Todo lo importante — ${analisis.titulo}`, items.map((x: any, i: number) => `${i+1}. ${x.elemento}: ${x.por_que_importa}`).join('\n'));
                }}
              >
                <div style={{ ...miniCard, background: 'color-mix(in srgb, #38bdf8 12%, var(--bg-card))', borderColor: '#0284c7', marginBottom: 14 }}>
                  <strong style={miniLabel}>ALAI revisó el material y detectó estas piezas clave:</strong> si entiendes esto, tienes la base del tema.
                </div>
                {(analisis.cobertura_material?.length
                  ? analisis.cobertura_material
                  : (analisis.vocabulario_base || []).map((v: any) => ({ elemento: v.termino, por_que_importa: v.por_que_aparece || v.explicacion }))
                ).filter((x: any, i: number, arr: any[]) => {
                    if (!x.elemento || !x.por_que_importa) return false;
                    const el = String(x.elemento).trim();
                    const pk = String(x.por_que_importa).trim();
                    // Eliminar items donde elemento y por_que_importa son idénticos o casi
                    if (el === pk) return false;
                    if (pk.toLowerCase().startsWith(el.toLowerCase().slice(0, 20))) return false;
                    // Eliminar si por_que_importa es muy corto (menos de 15 chars)
                    if (pk.length < 15) return false;
                    // Eliminar duplicados por primeros 30 chars
                    return arr.findIndex((y: any) => String(y.elemento).slice(0,30) === el.slice(0,30)) === i;
                  }).map((x: any, i: number) => (
                  <div key={i} style={{
                    ...miniCard,
                    background: 'color-mix(in srgb, var(--text-primary) 4%, var(--bg-card))',
                    borderColor: 'color-mix(in srgb, var(--text-primary) 18%, transparent)',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                  }}>
                    <span style={{
                      background: 'color-mix(in srgb, #38bdf8 30%, var(--bg-card))',
                      border: '1.5px solid #0284c7',
                      color: 'var(--text-primary)',
                      fontFamily: BODY,
                      fontSize: 12,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 999,
                      flexShrink: 0,
                      marginTop: 2,
                    }}>{i + 1}</span>
                    <div>
                      <strong style={miniLabel}>{x.elemento}</strong>
                      <span style={{ fontFamily: BODY, fontSize: 14, color: 'var(--text-muted)' }}>: {x.por_que_importa}</span>
                    </div>
                  </div>
                ))}
              </Seccion>
            )}

            {/* Clase narrativa */}
            {((analisis.clase_narrativa?.length || 0) > 0 || (analisis.clases?.length || 0) > 0 || (analisis.ensenanza_guiada?.length || 0) > 0 || (analisis.conceptos?.length || 0) > 0) && (
              <Seccion
                id="clase" emoji="👨‍🏫" titulo="Clase completa de ALAI"
                setRef={(el: any) => { sectionRefs.current['clase'] = el; }}
                leida={leidas.has('clase')}
                onToggleLeida={() => toggleLeida('clase')}
                onGuardar={() => {
                  const items = (analisis.clase_narrativa?.length
                    ? analisis.clase_narrativa
                    : (analisis.clases?.length
                      ? analisis.clases.map((c: any) => ({ titulo: c.titulo, explicacion: c.explicacion, ejemplo: c.ejemplo_guiado, checkpoint: c.pregunta_reflexion }))
                      : (analisis.ensenanza_guiada?.length
                        ? analisis.ensenanza_guiada.map((c: any) => ({ titulo: c.concepto, explicacion: c.explicacion_profunda, ejemplo: c.ejemplo, checkpoint: c.por_que_importa }))
                        : (analisis.conceptos || []).map((c: any) => ({ titulo: c.nombre, explicacion: c.definicion_tecnica, ejemplo: c.ejemplo_concreto, checkpoint: c.por_que_importa })))
                    )
                  );
                  onGuardarApunte?.(`👨‍🏫 Clase completa — ${analisis.titulo}`, items.map((c: any, i: number) => `Parte ${i+1}: ${c.titulo}\n${c.explicacion}\nEjemplo: ${c.ejemplo}\nCheckpoint: ${c.checkpoint}`).join('\n\n'));
                }}
              >
                {(analisis.clase_narrativa?.length
                  ? analisis.clase_narrativa
                  : (analisis.clases?.length
                    ? analisis.clases.map((c: any) => ({ titulo: c.titulo, explicacion: c.explicacion, ejemplo: c.ejemplo_guiado, checkpoint: c.pregunta_reflexion }))
                    : (analisis.ensenanza_guiada?.length
                      ? analisis.ensenanza_guiada.map((c: any) => ({ titulo: c.concepto, explicacion: c.explicacion_profunda, ejemplo: c.ejemplo, checkpoint: c.por_que_importa }))
                      : (analisis.conceptos || []).map((c: any) => ({ titulo: c.nombre, explicacion: c.definicion_tecnica, ejemplo: c.ejemplo_concreto, checkpoint: c.por_que_importa })))
                  )
                ).map((c: any, i: number) => (
                  <div key={i} style={{ ...conceptoCard, padding: '20px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{
                        background: 'var(--gold)',
                        color: 'var(--text-primary)',
                        fontFamily: BODY,
                        fontSize: 13,
                        fontWeight: 900,
                        padding: '3px 10px',
                        borderRadius: 999,
                        border: '1.5px solid var(--text-primary)',
                        flexShrink: 0,
                      }}>{i+1}</span>
                      <div style={{ fontFamily: BODY, fontSize: 21, fontWeight: 900, color: 'var(--text-primary)' }}>
                        {c.titulo}
                      </div>
                    </div>
                    {c.explicacion && (
                      <div style={{ marginBottom: 12 }}>
                        {dedupeOraciones(fixFormulas(String(c.explicacion))).split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/).map((sentence, si) => (
                          <p key={si} style={{ ...parrafo, marginBottom: si === 0 ? 10 : 8 }}>{sentence.trim()}</p>
                        ))}
                      </div>
                    )}
                    {c.ejemplo && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, #fb923c 16%, var(--bg-card))', borderColor: '#ea580c' }}>
                        <strong style={miniLabel}>Ejemplo del material:</strong> {c.ejemplo}
                      </div>
                    )}
                    {c.checkpoint && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, #c4b5fd 18%, var(--bg-card))', borderColor: '#7c3aed' }}>
                        <strong style={miniLabel}>Comprueba:</strong> {c.checkpoint}
                      </div>
                    )}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Panorama completo */}
            {(analisis.panorama_completo || analisis.historia_completa) && (
              <Seccion
                id="panorama" emoji="🧠" titulo="Ahora une todo"
                setRef={(el: any) => { sectionRefs.current['panorama'] = el; }}
                leida={leidas.has('panorama')}
                onToggleLeida={() => toggleLeida('panorama')}
                onGuardar={() => onGuardarApunte?.(`🧠 Panorama completo — ${analisis.titulo}`, analisis.panorama_completo || analisis.historia_completa || '')}
              >
                <div>
                {dedupeOraciones(fixFormulas(String(analisis.panorama_completo || analisis.historia_completa || ''))).split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/).map((s, i) => (
                  <p key={i} style={{ ...parrafo, fontSize: 17, marginBottom: 10 }}>{s.trim()}</p>
                ))}
              </div>
              </Seccion>
            )}

            {/* Conexiones */}
            {((analisis.conexiones_clave?.length || 0) > 0 || (analisis.conexiones?.length || 0) > 0) && (
              <Seccion
                id="conexiones" emoji="🔗" titulo="Conexiones clave"
                setRef={(el: any) => { sectionRefs.current['conexiones'] = el; }}
                leida={leidas.has('conexiones')}
                onToggleLeida={() => toggleLeida('conexiones')}
                onGuardar={() => {
                  const items = analisis.conexiones_clave?.length ? analisis.conexiones_clave : (analisis.conexiones || []);
                  onGuardarApunte?.(`🔗 Conexiones — ${analisis.titulo}`, items.map((c: any) => `${c.titulo || `${c.de} → ${c.a}`}\n${c.explicacion || c.como}`).join('\n\n'));
                }}
              >
                {(analisis.conexiones_clave?.length ? analisis.conexiones_clave : (analisis.conexiones || [])).map((c: any, i) => (
                  <div key={i} style={{ ...miniCard, background: 'color-mix(in srgb, #84cc16 15%, var(--bg-card))', borderColor: '#65a30d', marginBottom: 10 }}>
                    <div style={{ fontFamily: BODY, fontSize: 19, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {c.titulo || `${c.de} → ${c.a}`}
                    </div>
                    <div style={parrafoMini}>{c.explicacion || c.como}</div>
                  </div>
                ))}
              </Seccion>
            )}

            {/* Confusiones */}
            {((analisis.errores_comunes || []).filter((e: any) => e?.error || e?.correccion || e?.mini_ejemplo).length > 0 ||
              (analisis.confusiones || []).filter((e: any) => e?.error || e?.correccion || e?.truco).length > 0) && (
              <Seccion
                id="confusiones" emoji="⚠️" titulo="Lo que suele confundirse"
                setRef={(el: any) => { sectionRefs.current['confusiones'] = el; }}
                leida={leidas.has('confusiones')}
                onToggleLeida={() => toggleLeida('confusiones')}
                onGuardar={() => {
                  const items = (analisis.errores_comunes || []).filter((e: any) => e?.error || e?.correccion || e?.mini_ejemplo).length
                    ? (analisis.errores_comunes || []).filter((e: any) => e?.error || e?.correccion || e?.mini_ejemplo)
                    : (analisis.confusiones || []).filter((e: any) => e?.error || e?.correccion || e?.truco).map((e: any) => ({ error: e.error, correccion: e.correccion, mini_ejemplo: e.truco }));
                  onGuardarApunte?.(`⚠️ Confusiones — ${analisis.titulo}`, items.map((e: any) => `Error: ${e.error}\nCorrección: ${e.correccion}\nEjemplo: ${e.mini_ejemplo}`).join('\n\n'));
                }}
              >
                {((analisis.errores_comunes || []).filter((e: any) => e?.error || e?.correccion || e?.mini_ejemplo).length
                  ? (analisis.errores_comunes || []).filter((e: any) => e?.error || e?.correccion || e?.mini_ejemplo)
                  : (analisis.confusiones || []).filter((e: any) => e?.error || e?.correccion || e?.truco).map((e: any) => ({ error: e.error, correccion: e.correccion, mini_ejemplo: e.truco }))
                ).map((er: any, i: number) => (
                  <div key={i} style={{ ...conceptoCard, background: 'color-mix(in srgb, #fca5a5 15%, var(--bg-card))', borderColor: '#dc2626' }}>
                    {er.error && <div style={{ fontFamily: BODY, fontSize: 19, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6 }}>⚠️ {er.error}</div>}
                    {er.correccion && <div style={{ ...miniCard, background: 'transparent', borderColor: '#dc262644' }}><strong style={miniLabel}>Corrección:</strong> {er.correccion}</div>}
                    {er.mini_ejemplo && <div style={{ ...miniCard, background: 'color-mix(in srgb, #84cc16 15%, var(--bg-card))', borderColor: '#65a30d' }}><strong style={miniLabel}>Ejemplo rápido:</strong> {er.mini_ejemplo}</div>}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Para examen */}
            {((analisis.para_examen?.length || 0) > 0 || (analisis.examen?.length || 0) > 0 || (analisis.resumen_final?.length || 0) > 0) && (
              <Seccion
                id="examen" emoji="📝" titulo="Lo más importante para examen"
                setRef={(el: any) => { sectionRefs.current['examen'] = el; }}
                leida={leidas.has('examen')}
                onToggleLeida={() => toggleLeida('examen')}
                onGuardar={() => {
                  const items = analisis.para_examen?.length
                    ? analisis.para_examen
                    : (analisis.examen?.length ? analisis.examen.map((x) => ({ punto: x, por_que: '' })) : (analisis.resumen_final || []).map((x) => ({ punto: x, por_que: '' })));
                  onGuardarApunte?.(`📝 Para examen — ${analisis.titulo}`, items.map((b, i) => `${i+1}. ${b.punto}${b.por_que ? `\nPor qué: ${b.por_que}` : ''}`).join('\n\n'));
                }}
              >
                {(analisis.para_examen?.length
                  ? analisis.para_examen
                  : (analisis.examen?.length ? analisis.examen.map((x) => ({ punto: x, por_que: '' })) : (analisis.resumen_final || []).map((x) => ({ punto: x, por_que: '' })))
                ).map((b, i) => (
                  <div key={i} style={{ ...miniCard, background: 'color-mix(in srgb, var(--gold) 12%, var(--bg-card))', borderColor: 'var(--gold)', marginBottom: 10 }}>
                    <strong>{i + 1}. {b.punto}</strong>
                    {b.por_que && <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>{b.por_que}</div>}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Probabilidad de examen */}
            {(analisis as any).probabilidad_examen?.length > 0 && (
              <Seccion
                id="prob-examen" emoji="🔥" titulo="Probabilidad de examen"
                setRef={(el: any) => { sectionRefs.current['prob-examen'] = el; }}
                leida={leidas.has('prob-examen')}
                onToggleLeida={() => toggleLeida('prob-examen')}
                onGuardar={() => onGuardarApunte?.(`🔥 Probabilidad examen — ${analisis.titulo}`,
                  ((analisis as any).probabilidad_examen || []).map((x: any) => `${x.probabilidad === 'alta' ? '🔥' : x.probabilidad === 'media' ? '🟡' : '🟢'} ${x.concepto}: ${x.razon}`).join('\\n')
                )}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {((analisis as any).probabilidad_examen || []).map((item: any, i: number) => {
                    const emoji = item.probabilidad === 'alta' ? '🔥' : item.probabilidad === 'media' ? '🟡' : '🟢';
                    const bg = item.probabilidad === 'alta'
                      ? 'color-mix(in srgb, #ef4444 12%, var(--bg-card))'
                      : item.probabilidad === 'media'
                      ? 'color-mix(in srgb, #f59e0b 12%, var(--bg-card))'
                      : 'color-mix(in srgb, #22c55e 12%, var(--bg-card))';
                    const border = item.probabilidad === 'alta' ? '#ef4444' : item.probabilidad === 'media' ? '#f59e0b' : '#22c55e';
                    return (
                      <div key={i} style={{ ...miniCard, background: bg, borderColor: border, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ fontSize: 20, flexShrink: 0 }}>{emoji}</span>
                        <div>
                          <strong style={{ fontFamily: BODY, fontSize: 15, fontWeight: 800 }}>{item.concepto}</strong>
                          <div style={{ fontFamily: BODY, fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{item.razon}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Seccion>
            )}

            {/* Preguntas profesor */}
            {((analisis.preguntas_profesor?.length || 0) > 0 || (analisis.comprobacion?.length || 0) > 0 || (analisis.autoevaluacion?.length || 0) > 0) && (
              <Seccion
                id="comprobacion" emoji="✅" titulo="Comprueba si entendiste"
                setRef={(el: any) => { sectionRefs.current['comprobacion'] = el; }}
                leida={leidas.has('comprobacion')}
                onToggleLeida={() => toggleLeida('comprobacion')}
                onGuardar={() => {
                  const items = analisis.preguntas_profesor?.length ? analisis.preguntas_profesor : (analisis.comprobacion?.length ? analisis.comprobacion : (analisis.autoevaluacion || []));
                  onGuardarApunte?.(`✅ Comprobación — ${analisis.titulo}`, items.map((q: any, i: number) => `P${i+1}: ${q.pregunta}\nRespuesta: ${q.respuesta_esperada}`).join('\n\n'));
                }}
              >
                {(analisis.preguntas_profesor?.length ? analisis.preguntas_profesor : (analisis.comprobacion?.length ? analisis.comprobacion : (analisis.autoevaluacion || []))).map((q: any, i) => (
                  <div key={i} style={{ ...conceptoCard, background: 'color-mix(in srgb, #c4b5fd 14%, var(--bg-card))', borderColor: '#7c3aed' }}>
                    <div style={{ fontFamily: BODY, fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                      Pregunta {i + 1}
                    </div>
                    {q.que_evalua && (
                      <div style={{ ...miniCard, background: 'transparent', borderColor: '#7c3aed55', marginBottom: 10 }}>
                        <strong style={miniLabel}>Qué evalúa:</strong> {q.que_evalua}
                      </div>
                    )}
                    <p style={parrafo}>{q.pregunta}</p>
                    <button
                      onClick={() => setShowCheckAnswers((prev) => ({ ...prev, [i]: !prev[i] }))}
                      style={{
                        background: showCheckAnswers[i] ? 'var(--gold)' : 'transparent',
                        color: 'var(--text-primary)',
                        border: '1.5px solid var(--text-primary)',
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontFamily: BODY,
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {showCheckAnswers[i] ? 'Ocultar respuesta' : 'Ver respuesta esperada'}
                    </button>
                    {showCheckAnswers[i] && (
                      <div style={{ ...miniCard, background: 'color-mix(in srgb, #84cc16 14%, var(--bg-card))', borderColor: '#65a30d' }}>
                        <strong style={miniLabel}>Respuesta esperada:</strong> {q.respuesta_esperada}
                      </div>
                    )}
                  </div>
                ))}
              </Seccion>
            )}

            {/* Ya puedes explicar */}
            {analisis.ya_puedes_explicar?.length ? (
              <Seccion
                id="explicar" emoji="🎓" titulo="Ya puedes explicarle esto a alguien"
                setRef={(el: any) => { sectionRefs.current['explicar'] = el; }}
                leida={leidas.has('explicar')}
                onToggleLeida={() => toggleLeida('explicar')}
                onGuardar={() => onGuardarApunte?.(`🎓 Ya puedes explicar — ${analisis.titulo}`, analisis.ya_puedes_explicar!.map((x, i) => `${i+1}. ${x}`).join('\n'))}
              >
                <ul style={{ paddingLeft: 24, margin: 0 }}>
                  {analisis.ya_puedes_explicar.map((x, i) => (
                    <li key={i} style={{ ...parrafo, marginBottom: 10 }}>{x}</li>
                  ))}
                </ul>
              </Seccion>
            ) : null}

            {/* Resumen final */}
            {(analisis.resumen_final_profesor || analisis.resumen_30s) && (
              <Seccion
                id="resumen-final" emoji="⚡" titulo="Resumen final"
                setRef={(el: any) => { sectionRefs.current['resumen-final'] = el; }}
                leida={leidas.has('resumen-final')}
                onToggleLeida={() => toggleLeida('resumen-final')}
                onGuardar={() => onGuardarApunte?.(`⚡ Resumen final — ${analisis.titulo}`, analisis.resumen_final_profesor || analisis.resumen_30s || '')}
              >
                <div>
                  {dedupeOraciones(String(analisis.resumen_final_profesor || analisis.resumen_30s || '')).split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/).map((s, i) => (
                    <p key={i} style={{ ...parrafo, fontSize: 17, fontWeight: i === 0 ? 700 : 500, marginBottom: 10 }}>{s.trim()}</p>
                  ))}
                </div>
              </Seccion>
            )}

            {/* Pregúntale a ALAI */}
            <Seccion
              id="preguntale" emoji="💬" titulo="Pregúntale a ALAI"
              setRef={(el: any) => { sectionRefs.current['preguntale'] = el; }}
              leida={leidas.has('preguntale')}
              onToggleLeida={() => toggleLeida('preguntale')}
            >
              <div style={{
                ...miniCard,
                background: 'linear-gradient(135deg, color-mix(in srgb, #f472b6 18%, var(--bg-card)), color-mix(in srgb, var(--gold) 14%, var(--bg-card)))',
                borderColor: '#f472b6',
                fontSize: 16,
              }}>
                <strong style={miniLabel}>💬 Duda abierta:</strong>{' '}
                {analisis.preguntale_alai || 'Puedes preguntarme cualquier duda sobre este material.'}
              </div>

              {analisis.preguntas_sugeridas?.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {analisis.preguntas_sugeridas.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setDudaInput(q)}
                      style={{
                        background: 'color-mix(in srgb, var(--gold) 16%, var(--bg-card))',
                        color: 'var(--text-primary)',
                        border: '1px solid color-mix(in srgb, var(--text-primary) 22%, transparent)',
                        borderRadius: 999,
                        padding: '7px 11px',
                        fontFamily: BODY,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="analysis-doubt-composer" style={{
                marginTop: 14,
                display: 'flex',
                gap: 10,
                alignItems: 'stretch',
              }}>
                <textarea
                  value={dudaInput}
                  onChange={(e) => setDudaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      preguntarDuda();
                    }
                  }}
                  placeholder="Escribe aquí tu duda sobre este material..."
                  style={{
                    flex: 1,
                    minHeight: 88,
                    resize: 'vertical',
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1.5px solid color-mix(in srgb, var(--text-primary) 25%, transparent)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    fontFamily: BODY,
                    fontSize: 15,
                    lineHeight: 1.5,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={preguntarDuda}
                  disabled={dudaLoading || !dudaInput.trim()}
                  style={{
                    minWidth: 150,
                    background: dudaLoading || !dudaInput.trim() ? 'var(--bg-card)' : 'var(--gold)',
                    color: dudaLoading || !dudaInput.trim() ? 'var(--text-muted)' : 'var(--text-primary)',
                    border: '2px solid var(--text-primary)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    fontFamily: BODY,
                    fontSize: 15,
                    fontWeight: 800,
                    cursor: dudaLoading || !dudaInput.trim() ? 'not-allowed' : 'pointer',
                    boxShadow: dudaLoading || !dudaInput.trim() ? 'none' : '3px 4px 0 var(--text-primary)',
                  }}
                >
                  {dudaLoading ? 'Pensando...' : 'Preguntar'}
                </button>
              </div>

              <div style={{
                marginTop: 8,
                fontFamily: BODY,
                fontSize: 13,
                color: 'var(--text-faint)',
              }}>
                Tip: Enter envía. Shift + Enter hace una nueva línea.
              </div>

              {dudaError && (
                <div style={{ ...miniCard, borderColor: '#dc2626', background: 'color-mix(in srgb, #dc2626 12%, var(--bg-card))' }}>
                  <strong style={miniLabel}>⚠️ Error:</strong> {dudaError}
                </div>
              )}

              {dudaRespuesta && (
                <div style={{ ...miniCard, borderColor: '#65a30d', background: 'color-mix(in srgb, #84cc16 14%, var(--bg-card))' }}>
                  <div style={{ fontFamily: BODY, fontSize: 17, fontWeight: 900, marginBottom: 8 }}>
                    👨‍🏫 ALAI responde
                  </div>
                  {renderAnswerBlocks(dudaRespuesta)}
                </div>
              )}
            </Seccion>

            {/* Footer */}
            <div style={{
              marginTop: 60, padding: '24px 0',
              borderTop: '1.5px dashed color-mix(in srgb, var(--text-primary) 20%, transparent)',
              textAlign: 'center',
              fontFamily: BODY, fontSize: 18, color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}>
              🎉 Clase terminada. Ahora puedes hacer preguntas, flashcards o un quiz. ✨
            </div>
          </div>
        </main>
      </div>

      <Styles />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════════════

function Seccion({ id, emoji, titulo, children, setRef, leida, onToggleLeida, onGuardar }: any) {
  return (
    <section
      ref={setRef}
      style={{
        position: 'relative',
        background: 'var(--bg-card)',
        border: '1.5px solid color-mix(in srgb, var(--text-primary) 20%, transparent)',
        borderRadius: 8,
        padding: '24px 28px',
        marginBottom: 32,
        boxShadow: '0 8px 20px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.15)',
        scrollMarginTop: 24,
      }}
    >
      {/* Cinta scotch arriba */}
      <div style={{
        position: 'absolute', top: -8, left: 28,
        width: 76, height: 14,
        background: leida ? 'rgba(245,200,66,0.7)' : 'rgba(245,245,240,0.65)',
        border: '1px solid rgba(0,0,0,0.12)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        transform: 'rotate(-3deg)',
      }} />

      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 18, paddingBottom: 12,
        borderBottom: '1.5px dashed color-mix(in srgb, var(--text-primary) 18%, transparent)',
      }}>
        <span style={{ fontSize: 32 }}>{emoji}</span>
        <h2 style={{
          fontFamily: HAND, fontSize: 32, fontWeight: 900,
          color: 'var(--text-primary)', margin: 0,
          letterSpacing: 0.3,
        }}>{titulo}</h2>
      </header>

      <div>{children}</div>

      {/* Botones de acción */}
      <div style={{
        display: 'flex', gap: 8, marginTop: 18,
        paddingTop: 14,
        borderTop: '1px dashed color-mix(in srgb, var(--text-primary) 14%, transparent)',
      }}>
        <button onClick={onToggleLeida} style={{
          background: leida ? 'var(--gold)' : 'transparent',
          color: leida ? 'var(--text-primary)' : 'var(--text-muted)',
          border: `1.5px solid ${leida ? 'var(--gold)' : 'var(--text-muted)'}`,
          padding: '6px 14px', borderRadius: 8,
          fontFamily: BODY, fontSize: 15, fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}>
          {leida ? '✅ leído' : '⬜ marcar leído'}
        </button>
        {onGuardar && (
          <button onClick={onGuardar} style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1.5px solid var(--text-muted)',
            padding: '6px 14px', borderRadius: 8,
            fontFamily: BODY, fontSize: 15, fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            📝 guardar como apunte
          </button>
        )}
      </div>
    </section>
  );
}

function BgCuaderno() {
  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: 'var(--bg-primary)',
      }} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1,
        backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', left: 80, top: 0, bottom: 0, width: 1.5,
        background: 'rgba(239,68,68,0.35)',
        zIndex: 1, pointerEvents: 'none',
      }} />
    </>
  );
}

function Styles() {
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes lupa {
          0%, 100% { transform: rotate(-8deg) scale(1); }
          50%      { transform: rotate(8deg) scale(1.15); }
        }
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
        @media (max-width: 640px) {
          .analysis-topbar { padding: 10px 12px !important; gap: 10px !important; }
          .analysis-topbar button { padding: 6px 10px !important; }
          .analysis-topbar h1 { font-size: 22px !important; }
          .analysis-progress { display: none !important; }
          .analysis-layout { top: 72px !important; min-width: 0 !important; }
          .analysis-sidebar { display: none !important; }
          .analysis-main { min-width: 0 !important; padding: 14px 12px 64px !important; overflow-x: hidden !important; }
          .analysis-main section { padding: 20px 16px !important; }
          .analysis-doubt-composer { flex-direction: column !important; }
          .analysis-doubt-composer button { width: 100% !important; }
          .analysis-doubt-composer textarea { min-width: 0 !important; width: 100% !important; box-sizing: border-box !important; }
        }
      `}</style>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// ESTILOS
// ═══════════════════════════════════════════════════════════════

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 99999,
  background: 'var(--bg-primary)',
  overflow: 'hidden',
  isolation: 'isolate',
};

const btnPrimario: React.CSSProperties = {
  background: 'var(--gold)', color: 'var(--text-primary)',
  border: '2px solid var(--text-primary)',
  padding: '10px 24px', borderRadius: 12,
  fontFamily: HAND, fontSize: 20, fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '3px 4px 0 var(--text-primary)',
};

const conceptoCard: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--text-primary) 4%, var(--bg-card))',
  border: '1.5px solid color-mix(in srgb, var(--text-primary) 15%, transparent)',
  borderRadius: 6,
  padding: '14px 16px',
  marginBottom: 16,
};

const miniCard: React.CSSProperties = {
  border: '1.5px solid',
  borderRadius: 5,
  padding: '10px 12px',
  marginTop: 8,
  fontFamily: BODY,
  fontSize: 15,
  lineHeight: 1.55,
  color: 'var(--text-primary)',
};

const miniLabel: React.CSSProperties = {
  fontFamily: HAND,
  fontSize: 16,
  fontWeight: 800,
  marginRight: 4,
};

const parrafo: React.CSSProperties = {
  fontFamily: BODY,
  fontSize: 16,
  lineHeight: 1.65,
  color: 'var(--text-primary)',
  margin: '0 0 12px',
};

const parrafoMini: React.CSSProperties = {
  fontFamily: BODY,
  fontSize: 15,
  lineHeight: 1.55,
  color: 'var(--text-primary)',
};
