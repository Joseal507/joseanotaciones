import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../../lib/auth/studyalUser';
import { hashPassword, passwordStrengthError } from '../../../../lib/auth/password';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

// Authenticated-only: adds/replaces a password credential on the caller's
// OWN users.id, proven by an active NextAuth session (works whether that
// session originated from Google or an existing password login). This is
// the only safe direction to attach a password to an account that may have
// started on Google — ownership comes from the session, never from a
// client-supplied email.
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    if (!API) return NextResponse.json({ success: false, error: 'Servicio no disponible' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'Las contraseñas no coinciden' }, { status: 400 });
    }
    const strengthError = passwordStrengthError(password);
    if (strengthError) {
      return NextResponse.json({ success: false, error: strengthError }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const res = await fetch(`${API}/credentials/upsert`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ user_id: user.id, password_hash: passwordHash, algo: 'scrypt' }),
    });
    if (!res.ok) {
      return NextResponse.json({ success: false, error: 'No se pudo guardar la contraseña' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('set-password error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500 });
  }
}
