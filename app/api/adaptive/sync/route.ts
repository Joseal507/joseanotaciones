import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const materialId = searchParams.get('materialId')
    if (!materialId) {
      return NextResponse.json({ success: false, error: 'materialId requerido' }, { status: 400 })
    }

    // TODO: agregar auth cuando lib/auth esté disponible
    // Por ahora devuelve null — client usa localStorage
    return NextResponse.json({ success: true, state: null, source: 'not_found' })

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { materialId, state } = body

    if (!materialId || !state) {
      return NextResponse.json({ success: false, error: 'materialId y state requeridos' }, { status: 400 })
    }

    // TODO: agregar auth y persistencia en Cloudflare KV
    // Por ahora acepta el payload y devuelve ok
    // El client ya guardó en localStorage antes de llamar aquí
    console.log('[Sync] State recibido para material:', materialId, '- chars:', JSON.stringify(state).length)

    return NextResponse.json({ success: true, key: `adaptive:anonymous:${materialId}` })

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
