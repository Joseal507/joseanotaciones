import { createHash } from 'node:crypto'
import { createCanvas } from 'canvas'

export const PAGE_INTELLIGENCE_VERSION = '2.1.0'

export function computeMaterialContentFingerprint(pdfBuffer: Buffer): string {
  return createHash('sha256').update(pdfBuffer).digest('hex')
}

export function computePdfPageFingerprint(
  materialFingerprint: string,
  page: number,
): string {
  return createHash('sha256')
    .update(`${materialFingerprint}:${page}`)
    .digest('hex')
}

export type PageAnalysisMode = 'text' | 'vision' | 'text_and_vision'

export interface PageContentSignalMetrics {
  page: number
  textChars: number
  meaningfulTextChars: number
  academicWordCount?: number
  embeddedImageCount: number
  vectorObjectCount: number
  vectorPathSegmentCount: number
  drawingOperationCount: number
  rasterInkRatio: number
  rasterColorRatio: number
  rasterEdgeDensity: number
  tableLikeSignal: boolean
  formulaLikeSignal: boolean
  captionLikeSignal: boolean
}

export interface PageAnalysisDecision {
  page: number
  mode: PageAnalysisMode
  reasons: string[]
  visualRiskScore: number
  visualContentPresent: boolean
}

export interface PageContentSignals extends PageContentSignalMetrics, PageAnalysisDecision {
  pageFingerprint: string
  analyzerVersion: string
}

export interface AnalyzePdfPagesContentOptions {
  pdfBuffer: Buffer
  selectedPages: number[]
  extractedTextByPage: Map<number, string> | Record<number, string>
}

export interface AnalyzePdfPageContentOptions {
  pdfBuffer: Buffer
  page: number
  extractedText: string
}

