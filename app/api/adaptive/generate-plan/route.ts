import { NextRequest, NextResponse } from 'next/server';
import { buildLearningJourney } from '../../../../lib/adaptive/journeyBuilder';

// URL base para llamadas internas del servidor
function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}
import type { AdaptiveSetup } from '../../../../lib/studySessions';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { blueprint, setup, materialTitle } = body as {
      blueprint: any;
      setup: AdaptiveSetup;
      materialTitle: string;
    };

    if (!blueprint || !setup || !materialTitle) {
      return NextResponse.json(
        { success: false, error: 'blueprint, setup y materialTitle son requeridos' },
        { status: 400 }
      );
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
