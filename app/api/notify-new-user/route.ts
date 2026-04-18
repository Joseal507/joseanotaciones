import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      nombre,
      email,
      genero,
      tipo_estudiante,
      universidad,
      carrera,
      que_quieres_estudiar,
    } = body;

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jose.alberto.deobaldia@gmail.com';
    const GMAIL_USER = process.env.GMAIL_USER || 'jose.alberto.deobaldia@gmail.com';
    const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

    if (!GMAIL_PASS) {
      console.warn('GMAIL_APP_PASSWORD no configurado');
      return NextResponse.json({ success: false, error: 'Email no configurado' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    });

    const generoLabel: Record<string, string> = {
      hombre: '👦 Hombre',
      mujer: '👧 Mujer',
      otro: '🌈 Otro / Prefiero no decir',
    };

    const tipoLabel: Record<string, string> = {
      secundaria: '🏫 Estudiante (Bachillerato/Secundaria)',
      universitario: '🎓 Universitario',
    };

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
      </head>
      <body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,sans-serif;">
        <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
          
          <!-- Header -->
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-block;background:#f5c84220;border:2px solid #f5c842;border-radius:16px;padding:12px 24px;">
              <h1 style="color:#f5c842;margin:0;font-size:20px;font-weight:900;">
                🎉 JoseAnotaciones
              </h1>
            </div>
            <h2 style="color:#f1f5f9;font-size:16px;font-weight:700;margin:16px 0 4px;">
              Nuevo usuario registrado
            </h2>
            <p style="color:#64748b;font-size:13px;margin:0;">
              ${new Date().toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}
            </p>
          </div>

          <!-- Card datos -->
          <div style="background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;margin-bottom:16px;">
            <div style="height:4px;background:linear-gradient(90deg,#f5c842,#ef4444,#38bdf8,#f472b6);"></div>
            <div style="padding:24px;">
              
              <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #334155;">
                <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">
                  Información personal
                </p>
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;color:#94a3b8;font-size:13px;width:130px;">👤 Nombre</td>
                    <td style="padding:6px 0;color:#f1f5f9;font-weight:700;font-size:14px;">${nombre || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#94a3b8;font-size:13px;">📧 Email</td>
                    <td style="padding:6px 0;color:#f1f5f9;font-weight:700;font-size:14px;">${email || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#94a3b8;font-size:13px;">⚧ Género</td>
                    <td style="padding:6px 0;color:#f1f5f9;font-weight:700;font-size:14px;">${generoLabel[genero] || genero || '—'}</td>
                  </tr>
                </table>
              </div>

              <div style="${(universidad || carrera) ? 'margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #334155;' : ''}">
                <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">
                  Perfil académico
                </p>
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;color:#94a3b8;font-size:13px;width:130px;">🎓 Tipo</td>
                    <td style="padding:6px 0;color:#f1f5f9;font-weight:700;font-size:14px;">${tipoLabel[tipo_estudiante] || tipo_estudiante || '—'}</td>
                  </tr>
                  ${universidad ? `
                  <tr>
                    <td style="padding:6px 0;color:#94a3b8;font-size:13px;">🏫 Universidad</td>
                    <td style="padding:6px 0;color:#f1f5f9;font-weight:700;font-size:14px;">${universidad}</td>
                  </tr>` : ''}
                  ${carrera ? `
                  <tr>
                    <td style="padding:6px 0;color:#94a3b8;font-size:13px;">📚 Carrera</td>
                    <td style="padding:6px 0;color:#f5c842;font-weight:700;font-size:14px;">${carrera}</td>
                  </tr>` : ''}
                </table>
              </div>

              ${que_quieres_estudiar ? `
              <div>
                <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
                  💭 Quiere lograr
                </p>
                <div style="background:#0f172a;border-left:3px solid #f5c842;border-radius:0 8px 8px 0;padding:12px 16px;">
                  <p style="color:#f1f5f9;font-size:14px;margin:0;line-height:1.6;">
                    "${que_quieres_estudiar}"
                  </p>
                </div>
              </div>` : ''}

            </div>
          </div>

          <!-- Footer -->
          <p style="text-align:center;color:#475569;font-size:11px;margin:0;">
            JoseAnotaciones · Notificación automática de nuevo registro
          </p>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"JoseAnotaciones 🎓" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `🎉 Nuevo usuario: ${nombre} (${carrera || tipo_estudiante || 'sin carrera'})`,
      html: htmlContent,
    });

    console.log(`✅ Email enviado para nuevo usuario: ${nombre} (${email})`);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('Error enviando email:', err?.message || err);
    // No fallar silenciosamente — devolver el error para debug
    return NextResponse.json({
      success: false,
      error: err?.message || 'Error desconocido',
    }, { status: 500 });
  }
}