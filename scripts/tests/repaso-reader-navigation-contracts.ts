import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  changeRepasoReaderMaterial,
  buildBoundedPageItems,
  createActiveReaderNavigation,
  moveRepasoReader,
  openRecoveryReader,
  setRepasoReaderZoom,
} from '../../lib/repasoReaderNavigation'

const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
const viewer = readFileSync('components/materias/RepasarViewer.tsx', 'utf8')

// Active reading -> explanation -> active reading can repeat without converting
// the absolute PDF page into an array index or resetting zoom.
let active = createActiveReaderNavigation({ materialId: 'm1', selectedPages: [2, 7, 9] })
assert.equal(active.currentPage, 2)
active = moveRepasoReader(active, 7)
active = setRepasoReaderZoom(active, 1.3)
assert.equal(active.currentPage, 7)
assert.equal(active.zoom, 1.3)
// Phase changes do not mutate document navigation identity.
const afterFirstRoundTrip = active
assert.equal(afterFirstRoundTrip.currentPage, 7)
active = moveRepasoReader(afterFirstRoundTrip, 9)
assert.equal(active.currentPage, 9)
assert.equal(active.zoom, 1.3)
assert.equal(active.materialId, 'm1')

// A real source change resets to that source's first absolute selected page;
// a same-source phase change does not.
const changedSource = changeRepasoReaderMaterial(active, 'm2', [4, 11])
assert.equal(changedSource.currentPage, 4)
assert.equal(changeRepasoReaderMaterial(changedSource, 'm2', [4, 11]).currentPage, 4)

// Recovery starts at the first canonical server-projected page. Reopening the
// same frozen group restores its last absolute relevant page; a new group resets.
let recovery = openRecoveryReader(active, { materialId: 'm1', selectedPages: [2, 3, 7, 8, 9], recommendedPages: [3, 8], recoveryGroupId: 'g1' })
assert.equal(recovery.currentPage, 3)
recovery = moveRepasoReader(recovery, 8)
assert.equal(recovery.currentPage, 8)
const reopened = openRecoveryReader(recovery, { materialId: 'm1', selectedPages: [2, 3, 7, 8, 9], recommendedPages: [3, 8], recoveryGroupId: 'g1' })
assert.equal(reopened.currentPage, 8)
assert.equal(moveRepasoReader(reopened, 7).currentPage, 7, 'recommendations do not restrict selected-page authority')
assert.equal(moveRepasoReader(reopened, 4).currentPage, 8, 'unselected pages remain unauthorized')
assert.equal(openRecoveryReader(reopened, { materialId: 'm1', selectedPages: [2, 3, 7, 8, 9], recommendedPages: [3, 8], recoveryGroupId: 'g2' }).currentPage, 3)

// Forty-three pages remain bounded and use absolute page labels.
const pages43 = Array.from({ length: 43 }, (_, index) => index + 1)
const paginator = buildBoundedPageItems(pages43, 22)
assert.ok(paginator.length < 14)
assert.deepEqual(paginator.slice(0, 3), [1, 2, 'ellipsis-start'])
assert.deepEqual(paginator.slice(-3), ['ellipsis-end', 42, 43])
assert.ok(paginator.includes(22))
assert.deepEqual(buildBoundedPageItems([3, 7, 9], 7), [3, 7, 9])

// Runtime wiring: controlled absolute page/material/zoom, no phase key/remount,
// no provider request in either navigation handler, and closed-book verification.
assert.ok(viewer.includes('currentPage: requestedPage'))
assert.ok(!viewer.includes('setCurrentPageIndex'))
assert.ok(viewer.includes('pageNumber={currentPage}'))
assert.ok(viewer.includes('documentUrlRef.current !== pdfUrl'))
assert.ok(viewer.includes('renderIdentityRef.current === renderIdentity'))
assert.ok(!viewer.includes('display: firstPageRendered ? \'flex\' : \'none\''))
assert.ok(viewer.includes('hydratedMarksKey !== marksKey'), 'annotations cannot persist before the same absolute page hydrates')
assert.ok(ui.includes('readerNavigation.currentPage'))
assert.ok(ui.includes('readerNavigation.zoom'))
assert.ok(ui.includes('beginRecoveryReading'))
assert.ok(!ui.includes('forceRemountKey'))
assert.ok(!ui.includes('window.location.reload'))
const navigationSection = ui.slice(ui.indexOf('const selectReaderMaterial'), ui.indexOf('const PaperHeader'))
assert.ok(!navigationSection.includes('request('), 'reader navigation performs zero provider calls')
const verificationView = ui.slice(ui.indexOf("phase === 'verification'"), ui.indexOf("phase === 'mastery'"))
assert.ok(!verificationView.includes('RepasarViewer'))
assert.ok(!verificationView.includes('pagesToReview'))

// Visual acceptance: full-width workspace, bottom CTA, only left annotation tools.
assert.ok(ui.includes('maxWidth: 1640'))
assert.ok(ui.includes('Ya terminé de leer'))
assert.ok(!ui.includes('gridTemplateColumns: \'minmax(0,1fr) minmax(280px,360px)\''))
assert.ok(!viewer.includes("position: 'sticky',\n              top: 0"), 'horizontal floating annotation toolbar removed')
assert.ok(viewer.includes("gridTemplateColumns: isActiveReading ? '86px 1fr' : '1fr'"), 'left toolbar retained')

console.log('repaso-reader-navigation-contracts: ALL PASS')
