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
      es_login,
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

    // ✅ Si es login (no registro), enviar email simple
    if (es_login) {
      await transporter.sendMail({
        from: `"JoseAnotaciones 🎓" <${GMAIL_USER}>`,
        to: ADMIN_EMAIL,
        subject: `🔑 ${nombre || email} acaba de entrar`,
        html: `
          <div style="font-family:sans-serif;background:#0f172a;padding:32px;border-radius:16px;max-width:500px;margin:0 auto;">
            <h2 style="color:#f5c842;margin:0 0 16px;">🔑 Usuario activo</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:6px 0;color:#94a3b8;font-size:13px;">👤 Nombre</td>
                <td style="padding:6px 0;color:#f1f5f9;font-weight:700;">${nombre || '—'}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#94a3b8;font-size:13px;">📧 Email</td>
                <td style="padding:6px 0;color:#f1f5f9;font-weight:700;">${email || '—'}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#94a3b8;font-size:13px;">📅 Hora</td>
                <td style="padding:6px 0;color:#f1f5f9;font-weight:700;">${new Date().toLocaleString('es-ES')}</td>
              </tr>
            </table>
            <p style="color:#475569;font-size:11px;margin:16px 0 0;text-align:center;">
              JoseAnotaciones · Notificación de login
            </p>
          </div>
        `,
      });

      console.log(`✅ Email login enviado: ${nombre} (${email})`);
      return NextResponse.json({ success: true });
    }

    // ✅ Si es registro nuevo, enviar email completo
    const generoLabel: Record<string, string> = {
      hombre: '👦 Hombre',
      mujer: '👧 Mujer',
      otro: '🌈 Otro',
    };

    const tipoLabel: Record<string, string> = {
      secundaria: '🏫 Estudiante',
      universitario: '🎓 Universitario',
    };

    await transporter.sendMail({
      from: `"JoseAnotaciones 🎓" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `🎉 Nuevo usuario: ${nombre} (${carrera || tipo_estudiante || 'sin carrera'})`,
      html: `
        <div style="margin:0;padding:0;background:#0f172a;font-family:sans-serif;">
          <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
            <div style="text-align:center;margin-bottom:32px;">
              <h1 style="color:#f5c842;margin:0;font-size:20px;">🎉 Nuevo usuario registrado</h1>
              <p style="color:#64748b;font-size:13px;margin:8px 0 0;">
                ${new Date().toLocaleString('es-ES')}
              </p>
            </div>
            <div style="background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
              <div style="height:4px;background:linear-gradient(90deg,#f5c842,#ef4444,#38bdf8,#f472b6);"></div>
              <div style="padding:24px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:13px;width:140px;">👤 Nombre</td>
                    <td style="padding:8px 0;color:#f1f5f9;font-weight:700;">${nombre || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:13px;">📧 Email</td>
                    <td style="padding:8px 0;color:#f1f5f9;font-weight:700;">${email || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:13px;">⚧ Género</td>
                    <td style="padding:8px 0;color:#f1f5f9;font-weight:700;">${generoLabel[genero] || genero || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:13px;">🎓 Tipo</td>
                    <td style="padding:8px 0;color:#f1f5f9;font-weight:700;">${tipoLabel[tipo_estudiante] || tipo_estudiante || '—'}</td>
                  </tr>
                  ${universidad ? `
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:13px;">🏫 Universidad</td>
                    <td style="padding:8px 0;color:#f1f5f9;font-weight:700;">${universidad}</td>
                  </tr>` : ''}
                  ${carrera ? `
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:13px;">📚 Carrera</td>
                    <td style="padding:8px 0;color:#f5c842;font-weight:700;">${carrera}</td>
                  </tr>` : ''}
                </table>
                ${que_quieres_estudiar ? `
                <div style="margin-top:16px;padding-top:16px;border-top:1px solid #334155;">
                  <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">
                    💭 Quiere lograr
                  </p>
                  <div style="background:#0f172a;border-left:3px solid #f5c842;padding:12px 16px;border-radius:0 8px 8px 0;">
                    <p style="color:#f1f5f9;font-size:14px;margin:0;">"${que_quieres_estudiar}"</p>
                  </div>
                </div>` : ''}
              </div>
            </div>
            <p style="text-align:center;color:#475569;font-size:11px;margin:16px 0 0;">
              JoseAnotaciones · Notificación automática
            </p>
          </div>
        </div>
      `,
    });

    console.log(`✅ Email registro enviado: ${nombre} (${email})`);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('Error enviando email:', err?.message || err);
    return NextResponse.json({ success: false, error: err?.message || 'Error' }, { status: 500 });
  }
}