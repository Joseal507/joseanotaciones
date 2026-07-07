import { NextRequest, NextResponse } from 'next/server'

// Storage en memoria del servidor — persiste mientras el servidor esté corriendo
// Para persistencia real entre reinicios, los datos también van en localStorage del cliente
const memoryStore = new Map<string, any>()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { materialId, state } = body

    if (!materialId || !state) {
      return NextResponse.json({ success: false, error: 'Faltan datos' }, { status: 400 })
    }

    memoryStore.set(materialId, {
      ...state,
      savedAt: Date.now(),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const materialId = searchParams.get('materialId')

    if (!materialId) {
      return NextResponse.json({ success: false, error: 'Falta materialId' }, { status: 400 })
    }

    const state = memoryStore.get(materialId) || null
    return NextResponse.json({ success: true, state })

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
