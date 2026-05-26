'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { supabase } from '../../lib/supabase';

// Cache global de OCR
const ocrCache = new Map<string, { x: number; y: number; w: number; h: number }[]>();

if (typeof window !== 'undefined' && pdfjs?.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface CardSource {
  id: string;
  question: string;
  answer: string;
  sourceText?: string;
  sourcePage?: number;
  sourceMaterialId?: string;
}

interface Props {
  card: CardSource;
  materiales: any[];
  color: string;
  onClose: () => void;
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cache de textos extraídos por material para no re-pedir
const materialTextCache = new Map<string, string>();

export default function FlashcardSourceViewer({ card, materiales, color, onClose }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [containerWidth, setContainerWidth] = useState(680);
  const [resolvedMaterial, setResolvedMaterial] = useState<any>(null);
  const [resolvedPage, setResolvedPage] = useState<number>(1);
  const [resolving, setResolving] = useState(true);
  const [isScanned, setIsScanned] = useState(false);
  const [highlightSuccess, setHighlightSuccess] = useState(false);
  const [ocrRects, setOcrRects] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrRunning, setOcrRunning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // ── Función OCR con Tesseract para PDFs escaneados ──
  const onlyLettersHelper = (s: string) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  const runTesseractHighlight = async () => {
    if (!card.sourceText || !pageRef.current) return;

    const matId = resolvedMaterial?.materialId || resolvedMaterial?.id || 'x';
    const cacheKey = matId + '_p' + resolvedPage + '_' + onlyLettersHelper(card.sourceText).slice(0, 50);

    // Buscar el canvas correcto (react-pdf renderiza el PDF en .react-pdf__Page__canvas)
    const allCanvas = Array.from(pageRef.current.querySelectorAll('canvas')) as HTMLCanvasElement[];
    console.log('🎨 Canvas encontrados:', allCanvas.length, allCanvas.map(c => ({ w: c.width, h: c.height, class: c.className })));

    // Usar el canvas más grande (el del PDF, no el del textLayer)
    const canvas = allCanvas
      .filter(c => c.width > 100 && c.height > 100)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

    if (!canvas) {
      console.warn('⚠️ No hay canvas válido para OCR');
      return;
    }
    console.log('✅ Canvas seleccionado:', canvas.width, 'x', canvas.height);

    const cached = ocrCache.get(cacheKey);
    if (cached) {
      console.log('✅ OCR desde cache');
      setOcrRects(cached);
      setHighlightSuccess(true);
      return;
    }

    setOcrRunning(true);
    setOcrProgress(0);

    try {
      const Tesseract = (await import('tesseract.js')).default;
      console.log('🔍 Tesseract iniciado…');

      // Crear worker manualmente para tener control de output
      const worker = await Tesseract.createWorker(['spa', 'eng'], 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      // Activar output de palabras con bboxes
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as any, // assume single uniform block
      });

      const result = await worker.recognize(canvas, {}, {
        text: true,
        blocks: true,
      } as any);

      let words: any[] = (result.data as any).words || [];

      // Si no hay 'words' directo, extraerlos de blocks > paragraphs > lines > words
      if (!words.length && (result.data as any).blocks) {
        const blocks = (result.data as any).blocks || [];
        for (const blk of blocks) {
          for (const par of (blk.paragraphs || [])) {
            for (const ln of (par.lines || [])) {
              for (const w of (ln.words || [])) {
                words.push(w);
              }
            }
          }
        }
      }

      console.log('📝 ' + words.length + ' palabras detectadas');
      await worker.terminate();

      if (!words.length) { setOcrRunning(false); return; }

      const normLocal = (s: string) =>
        (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const letterMap: { wordIdx: number }[] = [];
      let stream = '';
      words.forEach((w, idx) => {
        const t = normLocal(w.text || '');
        for (const ch of t) {
          if (/[a-z0-9]/.test(ch)) {
            stream += ch;
            letterMap.push({ wordIdx: idx });
          }
        }
      });

      const targetLetters = onlyLettersHelper(card.sourceText);
      if (targetLetters.length < 4) { setOcrRunning(false); return; }

      const wordIdxSet = new Set<number>();

      // ── ESTRATEGIA 1: match de secuencia contigua ──
      let pos = stream.indexOf(targetLetters);
      if (pos < 0) {
        const partial = targetLetters.slice(0, Math.max(8, Math.floor(targetLetters.length * 0.7)));
        pos = stream.indexOf(partial);
      }
      if (pos < 0) {
        const partial = targetLetters.slice(0, Math.max(6, Math.floor(targetLetters.length * 0.5)));
        pos = stream.indexOf(partial);
      }

      if (pos >= 0) {
        const endPos = Math.min(pos + targetLetters.length, stream.length);
        for (let i = pos; i < endPos; i++) wordIdxSet.add(letterMap[i].wordIdx);
        console.log('✅ Match contiguo encontrado en pos', pos);
      }

      // ── ESTRATEGIA 2: buscar grupo de palabras consecutivas en orden ──
      if (wordIdxSet.size === 0) {
        const normLocal = (s: string) =>
          (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Stopwords + palabras muy cortas
        const stopWords = new Set([
          'the', 'and', 'for', 'with', 'que', 'los', 'las', 'del', 'por', 'con',
          'una', 'uno', 'sus', 'sin', 'son', 'sea', 'fue', 'han', 'has', 'que',
          'their', 'this', 'that', 'esta', 'ese', 'esa', 'como', 'pero',
        ]);
        // Solo palabras de >=4 letras y que no sean números puros cortos
        const targetWords = normLocal(card.sourceText)
          .split(/[^a-z0-9]+/)
          .filter(w => {
            if (w.length < 4) return false;
            if (stopWords.has(w)) return false;
            if (/^\d+$/.test(w) && w.length < 5) return false; // descartar números <5 dígitos
            return true;
          });

        console.log('🔎 Palabras significativas del fragmento:', targetWords);

        if (targetWords.length === 0) {
          console.warn('⚠️ No hay palabras significativas');
          setOcrRunning(false);
          return;
        }

        // Mapear cada palabra OCR a sus matches con el target
        const wordMatches: { idx: number; matchedTargets: Set<string> }[] = [];
        words.forEach((w: any, idx: number) => {
          const wText = normLocal(w.text || '').replace(/[^a-z0-9]/g, '');
          if (wText.length < 3) return;
          const matched = new Set<string>();
          for (const tw of targetWords) {
            if (wText === tw) { matched.add(tw); continue; }
            if (tw.length >= 5 && wText.length >= 4 && (wText.includes(tw) || tw.includes(wText))) {
              matched.add(tw);
            }
          }
          if (matched.size > 0) {
            wordMatches.push({ idx, matchedTargets: matched });
          }
        });

        console.log('🎯 Palabras OCR que matchean:', wordMatches.length);

        if (wordMatches.length === 0) {
          console.warn('⚠️ Sin matches');
          setOcrRunning(false);
          return;
        }

        // Buscar clúster de palabras cercanas con mayor densidad de matches
        // Sliding window por proximidad en el documento
        const MIN_MATCHES_REQUIRED = Math.max(2, Math.floor(targetWords.length * 0.4));

        let bestCluster: { idx: number; matchedTargets: Set<string> }[] = [];
        let bestUniqueCount = 0;
        let bestDensity = 0; // matches por palabra de ventana (más denso = mejor)

        for (let i = 0; i < wordMatches.length; i++) {
          // Ventana más chica para texto corto (más preciso)
          const windowSize = targetWords.length <= 3 ? 15 : 50;
          const window: typeof wordMatches = [];
          const uniqueTargets = new Set<string>();
          for (let j = i; j < wordMatches.length; j++) {
            if (wordMatches[j].idx - wordMatches[i].idx > windowSize) break;
            window.push(wordMatches[j]);
            wordMatches[j].matchedTargets.forEach(t => uniqueTargets.add(t));
          }
          // Densidad: targets únicos / spread de palabras OCR
          const spread = window.length > 1 ? (window[window.length-1].idx - window[0].idx + 1) : 1;
          const density = uniqueTargets.size / Math.max(1, Math.log2(spread + 1));

          // Preferir: más targets únicos, luego mayor densidad (más compacto)
          if (uniqueTargets.size > bestUniqueCount ||
              (uniqueTargets.size === bestUniqueCount && density > bestDensity)) {
            bestUniqueCount = uniqueTargets.size;
            bestDensity = density;
            bestCluster = window;
          }
        }

        // Si target es muy corto (<=3 palabras), incluir palabras vecinas para contexto visual
        if (targetWords.length <= 3 && bestCluster.length > 0) {
          const firstIdx = bestCluster[0].idx;
          const lastIdx = bestCluster[bestCluster.length - 1].idx;
          const expanded = new Set(bestCluster.map(m => m.idx));
          // Añadir hasta 2 palabras antes y 2 después (mismo renglón típicamente)
          for (let k = Math.max(0, firstIdx - 2); k <= Math.min(words.length - 1, lastIdx + 2); k++) {
            // Solo si está en el mismo renglón aproximado (y similar al primer match)
            const baseY = (words[firstIdx]?.bbox?.y0 || 0);
            const thisY = (words[k]?.bbox?.y0 || 0);
            if (Math.abs(thisY - baseY) < 20) {
              expanded.add(k);
            }
          }
          bestCluster = Array.from(expanded).sort((a,b) => a-b).map(idx => ({
            idx,
            matchedTargets: new Set<string>(),
          }));
          console.log('📌 Clúster expandido a ' + bestCluster.length + ' palabras (texto corto)');
        }

        console.log('🏆 Mejor clúster: ' + bestCluster.length + ' palabras, ' + bestUniqueCount + ' targets únicos (requiere ' + MIN_MATCHES_REQUIRED + ')');

        if (bestUniqueCount < MIN_MATCHES_REQUIRED) {
          console.warn('⚠️ Clúster insuficiente (' + bestUniqueCount + '/' + targetWords.length + ' palabras matchearon)');
          setOcrRunning(false);
          return;
        }

        bestCluster.forEach(m => wordIdxSet.add(m.idx));
        console.log('✅ Match clúster: ' + wordIdxSet.size + ' palabras resaltadas');
      }

      if (wordIdxSet.size === 0) {
        console.warn('⚠️ Tesseract: no encontró fragmento');
        setOcrRunning(false);
        return;
      }

      const cw = canvas.width;
      const ch = canvas.height;
      const matchedWords = Array.from(wordIdxSet).sort((a, b) => a - b).map(i => words[i]).filter(Boolean);

      const lineGroups: any[][] = [];
      let currentLine: any[] = [];
      let lastY = -999;

      for (const w of matchedWords) {
        const y = w.bbox.y0;
        if (Math.abs(y - lastY) > 15 && currentLine.length) {
          lineGroups.push(currentLine);
          currentLine = [];
        }
        currentLine.push(w);
        lastY = y;
      }
      if (currentLine.length) lineGroups.push(currentLine);

      const rects: { x: number; y: number; w: number; h: number }[] = [];
      for (const line of lineGroups) {
        const x0 = Math.min(...line.map((w: any) => w.bbox.x0));
        const y0 = Math.min(...line.map((w: any) => w.bbox.y0));
        const x1 = Math.max(...line.map((w: any) => w.bbox.x1));
        const y1 = Math.max(...line.map((w: any) => w.bbox.y1));
        rects.push({
          x: (x0 / cw) * 100,
          y: (y0 / ch) * 100,
          w: ((x1 - x0) / cw) * 100,
          h: ((y1 - y0) / ch) * 100,
        });
      }

      console.log('✅ Tesseract: ' + rects.length + ' líneas resaltadas');
      ocrCache.set(cacheKey, rects);
      setOcrRects(rects);
      setHighlightSuccess(true);
    } catch (e) {
      console.error('Error Tesseract:', e);
    } finally {
      setOcrRunning(false);
    }
  };

  // ── Resolver material correcto ───────────────────────────────────────────────
  useEffect(() => {
    if (!materiales.length) { setResolving(false); return; }

    // Un solo material → verificar página por contenido
    if (materiales.length === 1) {
      const mat = materiales[0];
      setResolvedMaterial(mat);

      // Si tenemos sourceText, buscar la página real por contenido
      if (card.sourceText && card.sourceText.length >= 10) {
        (async () => {
          const matId = mat?.materialId || mat?.id;
          if (!matId) {
            setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
            setResolving(false);
            return;
          }

          try {
            let fullText = materialTextCache.get(matId);
            if (!fullText) {
              const session = (await supabase.auth.getSession()).data.session;
              const authHeader: HeadersInit = session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : {};
              const res = await fetch('/api/enfoques/teorico/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ materialIds: [matId] }),
              });
              if (res.ok) {
                const data = await res.json();
                fullText = '';
                const mats = data?.materials || {};
                for (const k of Object.keys(mats)) {
                  fullText += '\n' + (mats[k]?.text || '');
                }
                materialTextCache.set(matId, fullText);
              }
            }

            if (fullText) {
              const normFull = norm(fullText);
              const normSrc = norm(card.sourceText ?? "");

              // Probar múltiples fragmentos del sourceText para encontrar el más confiable
              const candidates: string[] = [];

              // 1. Primeras 100 letras
              candidates.push(normSrc.slice(0, 100));
              // 2. Primeras 50 letras
              candidates.push(normSrc.slice(0, 50));
              // 3. Fragmento intermedio (más distintivo, evita inicios genéricos)
              if (normSrc.length > 80) {
                candidates.push(normSrc.slice(30, 100));
              }
              // 4. Primeras 6 palabras
              candidates.push(normSrc.split(' ').slice(0, 6).join(' '));
              // 5. Palabras 3-9 (saltando inicio común)
              const wParts = normSrc.split(' ');
              if (wParts.length >= 9) {
                candidates.push(wParts.slice(2, 9).join(' '));
              }

              let foundPage = -1;
              let foundIdx = -1;
              for (const cand of candidates) {
                if (cand.length < 8) continue;
                const idx = normFull.indexOf(cand);
                if (idx >= 0) {
                  const before = normFull.slice(0, idx);
                  const pageMatches = [...before.matchAll(/\[pagina (\d+)\]/g)];
                  if (pageMatches.length > 0) {
                    const realPage = parseInt(pageMatches[pageMatches.length - 1][1], 10);
                    if (realPage > 0) {
                      foundPage = realPage;
                      foundIdx = idx;
                      console.log('🔎 Match candidato:', cand.slice(0, 40), '→ página', realPage);
                      break;
                    }
                  }
                }
              }

              if (foundPage > 0) {
                setResolvedPage(foundPage);
                console.log('✅ Página real encontrada por contenido:', foundPage, '(IA dijo:', card.sourcePage, ')');
                setResolving(false);
                return;
              } else {
                console.warn('⚠️ No se encontró el sourceText en el texto OCR. Usando página de IA:', card.sourcePage);
              }
            }
          } catch (e) {
            console.warn('Error buscando página real:', e);
          }

          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
        })();
        return;
      }

      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
      return;
    }

    const resolveByContent = async () => {
      setResolving(true);

      console.log('🔎 Resolviendo material para card:', {
        sourceMaterialId: card.sourceMaterialId,
        sourcePage: card.sourcePage,
        sourceTextPreview: card.sourceText?.slice(0, 80),
        materialesDisponibles: materiales.map((m: any, i: number) => ({
          idx: i + 1,
          id: m?.materialId || m?.id,
          nombre: m?.nombre || m?.name,
        })),
      });

      // ── ESTRATEGIA PRIORITARIA: buscar sourceText en el contenido ──
      // Esto es lo MÁS confiable porque la IA a veces se equivoca con el ID
      if (card.sourceText && card.sourceText.length >= 10) {
        const needle = norm(card.sourceText ?? "").slice(0, 100);
        const needleShort = norm(card.sourceText ?? "").split(' ').slice(0, 6).join(' ');

        const session = (await supabase.auth.getSession()).data.session;
        const authHeader: HeadersInit = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        for (const mat of materiales) {
          const matId = mat?.materialId || mat?.id;
          if (!matId) continue;

          try {
            let fullText = materialTextCache.get(matId);
            if (!fullText) {
              const res = await fetch('/api/enfoques/teorico/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ materialIds: [matId] }),
              });
              if (!res.ok) continue;
              const data = await res.json();
              fullText = '';
              const mats = data?.materials || {};
              for (const k of Object.keys(mats)) {
                fullText += '\n' + (mats[k]?.text || '');
              }
              materialTextCache.set(matId, fullText);
            }

            const normFull = norm(fullText);
            if (normFull.includes(needle) || normFull.includes(needleShort)) {
              let matchPage = card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1;
              const idx = normFull.indexOf(needle) >= 0 ? normFull.indexOf(needle) : normFull.indexOf(needleShort);
              if (idx >= 0) {
                const before = normFull.slice(0, idx);
                const pageMatches = [...before.matchAll(/\[pagina (\d+)\]/g)];
                if (pageMatches.length > 0) {
                  matchPage = parseInt(pageMatches[pageMatches.length - 1][1], 10) || matchPage;
                }
              }
              setResolvedMaterial(mat);
              setResolvedPage(matchPage);
              setResolving(false);
              console.log('✅ Material resuelto por contenido:', matId, 'página:', matchPage);
              return;
            }
          } catch (e) {
            console.warn('Error consultando material', matId, e);
          }
        }
      }

      // ── FALLBACK 1: usar ID/índice que dio la IA ──
      if (card.sourceMaterialId) {
        const sid = String(card.sourceMaterialId).trim();

        const asNum = parseInt(sid, 10);
        if (!isNaN(asNum) && asNum >= 1 && asNum <= materiales.length) {
          const mat = materiales[asNum - 1];
          setResolvedMaterial(mat);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('⚠️ Fallback por índice IA:', asNum);
          return;
        }

        const byId = materiales.find((m: any) => {
          const mid = String(m?.materialId || m?.id || '').trim();
          return mid === sid;
        });
        if (byId) {
          setResolvedMaterial(byId);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('⚠️ Fallback por ID IA:', sid);
          return;
        }

        const byName = materiales.find((m: any) => {
          const mname = String(m?.nombre || m?.name || '').toLowerCase().trim();
          return mname.includes(sid.toLowerCase()) || sid.toLowerCase().includes(mname);
        });
        if (byName) {
          setResolvedMaterial(byName);
          setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
          setResolving(false);
          console.log('⚠️ Fallback por nombre IA:', sid);
          return;
        }
      }

      // ── FALLBACK 2: primer material ──
      console.warn('⚠️ No se pudo localizar material, usando el primero');
      setResolvedMaterial(materiales[0]);
      setResolvedPage(card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 1);
      setResolving(false);
    };

    resolveByContent();
  }, [card.sourceMaterialId, card.sourceText, card.sourcePage, materiales]);

  // Reset highlight cuando cambia material o página
  useEffect(() => {
    setHighlightSuccess(false);
    setIsScanned(false);
    setOcrRects([]);
    setOcrProgress(0);
  }, [resolvedMaterial, resolvedPage]);

  useEffect(() => {
    if (isScanned && card.sourceText && !ocrRects.length && !ocrRunning) {
      const timer = setTimeout(() => {
        // OCR Tesseract desactivado - usamos post-it visual en su lugar
        // if (typeof runTesseractHighlight === 'function') runTesseractHighlight();
      }, 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanned, resolvedPage, card.sourceText]);


  // ── Cargar URL del PDF ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!resolvedMaterial) return;

    let cancelled = false;
    setLoading(true);
    setError('');
    setPdfUrl(null);

    const load = async () => {
      if (typeof resolvedMaterial.url === 'string' && resolvedMaterial.url.startsWith('http')) {
        if (!cancelled) { setPdfUrl(resolvedMaterial.url); setLoading(false); }
        return;
      }

      const matId = resolvedMaterial?.materialId || resolvedMaterial?.id;
      if (!matId) {
        if (!cancelled) { setError('Material sin ID'); setLoading(false); }
        return;
      }

      try {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(`/api/materials/${matId}/download-url`, {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        });

        if (!res.ok) {
          if (!cancelled) { setError(`Error ${res.status} al obtener PDF`); setLoading(false); }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          if (data?.url) setPdfUrl(data.url);
          else setError('No se pudo obtener el PDF');
          setLoading(false);
        }
      } catch {
        if (!cancelled) { setError('Error de red'); setLoading(false); }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [resolvedMaterial]);

  // ── Medir ancho ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setContainerWidth(Math.min(containerRef.current.clientWidth - 32, 860));
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // ── Highlight ───────────────────────────────────────────────────────────────
  const onlyLetters = (s: string) =>
    norm(s).replace(/[^a-z0-9]/g, '');
  const highlight = () => {};

  const applyHL = (span: HTMLSpanElement) => {
    if (span.dataset.hl === '1') return;
    span.dataset.hl = '1';
    span.style.background = `${color}88`;
        span.setAttribute('data-flashka-highlight', '1');
    span.style.borderRadius = '3px';
    span.style.outline = `1px solid ${color}99`;
    span.style.mixBlendMode = 'multiply';
  };

  const hasSource = !!card.sourceText;
  const materialName = resolvedMaterial?.nombre || resolvedMaterial?.name || '';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <style>{`
        @keyframes pulseHL {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
        @keyframes spinHL {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 980, maxHeight: '93vh',
          background: '#0d0f18',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          boxShadow: '0 32px 80px rgba(0,0,0,0.75)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              background: `${color}18`, border: `1px dashed ${color}55`,
              color, borderRadius: 8, padding: '4px 10px',
              fontFamily: "'Caveat', cursive", fontSize: 15, fontWeight: 700,
            }}>
              🔍 Fuente
            </span>
            {materialName && (
              <span style={{ color: '#999', fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
                {materialName}
              </span>
            )}
            {!resolving && resolvedPage > 0 && (
              <span style={{ color: '#666', fontFamily: "'Caveat', cursive", fontSize: 14 }}>
                · Pág. {resolvedPage}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#aaa', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Pregunta */}
        <div style={{
          padding: '10px 18px',
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{ color: '#555', fontSize: 10, fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>
            Pregunta
          </div>
          <div style={{ color: '#ddd', fontSize: 14, fontFamily: 'Inter, sans-serif', lineHeight: 1.45 }}>
            {card.question}
          </div>
        </div>

        {/* Body */}
        <div ref={containerRef} style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {!hasSource && (
            <div style={{
              padding: '20px 24px', borderRadius: 14, maxWidth: 500, textAlign: 'center',
              background: 'rgba(251,191,36,0.06)', border: '1.5px dashed rgba(251,191,36,0.3)',
              color: '#fbbf24', fontFamily: "'Caveat', cursive", fontSize: 16, lineHeight: 1.5,
            }}>
              ⚠️ Esta flashcard fue creada antes de la nueva versión.<br />
              Regenera las flashcards para ver la fuente exacta.
            </div>
          )}

          {hasSource && (
            <>
              <div style={{
                width: '100%', maxWidth: containerWidth,
                background: `${color}0d`, border: `1.5px dashed ${color}44`,
                borderRadius: 12, padding: '12px 16px',
              }}>
                <div style={{ color, fontSize: 10, fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, fontWeight: 700 }}>
                  📑 Fragmento exacto del material
                </div>
                <div style={{ color: '#e8e8ed', fontSize: 14, fontFamily: 'Inter, sans-serif', fontStyle: 'italic', lineHeight: 1.55 }}>
                  "{card.sourceText}"
                </div>
              </div>

              {/* Hint de navegación */}
              {!resolving && resolvedPage > 0 && (
                <div style={{
                  width: '100%', maxWidth: containerWidth,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  fontFamily: 'Inter, sans-serif',
                }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: '#888', fontSize: 13 }}>
                      El fragmento está en la{' '}
                      <span style={{ color: '#fff', fontWeight: 700 }}>página {resolvedPage}</span>
                      {' '}— búscalo en el PDF de abajo.{' '}
                    </span>
                    <span style={{ color: '#555', fontSize: 12 }}>
                      Si no lo ves de inmediato, desplázate hacia abajo dentro del visor.
                    </span>
                  </div>
                </div>
              )}

              {resolving && (
                <div style={{ padding: 30, color: '#888', fontFamily: "'Caveat', cursive", fontSize: 16 }}>
                  🔍 Buscando fragmento en los materiales…
                </div>
              )}

              {!resolving && loading && !pdfUrl && (
                <div style={{ padding: 40, color: '#555', fontFamily: "'Caveat', cursive", fontSize: 16 }}>
                  Cargando PDF…
                </div>
              )}
              {error && (
                <div style={{ padding: 20, color: '#f87171', fontFamily: "'Caveat', cursive", fontSize: 15, textAlign: 'center' }}>
                  ⚠️ {error}
                </div>
              )}
              {!resolving && pdfUrl && !error && (
                <>
                  {/* Banner SOLO si no se encontró match en text-layer */}
                  {false && !highlightSuccess && !isScanned && (
                    <div style={{
                      width: '100%', maxWidth: containerWidth,
                      background: 'rgba(251,191,36,0.08)',
                      border: '1.5px dashed rgba(251,191,36,0.4)',
                      borderRadius: 12,
                      padding: '10px 14px',
                      marginBottom: -4,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: 18 }}>🔍</span>
                      <div style={{
                        flex: 1,
                        color: '#fbbf24',
                        fontSize: 13,
                        fontFamily: 'Inter, sans-serif',
                        lineHeight: 1.4,
                      }}>
                        No se pudo resaltar automáticamente. Búscalo en la página {resolvedPage}.
                      </div>
                    </div>
                  )}

                  <div ref={pageRef} style={{
                    position: 'relative',
                    borderRadius: 14,
                    overflow: 'visible',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                    background: '#fff',
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                  }}>
                    <Document file={pdfUrl}>
                      <Page
                        pageNumber={resolvedPage}
                        width={containerWidth}
                        onRenderTextLayerSuccess={() => {}}
                        renderAnnotationLayer={false}
                        renderTextLayer={false}
                      />
                    </Document>

                    {/* POST-IT flotante con el fragmento - esquina sup izq para no tapar texto */}
                    {card.sourceText && (
                      <div style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        maxWidth: 240,
                        background: 'linear-gradient(135deg, #fff7a8 0%, #ffe066 100%)',
                        color: '#1a1a1a',
                        padding: '12px 14px',
                        borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)',
                        transform: 'rotate(-1.5deg)',
                        zIndex: 10,
                        fontFamily: '"Caveat", "Marker Felt", cursive',
                        fontSize: 14,
                        lineHeight: 1.4,
                        border: '1px solid rgba(0,0,0,0.1)',
                        cursor: 'default',
                      }}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                          color: '#8a6d00',
                          marginBottom: 5,
                          fontFamily: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          📌 Busca este fragmento
                        </div>
                        <div style={{
                          fontSize: 13,
                          color: '#2a2a2a',
                          fontStyle: 'italic',
                          maxHeight: 80,
                          overflow: 'hidden',
                        }}>
                          "{card.sourceText.slice(0, 120)}{card.sourceText.length > 120 ? '…' : ''}"
                        </div>
                        <div style={{
                          marginTop: 8,
                          fontSize: 11,
                          color: '#6a5000',
                          fontStyle: 'normal',
                          fontFamily: 'inherit',
                        }}>
                          ↓ desplázate si no lo ves
                        </div>
                      </div>
                    )}

                    {/* OVERLAY OCR desactivado */}
                    {false && isScanned && ocrRects.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}>
                        {ocrRects.map((r, i) => (
                          <div
                            key={i}
                            style={{
                              position: 'absolute',
                              left: r.x + '%',
                              top: r.y + '%',
                              width: r.w + '%',
                              height: r.h + '%',
                              background: color + '55',
                              border: '2px solid ' + color,
                              borderRadius: 3,
                              boxShadow: '0 0 12px ' + color + '88',
                              mixBlendMode: 'multiply',
                              animation: 'pulseHL 1.6s ease-in-out infinite',
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Indicador progreso OCR */}
                    {ocrRunning && (
                      <div style={{
                        position: 'absolute',
                        top: 12, right: 12,
                        background: 'rgba(0,0,0,0.85)',
                        color: '#fff',
                        padding: '8px 14px',
                        borderRadius: 10,
                        fontSize: 12,
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 8,
                        zIndex: 20,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                      }}>
                        <div style={{
                          width: 14, height: 14,
                          border: '2px solid ' + color + '44',
                          borderTop: '2px solid ' + color,
                          borderRadius: '50%',
                          animation: 'spinHL 0.8s linear infinite',
                        }} />
                        Resaltando texto… {ocrProgress}%
                      </div>
                    )}


                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
