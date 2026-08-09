// ═══════════════════════════════════════════════════════
// useContent — resuelve el texto de un material
// Funciona para: texto puro, imagen, mixto
// Solo llama a la API si no hay contenido local
// ═══════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react';

export type ContentStatus =
  | 'idle'        // no empezó
  | 'loading'     // cargando desde API
  | 'ready'       // texto disponible
  | 'error';      // falló

export interface ContentResult {
  text: string;
  status: ContentStatus;
  error?: string;
  fromCache: boolean;
}

interface Options {
  materialId?: string;       // ID del nuevo sistema
  contenidoLocal?: string;   // contenido del sistema viejo
  kind?: string;             // pdf | docx | pptx | txt | image | audio
  enabled?: boolean;         // si false, no hace nada
}

export function useContent({
  materialId,
  contenidoLocal,
  kind,
  enabled = true,
}: Options): ContentResult {
  const [status, setStatus] = useState<ContentStatus>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // ─── Sistema viejo: ya tiene contenido ───
    if (contenidoLocal && contenidoLocal.trim().length > 0) {
      setText(contenidoLocal);
      setStatus('ready');
      setFromCache(true);
      return;
    }

    // ─── Nuevo sistema: pedir a la API ───
    if (materialId && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchContent(materialId, kind ?? 'pdf')
        .then(result => {
          setText(result.text);
          setStatus('ready');
          setFromCache(result.fromCache);
        })
        .catch(err => {
          setError(err.message);
          setStatus('error');
        });
      setStatus('loading');
    }
  }, [materialId, contenidoLocal, kind, enabled]);

  return { text, status, error, fromCache };
}

// ─── Múltiples materiales a la vez ───
export interface MultiContentResult {
  texts: Record<string, string>;   // materialId → texto
  status: ContentStatus;
  error?: string;
  totalChars: number;
}

export function useMultiContent(
  materials: { id: string; contenido?: string; kind?: string; materialId?: string }[],
  enabled = true,
): MultiContentResult {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ContentStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const fetchedRef = useRef(false);

  const materialsKey = JSON.stringify(
    (materials || []).map(m => ({
      id: m.id,
      materialId: m.materialId,
      hasContenido: !!(m.contenido && m.contenido.trim().length > 0),
      kind: m.kind || '',
    }))
  );

  useEffect(() => {
    fetchedRef.current = false;
    setTexts({});
    setError(undefined);
    setStatus('idle');
  }, [materialsKey]);

  useEffect(() => {
    if (!enabled || materials.length === 0) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const resolve = async () => {
      setStatus('loading');
      const result: Record<string, string> = {};

      // Separar los que ya tienen contenido de los que necesitan API
      const needAPI: typeof materials = [];

      for (const m of materials) {
        if (m.contenido && m.contenido.trim().length > 0) {
          result[m.id] = m.contenido;
        } else if (m.materialId) {
          needAPI.push(m);
        }
      }

      // Los que necesitan API: llamada en batch
      if (needAPI.length > 0) {
        try {
          const validNeedAPI = needAPI.filter(m =>
            typeof m.materialId === 'string' &&
            !m.materialId.startsWith('studyal_mastery_v2_')
          )

          const ignoredMasteryKeys = needAPI
            .filter(m => typeof m.materialId === 'string' && m.materialId.startsWith('studyal_mastery_v2_'))
            .map(m => m.materialId)

          if (ignoredMasteryKeys.length > 0) {
            console.warn('[useContent] ignored enfoques/teorico/start mastery keys:', ignoredMasteryKeys)
          }

          if (validNeedAPI.length === 0) {
            setTexts(result)
            setStatus('ready')
            return
          }

          const res = await fetch('/api/enfoques/teorico/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              materialIds: validNeedAPI.map(m => m.materialId),
            }),
          });

          if (!res.ok) throw new Error(`Error ${res.status}`);
          const data = await res.json();

          if (data.materials) {
            for (const m of validNeedAPI) {
              const extracted = data.materials[m.materialId!];
              if (extracted?.text) {
                result[m.id] = extracted.text;
              }
            }
          }
        } catch (err: any) {
          setError(err.message);
        }
      }

      setTexts(result);
      setStatus('ready');
    };

    resolve();
  }, [enabled, materials.length]);

  const totalChars = Object.values(texts).reduce((s, t) => s + t.length, 0);

  return { texts, status, error, totalChars };
}

// ─── Función interna de fetch ───
async function fetchContent(
  materialId: string,
  kind: string,
): Promise<{ text: string; fromCache: boolean }> {
  if (typeof materialId === 'string' && materialId.startsWith('studyal_mastery_v2_')) {
    console.warn('[useContent] ignored single enfoques/teorico/start call with mastery key:', materialId)
    return { text: '', fromCache: false }
  }

  const res = await fetch('/api/enfoques/teorico/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
    body: JSON.stringify({ materialIds: [materialId] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Error ${res.status}`);
  }

  const data = await res.json();
  const material = data.materials?.[materialId];

  if (!material?.text) {
    throw new Error('No se pudo extraer texto del material');
  }

  return { text: material.text, fromCache: false };
}
