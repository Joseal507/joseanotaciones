import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../lib/auth/options'
import { buildSourceSelectionSnapshot } from '../../../lib/adaptive/sourceSelection'
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../../lib/adaptive/materialEnjoyer'
import { getMaterial } from '../../../lib/materials/repository'
import { WorkerFlashcardDeckStore } from '../../../lib/materialBrain/flashcards'
import {
  lookupEnjoyerFlashcardDeck,
} from '../../../lib/materialBrain/flashcards/enjoyerAdapter'
import { generateEnjoyerFlashcardDeck } from '../../../lib/materialBrain/flashcards/enjoyerGenerator'
import type { FlashcardDeckLookupStatus } from '../../../lib/materialBrain/flashcards'
import type { FlashcardDeck } from '../../../lib/materialBrain/flashcards'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const __routeDeps = {
  getServerSession,
  getMaterial,
  lookupStudyalMaterialEnjoyer,
  lookupEnjoyerFlashcardDeck,
  generateEnjoyerFlashcardDeck,
}

export interface FlashcardsV2Response {
  status: FlashcardDeckLookupStatus
  deck?: FlashcardDeck
}

export async function POST(req: NextRequest) {
  try {
    const session = await __routeDeps.getServerSession(authOptions)
    const user = (session?.user || {}) as { id?: string }
    if (!user.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
    }

    const rawMaterialIds = Array.isArray(body?.materialIds) ? body.materialIds : []
    const materialIds = rawMaterialIds
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean)
      .slice(0, 5)

    const rawSelectedPages = body?.selectedPages && typeof body.selectedPages === 'object'
      ? body.selectedPages
      : {}
    const selectedPages: Record<string, number[]> = {}
    for (const key of Object.keys(rawSelectedPages)) {
      const value = rawSelectedPages[key]
      selectedPages[key] = Array.isArray(value)
        ? value.map(Number).filter((page: number) => Number.isInteger(page) && page > 0)
        : []
    }

    if (materialIds.length === 0) {
      return NextResponse.json({ error: 'INVALID_MATERIAL_COUNT' }, { status: 400 })
    }

    for (const id of materialIds) {
      const material = await __routeDeps.getMaterial(id, user.id)
      if (!material) {
        return NextResponse.json({ error: `MATERIAL_NOT_FOUND:${id}` }, { status: 422 })
      }
    }

    const scope = buildSourceSelectionSnapshot(materialIds, selectedPages)
    const deckStore = new WorkerFlashcardDeckStore()

    // RESTORE-FIRST BEFORE THE STABILITY GATE (P4): an already-frozen
    // deck for this exact fingerprint is existing valid work — it must
    // open immediately regardless of what the Brain is doing right now
    // (e.g. a later background enrichment continuation, or a stricter
    // gate introduced after this deck was already built). Only an
    // explicit `regenerate` intent bypasses this.
    if (body?.regenerate !== true) {
      const deckLookup = await __routeDeps.lookupEnjoyerFlashcardDeck(deckStore, scope.fingerprint)
      const restorable = deckLookup.deck
        && (deckLookup.status === 'ready' || (deckLookup.status === 'partial' && deckLookup.deck.cards.some(card => card.validated)))
      if (restorable) {
        if (process.env.NODE_ENV !== 'production') console.info('[enjoyer-flashcards]', JSON.stringify({
          fingerprint: scope.fingerprint, sourceItems: deckLookup.deck!.coverage.targetedUnitIds.length,
          topics: null, generationBatches: 0, cardsGenerated: deckLookup.deck!.cards.length,
          coveredSourceItems: deckLookup.deck!.coverage.coveredUnitIds.length,
          uncoveredSourceItems: Math.max(0, deckLookup.deck!.coverage.targetedUnitIds.length - deckLookup.deck!.coverage.coveredUnitIds.length),
          coveragePercent: deckLookup.deck!.coverage.targetedUnitIds.length
            ? Math.round((deckLookup.deck!.coverage.coveredUnitIds.length / deckLookup.deck!.coverage.targetedUnitIds.length) * 10000) / 100
            : 100,
          repairAttempts: deckLookup.deck!.meta.retries, restoredFromCache: true,
        }))
        return NextResponse.json({ status: deckLookup.status, deck: deckLookup.deck! } satisfies FlashcardsV2Response, { status: 200 })
      }
    }

    // The Free hub lifecycle owns restore-first Enjoyer preparation through
    // Adaptive's existing shared blueprint pipeline. This route is lookup-only:
    // opening Flashcards never starts a second analysis pipeline/provider call.
    const enjoyer = await __routeDeps.lookupStudyalMaterialEnjoyer(
      scope.fingerprint,
      new WorkerMaterialEnjoyerStore(),
    )
    if (!enjoyer) {
      return NextResponse.json(
        { status: 'building' } satisfies FlashcardsV2Response,
        { status: 202 },
      )
    }
    const deck = await __routeDeps.generateEnjoyerFlashcardDeck(enjoyer, scope, { language: body?.language })
    await deckStore.set(scope.fingerprint, deck)
    return NextResponse.json({ status: deck.meta.status, deck } satisfies FlashcardsV2Response, { status: 200 })
  } catch (err: any) {
    console.error('flashcards-v2 route error:', err?.message || err)

    const message = err?.message || String(err)
    if (
      message.startsWith('MATERIAL_NOT_FOUND:') ||
      message.startsWith('MATERIAL_TEXT_UNAVAILABLE:') ||
      message.startsWith('AUTHORIZED_PAGES_UNAVAILABLE:')
    ) {
      return NextResponse.json({ error: message }, { status: 422 })
    }
    if (message === 'NO_MATERIALS' || message === 'TOO_MANY_MATERIALS') {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message },
      { status: 500 },
    )
  }
}
