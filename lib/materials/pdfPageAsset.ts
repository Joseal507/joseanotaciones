import { createCanvas } from 'canvas'

/** Local deterministic page rasterization. No provider call and no OCR. */
export async function renderPdfPagePng(buffer: Buffer, pageNumber: number, scale = 1.5): Promise<Buffer> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('PDF_PAGE_INVALID')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js')
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise
  if (pageNumber > document.numPages) throw new Error('PDF_PAGE_OUT_OF_RANGE')
  const page = await document.getPage(pageNumber)
  const viewport = page.getViewport({ scale: Math.max(0.5, Math.min(scale, 2)) })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  await page.render({ canvasContext: context as any, viewport }).promise
  return canvas.toBuffer('image/png')
}
