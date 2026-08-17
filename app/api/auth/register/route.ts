import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, passwordStrengthError } from '../../../../lib/auth/password';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export async function POST(req: NextRequest) {
  try {
    if (!API) return NextResponse.json({ success: false, error: 'Servicio no disponible' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');

    if (!isValidEmail(email)) {
      return NextResponse.json({ success: false, error: 'Email inválido' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'Las contraseñas no coinciden' }, { status: 400 });
    }
    const strengthError = passwordStrengthError(password);
    if (strengthError) {
      return NextResponse.json({ success: false, error: strengthError }, { status: 400 });
    }

    // Reject if ANY account already owns this email (Google or password).
    // Attaching a password to a pre-existing account must go through the
    // authenticated set-password flow (proves ownership via an active
    // session) — never through anonymous registration, which would let
    // anyone claim a password login for someone else's email.
    const existingRes = await fetch(`${API}/users/by-email?email=${encodeURIComponent(email)}`, {
      cache: 'no-store',
      headers: workerAuthHeaders(),
    });
    const existingData = await existingRes.json().catch(() => ({}));
    if (existingData?.user?.id) {
      return NextResponse.json({ success: false, error: 'Ya existe una cuenta con este email' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const createRes = await fetch(`${API}/users/upsert`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ email, provider: 'credentials' }),
    });
    const createData = await createRes.json().catch(() => ({}));
    const userId = createData?.user?.id;
    if (!userId) {
      console.error('register: users/upsert failed', createRes.status);
      return NextResponse.json({ success: false, error: 'No se pudo crear la cuenta' }, { status: 500 });
    }

    const credRes = await fetch(`${API}/credentials/upsert`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ user_id: userId, password_hash: passwordHash, algo: 'scrypt' }),
    });
    if (!credRes.ok) {
      console.error('register: credentials/upsert failed', credRes.status);
      return NextResponse.json({ success: false, error: 'No se pudo crear la cuenta' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('register error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500 });
  }
}
