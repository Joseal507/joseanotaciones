import nodemailer from 'nodemailer';

// Reuses the same Gmail/nodemailer setup already proven working in
// app/api/notify-new-user and app/api/sugerencia — no new email provider.
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';

export function emailConfigured(): boolean {
  return Boolean(GMAIL_USER && GMAIL_PASS);
}

export async function sendResetPasswordEmail(to: string, resetLink: string): Promise<void> {
  if (!emailConfigured()) {
    throw new Error('GMAIL_APP_PASSWORD no configurado');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  await transporter.sendMail({
    from: `"StudyAL" <${GMAIL_USER}>`,
    to,
    subject: '🔑 Recuperar tu contraseña — StudyAL',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; background: #0d0d1a; color: #fff; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #d6b26f, #ef4444); padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 22px; color: #000;">🔑 Recuperar contraseña</h1>
        </div>
        <div style="padding: 24px;">
          <p style="color: #f1f5f9; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            Pediste restablecer tu contraseña de StudyAL. Tocá el botón para elegir una nueva. Este enlace expira en 1 hora y solo se puede usar una vez.
          </p>
          <a href="${resetLink}" style="display:inline-block;background:#d6b26f;color:#000;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:10px;">
            Elegir nueva contraseña
          </a>
          <p style="color: #64748b; font-size: 12px; margin: 20px 0 0;">
            Si no pediste esto, podés ignorar este email — tu contraseña actual sigue funcionando.
          </p>
        </div>
      </div>
    `,
  });
}
