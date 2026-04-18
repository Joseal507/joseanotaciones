import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET(req: NextRequest) {
  try {
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

    // Diagnóstico de variables
    const diagnostico = {
      GMAIL_USER: GMAIL_USER ? `✅ ${GMAIL_USER}` : '❌ NO CONFIGURADO',
      GMAIL_PASS: GMAIL_PASS ? `✅ ${GMAIL_PASS.length} caracteres` : '❌ NO CONFIGURADO',
      ADMIN_EMAIL: ADMIN_EMAIL ? `✅ ${ADMIN_EMAIL}` : '❌ NO CONFIGURADO',
    };

    if (!GMAIL_USER || !GMAIL_PASS) {
      return NextResponse.json({
        success: false,
        error: 'Variables de entorno faltantes',
        diagnostico,
      });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    });

    // Verificar conexión
    await transporter.verify();

    // Enviar email de prueba
    await transporter.sendMail({
      from: `"JoseAnotaciones Test" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL || GMAIL_USER,
      subject: '✅ Test email JoseAnotaciones',
      html: `<h1>Funciona!</h1><p>El sistema de emails está configurado correctamente.</p><p>Hora: ${new Date().toLocaleString('es-ES')}</p>`,
    });

    return NextResponse.json({
      success: true,
      mensaje: 'Email enviado correctamente',
      diagnostico,
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Error desconocido',
      codigo: err?.code,
      diagnostico: {
        GMAIL_USER: process.env.GMAIL_USER ? '✅ existe' : '❌ falta',
        GMAIL_PASS: process.env.GMAIL_APP_PASSWORD ? '✅ existe' : '❌ falta',
        ADMIN_EMAIL: process.env.ADMIN_EMAIL ? '✅ existe' : '❌ falta',
      },
    });
  }
}