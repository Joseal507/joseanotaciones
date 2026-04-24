import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabase as createSupabase } from '../../../lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { mensaje } = await req.json();
    if (!mensaje?.trim()) {
      return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
    }

    const GMAIL_USER = process.env.GMAIL_USER || 'jose.alberto.deobaldia@gmail.com';
    const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

    if (!GMAIL_PASS) {
      console.warn('GMAIL_APP_PASSWORD no configurado');
      return NextResponse.json({ success: true });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"StudyAL" <${GMAIL_USER}>`,
      to: 'jose.alberto.deobaldia@gmail.com',
      subject: '💡 Nueva sugerencia — StudyAL',
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; background: #0d0d1a; color: #fff; border-radius: 16px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #f5c842, #ff4d6d); padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #000;">💡 Nueva Sugerencia</h1>
          </div>
          <div style="padding: 24px;">
            <p style="color: #aaa; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px;">Mensaje del usuario</p>
            <div style="background: #1a1a2e; border-left: 3px solid #f5c842; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 16px;">
              <p style="color: #fff; font-size: 15px; line-height: 1.6; margin: 0;">${mensaje.trim()}</p>
            </div>
            <p style="color: #555; font-size: 12px; margin: 0;">
              Enviado desde StudyAL · ${new Date().toLocaleString('es-PA')}
            </p>
          </div>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Sugerencia error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
