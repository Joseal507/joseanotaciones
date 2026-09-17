import assert from 'node:assert/strict'
import { freeNavDebug, safeDebugStringify } from '../../lib/debug/freeNavDebug'

// ============================================================
// freeNavDebug safe-serialization contracts
//
// Deterministic, no-LLM tests confirming the dev-only logger never
// crashes regardless of what callers pass in `data`.
// ============================================================

function contains(haystack: string, needle: string) {
  assert.ok(
    haystack.includes(needle),
    `expected serialized output to include "${needle}", got: ${haystack}`,
  )
}

function notContains(haystack: string, needle: string) {
  assert.ok(
    !haystack.includes(needle),
    `expected serialized output NOT to include "${needle}", got: ${haystack}`,
  )
}

async function main() {
  console.log('\n--- freeNavDebug safe-serialization contracts ---\n')

  // 1. Plain object still serializes normally.
  const plain = safeDebugStringify({ foo: 'bar', count: 42, active: true })
  contains(plain, 'bar')
  contains(plain, '42')
  contains(plain, 'true')

  // 2. Circular references do not throw and are marked.
  const circular: any = { name: 'loop', child: { value: 1 } }
  circular.self = circular
  circular.child.parent = circular
  const circularOut = safeDebugStringify(circular)
  contains(circularOut, 'loop')
  contains(circularOut, '[Circular]')

  // 3. HTMLElement-like object serializes compactly.
  const elementLike = {
    __type: 'should-be-overwritten',
    tagName: 'BUTTON',
    id: 'generate-btn',
    className: 'btn primary',
  }
  const elementOut = safeDebugStringify({ target: elementLike, extra: 'ok' })
  contains(elementOut, 'BUTTON')
  contains(elementOut, 'generate-btn')
  contains(elementOut, 'btn primary')
  contains(elementOut, 'ok')

  // 4. Event-like object serializes compactly.
  const eventLike = {
    type: 'click',
    target: elementLike,
    bubbles: true,
  }
  const eventOut = safeDebugStringify(eventLike)
  contains(eventOut, 'click')
  contains(eventOut, 'BUTTON')

  // 5. Error does not throw and exposes useful fields.
  const error = new Error('boom')
  const errorOut = safeDebugStringify({ err: error })
  contains(errorOut, 'Error')
  contains(errorOut, 'boom')

  // 6. BigInt does not throw.
  const bigOut = safeDebugStringify({ value: BigInt(123) })
  contains(bigOut, '123n')

  // 7. Functions are replaced by a placeholder.
  const fnOut = safeDebugStringify({ callback: () => {} })
  contains(fnOut, '[Function]')

  // 8. React internals are stripped.
  const reactOut = safeDebugStringify({
    button: {
      tagName: 'BUTTON',
      // @ts-expect-error testing runtime keys
      __reactFiber$abc: { memoizedState: 'secret' },
      // @ts-expect-error testing runtime keys
      __reactProps$123: { onClick: () => {} },
      // @ts-expect-error testing runtime keys
      stateNode: documentHead,
    },
    ok: true,
  })
  notContains(reactOut, '__reactFiber')
  notContains(reactOut, '__reactProps')
  notContains(reactOut, 'stateNode')
  contains(reactOut, 'ok')

  // 9. freeNavDebug itself never throws, even for hostile payloads.
  const originalLog = console.log
  let logged = ''
  console.log = (...args: any[]) => {
    logged = args.join(' ')
  }
  try {
    freeNavDebug('HOSTILE_PAYLOAD', {
      circular,
      element: elementLike,
      event: eventLike,
      err: error,
      big: BigInt(999),
      fn: () => {},
    })
  } finally {
    console.log = originalLog
  }
  contains(logged, '[free-nav-debug] HOSTILE_PAYLOAD')
  contains(logged, '[Circular]')
  contains(logged, 'BUTTON')

  // 10. BigInt top-level does not throw.
  assert.doesNotThrow(() => safeDebugStringify(BigInt(1)))

  console.log('✅ All freeNavDebug safe-serialization contracts passed.')
}

// Fake DOM node used only for the React-internals test; no global access.
const documentHead = {
  tagName: 'HEAD',
  id: '',
}

main().catch(error => {
  console.error('❌ freeNavDebug contracts failed:', error)
  process.exit(1)
})
