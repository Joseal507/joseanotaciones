import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nombre, email, genero, tipo_estudiante, universidad, carrera, que_quieres_estudiar } = body;

    // Usar Resend, Nodemailer o cualquier servicio
    // Aquí usamos fetch a tu email con un webhook simple
    // Puedes reemplazar por Resend si tienes la API key

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jose.alberto.deobaldia@gmail.com';
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (RESEND_API_KEY) {
      // Con Resend
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'JoseAnotaciones <onboarding@resend.dev>',
          to: [ADMIN_EMAIL],
          subject: `🎉 Nuevo usuario: ${nombre}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
              <h1 style="color: #f5c842; margin-bottom: 24px;">🎉 Nuevo usuario registrado</h1>
              
              <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px; width: 140px;">👤 Nombre</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${nombre || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">📧 Email</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${email || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">⚧ Género</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${genero || '—'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">🎓 Tipo</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${tipo_estudiante || '—'}</td>
                  </tr>
                  ${universidad ? `
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">🏫 Universidad</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${universidad}</td>
                  </tr>` : ''}
                  ${carrera ? `
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">📚 Carrera</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${carrera}</td>
                  </tr>` : ''}
                  ${que_quieres_estudiar ? `
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">💭 Quiere estudiar</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${que_quieres_estudiar}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="padding: 8px 0; color: #94a3b8; font-size: 13px;">📅 Fecha</td>
                    <td style="padding: 8px 0; color: #f1f5f9; font-weight: 700;">${new Date().toLocaleString('es-ES')}</td>
                  </tr>
                </table>
              </div>

              <p style="color: #64748b; font-size: 12px; text-align: center;">
                JoseAnotaciones · Sistema de notificaciones automáticas
              </p>
            </div>
          `,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error enviando notificación:', err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}