import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import { deleteTemaCascade } from '../../../../../lib/materials/temaCascade';

export const dynamic = 'force-dynamic';

async function getUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  return user?.id || null;
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: temaId } = await context.params;
    if (!temaId) {
      return NextResponse.json({ success: false, error: 'temaId_required' }, { status: 400 });
    }

    // ─── Auth: la autoridad es SIEMPRE la sesión del servidor, nunca un
    // userId que mande el cliente ───
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    }

    const result = await deleteTemaCascade(temaId, userId);
    const hasErrors = result.materialErrors.length > 0 || result.sessionErrors.length > 0;

    if (hasErrors) {
      // Éxito parcial: lo que sí se borró ya quedó borrado (D1/R2), y la
      // operación es idempotente — repetir el DELETE reintenta solo lo que
      // falta, sin re-tocar lo ya eliminado.
      return NextResponse.json({ success: false, error: 'CASCADE_PARTIAL_FAILURE', ...result }, { status: 502 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('tema cascade delete error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
