import { NextRequest, NextResponse } from 'next/server';
import { buildLearningJourney } from '../../../../lib/adaptive/journeyBuilder';
import type { AdaptiveSetup } from '../../../../lib/studySessions';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { blueprint, setup, materialTitle, quality } = body as {
      blueprint: any;
      setup: AdaptiveSetup;
      materialTitle: string;
      quality?: { status: string; reasons?: string[]; metrics?: any };
    };

    if (!blueprint || !setup || !materialTitle) {
      return NextResponse.json(
        { success: false, error: 'blueprint, setup y materialTitle son requeridos' },
        { status: 400 }
      );
    }

    // BLOQUEAR si el blueprint está degradado
    if (quality?.status === 'degraded') {
      console.warn(`[generate-plan] BLOQUEADO — Blueprint degradado para "${materialTitle}"`);
      console.warn(`[generate-plan] Razones: ${(quality.reasons || []).join(' | ')}`);
      return NextResponse.json({
        success: false,
        error: 'El análisis del material no está completo. No se puede generar un plan confiable.',
        quality,
        degraded: true,
      }, { status: 422 });
    }

    console.log(`[generate-plan] Generando journey para "${materialTitle}" | exam=${setup.examDateType} | level=${setup.knowledgeLevel}`);

    const baseUrl = getBaseUrl(req);
    const journey = await buildLearningJourney(blueprint, setup, materialTitle, baseUrl);

    console.log(`[generate-plan] Journey generado: ${journey.totalChapters} sesiones para "${materialTitle}"`);

    return NextResponse.json({ success: true, journey });

  } catch (e: any) {
    console.error('[generate-plan] Error:', e?.message);
    return NextResponse.json(
      { success: false, error: e?.message || 'Error interno' },
      { status: 500 }
    );
  }
}
