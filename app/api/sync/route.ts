import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: materias, agenda, horario y settings ahora usan D1.',
  });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: datos gestionados por endpoints D1.',
  });
}

