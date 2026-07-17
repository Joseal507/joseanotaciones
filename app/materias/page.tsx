'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamicImport from 'next/dynamic';
import { getMaterias, saveMaterias, generateId, Materia, Tema, Apunte, Documento } from '../../lib/storage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
const MateriasList = dynamicImport(() => import('../../components/materias/MateriasList'));
const MateriaView = dynamicImport(() => import('../../components/materias/MateriaView'));
const TemaView = dynamicImport(() => import('../../components/materias/TemaView'));
const ApunteEditor = dynamicImport(() => import('../../components/materias/ApunteEditor'));
const DocumentoView = dynamicImport(() => import('../../components/materias/DocumentoView'));
const ALAIStudyALCards = dynamicImport(() => import('../../components/materias/ALAIStudyALCards'), { ssr: false });
const ALAIStudyALQuizzes = dynamicImport(() => import('../../components/materias/ALAIStudyALQuizzes'), { ssr: false });
const ALAIStudyALRepasar = dynamicImport(() => import('../../components/materias/ALAIStudyALRepasar'), { ssr: false });
const ALAIStudyALChat = dynamicImport(() => import('../../components/materias/ALAIStudyALChat'), { ssr: false });
const ALAIStudyALExams = dynamicImport(() => import('../../components/materias/ALAIStudyALExams'), { ssr: false });
const AnalisisTeorico = dynamicImport(() => import('../../components/materias/AnalisisTeorico'), { ssr: false });
const AdaptiveProductRealFixture = dynamicImport(() => import('../../components/materias/AdaptiveProductRealFixture'), { ssr: false });
const ModalMateria = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalMateria));
const ModalTema = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalTema));
const ModalApunte = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalApunte));
import Buscador from '../../components/Buscador';
import MaterialUploader from '../../components/materials/MaterialUploader';
import type { MaterialUI } from '../../lib/materials/types';
import {
  getMasteryStorageKey,
  loadMaterialMastery,
  saveMaterialMastery,
  createEmptyMastery,
  processEvent,
  calculateMasterySnapshot,
  buildMasteryContext,
  applyForgettingCurve,
  buildSessionSummary,
  type MaterialMastery,
  type MasteryEvent,
  type MasterySnapshot,
  type MasteryContext,
  type SessionSummary,
} from '../../lib/masteryEngine';

type Vista = 'materias' | 'materia' | 'tema' | 'apunte' | 'documento' | 'flashcards' | 'quiz' | 'repasar' | 'analisis' | 'alai' | 'exam';

