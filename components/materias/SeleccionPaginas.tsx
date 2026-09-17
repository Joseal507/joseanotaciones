'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';

const Document = dynamic(() => import('react-pdf').then(m => m.Document), { ssr: false });
const Page = dynamic(() => import('react-pdf').then(m => m.Page), { ssr: false });

if (typeof window !== 'undefined') {
  import('react-pdf').then(({ pdfjs }) => {
    if (pdfjs?.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
    }
  });
}

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Material {
  id: string;
  nombre: string;
  tipo?: string;
  kind?: string;
  archivoUrl?: string;
  archivoBase64?: string;
  archivoMime?: string;
  materialId?: string;
  contenido?: string;
  conversion_status?: string;
}

export interface SeleccionResult {
  materialId: string;
  paginasSeleccionadas: number[];
  totalPaginas: number;
  todoSeleccionado: boolean;
}

interface Props {
  materiales: Material[];
  enfoque: 'teorico' | 'matematico' | 'mixto' | 'practico';
  temaId: string;
  themeColor: string;
  onCancel: () => void;
  onConfirm: (selecciones: SeleccionResult[]) => void;
}

type MaterialTipo = 'pdf' | 'docx' | 'pptx' | 'image' | 'txt' | 'otro';
type EstadoMaterial = 'ready' | 'processing' | 'failed';

// docx/pptx/odt/rtf (y sus variantes legacy doc/ppt) se normalizan a PDF
// server-side (document-converter) — el picker NUNCA vuelve a parsear el
// archivo original para estos, siempre pregunta al servidor vía
// download-url cuál es el estado real (autoridad única, nunca el prop
// conversion_status que puede quedar viejo en datos ya persistidos).
const KINDS_NORMALIZADOS_A_PDF = new Set(['docx', 'pptx', 'odt', 'rtf']);

function esConvertible(m: Material): boolean {
  const kind = (m.kind || m.tipo || '').toLowerCase();
  return KINDS_NORMALIZADOS_A_PDF.has(kind);
}

// Clasificación por archivo — solo para materiales que NO pasan por
// conversión (pdf nativo, imagen, txt). Para convertibles, el tipo
// efectivo lo decide exclusivamente la respuesta de download-url (ver
// tipoResueltoPorMat), nunca esta función.
function detectarTipo(m: Material): MaterialTipo {
  const nombre = (m.nombre || '').toLowerCase();
  const mime = (m.archivoMime || '').toLowerCase();
  const kind = (m.kind || m.tipo || '').toLowerCase();

  if (kind === 'pdf' || mime === 'application/pdf' || nombre.endsWith('.pdf')) return 'pdf';
  if (kind === 'docx' || kind === 'word' || nombre.endsWith('.docx') || nombre.endsWith('.doc') ||
      mime.includes('wordprocessingml')) return 'docx';
  if (kind === 'pptx' || kind === 'ppt' || nombre.endsWith('.pptx') || nombre.endsWith('.ppt') ||
      mime.includes('presentationml')) return 'pptx';
  if (kind === 'image' || kind === 'imagen' || mime.startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(nombre)) return 'image';
  if (kind === 'txt' || nombre.endsWith('.txt')) return 'txt';
  return 'otro';
}

const storageKey = (temaId: string, enfoque: string, matIds: string[]) =>
  `josea_seleccion_${temaId}_${enfoque}_${matIds.sort().join('-')}`;

