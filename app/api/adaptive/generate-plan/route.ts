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
    const { blueprint, setup, materialTitle, quality, userProfile } = body as {
      blueprint: any;
      setup: AdaptiveSetup;
      materialTitle: string;
      quality?: {
        status: string;
        reasons?: string[];
        metrics?: any;
        coverageCertified?: boolean;
        planGenerationAllowed?: boolean;
        certificationReasons?: string[];
        auditIssues?: Array<{
          kind: 'omission' | 'invention' | 'other' | 'audit_failure';
          message: string;
        }>;
      };
      userProfile?: {
        name?: string;
        type?: string;
        university?: string;
        career?: string;
        goal?: string;
        age?: number;
      };
    };

    if (!blueprint || !setup || !materialTitle) {
      return NextResponse.json(
        { success: false, error: 'blueprint, setup y materialTitle son requeridos' },
        { status: 400 }
      );
    }

    // BLOQUEAR si la certificación no permite generar el plan
    const planBlocked =
      quality?.planGenerationAllowed === false ||
      (quality?.planGenerationAllowed === undefined && quality?.status === 'degraded');

    if (planBlocked) {
      const reasons = [
        ...(quality?.certificationReasons || []),
        ...(quality?.reasons || []),
      ].filter(Boolean);
      console.warn(`[generate-plan] BLOQUEADO — Plan no certificado para "${materialTitle}"`);
      if (reasons.length) console.warn(`[generate-plan] Razones: ${reasons.join(' | ')}`);
      return NextResponse.json({
        success: false,
        error: 'El análisis del material no está certificado. No se puede generar un plan confiable.',
        quality,
        degraded: true,
      }, { status: 422 });
    }

    console.log(`[generate-plan] Generando journey para "${materialTitle}" | exam=${setup.examDateType} | level=${setup.knowledgeLevel} | blocks=${blueprint?.blocks?.length || 0} | topics=${blueprint?.topics?.length || 0}`);

    if (!blueprint?.blocks?.length && !blueprint?.globalOrderedAnalysis?.length) {
      console.error("[generate-plan] Blueprint sin bloques — no se puede generar journey");
      return NextResponse.json({
        success: false,
        error: "El análisis del material no tiene bloques. Regenera el blueprint primero.",
        degraded: true,
      }, { status: 422 });
    }

    // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 2): buildLearningJourney
    // cascada en session-copy (llamada LLM). Si el cliente ya abortó esta
    // request (navegó fuera antes de que llegáramos aquí), no tiene sentido
    // pagar esa siguiente etapa cara — nadie va a consumir el resultado. No
    // promete cancelar trabajo YA despachado; solo evita lanzar el SIGUIENTE
    // trabajo caro cuando el consumidor ya no está.
    if (req.signal?.aborted) {
      return NextResponse.json({ success: false, error: 'cancelled', cancelled: true }, { status: 499 });
    }

    const baseUrl = getBaseUrl(req);
    const journey = await buildLearningJourney(blueprint, setup, materialTitle, baseUrl, userProfile, req.signal);

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