export default function MateriasPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [vista, setVista] = useState<'lista' | 'materia' | 'materias' | 'apunte' | 'tema' | 'documento' | 'flashcards' | 'quiz' | 'repasar' | 'analisis' | 'alai' | 'exam'>(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('open')) return 'materia';
    }
    return 'lista';
  });
  const [materiaActual, setMateriaActual] = useState<Materia | null>(null);
  const [temaActual, setTemaActual] = useState<Tema | null>(null);
  const [flashcardsMateriales, setFlashcardsMateriales] = useState<any[]>([]);
  const [flashcardsSeleccion, setFlashcardsSeleccion] = useState<any[] | null>(null);
  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);
  const [quizMateriales, setQuizMateriales]   = useState<any[]>([]);
  const [quizSeleccion,  setQuizSeleccion]    = useState<any[] | undefined>(undefined);
  const [repasarMateriales, setRepasarMateriales] = useState<any[]>([]);
  const [repasarSeleccion, setRepasarSeleccion] = useState<any[] | null>(null);
  const [analisisMateriales, setAnalisisMateriales] = useState<any[]>([]);
  const [analisisSeleccion, setAnalisisSeleccion] = useState<any[] | null>(null);
  const [alaiMateriales, setAlaiMateriales] = useState<any[]>([]);
  const [alaiSeleccion, setAlaiSeleccion] = useState<any[] | null>(null);
  const [examMateriales, setExamMateriales] = useState<any[]>([]);
  const [examSeleccion, setExamSeleccion] = useState<any[] | null>(null);
  const [returnToEnfoque, setReturnToEnfoque] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);

  // ── Auto-inicializar mastery cuando hay tema activo ──
  // Se ejecuta cuando el usuario entra a un tema que tiene documentos
  // No espera a que abra ninguna herramienta
  useEffect(() => {
    if (!temaActual?.documentos?.length) return;
    if (vista !== 'tema') return;

    const docs = temaActual.documentos;
    const ids = docs
      .map((d: any) => String(d?.materialId || d?.id || ''))
      .filter(Boolean);

    if (!ids.length) return;

    // Solo inicializar si no hay mastery activo o es de otro tema
    const currentKey = getMasteryStorageKey(ids);
    if (masteryState?.sessionKey === currentKey) return;

    const names = docs.map((d: any) => d?.nombre || d?.name || 'Material');
    initMastery(ids, names);
  }, [temaActual?.id, vista]);

  // ── Mastery Engine — vive aquí, persiste entre vistas ──
  const [masteryState, setMasteryState] = useState<MaterialMastery | null>(null);
  const [masterySnapshot, setMasterySnapshot] = useState<MasterySnapshot | null>(null);

  // Auto-extraer conceptos en background cuando el mastery existe pero no tiene conceptos
  const autoExtractConcepts = async (mastery: MaterialMastery) => {
    if (!mastery || mastery.conceptsExtracted || mastery.concepts.length > 0) return;
    if (!mastery.materialId && !mastery.sessionKey) return;

    try {
      const materialIds = mastery.sessionKey
        .replace('studyal_mastery_v1_', '')
        .split('-')
        .filter(Boolean);

      if (!materialIds.length) return;

      console.log('%c🧠 Mastery: extrayendo conceptos en background...', 'background:#a78bfa;color:#000;padding:2px 6px;border-radius:4px;font-weight:900');

      // 1. Cargar texto
      const res = await fetch('/api/enfoques/teorico/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ materialIds }),
      });
      const data = await res.json();
      if (!data.materials) return;

      const fullText = Object.entries(data.materials)
        .map(([id, m]: [string, any]) => (m.text || '').trim())
        .filter(Boolean)
        .join('\n\n---\n\n');

      if (!fullText.trim()) return;

      // 2. Extraer conceptos
      const extractRes = await fetch('/api/mastery/extract-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialText: fullText.slice(0, 25000),
          materialId: materialIds[0],
          tema: temaActual?.nombre || '',
          materia: materiaActual?.nombre || '',
        }),
      });

      const extractData = await extractRes.json();
      if (!extractData.success || !extractData.concepts?.length) return;

      const extractedConcepts = extractData.concepts;
      console.log(
        '%c✅ Mastery: conceptos extraídos automáticamente',
        'background:#4ade80;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
        extractedConcepts
      );

      const newConcepts = extractedConcepts.map((name: string) => ({
        id: name.toLowerCase().replace(/\s+/g, '_').slice(0, 50),
        name,
        materialId: materialIds[0],
        understanding: 0, memory: 0, application: 0,
        explanation: 0, exam: 0, confidence: 0,
        speed: 0, stability: 0, attempts: 0, mistakes: 0,
        lastReviewed: null, previousScores: [],
        forgettingRisk: 'very_high' as const,
        recommendedAction: 'Empieza con Repasar.',
        recommendedTool: 'repasar' as const,
      }));

      setMasteryState(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          concepts: newConcepts,
          conceptsExtracted: true,
          lastUpdated: Date.now(),
        };
        saveMaterialMastery(updated);
        setMasterySnapshot(calculateMasterySnapshot(updated));
        return updated;
      });

      // Extraer Knowledge Graph en background (no bloquea)
      setTimeout(async () => {
        try {
          const graphRes = await fetch('/api/mastery/extract-graph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              materialText: fullText.slice(0, 12000),
              concepts: extractedConcepts,
              materialId: materialIds[0],
              tema: temaActual?.nombre || '',
              materia: materiaActual?.nombre || '',
            }),
          });
          const graphData = await graphRes.json();
          if (graphData.success && graphData.relations?.length) {
            console.log(
              '%c🕸️ Knowledge Graph extraído',
              'background:#a78bfa;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
              graphData.relations.length, 'relaciones'
            );
            setMasteryState(prev => {
              if (!prev) return prev;
              const withGraph = {
                ...prev,
                knowledgeGraph: {
                  concepts: extractedConcepts,
                  relations: graphData.relations,
                },
                lastUpdated: Date.now(),
              };
              saveMaterialMastery(withGraph);
              return withGraph;
            });
          }
        } catch (e) {
          console.warn('Knowledge Graph extraction failed:', e);
        }
      }, 2000);

    } catch (err) {
      console.warn('Mastery auto-extract error:', err);
    }
  };

  // Inicializar/actualizar mastery cuando cambian los materiales seleccionados
  const initMastery = (materialIds: string[], materialNames: string[]) => {
    if (!materialIds.length) return;
    const sessionKey = getMasteryStorageKey(materialIds);
    const loaded = loadMaterialMastery(sessionKey);

    // Aplicar curva de olvido al cargar (actualiza valores según tiempo transcurrido)
    const mastery = loaded
      ? applyForgettingCurve(loaded)
      : createEmptyMastery({ materialIds, materialNames, sessionKey });

    setMasteryState(mastery);
    setMasterySnapshot(calculateMasterySnapshot(mastery));

    // Guardar el estado con el olvido aplicado
    if (loaded) saveMaterialMastery(mastery);

    // Auto-extraer conceptos si no los tiene
    if (!mastery.conceptsExtracted && !mastery.concepts.length) {
      setTimeout(() => autoExtractConcepts(mastery), 500);
    }
  };

  // Construir contexto de mastery para pasarlo a las herramientas
  const getMasteryContext = (): MasteryContext | null => {
    return buildMasteryContext(masteryState);
  };

  // Extraer conceptos débiles del estado actual para pasarlos a las herramientas
  const getWeakConcepts = (): string[] => {
    if (!masteryState?.concepts?.length) return [];
    return masteryState.concepts
      .filter((c: any) => {
        const score = (c.understanding * 0.25 + c.memory * 0.20 +
          c.application * 0.20 + c.explanation * 0.15 + c.exam * 0.20);
        const name = c.name || '';
        // Solo conceptos reales (no preguntas)
        if (name.includes('?') || name.length > 60) return false;
        return score < 50;
      })
      .sort((a: any, b: any) => {
        const scoreA = a.understanding * 0.25 + a.memory * 0.20 + a.application * 0.20;
        const scoreB = b.understanding * 0.25 + b.memory * 0.20 + b.application * 0.20;
        return scoreA - scoreB;
      })
      .map((c: any) => c.name)
      .slice(0, 8);
  };

  // Función que reciben todas las herramientas para reportar eventos
  const reportMasteryEvent = (event: Omit<MasteryEvent, 'sessionKey'>) => {
    setMasteryState(prev => {
      if (!prev) return prev;
      const fullEvent: MasteryEvent = {
        ...event,
        sessionKey: prev.sessionKey,
        timestamp: Date.now(),
      };
      const before = prev;
      const updated = processEvent(prev, fullEvent);
      saveMaterialMastery(updated);
      const snap = calculateMasterySnapshot(updated);
      setMasterySnapshot(snap);

      // Generar session summary SOLO en modo adaptativo
      // Nunca aparece en modo libre (los eventos del modo libre traen freeModeUse: true)
      // En modo libre el dominio se ve en el sidebar sin interrupciones
      const isFreeMode = (event as any).freeModeUse === true || updated.processMode === 'free';
      if (
        event.score !== undefined &&
        event.score >= 0 &&
        updated.concepts.length > 0 &&
        !isFreeMode
      ) {
        const summary = buildSessionSummary(before, updated, event.tool);
        setSessionSummary(summary);
        setSummaryVisible(true);
      }

      console.log(
        '%c📈 Mastery Event CENTRAL',
        'background:#d6b26f;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
        event.tool,
        '| score:', event.score ?? '—',
        '| concepts:', event.conceptsIdentified?.length || 0,
        '| overall:', snap.overallMastery,
      );
      return updated;
    });
  };

  const normalizePages = (value: any): number[] => {
    if (Array.isArray(value)) {
      return Array.from(new Set(
        value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      )).sort((a: number, b: number) => a - b);
    }

    if (value && typeof value === 'object') {
      const start = Number(value.start || value.from || value.startPage);
      const end = Number(value.end || value.to || value.endPage);
      if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
    }

    return [];
  };

  const normalizeSeleccionForFlashcards = (rawSel: any[] | null | undefined, mats: any[]) => {
    if (!Array.isArray(rawSel) || rawSel.length === 0) return null;

    const getIds = (item: any): string[] => {
      const nested =
        item?.material ||
        item?.documento ||
        item?.doc ||
        item?.source ||
        item?.file ||
        null;

      return [
        item?.materialId,
        item?.material_id,
        item?.documentId,
        item?.document_id,
        item?.docId,
        item?.doc_id,
        item?.id,
        nested?.materialId,
        nested?.material_id,
        nested?.id,
      ]
        .filter(Boolean)
        .map((v: any) => String(v));
    };

    const normalized = (mats || [])
      .map((mat: any, index: number) => {
        const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
        const matDocumentId = String(mat?.id || '');

        const byMaterialIndex =
          rawSel.find((item: any) => Number(item?.materialIndex) === index) || null;

        const byId =
          rawSel.find((item: any) => {
            const ids = getIds(item);
            return ids.includes(matMaterialId) || ids.includes(matDocumentId);
          }) || null;

        const item: any = byMaterialIndex ?? byId ?? rawSel[index] ?? null;
        if (!item) return null;

        const pages = [
          item?.pages,
          item?.selectedPages,
          item?.paginasSeleccionadas,
          item?.paginas,
          item?.pageNumbers,
          item?.range,
          item?.selection,
        ]
          .map(normalizePages)
          .find((arr: any) => Array.isArray(arr) && arr.length > 0) || [];

        const text =
          item?.text ||
          item?.texto ||
          item?.selectedText ||
          item?.content ||
          item?.contenido ||
          item?.extractedText ||
          item?.rawText ||
          item?.extract ||
          item?.selected?.text ||
          undefined;

        if (!pages.length && !text) return null;

        return {
          materialId: matMaterialId,
          documentId: matDocumentId,
          materialIndex: index,
          pages,
          text,
        };
      })
      .filter(Boolean);

    console.log('🧩 Flashcards selección RAW:', rawSel);
    console.log('✅ Flashcards selección NORMALIZADA:', normalized);

    return normalized.length ? normalized : null;
  };
  const [apunteActual, setApunteActual] = useState<Apunte | null>(null);
  const [documentoActual, setDocumentoActual] = useState<Documento | null>(null);
  const [modalMateria, setModalMateria] = useState(false);
  const [modalTema, setModalTema] = useState(false);
  const [modalApunte, setModalApunte] = useState(false);
  const [subiendoDoc, setSubiendoDoc] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [showBuscador, setShowBuscador] = useState(false);
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const openParam = searchParams?.get('open') || '';
  const { tr, idioma } = useIdioma();

  useEffect(() => {
    const cargar = async () => {
      if (new URLSearchParams(window.location.search).get('adaptive-product-real') === '1') {
        setCargando(false);
        return;
      }
      setCargando(true);
      try {
        const materiasLocal = getMaterias();
        if (materiasLocal.length > 0) {
          setMaterias(materiasLocal);

          const openIdLocal = openParam || localStorage.getItem('josea_open_materia');
          if (openIdLocal) {
            const matLocal = materiasLocal.find((m: any) => String(m.id) === String(openIdLocal));
            if (matLocal) {
              setMateriaActual(matLocal);
              setVista(prev => (
                ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                  ? prev
                  : 'materia'
              ));
              localStorage.removeItem('josea_open_materia');
            } else {
              setVista(prev => (
                ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                  ? prev
                  : 'materias'
              ));
            }
          } else {
            setVista(prev => (
              ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                ? prev
                : 'materias'
            ));
          }

          setCargando(false);
        }

        if (status === 'loading') return;

        const nextUser = session?.user as any;
        if (!nextUser?.id) {
          router.push('/auth');
          return;
        }

        const uid = nextUser.id;
        setUserId(uid);

        const lastUserId = localStorage.getItem('josea_last_user');
        if (lastUserId !== uid) {
          localStorage.setItem('josea_last_user', uid);
          localStorage.removeItem('josea_perfil');
          localStorage.removeItem('josea_asignaciones');
          localStorage.removeItem('josea_objetivos');
        }

        const res = await fetch('/api/materias', {

        });
        const data = await res.json();

        if (data.success && data.materias.length > 0) {
          setMaterias(data.materias);
          saveMaterias(data.materias);
          // Auto-abrir materia si viene del home (URL param o localStorage)
          try {
            const openId = openParam || localStorage.getItem('josea_open_materia');
            if (openId) {
              const allMaterias = data.materias?.length ? data.materias : materiasLocal;
              const mat = allMaterias.find((m: any) => m.id === openId);
              if (mat) {
                setMateriaActual(mat);
                setVista(prev => (
                  ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                    ? prev
                    : 'materia'
                ));
              } else {
                setVista(prev => (
                  ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'tema', 'apunte', 'documento'].includes(prev)
                    ? prev
                    : 'materias'
                ));
              }
              localStorage.removeItem('josea_open_materia');
            }
          } catch {}
        } else if (materiasLocal.length > 0) {
          await fetch('/api/materias', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ materias: materiasLocal }),
          });
        } else {
          await new Promise(r => setTimeout(r, 2000));
          const res2 = await fetch('/api/materias', {

          });
          const data2 = await res2.json();
          if (data2.success && data2.materias.length > 0) {
            setMaterias(data2.materias);
            saveMaterias(data2.materias);
          }
        }
      } catch (err) {
        console.error(err);
        const materiasLocal = getMaterias();
        if (materiasLocal.length > 0) setMaterias(materiasLocal);
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, [status, session, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowBuscador(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const save = (m: Materia[]) => {
    setMaterias(m);
    saveMaterias(m);
  };

  const actualizarMateria = (materia: Materia) => {
    const nuevas = materias.map(m => m.id === materia.id ? materia : m);
    save(nuevas);
    setMateriaActual(materia);
  };

  const actualizarTema = (tema: Tema) => {
    if (!materiaActual) return;
    const nuevaMateria = {
      ...materiaActual,
      temas: materiaActual.temas.map(t => t.id === tema.id ? tema : t),
    };
    actualizarMateria(nuevaMateria);
    setTemaActual(tema);
  };

  const actualizarDocumento = (doc: Documento) => {
    if (!temaActual) return;
    const nuevoTema = {
      ...temaActual,
      documentos: temaActual.documentos.map(d => d.id === doc.id ? doc : d),
    };
    actualizarTema(nuevoTema);
    setDocumentoActual(doc);
  };

  const crearMateria = (data: { nombre: string; color: string; emoji: string }) => {
    const nueva: Materia = {
      id: generateId(),
      nombre: data.nombre,
      color: data.color,
      emoji: data.emoji,
      temas: [],
    };
    save([...materias, nueva]);
    setModalMateria(false);
  };

  const eliminarMateria = (id: string) => {
    if (!confirm(idioma === 'en'
      ? 'Delete this subject and all its content?'
      : '¿Eliminar esta materia y todo su contenido?')) return;
    save(materias.filter(m => m.id !== id));
  };

  const crearTema = (data: { nombre: string; color: string }) => {
    if (!materiaActual) return;
    const nuevo: Tema = {
      id: generateId(),
      nombre: data.nombre,
      color: data.color,
      apuntes: [],
      documentos: [],
    };
    actualizarMateria({ ...materiaActual, temas: [...materiaActual.temas, nuevo] });
    setModalTema(false);
  };

  const eliminarTema = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this topic?' : '¿Eliminar este tema?')) return;
    if (!materiaActual) return;
    actualizarMateria({
      ...materiaActual,
      temas: materiaActual.temas.filter(t => t.id !== id),
    });
  };

  const crearApunte = (data: { titulo: string; paperColor?: string; paperStyle?: string; paperSize?: string; scrollDirection?: 'vertical' | 'horizontal' }) => {
    if (!temaActual) return;
    // Guardar config del papel en el contenido inicial
    const paperConfig = {
      paperColor: data.paperColor || 'white',
      paperStyle: data.paperStyle || 'lined',
      paperSize: data.paperSize || 'normal',
      scrollDirection: data.scrollDirection || 'vertical',
    };
    const nuevo: Apunte = {
      id: generateId(),
      titulo: data.titulo,
      contenido: JSON.stringify({ paginas: [{ bloques: [], canvasData: null }], paperConfig }),
      fechaCreacion: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
      fechaModificacion: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
    };
    const nuevoTema = { ...temaActual, apuntes: [...temaActual.apuntes, nuevo] };
    actualizarTema(nuevoTema);
    setApunteActual(nuevo);
    setModalApunte(false);
    setVista('apunte');
  };

  const guardarApunte = (contenido: string) => {
    if (!apunteActual || !temaActual) return;
    const updated: Apunte = {
      ...apunteActual,
      contenido,
      fechaModificacion: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
    };
    const nuevoTema = {
      ...temaActual,
      apuntes: temaActual.apuntes.map(a => a.id === updated.id ? updated : a),
    };
    actualizarTema(nuevoTema);
    setApunteActual(updated);
  };

  const eliminarApunte = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this note?' : '¿Eliminar este apunte?')) return;
    if (!temaActual) return;
    actualizarTema({
      ...temaActual,
      apuntes: temaActual.apuntes.filter(a => a.id !== id),
    });
    setVista('tema');
  };

  // ─── Nuevo sistema: abrir el uploader modal ───
  const subirDocumento = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    setShowUploader(true);
  };

  // ─── Cuando el uploader termina, agregar al tema ───
  const handleUploadComplete = (newMaterials: MaterialUI[]) => {
    if (!temaActual) return;
    const nuevosDocumentos = newMaterials.map(m => ({
      id: m.id,
      nombre: m.nombre,
      contenido: '',
      tipo: m.kind === 'image' ? 'imagen'
        : m.kind === 'docx' ? 'word'
        : m.kind === 'pptx' ? 'ppt'
        : m.kind === 'audio' ? 'audio'
        : m.kind,
      fechaSubida: new Date().toLocaleDateString('es-ES'),
      archivoUrl: undefined,
      archivoMime: undefined,
      materialId: m.id,
      text_status: m.text_status,
    }));
    actualizarTema({
      ...temaActual,
      documentos: [...temaActual.documentos, ...nuevosDocumentos],
    });
    setShowUploader(false);
  };

