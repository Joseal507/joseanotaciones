import { NextRequest, NextResponse } from 'next/server';
import { generateResetToken, hashResetToken, resetTokenExpiry } from '../../../../lib/auth/resetToken';
import { sendResetPasswordEmail, emailConfigured } from '../../../../lib/email/sendResetEmail';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

// Always the same response shape regardless of whether the email exists,
// whether email sending is configured, or whether anything failed
// internally — an attacker (or anyone) must not be able to distinguish
// "no account" from "account exists" from "something broke" by watching
// this endpoint's responses. A fresh NextResponse per call — a shared
// module-level Response instance would have its body stream consumed by
// the first request and can't be safely replayed to a second one,
// especially under Fluid Compute's concurrent instance reuse.
function genericResponse() {
  return NextResponse.json({
    success: true,
    message: 'Si existe una cuenta con ese email, te enviamos un enlace para recuperar tu contraseña.',
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!API) return genericResponse();

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    if (!email) return genericResponse();

    const userRes = await fetch(`${API}/users/by-email?email=${encodeURIComponent(email)}`, {
      cache: 'no-store',
      headers: workerAuthHeaders(),
    });
    const userData = await userRes.json().catch(() => ({}));
    const userId = userData?.user?.id;
    if (!userId) return genericResponse();

    if (!emailConfigured()) {
      console.error('forgot-password: email no configurado, no se pudo enviar el enlace');
      return genericResponse();
    }

    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    const expiresAt = resetTokenExpiry();

    const createRes = await fetch(`${API}/password-reset-tokens/create`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt }),
    });
    if (!createRes.ok) {
      console.error('forgot-password: no se pudo guardar el token', createRes.status);
      return genericResponse();
    }

    const origin = req.nextUrl.origin;
    const resetLink = `${origin}/auth/reset-password?token=${token}`;

    try {
      await sendResetPasswordEmail(userData.user.email, resetLink);
    } catch (err) {
      console.error('forgot-password: fallo enviando email', err instanceof Error ? err.message : String(err));
    }

    return genericResponse();
  } catch (err) {
    console.error('forgot-password error:', err instanceof Error ? err.message : String(err));
    return genericResponse();
  }
}