function round(value: number, places = 4): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function meaningfulText(text: string): string {
  return text
    .replace(/\[P[aá]gina\s+\d+\]/gi, ' ')
    .replace(/\(p[aá]gina vac[ií]a\)/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function textSignals(text: string) {
  const meaningful = meaningfulText(text)
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const tableRows = lines.filter(line =>
    /\|.*\|/.test(line) || /\S+\s{3,}\S+\s{3,}\S+/.test(line))

  return {
    textChars: text.trim().length,
    meaningfulTextChars: meaningful.length,
    academicWordCount: meaningful ? meaningful.split(/\s+/u).filter(token => /\p{L}/u.test(token)).length : 0,
    tableLikeSignal: tableRows.length >= 2,
    formulaLikeSignal: /(?:[=∑√∫≈≤≥]|\b(?:sin|cos|tan|log)\s*\(|\b[A-Za-z]\s*\^\s*\d)/.test(text),
    captionLikeSignal: /\b(?:fig(?:ura|ure)?|gr[aá]fic[ao]|diagram[ae]|tabla|chart)\s*\d*\b/i.test(text),
  }
}

function analyzeRaster(data: Uint8ClampedArray, width: number, height: number) {
  let ink = 0
  let color = 0
  let edges = 0
  let comparisons = 0
  const luminance = new Uint8Array(width * height)

  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const alpha = data[offset + 3]
    const light = Math.round(red * 0.299 + green * 0.587 + blue * 0.114)
    luminance[pixel] = light
    if (alpha > 10 && light < 245) ink += 1
    if (alpha > 10 && Math.max(red, green, blue) - Math.min(red, green, blue) > 24 && light < 245) color += 1
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (x + 1 < width) {
        comparisons += 1
        if (Math.abs(luminance[index] - luminance[index + 1]) > 32) edges += 1
      }
      if (y + 1 < height) {
        comparisons += 1
        if (Math.abs(luminance[index] - luminance[index + width]) > 32) edges += 1
      }
    }
  }

  const pixels = Math.max(1, width * height)
  return {
    rasterInkRatio: round(ink / pixels),
    rasterColorRatio: round(color / pixels),
    rasterEdgeDensity: round(edges / Math.max(1, comparisons)),
  }
}

export function decidePageAnalysisMode(
  signals: PageContentSignalMetrics,
): PageAnalysisDecision {
  const hasText = signals.meaningfulTextChars > 0
  const lowText = signals.meaningfulTextChars <= 80
  const highText = signals.meaningfulTextChars >= 500
  // A short academic slide is not an extraction failure. Formulae and a
  // compact explanatory sentence can faithfully represent the whole page.
  // Character count is only a supporting signal; it never authorizes vision
  // by itself.
  const compactAcademicText = signals.formulaLikeSignal
    || signals.tableLikeSignal
    || (signals.academicWordCount || 0) >= 7
    || signals.meaningfulTextChars >= 81
  const hasSignificantInk = signals.rasterInkRatio >= 0.008
  const embeddedVisual = signals.embeddedImageCount > 0 && hasSignificantInk
  const vectorVisual = signals.vectorPathSegmentCount >= 12
    && signals.drawingOperationCount >= 3
    && hasSignificantInk
  const coloredVisual = signals.rasterColorRatio >= 0.012
    && signals.rasterEdgeDensity >= 0.012
    && signals.rasterInkRatio >= 0.02
  const visualContentPresent = embeddedVisual || vectorVisual || coloredVisual
  // Embedded images are frequently page backgrounds, logos or decorative
  // chrome. With usable text they require an additional academic/structural
  // signal before vision is justified.
  const needsVisionAlongsideText = visualContentPresent
    && (signals.tableLikeSignal || signals.captionLikeSignal)

  let risk = 0
  if (embeddedVisual) risk += 0.38
  if (vectorVisual) risk += 0.28
  if (coloredVisual) risk += 0.16
  if (signals.vectorPathSegmentCount >= 40) risk += 0.08
  if (signals.rasterEdgeDensity >= 0.03) risk += 0.05
  if (signals.tableLikeSignal && visualContentPresent) risk += 0.03
  if (signals.formulaLikeSignal && visualContentPresent) risk += 0.02
  const visualRiskScore = round(Math.min(1, risk))

  if (!visualContentPresent) {
    return {
      page: signals.page,
      mode: 'text',
      reasons: [
        hasText ? (highText ? 'high_text' : 'meaningful_text_present') : 'blank_no_visual_content',
        'low_visual_risk',
      ],
      visualRiskScore,
      visualContentPresent,
    }
  }

  const visualReasons = [
    embeddedVisual ? 'embedded_image' : '',
    vectorVisual ? 'high_visual_complexity' : '',
    coloredVisual ? 'raster_visual_complexity' : '',
    signals.tableLikeSignal ? 'table_like_content' : '',
    signals.formulaLikeSignal ? 'formula_like_content' : '',
    signals.captionLikeSignal ? 'caption_like_content' : '',
  ].filter(Boolean)

  if (!hasText || (lowText && !compactAcademicText)) {
    return {
      page: signals.page,
      mode: 'vision',
      reasons: [hasText ? 'insufficient_extracted_representation' : 'extraction_missing', 'visual_content_present', ...visualReasons],
      visualRiskScore,
      visualContentPresent,
    }
  }

  if (!needsVisionAlongsideText) {
    return {
      page: signals.page,
      mode: 'text',
      reasons: ['meaningful_text_present', 'text_sufficient', 'low_visual_risk'],
      visualRiskScore,
      visualContentPresent,
    }
  }

  return {
    page: signals.page,
    mode: 'text_and_vision',
    reasons: ['meaningful_text_present', 'visual_content_present', ...visualReasons],
    visualRiskScore,
    visualContentPresent,
  }
}

function textForPage(
  source: Map<number, string> | Record<number, string>,
  page: number,
): string {
  return source instanceof Map ? source.get(page) || '' : source[page] || ''
}

function countOperators(fnArray: number[], argsArray: unknown[][], ops: Record<string, number>) {
  const imageOps = new Set([
    ops.paintImageMaskXObject,
    ops.paintImageMaskXObjectGroup,
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
    ops.paintInlineImageXObjectGroup,
    ops.paintImageXObjectRepeat,
    ops.paintImageMaskXObjectRepeat,
    ops.paintSolidColorImageMask,
  ])
  const drawingOps = new Set([
    ops.stroke,
    ops.closeStroke,
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
    ops.shadingFill,
  ])
  let embeddedImageCount = 0
  let vectorObjectCount = 0
  let vectorPathSegmentCount = 0
  let drawingOperationCount = 0

  fnArray.forEach((operator, index) => {
    if (imageOps.has(operator)) embeddedImageCount += 1
    if (operator === ops.constructPath) {
      vectorObjectCount += 1
      const pathOperators = argsArray[index]?.[0]
      vectorPathSegmentCount += Array.isArray(pathOperators) ? pathOperators.length : 1
    }
    if (drawingOps.has(operator)) drawingOperationCount += 1
  })

  return { embeddedImageCount, vectorObjectCount, vectorPathSegmentCount, drawingOperationCount }
}

export async function analyzePdfPagesContentSignals(
  options: AnalyzePdfPagesContentOptions,
): Promise<PageContentSignals[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js')
  const document = await pdfjs.getDocument({
    data: new Uint8Array(options.pdfBuffer),
    disableFontFace: true,
  }).promise
  const pages = [...new Set(options.selectedPages)]
    .filter(page => Number.isInteger(page) && page >= 1 && page <= document.numPages)
    .sort((a, b) => a - b)
  const contentFingerprint = computeMaterialContentFingerprint(options.pdfBuffer)
  const results: PageContentSignals[] = []

  for (const pageNumber of pages) {
    const page = await document.getPage(pageNumber)
    const operatorList = await page.getOperatorList()
    const viewport = page.getViewport({ scale: 0.35 })
    const width = Math.max(1, Math.ceil(viewport.width))
    const height = Math.max(1, Math.ceil(viewport.height))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    await page.render({ canvasContext: context as any, viewport }).promise
    const raster = analyzeRaster(context.getImageData(0, 0, width, height).data, width, height)
    const extractedText = textForPage(options.extractedTextByPage, pageNumber)
    const metrics: PageContentSignalMetrics = {
      page: pageNumber,
      ...textSignals(extractedText),
      ...countOperators(operatorList.fnArray, operatorList.argsArray, pdfjs.OPS),
      ...raster,
    }
    const decision = decidePageAnalysisMode(metrics)
    const pageFingerprint = computePdfPageFingerprint(contentFingerprint, pageNumber)
    results.push({
      ...metrics,
      ...decision,
      pageFingerprint,
      analyzerVersion: PAGE_INTELLIGENCE_VERSION,
    })
  }

  await document.destroy()
  return results
}

export async function analyzePdfPageContentSignals(
  options: AnalyzePdfPageContentOptions,
): Promise<PageContentSignals> {
  const [result] = await analyzePdfPagesContentSignals({
    pdfBuffer: options.pdfBuffer,
    selectedPages: [options.page],
    extractedTextByPage: { [options.page]: options.extractedText },
  })
  if (!result) throw new Error('PDF_PAGE_OUT_OF_RANGE')
  return result
}
