import { NextResponse } from 'next/server'
import { extractText } from '../../../../lib/materials/extractors'
import type { MaterialKind } from '../../../../lib/materials/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SupportedMaterialKind = Extract<MaterialKind, 'pdf' | 'docx'>

const kinds: Record<string, SupportedMaterialKind> = {
  pdf: 'pdf',
  docx: 'docx',
}

const allowedTypes: Record<SupportedMaterialKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export function GET() {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'E2E endpoint disabled' }, { status: 404 })
  return NextResponse.json({ ready: true })
}

function humanConcepts(text: string): string[] {
  const technical = /^(?:micro|concept|node)[_-]?\d+/i
  const candidates = text
    .replace(/\[Pagina \d+\]/gi, ' ')
    .split(/[\n.!?]+/)
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(value => value.length >= 18 && value.length <= 110 && !technical.test(value))

  const unique: string[] = []
  for (const candidate of candidates) {
    const name = candidate.replace(/^[-•\d.)\s]+/, '').trim()
    if (!name || unique.some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase())) continue
    unique.push(name)
    if (unique.length === 9) break
  }
  return unique
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'E2E endpoint disabled' }, { status: 404 })
  }

  const contentType = request.headers.get('content-type') ?? ''
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean)
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundary) {
    return NextResponse.json({
      ok: false,
      code: 'INVALID_MULTIPART_REQUEST',
      message: 'Missing multipart boundary',
    }, { status: 400 })
  }

  const requestBytes = await request.arrayBuffer()
  let form: FormData
  try {
    // Next's Request wrapper can expose a valid header while losing the multipart
    // metadata used by request.formData(). A plain Response binds the preserved
    // bytes and Content-Type together before invoking the same web parser.
    form = await new Response(requestBytes, {
      headers: { 'Content-Type': contentType },
    }).formData()
  } catch (error) {
    console.warn('Invalid multipart request', {
      contentType: 'multipart/form-data',
      hasBoundary: true,
      requestBytes: requestBytes.byteLength,
      reason: error instanceof Error ? error.message : 'Unknown multipart parse error',
    })
    return NextResponse.json({
      ok: false,
      code: 'INVALID_MULTIPART_REQUEST',
      message: 'Unable to parse multipart body',
    }, { status: 400 })
  }
  const upload = form.get('file')
  if (!(upload instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const extension = upload.name.split('.').pop()?.toLowerCase() ?? ''
  const kind = kinds[extension]
  if (!kind) {
    return NextResponse.json({
      ok: false,
      code: 'UNSUPPORTED_FIXTURE_FORMAT',
      message: 'Only PDF and DOCX fixtures are supported by this E2E route',
    }, { status: 415 })
  }

  const buffer = Buffer.from(await upload.arrayBuffer())
  if (buffer.length === 0 || buffer.length !== upload.size) {
    return NextResponse.json({
      ok: false,
      code: 'INCOMPLETE_UPLOAD',
      message: 'Uploaded bytes do not match the parsed file size',
    }, { status: 400 })
  }
  if (upload.type !== allowedTypes[kind]) {
    return NextResponse.json({
      ok: false,
      code: 'INVALID_FILE_TYPE',
      message: 'Uploaded file type does not match its supported format',
    }, { status: 415 })
  }
  const hasExpectedHeader = kind === 'pdf'
    ? buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    : buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!hasExpectedHeader) {
    return NextResponse.json({
      ok: false,
      code: 'INVALID_FILE_HEADER',
      message: 'Uploaded bytes do not match the declared format',
    }, { status: 415 })
  }

  const extraction = await extractText(buffer, kind, upload.type, upload.name, { localOnly: true })
  const concepts = humanConcepts(extraction.text)
  const identityTokens = extraction.text
    .replace(/\[Pagina \d+\]/gi, ' ')
    .match(/[\p{L}\p{N}]{5,}/gu)?.slice(0, 12) ?? []

  return NextResponse.json({
    file: {
      name: upload.name,
      type: upload.type,
      size: upload.size,
      extension,
      multipart: { contentType, hasBoundary: true, requestBytes: requestBytes.byteLength },
    },
    server: {
      receivedName: upload.name,
      receivedType: upload.type,
      receivedSize: upload.size,
      bufferLength: buffer.length,
      extractionChars: extraction.chars,
      extractionKind: extraction.classification ?? kind,
      sourceName: upload.name,
      provider: 'local',
      openRouterUsed: false,
    },
    extraction,
    graph: {
      sourceName: upload.name,
      totalMicros: concepts.length,
      micros: concepts.map((name, index) => ({ id: `extracted_${index + 1}`, name })),
      identityTokens,
    },
    layer: { upload: 'real', extraction: 'real-local', graph: 'deterministic-from-extracted-text' },
  })
}
