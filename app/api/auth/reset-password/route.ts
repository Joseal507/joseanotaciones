import { NextRequest, NextResponse } from 'next/server';
import { hashResetToken, isTokenExpired, isTokenUsed } from '../../../../lib/auth/resetToken';
import { hashPassword, passwordStrengthError } from '../../../../lib/auth/password';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    if (!API) return NextResponse.json({ success: false, error: 'Servicio no disponible' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '');
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (!token) {
      return NextResponse.json({ success: false, error: 'Enlace inválido' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'Las contraseñas no coinciden' }, { status: 400 });
    }
    const strengthError = passwordStrengthError(password);
    if (strengthError) {
      return NextResponse.json({ success: false, error: strengthError }, { status: 400 });
    }

    const tokenHash = hashResetToken(token);
    const tokenRes = await fetch(`${API}/password-reset-tokens/by-hash?tokenHash=${encodeURIComponent(tokenHash)}`, {
      cache: 'no-store',
      headers: workerAuthHeaders(),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    const tokenRow = tokenData?.token;

    if (!tokenRow) {
      return NextResponse.json({ success: false, error: 'Este enlace no es válido. Pedí uno nuevo.' }, { status: 400 });
    }
    if (isTokenUsed(tokenRow)) {
      return NextResponse.json({ success: false, error: 'Este enlace ya fue usado. Pedí uno nuevo.' }, { status: 400 });
    }
    if (isTokenExpired(tokenRow)) {
      return NextResponse.json({ success: false, error: 'Este enlace expiró. Pedí uno nuevo.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    const credRes = await fetch(`${API}/credentials/upsert`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ user_id: tokenRow.user_id, password_hash: passwordHash, algo: 'scrypt' }),
    });
    if (!credRes.ok) {
      return NextResponse.json({ success: false, error: 'No se pudo actualizar la contraseña' }, { status: 500 });
    }

    // Mark used only after the new credential is safely stored — if the
    // upsert above ever fails, the token stays usable so the request isn't
    // silently burned by a transient error.
    await fetch(`${API}/password-reset-tokens/mark-used`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ token_hash: tokenHash }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('reset-password error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500 });
  }
}
