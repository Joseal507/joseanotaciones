'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { getMaterias, saveMaterias, generateId, Materia, Tema, Apunte, Documento } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
const MateriasList = dynamicImport(() => import('../../components/materias/MateriasList'));
const MateriaView = dynamicImport(() => import('../../components/materias/MateriaView'));
const TemaView = dynamicImport(() => import('../../components/materias/TemaView'));
const ApunteEditor = dynamicImport(() => import('../../components/materias/ApunteEditor'));
const DocumentoView = dynamicImport(() => import('../../components/materias/DocumentoView'));
const FlashcardsPage = dynamicImport(() => import('../../components/materias/FlashcardsPage'), { ssr: false });
const QuizPage = dynamicImport(() => import('../../components/materias/QuizPage'), { ssr: false });
const RepasarWorkspace = dynamicImport(() => import('../../components/materias/RepasarWorkspace'), { ssr: false });
const ModalMateria = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalMateria));
const ModalTema = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalTema));
const ModalApunte = dynamicImport(() => import('../../components/materias/Modales').then(mod => mod.ModalApunte));
import Buscador from '../../components/Buscador';
import MaterialUploader from '../../components/materials/MaterialUploader';
import type { MaterialUI } from '../../lib/materials/types';

type Vista = 'materias' | 'materia' | 'tema' | 'apunte' | 'documento' | 'flashcards' | 'quiz' | 'repasar';

export default function MateriasPage() {
  const router = useRouter();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [vista, setVista] = useState<'lista' | 'materia' | 'materias' | 'apunte' | 'tema' | 'documento' | 'flashcards' | 'quiz' | 'repasar'>(() => {
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
  const [returnToEnfoque, setReturnToEnfoque] = useState(false);

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
      setCargando(true);
      try {
        const materiasLocal = getMaterias();
        if (materiasLocal.length > 0) {
          setMaterias(materiasLocal);
          setCargando(false);
        }

        // Check robusto con timeout
        let session: any = null;
        let tokenLocal: string | null = null;
        let userIdLocal: string | null = null;
        try {
          const authKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
          if (authKey) {
            const raw = localStorage.getItem(authKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              tokenLocal = parsed?.access_token || parsed?.[0]?.access_token || null;
              userIdLocal = parsed?.user?.id || parsed?.[0]?.user?.id || null;
            }
          }
        } catch {}

        try {
          const sessionPromise = supabase.auth.getSession();
          const timeout = new Promise<any>((_, rej) => setTimeout(() => rej(new Error('t')), 3000));
          const result: any = await Promise.race([sessionPromise, timeout]);
          session = result?.data?.session;
        } catch {}

        if (!session && tokenLocal && userIdLocal) {
          // Usar token local como fallback (no botear)
          session = { user: { id: userIdLocal }, access_token: tokenLocal };
        }

        if (!session) {
          try {
            const { data } = await supabase.auth.refreshSession();
            session = data.session;
          } catch {}
        }
        if (!session) { ((window as any).__showNavLoader?.('/auth'), router.push('/auth')); return; }

        const uid = session.user.id;
        const token = session.access_token;
        setUserId(uid);

        const lastUserId = localStorage.getItem('josea_last_user');
        if (lastUserId !== uid) {
          localStorage.setItem('josea_last_user', uid);
          localStorage.removeItem('josea_perfil');
          localStorage.removeItem('josea_asignaciones');
          localStorage.removeItem('josea_objetivos');
        }

        const res = await fetch('/api/materias', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();

        if (data.success && data.materias.length > 0) {
          setMaterias(data.materias);
          saveMaterias(data.materias);
          // Auto-abrir materia si viene del home (URL param o localStorage)
          try {
            const openId = openParam || localStorage.getItem('josea_open_materia');
            if (openId) {
              const mat = data.materias.find((m: any) => m.id === openId);
              if (mat) {
                setMateriaActual(mat);
                setVista('materia');
              }
              localStorage.removeItem('josea_open_materia');
            }
          } catch {}
        } else if (materiasLocal.length > 0) {
          await fetch('/api/materias', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ materias: materiasLocal }),
          });
        } else {
          await new Promise(r => setTimeout(r, 2000));
          const res2 = await fetch('/api/materias', {
            headers: { 'Authorization': `Bearer ${token}` },
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
  }, []);

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
      const session = (await import('../../lib/supabase').then(m => m.supabase.auth.getSession())).data.session;
      if (session) {
        await fetch(`/api/materials/${materialId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }
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

  if (cargando || (openParam && vista === 'lista')) {
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

        {vista === 'materias' && (
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
              setVista('flashcards');
            }}
            onOpenQuiz={(mats?: any[], sel?: any[]) => {
              setQuizMateriales(mats || temaActual?.documentos || []);
              setQuizSeleccion(sel);
              setVista('quiz');
            }}
            onOpenRepasar={(mats?: any[], sel?: any[]) => {
              const matsToUse = mats || temaActual?.documentos || [];
              setRepasarMateriales(matsToUse);
              setRepasarSeleccion(Array.isArray(sel) && sel.length ? sel : null);
              setVista('repasar');
            }}
            onAgregarYoutube={agregarYoutube}
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
          <FlashcardsPage
            materiales={flashcardsMateriales.length > 0 ? flashcardsMateriales : temaActual.documentos}
            seleccion={flashcardsSeleccion}
            tema={temaActual}
            materia={materiaActual}
            sessionId={flashcardsSessionId}
            onBack={() => {
              setReturnToEnfoque(true);
              setVista('tema');
            }}
          />
        )}

        {vista === 'quiz' && temaActual && materiaActual && (
          <QuizPage
            materiales={quizMateriales.length > 0 ? quizMateriales : temaActual.documentos}
            seleccion={quizSeleccion}
            tema={temaActual}
            materia={materiaActual}
            onBack={() => { setVista('tema'); setQuizMateriales([]); setQuizSeleccion(undefined); }}
          />
        )}

        {vista === 'repasar' && temaActual && materiaActual && (
          <RepasarWorkspace
            materiales={repasarMateriales.length > 0 ? repasarMateriales : temaActual.documentos}
            seleccion={repasarSeleccion}
            tema={temaActual}
            materia={materiaActual}
            onBack={() => {
              setReturnToEnfoque(true);
              setVista('tema');
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