// ─── Tipos de página extraída ───
interface PaginaExtraida {
  numero: number;
  titulo?: string;
  texto: string;
  bullets?: string[];
  imagenes?: string[]; // dataURLs
  layout?: 'titulo' | 'titulo-contenido' | 'imagen-texto' | 'solo-imagen' | 'texto';
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~60s de auto-poll antes de exigir reintento manual

export default function SeleccionPaginas({
  materiales, enfoque, temaId, themeColor, onCancel, onConfirm,
}: Props) {
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});
  const [paginasPorMat, setPaginasPorMat] = useState<Record<string, number>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [extraidasPorMat, setExtraidasPorMat] = useState<Record<string, PaginaExtraida[]>>({});
  const [selecciones, setSelecciones] = useState<Record<string, Set<number>>>({});
  const [rangoDesde, setRangoDesde] = useState<Record<string, number>>({});
  const [rangoHasta, setRangoHasta] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Estado de normalización por material (solo aplica a convertibles).
  // 'ready' = normalized.pdf listo → se pagina como cualquier PDF.
  const [estadoPorMat, setEstadoPorMat] = useState<Record<string, EstadoMaterial>>({});
  const [conversionErrorPorMat, setConversionErrorPorMat] = useState<Record<string, string>>({});
  const [tipoResueltoPorMat, setTipoResueltoPorMat] = useState<Record<string, MaterialTipo>>({});
  const pollAttemptsRef = useRef<Record<string, number>>({});
  const [pollTick, setPollTick] = useState(0);

  // Cargar selección guardada
  useEffect(() => {
    if (materiales.length === 0) return;
    const key = storageKey(temaId, enfoque, materiales.map(m => m.id));
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        const restored: Record<string, Set<number>> = {};
        for (const [mid, pages] of Object.entries(parsed)) {
          restored[mid] = new Set(pages as number[]);
        }
        setSelecciones(restored);
      }
    } catch {}
  }, [temaId, enfoque, materiales]);

  // Resuelve UN material — autoridad única: download-url. Para
  // convertibles (docx/pptx/odt/rtf) nunca se toca el archivo original;
  // 200 con kind==='pdf' es la única forma de mostrar páginas. Usada tanto
  // en la carga inicial como en el poll de 'processing' y el reintento
  // manual de 'failed' — mismo camino, sin duplicar lógica.
  const resolverMaterial = useCallback(async (m: Material, blobsToRevoke?: string[]) => {
    const tipoArchivo = detectarTipo(m);
    const convertible = esConvertible(m);

    try {
      // Atajos (base64/archivoUrl ya en memoria) solo tienen sentido para
      // contenido que el picker va a interpretar tal cual — nunca para
      // convertibles, donde SIEMPRE hay que preguntarle al servidor cuál
      // es el estado real de la normalización.
      if (!convertible && m.archivoBase64) {
        const mime = m.archivoMime || 'application/octet-stream';
        const bytes = atob(m.archivoBase64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: mime });
        const url = URL.createObjectURL(blob);
        blobsToRevoke?.push(url);
        await procesarConUrl(m, tipoArchivo, url, arr.buffer);
        return;
      }
      if (!convertible && m.archivoUrl) {
        await procesarConUrl(m, tipoArchivo, m.archivoUrl, null);
        return;
      }

      const remoteId = m.materialId || m.id;
      if (!remoteId) {
        setPdfErrors(prev => ({ ...prev, [m.id]: 'Este material no tiene ID válido para acceder al archivo' }));
        return;
      }

      const res = await fetch(`/api/materials/${remoteId}/download-url`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data?.code === 'MATERIAL_CONVERSION_PENDING') {
        setEstadoPorMat(prev => ({ ...prev, [m.id]: 'processing' }));
        return;
      }
      if (res.status === 409 && data?.code === 'MATERIAL_CONVERSION_FAILED') {
        setEstadoPorMat(prev => ({ ...prev, [m.id]: 'failed' }));
        setConversionErrorPorMat(prev => ({ ...prev, [m.id]: data?.conversionError || 'La conversión a PDF falló.' }));
        return;
      }
      if (!res.ok) {
        setPdfErrors(prev => ({ ...prev, [m.id]: data?.error ? `No se pudo obtener el archivo: ${data.error}` : `No se pudo obtener el archivo (${res.status})` }));
        return;
      }

      if (convertible && data.kind !== 'pdf') {
        // Material convertible cuya conversión nunca se disparó (legacy,
        // de antes de este pipeline). Dispararla ahora — nunca caer a
        // parseo client-side como alternativa.
        setEstadoPorMat(prev => ({ ...prev, [m.id]: 'processing' }));
        try {
          await fetch('/api/materials/upload/complete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ materialId: remoteId }),
          });
        } catch {}
        return;
      }

      if (data.kind === 'pdf') {
        setEstadoPorMat(prev => ({ ...prev, [m.id]: 'ready' }));
        setTipoResueltoPorMat(prev => ({ ...prev, [m.id]: 'pdf' }));
        setPdfUrls(prev => ({ ...prev, [m.id]: data.url }));
        return;
      }

      await procesarConUrl(m, tipoArchivo, data.url, null);
    } catch (e: any) {
      console.error('Error procesando', m.nombre, e);
      setPdfErrors(prev => ({ ...prev, [m.id]: e?.message || 'Error procesando' }));
    }
  }, []);

  // Solo para NO convertibles: imagen/txt. PDF nativo también pasa por
  // acá si algún día llega con archivoBase64/archivoUrl directo.
  async function procesarConUrl(m: Material, tipo: MaterialTipo, url: string, buffer: ArrayBuffer | null) {
    if (tipo === 'pdf') {
      setEstadoPorMat(prev => ({ ...prev, [m.id]: 'ready' }));
      setPdfUrls(prev => ({ ...prev, [m.id]: url }));
      return;
    }
    if (tipo === 'image') {
      setImageUrls(prev => ({ ...prev, [m.id]: url }));
      setExtraidasPorMat(prev => ({ ...prev, [m.id]: [{ numero: 1, texto: '' }] }));
      setPaginasPorMat(prev => ({ ...prev, [m.id]: 1 }));
      setSelecciones(prev => (prev[m.id]?.size ? prev : { ...prev, [m.id]: new Set([1]) }));
      return;
    }
    if (tipo === 'txt') {
      if (!buffer) {
        const r = await fetch(url);
        buffer = await r.arrayBuffer();
      }
      const texto = new TextDecoder('utf-8').decode(buffer);
      const paginas = dividirTextoEnPaginas(texto);
      setExtraidasPorMat(prev => ({ ...prev, [m.id]: paginas }));
      setPaginasPorMat(prev => ({ ...prev, [m.id]: paginas.length }));
      setSelecciones(prev => {
        if (prev[m.id]?.size) return prev;
        const all = new Set<number>();
        for (let i = 1; i <= paginas.length; i++) all.add(i);
        return { ...prev, [m.id]: all };
      });
      setRangoDesde(prev => ({ ...prev, [m.id]: prev[m.id] || 1 }));
      setRangoHasta(prev => ({ ...prev, [m.id]: prev[m.id] || paginas.length || 1 }));
    }
  }

  // Carga inicial
  useEffect(() => {
    let cancelled = false;
    const blobsToRevoke: string[] = [];

    const cargar = async () => {
      setLoading(true);
      await Promise.allSettled(materiales.map(m => resolverMaterial(m, blobsToRevoke)));
      if (!cancelled) setLoading(false);
    };

    cargar();

    return () => {
      cancelled = true;
      blobsToRevoke.forEach(u => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiales.map(m => m.id).join(',')]);

  // Poll de materiales 'processing' — nunca spinner infinito: se detiene
  // solo (auto) a los ~60s y queda un botón de reintento manual visible
  // todo el tiempo en el estado 'processing'.
  useEffect(() => {
    const enProceso = materiales.filter(m => estadoPorMat[m.id] === 'processing');
    if (!enProceso.length) return;
    const t = setTimeout(() => {
      for (const m of enProceso) {
        const intentos = (pollAttemptsRef.current[m.id] || 0) + 1;
        pollAttemptsRef.current[m.id] = intentos;
        if (intentos > POLL_MAX_ATTEMPTS) continue; // requiere click manual de acá en más
        resolverMaterial(m);
      }
      setPollTick(t => t + 1);
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoPorMat, pollTick, materiales, resolverMaterial]);

  const reintentarMaterial = useCallback((m: Material) => {
    pollAttemptsRef.current[m.id] = 0;
    setConversionErrorPorMat(prev => { const next = { ...prev }; delete next[m.id]; return next; });
    setEstadoPorMat(prev => ({ ...prev, [m.id]: 'processing' }));
    const remoteId = m.materialId || m.id;
    fetch('/api/materials/upload/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ materialId: remoteId }),
    }).finally(() => resolverMaterial(m));
  }, [resolverMaterial]);

  const handlePDFLoaded = useCallback((matId: string, numPages: number) => {
    setPaginasPorMat(prev => ({ ...prev, [matId]: numPages }));
    setRangoHasta(prev => ({ ...prev, [matId]: prev[matId] && prev[matId] > 1 ? prev[matId] : numPages }));
    setSelecciones(prev => {
      if (prev[matId] && prev[matId].size > 0) return prev;
      const all = new Set<number>();
      for (let i = 1; i <= numPages; i++) all.add(i);
      return { ...prev, [matId]: all };
    });
  }, []);

  const togglePagina = (matId: string, pageNum: number) => {
    setSelecciones(prev => {
      const next = { ...prev };
      const set = new Set(next[matId] || []);
      if (set.has(pageNum)) set.delete(pageNum);
      else set.add(pageNum);
      next[matId] = set;
      return next;
    });
  };

  const seleccionarTodoMat = (matId: string) => {
    const total = paginasPorMat[matId] || 0;
    if (!total) return;
    const all = new Set<number>();
    for (let i = 1; i <= total; i++) all.add(i);
    setSelecciones(prev => ({ ...prev, [matId]: all }));
  };

  const limpiarTodoMat = (matId: string) => {
    setSelecciones(prev => ({ ...prev, [matId]: new Set() }));
  };

  const aplicarRangoMat = (matId: string) => {
    const total = paginasPorMat[matId] || 0;
    if (!total) return;
    const from = Math.max(1, Math.min(total, rangoDesde[matId] || 1));
    const to = Math.max(from, Math.min(total, rangoHasta[matId] || total));
    const set = new Set<number>();
    for (let i = from; i <= to; i++) set.add(i);
    setSelecciones(prev => ({ ...prev, [matId]: set }));
  };

  const handleConfirmar = () => {
    const resultado: SeleccionResult[] = materiales.map(m => {
      const set = selecciones[m.id];
      const total = paginasPorMat[m.id] || 0;
      const pages = Array.from(set || []).sort((a, b) => a - b);
      return {
        materialId: m.id,
        paginasSeleccionadas: pages,
        totalPaginas: total,
        todoSeleccionado: total > 0 && pages.length === total,
      };
    });

    const key = storageKey(temaId, enfoque, materiales.map(m => m.id));
    const toSave: Record<string, number[]> = {};
    for (const [mid, set] of Object.entries(selecciones)) {
      toSave[mid] = Array.from(set);
    }
    try { localStorage.setItem(key, JSON.stringify(toSave)); } catch {}

    onConfirm(resultado);
  };

  const totalSeleccionadas = Object.values(selecciones).reduce((s, set) => s + set.size, 0);
  const totalPaginasTodos = Object.values(paginasPorMat).reduce((s, n) => s + n, 0);
  const puedeConfirmar = totalSeleccionadas > 0;

  const enfoqueLabel = enfoque === 'teorico' ? 'Teórico' : enfoque === 'matematico' ? 'Matemático' : 'Mixto';
  const enfoqueEmoji = enfoque === 'teorico' ? '📖' : enfoque === 'matematico' ? '📐' : '🧮';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      zIndex: 9998,
      display: 'flex', flexDirection: 'column',
      fontFamily: HAND, overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `linear-gradient(to bottom, transparent 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
      }} />
      <div style={{
        position: 'absolute', left: 80, top: 0, bottom: 0, width: 1.5,
        background: 'rgba(239,68,68,0.35)', zIndex: 0, pointerEvents: 'none',
      }} />

      {/* HEADER */}
      <div style={{
        position: 'relative', zIndex: 10,
        padding: '18px 28px',
        borderBottom: '2px solid var(--border-color)',
        background: 'color-mix(in srgb, var(--bg-primary) 95%, transparent)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', gap: 18,
        flexShrink: 0,
      }}>
        <button onClick={onCancel} style={{
          background: 'var(--bg-card)',
          border: '2px solid var(--text-primary)',
          padding: '8px 18px', borderRadius: 10,
          color: 'var(--text-primary)', cursor: 'pointer',
          fontFamily: HAND, fontSize: 18, fontWeight: 700,
          boxShadow: '2px 3px 0 var(--text-primary)',
          transform: 'rotate(-1.5deg)',
        }}>← volver</button>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{
              margin: 0, fontFamily: HAND,
              fontSize: 34, fontWeight: 900,
              color: 'var(--text-primary)',
              transform: 'rotate(-0.5deg)',
              display: 'inline-block',
            }}>📑 Elegir qué estudiar</h1>
            <div style={{ fontFamily: HAND, fontSize: 17, color: 'var(--text-muted)' }}>
              ~ enfoque {enfoqueEmoji} {enfoqueLabel} ~
            </div>
          </div>
          <p style={{ margin: '4px 0 0', fontFamily: BODY, fontSize: 14, color: 'var(--text-muted)' }}>
            Elegí partes específicas, o "Seleccionar todo" para el documento completo. Lo no seleccionado no se analiza.
          </p>
        </div>

        <div style={{
          padding: '8px 18px',
          background: `color-mix(in srgb, ${themeColor} 20%, var(--bg-card))`,
          border: `2.5px solid ${themeColor}`,
          borderRadius: 12,
          boxShadow: `2px 3px 0 ${themeColor}`,
          transform: 'rotate(1.5deg)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: themeColor, lineHeight: 1 }}>
            {totalSeleccionadas}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            de {totalPaginasTodos} partes
          </div>
        </div>

        <button
          onClick={handleConfirmar}
          disabled={!puedeConfirmar}
          style={{
            padding: '12px 24px',
            background: !puedeConfirmar ? 'var(--bg-card2)' : themeColor,
            color: !puedeConfirmar ? 'var(--text-faint)' : '#000',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 12,
            fontFamily: HAND, fontSize: 20, fontWeight: 900,
            cursor: !puedeConfirmar ? 'not-allowed' : 'pointer',
            boxShadow: !puedeConfirmar ? 'none' : '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1deg)',
            whiteSpace: 'nowrap',
          }}
        >
          ✓ Confirmar [{totalSeleccionadas}] →
        </button>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        position: 'relative', zIndex: 5,
        padding: '24px 0',
      }}>
        {loading && <CenterMsg emoji="⏳" title="Cargando materiales..." />}

        {!loading && materiales.map((m, idx) => {
          const tipo = tipoResueltoPorMat[m.id] || detectarTipo(m);
          const total = paginasPorMat[m.id] || 0;
          const sel = selecciones[m.id] || new Set<number>();
          return (
            <MaterialSection
              key={m.id}
              material={m}
              tipo={tipo}
              index={idx}
              totalMateriales={materiales.length}
              total={total}
              seleccionadas={sel}
              themeColor={themeColor}
              pdfUrl={pdfUrls[m.id]}
              imageUrl={imageUrls[m.id]}
              paginasExtraidas={extraidasPorMat[m.id] || []}
              error={pdfErrors[m.id]}
              estado={estadoPorMat[m.id]}
              conversionError={conversionErrorPorMat[m.id]}
              onReintentar={() => reintentarMaterial(m)}
              rangoDesde={rangoDesde[m.id] || 1}
              rangoHasta={rangoHasta[m.id] || total || 1}
              onRangoDesde={(n) => setRangoDesde(prev => ({ ...prev, [m.id]: n }))}
              onRangoHasta={(n) => setRangoHasta(prev => ({ ...prev, [m.id]: n }))}
              onAplicarRango={() => aplicarRangoMat(m.id)}
              onSeleccionarTodo={() => seleccionarTodoMat(m.id)}
              onLimpiar={() => limpiarTodoMat(m.id)}
              onTogglePagina={(p) => togglePagina(m.id, p)}
              onPDFLoaded={(n) => handlePDFLoaded(m.id, n)}
              onPDFError={(err) => setPdfErrors(prev => ({ ...prev, [m.id]: err }))}
            />
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
function MaterialSection({
  material, tipo, index, totalMateriales,
  total, seleccionadas, themeColor,
  pdfUrl, imageUrl, paginasExtraidas, error,
  estado, conversionError, onReintentar,
  rangoDesde, rangoHasta,
  onRangoDesde, onRangoHasta, onAplicarRango,
  onSeleccionarTodo, onLimpiar, onTogglePagina,
  onPDFLoaded, onPDFError,
}: {
  material: Material; tipo: MaterialTipo;
  index: number; totalMateriales: number;
  total: number; seleccionadas: Set<number>;
  themeColor: string;
  pdfUrl?: string; imageUrl?: string;
  paginasExtraidas: PaginaExtraida[]; error?: string;
  estado?: EstadoMaterial; conversionError?: string; onReintentar: () => void;
  rangoDesde: number; rangoHasta: number;
  onRangoDesde: (n: number) => void; onRangoHasta: (n: number) => void;
  onAplicarRango: () => void;
  onSeleccionarTodo: () => void; onLimpiar: () => void;
  onTogglePagina: (p: number) => void;
  onPDFLoaded: (n: number) => void; onPDFError: (err: string) => void;
}) {
  const tipoEmoji = tipo === 'pdf' ? '📄' : tipo === 'docx' ? '📃' :
                    tipo === 'pptx' ? '📊' : tipo === 'image' ? '🖼️' :
                    tipo === 'txt' ? '📝' : '📁';
  const tipoLabel = tipo === 'pdf' ? 'PDF' : tipo === 'docx' ? 'Word' :
                    tipo === 'pptx' ? 'PowerPoint' : tipo === 'image' ? 'Imagen' :
                    tipo === 'txt' ? 'Texto' : 'Archivo';
  const unidadLabel = tipo === 'pptx' ? 'diapositiva' : tipo === 'image' ? 'imagen' :
                      tipo === 'docx' ? 'sección' : tipo === 'txt' ? 'bloque' : 'página';
  const unidadPlural = tipo === 'pptx' ? 'diapositivas' : tipo === 'image' ? 'imágenes' :
                       tipo === 'docx' ? 'secciones' : tipo === 'txt' ? 'bloques' : 'páginas';
  const unidadPluralCap = unidadPlural.charAt(0).toUpperCase() + unidadPlural.slice(1);

  return (
    <div style={{
      maxWidth: 1400, margin: '0 auto',
      padding: '0 32px',
      marginBottom: index < totalMateriales - 1 ? 48 : 24,
    }}>
      {/* TÍTULO */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        marginBottom: 18, paddingBottom: 14,
        borderBottom: `2.5px dashed ${themeColor}66`,
      }}>
        {totalMateriales > 1 && (
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: themeColor,
            border: '2.5px solid var(--text-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            color: '#000',
            boxShadow: '2px 3px 0 var(--text-primary)',
            transform: 'rotate(-3deg)',
            flexShrink: 0,
          }}>{index + 1}</div>
        )}
        <div style={{
          width: 50, height: 50, borderRadius: 10,
          background: 'var(--bg-card)',
          border: '2px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, flexShrink: 0,
        }}>{tipoEmoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            margin: 0,
            fontFamily: HAND, fontSize: 28, fontWeight: 900,
            color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{material.nombre}</h2>
          <div style={{
            fontFamily: BODY, fontSize: 15,
            color: 'var(--text-muted)',
            marginTop: 2,
          }}>
            ~ {tipoLabel}{total > 0 ? ` · ${total} ${unidadPlural}` : ''} ~
          </div>
        </div>
        <div style={{
          padding: '8px 16px',
          background: seleccionadas.size > 0
            ? `color-mix(in srgb, ${themeColor} 18%, var(--bg-card))`
            : 'var(--bg-card)',
          border: `2px solid ${seleccionadas.size > 0 ? themeColor : 'var(--border-color)'}`,
          borderRadius: 10,
          fontFamily: HAND, fontSize: 18, fontWeight: 800,
          color: seleccionadas.size > 0 ? themeColor : 'var(--text-faint)',
          whiteSpace: 'nowrap',
        }}>{seleccionadas.size} / {total || '?'}</div>
      </div>

      {/* TOOLBAR */}
      {!error && total > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'center',
          alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '14px 20px', marginBottom: 22,
          background: 'var(--bg-card)',
          border: '1.5px dashed var(--border-color)',
          borderRadius: 12,
        }}>
          <button onClick={onSeleccionarTodo} style={toolBtn(themeColor)}>✓ Seleccionar todo</button>
          <button onClick={onLimpiar} style={toolBtn('var(--text-faint)')}>✕ Limpiar</button>
          <div style={{ width: 1, height: 28, background: 'var(--border-color)' }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: HAND, fontSize: 16, color: 'var(--text-primary)',
          }}>
            <span>{unidadPluralCap} de</span>
            <input type="text" inputMode="numeric" pattern="[0-9]*"
              value={rangoDesde}
              onChange={e => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                if (v === '') { onRangoDesde(0 as any); return; }
                onRangoDesde(parseInt(v));
              }}
              onBlur={() => {
                const v = rangoDesde || 1;
                onRangoDesde(Math.max(1, Math.min(total, v)));
              }}
              onKeyDown={(e: any) => { if (e.key === 'Enter') { e.currentTarget.blur(); onAplicarRango(); } }}
              style={inputNum(themeColor)} />
            <span>a</span>
            <input type="text" inputMode="numeric" pattern="[0-9]*"
              value={rangoHasta}
              onChange={e => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                if (v === '') { onRangoHasta(0 as any); return; }
                onRangoHasta(parseInt(v));
              }}
              onBlur={() => {
                const v = rangoHasta || total;
                onRangoHasta(Math.max(1, Math.min(total, v)));
              }}
              onKeyDown={(e: any) => { if (e.key === 'Enter') { e.currentTarget.blur(); onAplicarRango(); } }}
              style={inputNum(themeColor)} />
            <button onClick={onAplicarRango} style={{
              padding: '6px 14px', borderRadius: 8,
              border: `2px solid ${themeColor}`, background: themeColor,
              color: '#000', fontFamily: HAND, fontSize: 15, fontWeight: 800,
              cursor: 'pointer', boxShadow: `1px 2px 0 var(--text-primary)`,
            }}>Aplicar</button>
          </div>
        </div>
      )}

      {/* CONTENIDO */}
      {error && (
        <div style={{
          textAlign: 'center', padding: 30,
          background: 'color-mix(in srgb, #f87171 10%, var(--bg-card))',
          border: '2px dashed #f87171', borderRadius: 12,
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontFamily: HAND, fontSize: 19, color: '#f87171', fontWeight: 700 }}>
            {error}
          </div>
        </div>
      )}

      {!error && estado === 'processing' && (
        <CenterMsg emoji="⏳" title="Preparando documento..."
          sub="Convirtiendo a PDF para poder mostrarte las páginas. Esto no debería tardar más de un minuto." />
      )}

      {!error && estado === 'failed' && (
        <div style={{
          textAlign: 'center', padding: 30,
          background: 'color-mix(in srgb, #f87171 10%, var(--bg-card))',
          border: '2px dashed #f87171', borderRadius: 12,
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontFamily: HAND, fontSize: 19, color: '#f87171', fontWeight: 700, marginBottom: 6 }}>
            Este material no pudo prepararse.
          </div>
          {conversionError && (
            <div style={{ fontFamily: BODY, fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              {conversionError}
            </div>
          )}
          <button onClick={onReintentar} style={{
            padding: '10px 22px', borderRadius: 10,
            border: '2px solid #f87171', background: 'transparent',
            color: '#f87171', fontFamily: HAND, fontSize: 16, fontWeight: 800,
            cursor: 'pointer',
          }}>🔁 Reintentar</button>
        </div>
      )}

      {!error && tipo === 'pdf' && pdfUrl && (
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => onPDFLoaded(numPages)}
          onLoadError={(err) => { console.error(err); onPDFError(err?.message || 'Error'); }}
          loading={<CenterMsg emoji="⏳" title="Procesando PDF..." />}
        >
          <ThumbsGrid
            total={total} seleccionadas={seleccionadas}
            themeColor={themeColor} onToggle={onTogglePagina}
            label="página"
            renderThumb={(n: number) => (
              <Page pageNumber={n} width={170}
                renderAnnotationLayer={false} renderTextLayer={false}
                loading={<div style={loadingThumb} />} />
            )}
          />
        </Document>
      )}

      {!error && tipo === 'image' && imageUrl && (
        <ThumbsGrid
          total={1} seleccionadas={seleccionadas}
          themeColor={themeColor} onToggle={onTogglePagina}
          label="imagen" centered
          renderThumb={() => (
            <img src={imageUrl} alt={material.nombre}
              style={{ width: 280, maxWidth: '100%', height: 'auto', display: 'block' }} />
          )}
        />
      )}

      {!error && tipo === 'txt' && paginasExtraidas.length > 0 && (
        <ThumbsGrid
          total={paginasExtraidas.length} seleccionadas={seleccionadas}
          themeColor={themeColor} onToggle={onTogglePagina}
          label={unidadLabel}
          renderThumb={(n: number) => <PageThumb pagina={paginasExtraidas[n - 1]} />}
        />
      )}

      {!error && tipo === 'txt' && paginasExtraidas.length === 0 && (
        <CenterMsg emoji="⏳" title="Extrayendo contenido..." />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// GRID
// ═══════════════════════════════════════════════
function ThumbsGrid({
  total, seleccionadas, themeColor, onToggle, renderThumb, label = 'página', centered = false,
}: any) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: centered ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 22,
      justifyItems: centered ? 'center' : 'stretch',
    }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((pageNum: number) => {
        const sel = seleccionadas.has(pageNum);
        return (
          <div key={pageNum}
            onClick={() => onToggle(pageNum)}
            style={{
              cursor: 'pointer',
              transition: 'transform 0.2s cubic-bezier(.25,.8,.25,1)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
            onMouseEnter={(e:any) => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
            onMouseLeave={(e:any) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div style={{
              position: 'relative',
              background: '#fff',
              border: `3px solid ${sel ? themeColor : 'var(--border-color)'}`,
              borderRadius: 10, overflow: 'hidden',
              boxShadow: sel
                ? `3px 4px 0 ${themeColor}, 0 0 0 1px ${themeColor}55`
                : '2px 3px 0 var(--border-color)',
              opacity: sel ? 1 : 0.55,
              width: '100%',
              display: 'flex', justifyContent: 'center',
            }}>
              {renderThumb(pageNum)}
              {!sel && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.25)',
                  pointerEvents: 'none',
                }} />
              )}
              <div style={{
                position: 'absolute', top: 6, right: 6,
                width: 26, height: 26, borderRadius: 6,
                background: sel ? themeColor : 'rgba(255,255,255,0.9)',
                border: `2px solid ${sel ? '#000' : 'var(--text-faint)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 900,
                color: sel ? '#000' : 'transparent',
                boxShadow: sel ? `0 2px 4px ${themeColor}88` : 'none',
              }}>{sel ? '✓' : ''}</div>
            </div>
            <div style={{
              textAlign: 'center', marginTop: 8,
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              color: sel ? themeColor : 'var(--text-faint)',
            }}>{label} {pageNum}</div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════
// PAGE THUMB (TXT) — formato hoja vertical
// ═══════════════════════════════════════════════
function PageThumb({ pagina }: { pagina: PaginaExtraida }) {
  return (
    <div style={{
      width: '100%', aspectRatio: '210/297',
      padding: '14px 12px',
      background: '#fffef5',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: BODY,
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(180deg, transparent 0 16px, rgba(56,189,248,0.15) 16px 17px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 18,
        width: 1.5, background: 'rgba(239,68,68,0.4)',
        pointerEvents: 'none',
      }} />

      {pagina.titulo && (
        <div style={{
          fontFamily: HAND, fontSize: 12, fontWeight: 800,
          color: '#1e293b', marginBottom: 6,
          paddingLeft: 18,
          position: 'relative', zIndex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any,
        }}>
          {pagina.titulo}
        </div>
      )}
      <div style={{
        fontSize: 8.5,
        lineHeight: 1.4,
        color: '#334155',
        paddingLeft: 18,
        flex: 1,
        overflow: 'hidden',
        position: 'relative', zIndex: 1,
        display: '-webkit-box',
        WebkitLineClamp: 15,
        WebkitBoxOrient: 'vertical' as any,
        textOverflow: 'ellipsis',
        whiteSpace: 'pre-wrap',
      }}>
        {pagina.texto || <span style={{ color: '#94a3b8' }}>(sin texto)</span>}
      </div>
    </div>
  );
}

function dividirTextoEnPaginas(texto: string): PaginaExtraida[] {
  const limpio = texto.trim();
  if (!limpio) return [];

  const CHARS_POR_PAGINA = 1800;
  const paginas: PaginaExtraida[] = [];
  const bloques = limpio.split(/\n{2,}/).filter(b => b.trim().length > 0);

  let actual = '';
  let numPagina = 1;
  for (const bloque of bloques) {
    if ((actual + bloque).length > CHARS_POR_PAGINA && actual.length > 0) {
      const lineas = actual.trim().split('\n');
      const titulo = lineas[0]?.slice(0, 80) || `Página ${numPagina}`;
      paginas.push({ numero: numPagina, titulo, texto: actual.trim() });
      actual = bloque + '\n\n';
      numPagina++;
    } else {
      actual += bloque + '\n\n';
    }
  }
  if (actual.trim().length > 0) {
    const lineas = actual.trim().split('\n');
    const titulo = lineas[0]?.slice(0, 80) || `Página ${numPagina}`;
    paginas.push({ numero: numPagina, titulo, texto: actual.trim() });
  }

  return paginas.length > 0 ? paginas : [{ numero: 1, texto: limpio.slice(0, 2000) }];
}

// ═══════════════════════════════════════════════
function CenterMsg({ emoji, title, sub }: { emoji: string; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, fontFamily: HAND }}>
      <div style={{ fontSize: 50, marginBottom: 12 }}>{emoji}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 500, margin: '0 auto' }}>{sub}</div>}
    </div>
  );
}

const toolBtn = (color: string): React.CSSProperties => ({
  padding: '7px 14px',
  borderRadius: 9,
  border: `2px dashed ${color}`,
  background: 'transparent',
  color,
  fontFamily: HAND, fontSize: 15, fontWeight: 800,
  cursor: 'pointer',
});

const inputNum = (color: string): React.CSSProperties => ({
  width: 60,
  padding: '5px 8px',
  borderRadius: 7,
  border: `2px solid ${color}55`,
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontFamily: HAND, fontSize: 17, fontWeight: 800,
  textAlign: 'center', outline: 'none',
});

const loadingThumb: React.CSSProperties = {
  height: 220,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-secondary)',
  color: 'var(--text-faint)',
  fontFamily: BODY, fontSize: 16,
};