// Guardar video YouTube en el tema actual
const agregarYoutube = (doc: Documento) => {
  if (!temaActual) return;
  actualizarTema({ ...temaActual, documentos: [...temaActual.documentos, doc] });
};

// DESPUÉS ✅
const eliminarDocumento = async (id: string) => {
  // Sin confirm() nativo - TemaView tiene su propio modal de confirmación
  if (!temaActual) return;

  // Limpiar selecciones guardadas en localStorage para este material
  try {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith('josea_seleccion_') && k.includes(temaActual.id)) {
        const data = localStorage.getItem(k);
        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (parsed[id]) {
              delete parsed[id];
              if (Object.keys(parsed).length === 0) {
                localStorage.removeItem(k);
              } else {
                localStorage.setItem(k, JSON.stringify(parsed));
              }
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('Error limpiando selección:', e);
  }

  const doc = temaActual.documentos.find(d => d.id === id);

  // ─── Nuevo sistema: borrar por materialId ───
  const materialId = (doc as any)?.materialId;
  if (materialId) {
    try {
      await fetch(`/api/materials/${materialId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch (e) {
      console.warn('Error borrando material nuevo:', e);
    }
  }
  // ─── Sistema viejo: borrar por archivoUrl ───
  else if (doc?.archivoUrl && doc.archivoUrl.startsWith('http')) {
    try {
      await fetch('/api/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivoUrl: doc.archivoUrl }),
      });
    } catch (e) {
      console.warn('Error borrando archivo viejo:', e);
    }
  }

  // Actualizar estado local inmediatamente (sin stale closure)
  // Usar función callback para garantizar que lee el estado más reciente
  // Capturar IDs en el momento del cierre (no son stale)
  const temaId = temaActual?.id;
  const materiaId = materiaActual?.id;

  setMaterias(prevMaterias => {
    const nuevas = prevMaterias.map(m => {
      if (!temaId || m.id !== materiaId) return m;
      return {
        ...m,
        temas: m.temas.map(t => {
          if (t.id !== temaId) return t;
          return {
            ...t,
            documentos: t.documentos.filter((d: any) => d.id !== id),
          };
        }),
      };
    });
    saveMaterias(nuevas);
    return nuevas;
  });

  // Actualizar temaActual y materiaActual FUERA del callback de setMaterias
  setTemaActual(prev => {
    if (!prev || prev.id !== temaId) return prev;
    return {
      ...prev,
      documentos: prev.documentos.filter((d: any) => d.id !== id),
    };
  });
  setMateriaActual(prev => {
    if (!prev || prev.id !== materiaId) return prev;
    return {
      ...prev,
      temas: prev.temas.map((t: any) => {
        if (t.id !== temaId) return t;
        return {
          ...t,
          documentos: t.documentos.filter((d: any) => d.id !== id),
        };
      }),
    };
  });
};

  const reordenarMaterias = (nuevasMaterias: Materia[]) => {
    setMaterias(nuevasMaterias);
    saveMaterias(nuevasMaterias);
  };

  const editarMateria = (materiaEditada: Materia) => {
    const nuevas = materias.map(m => m.id === materiaEditada.id ? materiaEditada : m);
    setMaterias(nuevas);
    saveMaterias(nuevas);
    if (materiaActual?.id === materiaEditada.id) setMateriaActual(materiaEditada);
  };

  useEffect(() => {
    if (cargando) return;

    // Nunca cambiar vista durante render. Este guard solo corrige estados rotos.
    if (['exam', 'flashcards', 'quiz', 'repasar', 'analisis', 'alai'].includes(vista)) return;

    if (vista === 'materia' && !materiaActual) {
      try { window.history.replaceState(null, '', '/materias'); } catch {}
      setVista('materias');
      return;
    }

    // Si se pierde el tema pero todavía existe materia, vuelve a la materia,
    // no al listado completo. Evita que un enfoque abierto bote al usuario.
    if (vista === 'tema' && materiaActual && !temaActual) {
      setVista('materia');
      return;
    }
  }, [cargando, vista, materiaActual, temaActual]);

  if (searchParams?.get('adaptive-product-real') === '1') {
    return <AdaptiveProductRealFixture />;
  }

  if (cargando) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ fontSize: 56, animation: 'matBounce 1.2s ease-in-out infinite' }}>📚</div>
        <p style={{
          fontFamily: "'Caveat',cursive", fontSize: 22, fontStyle: 'italic',
          color: 'var(--text-muted)', margin: 0,
        }}>
          ~ {openParam ? 'abriendo materia' : tr('cargando')} ~
        </p>
        <style>{`
          @keyframes matBounce {
            0%, 100% { transform: rotate(-5deg) translateY(0); }
            50% { transform: rotate(5deg) translateY(-8px); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}

      {isMobile ? (
        <NavbarMobile />
      ) : (
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 40px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const fallback = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(fallback), 750); }
                catch { clearTimeout(fallback); window.location.href = '/'; }
              }}
                style={{
                  background: 'none',
                  border: '2px solid var(--gold)',
                  color: 'var(--gold)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                ← {tr('inicio')}
              </button>
              <button
                onClick={() => setShowBuscador(true)}
                style={{
                  background: 'none',
                  border: '2px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                🔍 {tr('buscar')}
                <span style={{
                  fontSize: '11px',
                  background: 'var(--bg-secondary)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}>⌘K</span>
              </button>
            </div>
            {userId && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-faint)',
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#4ade80',
                }} />
                {tr('sincronizado')}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: isMobile ? '16px' : '0 40px 40px' }}>

        {(vista === 'lista' || vista === 'materias') && (
          <MateriasList
            materias={materias}
            onAbrir={(m: any) => { setMateriaActual(m); setVista('materia'); }}
            onEliminar={eliminarMateria}
            onNueva={() => setModalMateria(true)}
            onReordenar={reordenarMaterias}
            onEditar={editarMateria}
          />
        )}

        {vista === 'materia' && materiaActual && (
          <MateriaView
            materia={materiaActual}
            onBack={() => setVista('materias')}
            onAbrirTema={(t: any) => { setTemaActual(t); setVista('tema'); }}
            onEliminarTema={eliminarTema}
            onNuevoTema={() => setModalTema(true)}
            onActualizarMateria={actualizarMateria}
          />
        )}

        {vista === 'tema' && temaActual && materiaActual && (
          <TemaView
            userId={userId}
            materia={materiaActual}
            tema={temaActual}
            onBack={() => setVista('materias')}
            onBackMateria={() => setVista('materia')}
            onGoHome={() => ((window as any).__showNavLoader?.('/'), router.push('/'))}
            onAbrirApunte={(a: any) => { setApunteActual(a); setVista('apunte'); }}
            onAbrirDocumento={(d: any) => { setDocumentoActual(d); setVista('documento'); }}
            onEliminarApunte={eliminarApunte}
            onEliminarDocumento={eliminarDocumento}
            onNuevoApunte={() => setModalApunte(true)}
            onSubirDocumento={subirDocumento}
            subiendoDoc={subiendoDoc}
            onAbrirUploader={() => setShowUploader(true)}
            returnToEnfoque={returnToEnfoque}
            onClearReturnToEnfoque={() => setReturnToEnfoque(false)}
            onOpenFlashcards={(mats?: any[], sel?: any[], sessionId?: string | null) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);

              console.log('📘 Materiales para flashcards:', matsToUse);
              console.log('📑 Selección usada por flashcards:', normalizedSel);

              setFlashcardsMateriales(matsToUse);
              setFlashcardsSeleccion(normalizedSel);
              setFlashcardsSessionId(sessionId || null);
              // Inicializar mastery
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVista('flashcards');
            }}
            onOpenQuiz={(mats?: any[], sel?: any[]) => {
              const matsToUse = mats || temaActual?.documentos || [];
              setQuizMateriales(matsToUse);
              setQuizSeleccion(sel);
              // Inicializar mastery
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVista('quiz');
            }}
            onOpenRepasar={(mats?: any[], sel?: any[]) => {
              const matsToUse = mats || temaActual?.documentos || [];
              setRepasarMateriales(matsToUse);
              setRepasarSeleccion(Array.isArray(sel) && sel.length ? sel : null);
              // Inicializar mastery con estos materiales
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVista('repasar');
            }}
            onOpenAnalisis={(mats?: any[], sel?: any[]) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);
              setAnalisisMateriales(matsToUse);
              setAnalisisSeleccion(normalizedSel);
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVista('analisis');
            }}
            onOpenAlai={(mats?: any[], sel?: any[]) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);
              setAlaiMateriales(matsToUse);
              setAlaiSeleccion(normalizedSel);
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVista('alai');
            }}
            onOpenExam={(mats?: any[], sel?: any[]) => {
              const matsToUse = mats || temaActual?.documentos || [];
              const normalizedSel = normalizeSeleccionForFlashcards(sel || null, matsToUse);
              setExamMateriales(matsToUse);
              setExamSeleccion(normalizedSel);
              // Inicializar mastery
              const ids = matsToUse.map((m: any) => String(m?.materialId || m?.id || '')).filter(Boolean);
              const names = matsToUse.map((m: any) => m?.nombre || m?.name || 'Material');
              initMastery(ids, names);
              setVista('exam');
            }}
            onAgregarYoutube={agregarYoutube}
            masteryState={masteryState}
            masterySnapshot={masterySnapshot}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onInitMastery={initMastery}
          />
        )}

        {vista === 'apunte' && apunteActual && materiaActual && temaActual && (
          <ApunteEditor
            apunte={apunteActual}
            materia={materiaActual}
            tema={temaActual}
            onBack={() => setVista('materias')}
            onBackMateria={() => setVista('materia')}
            onBackTema={() => setVista('tema')}
            onGuardar={guardarApunte}
          />
        )}

        {vista === 'flashcards' && temaActual && materiaActual && (
          <ALAIStudyALCards
            materiales={flashcardsMateriales.length > 0 ? flashcardsMateriales : temaActual.documentos}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={flashcardsSessionId}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => {
              setReturnToEnfoque(true);
              requestAnimationFrame(() => {
                setVista('tema');
              });
            }}
          />
        )}

        {vista === 'quiz' && temaActual && materiaActual && (
          <ALAIStudyALQuizzes
            materiales={quizMateriales.length > 0 ? quizMateriales : temaActual.documentos}
            seleccion={quizSeleccion}
            tema={temaActual}
            materia={materiaActual}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => {
              setReturnToEnfoque(true);
              setQuizMateriales([]);
              setQuizSeleccion(undefined);
              requestAnimationFrame(() => {
                setVista('tema');
              });
            }}
          />
        )}

        {vista === 'repasar' && temaActual && materiaActual && (
          <ALAIStudyALRepasar
            materiales={repasarMateriales.length > 0 ? repasarMateriales : temaActual.documentos}
            seleccion={repasarSeleccion}
            tema={temaActual}
            materia={materiaActual}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => {
              setReturnToEnfoque(true);
              requestAnimationFrame(() => {
                setVista('tema');
              });
            }}
          />
        )}

        {vista === 'analisis' && temaActual && materiaActual && (
          <AnalisisTeorico
            materiales={analisisMateriales.length > 0 ? analisisMateriales : temaActual.documentos}
            seleccion={analisisSeleccion}
            tema={temaActual}
            materia={materiaActual}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onClose={() => {
              setReturnToEnfoque(true);
              requestAnimationFrame(() => {
                setVista('tema');
              });
            }}
          />
        )}

        {vista === 'alai' && temaActual && materiaActual && (
          <ALAIStudyALChat
            materiales={alaiMateriales.length > 0 ? alaiMateriales : temaActual.documentos}
            seleccion={alaiSeleccion}
            tema={temaActual}
            materia={materiaActual}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => {
              setReturnToEnfoque(true);
              requestAnimationFrame(() => {
                setVista('tema');
              });
            }}
          />
        )}


        {vista === 'exam' && temaActual && materiaActual && (
          <ALAIStudyALExams
            materiales={examMateriales.length > 0 ? examMateriales : temaActual.documentos}
            seleccion={examSeleccion}
            tema={temaActual}
            materia={materiaActual}
            userName={(session?.user as any)?.name || (session?.user as any)?.username || ''}
            masteryContext={getMasteryContext()}
            onMasteryEvent={reportMasteryEvent}
            onBack={() => {
              setReturnToEnfoque(true);
              requestAnimationFrame(() => {
                setVista('tema');
              });
            }}
          />
        )}

        {vista === 'documento' && documentoActual && materiaActual && temaActual && (
          <DocumentoView
            documento={documentoActual}
            materia={materiaActual}
            tema={temaActual}
            onBack={() => setVista('materias')}
            onBackMateria={() => setVista('materia')}
            onBackTema={() => setVista('tema')}
            onActualizar={actualizarDocumento}
          />
        )}

        {/* ─── Modal Upload nuevo sistema ─── */}
        {showUploader && temaActual && materiaActual && (
          <div
            onClick={() => setShowUploader(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 99999,
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <MaterialUploader
                temaId={temaActual.id}
                materiaId={materiaActual.id}
                onUploadComplete={handleUploadComplete}
                onClose={() => setShowUploader(false)}
              />
            </div>
          </div>
        )}

        {modalMateria && (
          <ModalMateria
            onClose={() => setModalMateria(false)}
            onConfirm={crearMateria}
          />
        )}
        {modalTema && materiaActual && (
          <ModalTema
            onClose={() => setModalTema(false)}
            onConfirm={crearTema}
            colorMateria={materiaActual.color}
          />
        )}
        {/* Session Summary Modal */}
        {summaryVisible && sessionSummary && (
          <div
            onClick={() => setSummaryVisible(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 99999,
              background: 'rgba(0,0,0,0.75)',
              backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: 'min(500px, 100%)',
                background: 'var(--bg-card)',
                border: '2px solid var(--gold)',
                borderRadius: 18,
                padding: 22,
                boxShadow: '0 24px 80px rgba(0,0,0,.5)',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--gold)', marginBottom: 4 }}>
                ✅ Sesión completada
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16, fontWeight: 700 }}>
                {sessionSummary.tool.toUpperCase()} · {new Date(sessionSummary.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
              </div>

              {Object.keys(sessionSummary.dimensionGains).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    LO QUE SUBIÓ HOY
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {Object.entries(sessionSummary.dimensionGains).map(([dim, gain]) => {
                      if (!gain || gain <= 0) return null;
                      const dimLabels: any = { understanding: 'Comprensión', memory: 'Memoria', application: 'Aplicación', explanation: 'Explicación', exam: 'Examen' };
                      return (
                        <div key={dim} style={{
                          padding: '5px 10px', borderRadius: 20,
                          background: 'rgba(74,222,128,0.12)',
                          border: '1px solid rgba(74,222,128,0.3)',
                          fontSize: 11, fontWeight: 800, color: '#4ade80',
                        }}>
                          {dimLabels[dim]} +{gain}%
                        </div>
                      );
                    })}
                    {sessionSummary.overallGain > 0 && (
                      <div style={{
                        padding: '5px 10px', borderRadius: 20,
                        background: 'rgba(214,178,111,0.15)',
                        border: '1px solid rgba(214,178,111,0.4)',
                        fontSize: 11, fontWeight: 900, color: 'var(--gold)',
                      }}>
                        Dominio total +{sessionSummary.overallGain}%
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sessionSummary.conceptsImproved.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    CONCEPTOS QUE MEJORARON
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {sessionSummary.conceptsImproved.map(c => (
                      <span key={c} style={{
                        padding: '4px 9px', borderRadius: 20,
                        background: 'rgba(74,222,128,0.08)',
                        border: '1px solid rgba(74,222,128,0.25)',
                        fontSize: 11, fontWeight: 700, color: '#4ade80',
                      }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {sessionSummary.conceptsStillWeak.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    TODAVÍA REQUIERE TRABAJO
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {sessionSummary.conceptsStillWeak.map(c => (
                      <span key={c} style={{
                        padding: '4px 9px', borderRadius: 20,
                        background: 'rgba(249,115,22,0.08)',
                        border: '1px solid rgba(249,115,22,0.25)',
                        fontSize: 11, fontWeight: 700, color: '#f97316',
                      }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{
                padding: '10px 14px', borderRadius: 10,
                background: 'rgba(214,178,111,0.08)',
                border: '1px solid rgba(214,178,111,0.25)',
                marginBottom: 16,
                fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45,
              }}>
                <strong style={{ color: 'var(--gold)', fontWeight: 900 }}>Siguiente paso: </strong>
                {sessionSummary.nextRecommendedTool.toUpperCase()}
                {sessionSummary.nextRecommendedConcept && ` · enfócate en "${sessionSummary.nextRecommendedConcept}"`}
              </div>

              <button
                onClick={() => setSummaryVisible(false)}
                style={{
                  width: '100%', padding: '12px',
                  borderRadius: 12, border: '2px solid var(--gold)',
                  background: 'var(--gold)', color: '#111',
                  fontWeight: 900, fontSize: 14, cursor: 'pointer',
                }}
              >
                Continuar →
              </button>
            </div>
          </div>
        )}

        {modalApunte && temaActual && (
          <ModalApunte
            onClose={() => setModalApunte(false)}
            onConfirm={crearApunte}
            colorTema={temaActual.color}
          />
        )}
      </div>
    </div>
  );
}
