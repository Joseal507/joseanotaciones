import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getMaterial,
  getMaterialText,
  saveMaterialText,
  updateMaterialTextStatus,
} from '../../../../../lib/materials/repository';
import { downloadFromR2 } from '../../../../../lib/materials/storage';
import { extractText } from '../../../../../lib/materials/extractors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // ─── Auth ───
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { materialIds } = await req.json();
    if (!materialIds?.length) {
      return NextResponse.json({ error: 'materialIds requeridos' }, { status: 400 });
    }

    const results: Record<string, {
      text: string;
      nombre: string;
      kind: string;
      isImageBased: boolean;
      fromCache: boolean;
      chars: number;
    }> = {};

    // Procesar en paralelo (máx 3)
    const batch = materialIds.slice(0, 5);
    await Promise.all(
      batch.map(async (materialId: string) => {
        try {
          // Verificar ownership
          const material = await getMaterial(materialId, user.id);
          if (!material) {
            console.warn(`Material ${materialId} no encontrado para user ${user.id}`);
            return;
          }

          // ── Cache hit: texto ya extraído ──
          const cached = await getMaterialText(materialId);
          // Solo reextraer si el texto NO tiene separadores de ningún tipo
          //  = pdf-parse nativo | [Pagina N] = formato legacy | texto largo = Gemini OCR (sin páginas, ok)
          const hasPageSeparators =
            cached?.raw_text.includes('\f') ||
            cached?.raw_text.includes('[Pagina ') ||
            cached?.raw_text.includes('[Página ') ||
            cached?.raw_text.includes('[Page ');
          // Si el texto es suficientemente largo aunque no tenga separadores (Gemini OCR), NO reextraer
          const isLongEnough = (cached?.raw_text.length ?? 0) > 500;
          const shouldRefreshPdfCache =
            !!cached &&
            material.kind === 'pdf' &&
            cached.raw_text.length > 0 &&
            !hasPageSeparators &&
            !isLongEnough;

          if (shouldRefreshPdfCache) {
            console.log(`♻️ Reextrayendo PDF ${material.nombre} para guardar separadores por página`);
          }

          if (cached && cached.raw_text.length > 0 && !shouldRefreshPdfCache) {
            results[materialId] = {
              text: cached.raw_text,
              nombre: material.nombre,
              kind: material.kind,
              isImageBased: material.kind === 'image',
              fromCache: true,
              chars: cached.raw_text.length,
            };
            return;
          }

          // ── Cache miss: extraer ahora ──
          await updateMaterialTextStatus(materialId, 'processing');

          const buffer = await downloadFromR2(material.storage_key);
          const extraction = await extractText(
            buffer,
            material.kind,
            material.mime_type,
            material.nombre,
          );

          if (extraction.hasText && extraction.text.length > 0) {
            // Limpiar el texto antes de guardar
            const cleanText = cleanExtractedText(extraction.text);

            await saveMaterialText(materialId, cleanText);
            await updateMaterialTextStatus(materialId, 'ready', {
              extracted_chars: cleanText.length,
              pages_count: extraction.pages,
            });

            results[materialId] = {
              text: cleanText,
              nombre: material.nombre,
              kind: material.kind,
              isImageBased: extraction.isImageBased,
              fromCache: false,
              chars: cleanText.length,
            };
          } else {
            await updateMaterialTextStatus(materialId, 'error', {
              last_error: `No se pudo extraer texto (método: ${extraction.method})`,
            });
            console.warn(`❌ Sin texto: ${material.nombre} (${extraction.method})`);
          }

        } catch (e: any) {
          console.error(`Error procesando ${materialId}:`, e?.message);
          try {
            await updateMaterialTextStatus(materialId, 'error', {
              last_error: e.message,
            });
          } catch {}
        }
      })
    );

    if (Object.keys(results).length === 0) {
      return NextResponse.json(
        { error: 'No se pudo extraer texto de ningún material' },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      materials: results,
      count: Object.keys(results).length,
      totalChars: Object.values(results).reduce((s, r) => s + r.chars, 0),
    });

  } catch (err: any) {
    console.error('enfoque/teorico/start error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Limpiar texto extraído ───
function cleanExtractedText(text: string): string {
  // Proteger separadores de página ANTES de limpiar
  const MARKER = '<<PAGE_BREAK>>';
  return text
    .replace(/\f/g, MARKER)
    // Quitar referencias de imágenes markdown
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\b\S+\.(jpeg|jpg|png|gif|webp|svg|bmp)\b/gi, '')
    // Normalizar saltos de línea (sin tocar el MARKER)
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    // Quitar líneas que son solo espacios
    .replace(/^[ \t]+$/gm, '')
    // Restaurar separadores de página
    .replace(new RegExp(MARKER, 'g'), '\f')
    .trim();
}
