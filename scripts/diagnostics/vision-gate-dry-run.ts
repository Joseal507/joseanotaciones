import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { extractPdf } from '../../lib/materials/extractors'
import { analyzePdfPagesContentSignals } from '../../lib/materials/pageContentSignals'
import { analyzePdfPageVisual, selectPagesNeedingVisualAnalysis } from '../../lib/materials/visualPageAnalysis'

function splitPages(text: string): Map<number, string> {
  const pages = new Map<number, string>()
  const marker = /\[(?:P[aá]gina|Pagina|Page)\s+(\d+)\]/gi
  const matches = [...text.matchAll(marker)]
  for (let index = 0; index < matches.length; index++) {
    const page = Number(matches[index][1])
    const start = matches[index].index! + matches[index][0].length
    const end = index + 1 < matches.length ? matches[index + 1].index! : text.length
    pages.set(page, text.slice(start, end).replace(/\f/g, '').trim())
  }
  return pages
}

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: vision-gate-dry-run.ts <pdf>')
  const originalFetch = globalThis.fetch
  let providerCalls = 0
  globalThis.fetch = (async () => {
    providerCalls += 1
    throw new Error('DRY_RUN_MUST_NOT_CALL_PROVIDER')
  }) as typeof fetch
  try {
    const pdfBuffer = readFileSync(path)
    const extraction = await extractPdf(pdfBuffer, { localOnly: true })
    const extractedTextByPage = splitPages(extraction.text)
    const selectedPages = Array.from({ length: extraction.pages || 0 }, (_, index) => index + 1)
    const signals = await analyzePdfPagesContentSignals({ pdfBuffer, selectedPages, extractedTextByPage })
    const candidates = new Set(selectPagesNeedingVisualAnalysis(
      extractedTextByPage,
      selectedPages,
      { policy: 'intelligent', signals },
    ))
    const realPageFlag = process.argv.indexOf('--real-page')
    const realPage = realPageFlag >= 0 ? Number(process.argv[realPageFlag + 1]) : null
    let realProviderResult: { page: number, status: string, outputChars: number, attempts: number } | undefined
    if (realPage !== null) {
      if (!candidates.has(realPage)) throw new Error(`REAL_PAGE_NOT_A_VISION_CANDIDATE:${realPage}`)
      globalThis.fetch = originalFetch
      const signal = signals.find(item => item.page === realPage)
      const result = await analyzePdfPageVisual({
        pdfBuffer,
        page: realPage,
        existingText: extractedTextByPage.get(realPage) || '',
        pageMetrics: signal,
      })
      realProviderResult = {
        page: realPage,
        status: result.status,
        outputChars: result.visualDescription.length,
        attempts: result.attempts,
      }
    }
    console.log(JSON.stringify({
      file: basename(path),
      selectedPages: selectedPages.length,
      pagesWithExtractedContent: [...extractedTextByPage.values()].filter(text => text.trim()).length,
      candidates: [...candidates],
      providerCalls,
      ...(realProviderResult ? { realProviderResult } : {}),
      pages: signals.map(signal => ({
        page: signal.page,
        extractedChars: signal.textChars,
        meaningfulChars: signal.meaningfulTextChars,
        mode: signal.mode,
        needsVision: candidates.has(signal.page),
        formula: signal.formulaLikeSignal,
        visualEvidence: signal.visualContentPresent,
        reasons: signal.reasons,
      })),
    }, null, 2))
  } finally {
    globalThis.fetch = originalFetch
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
