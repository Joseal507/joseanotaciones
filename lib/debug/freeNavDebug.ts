// ═══════════════════════════════════════════════════════════════════
// TEMPORARY DEV-ONLY INSTRUMENTATION — BUG REAL #2 (Free Flashcards bounce)
// Prefix: [free-nav-debug]
// Safe to delete once the race is confirmed/fixed and verified manually.
// No-ops in production builds.
// ═══════════════════════════════════════════════════════════════════

const ENABLED = process.env.NODE_ENV !== 'production';

let renderSeq = 0;
export function nextFreeNavRenderId(): number {
  return ++renderSeq;
}

let instanceSeq = 0;
export function nextFreeNavInstanceId(prefix: string): string {
  return `${prefix}-${++instanceSeq}-${Date.now().toString(36)}`;
}

// ── SAFE DEBUG SERIALIZER ──────────────────────────────────────────
// Never throws. Handles circular refs, DOM nodes, events, functions,
// BigInts and React internal properties. Falls back to [unserializable].

const REACT_INTERNAL_KEYS = /^(__reactFiber.*|__reactProps.*|stateNode)$/;
const MAX_DEPTH = 5;
const MAX_KEYS = 30;
const MAX_ARRAY_LEN = 50;
const MAX_STRING_LEN = 500;

type ErrorLike = { name: string; message: string; stack?: string };
type ElementLike = { tagName: string; id?: string; className?: string };
type EventLike = { type: string; target?: unknown };

function isErrorLike(value: unknown): value is ErrorLike {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).name === 'string' &&
      typeof (value as Record<string, unknown>).message === 'string')
  );
}

function isElementLike(value: unknown): value is ElementLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).tagName === 'string'
  );
}

function isEventLike(value: unknown): value is EventLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).type === 'string' &&
    'target' in value
  );
}

function serializeError(value: ErrorLike): Record<string, unknown> {
  return {
    __type: 'Error',
    name: value.name,
    message: value.message,
    stack:
      typeof value.stack === 'string'
        ? value.stack.split('\n').slice(0, 3).join('\n')
        : undefined,
  };
}

function serializeElement(value: ElementLike): Record<string, unknown> {
  return {
    __type: 'HTMLElement',
    tagName: value.tagName,
    id: value.id || undefined,
    className: value.className || undefined,
  };
}

function serializeEvent(value: EventLike, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  return {
    __type: 'Event',
    type: value.type,
    target: value.target ? serialize(value.target, depth + 1, seen) : null,
  };
}

function serialize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]';

  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Date) return value.toISOString();

  if (isErrorLike(value)) return serializeError(value);
  if (isElementLike(value)) return serializeElement(value);
  if (isEventLike(value)) return serializeEvent(value, depth, seen);

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) {
      return [
        ...value.slice(0, MAX_ARRAY_LEN).map(v => serialize(v, depth + 1, seen)),
        `...(${value.length - MAX_ARRAY_LEN} more)`,
      ];
    }
    return value.map(v => serialize(v, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(value)) {
      if (REACT_INTERNAL_KEYS.test(key)) continue;
      if (++count > MAX_KEYS) {
        out['...'] = '[MoreKeys]';
        break;
      }
      const v = (value as Record<string, unknown>)[key];
      const serialized = serialize(v, depth + 1, seen);
      if (serialized !== undefined) {
        out[key] = serialized;
      }
    }

    seen.delete(value);
    return out;
  }

  return String(value);
}

export function safeDebugStringify(value: unknown): string {
  try {
    const serialized = serialize(value, 0, new WeakSet());
    return JSON.stringify(serialized);
  } catch {
    return '[unserializable]';
  }
}

export function freeNavDebug(event: string, data?: Record<string, unknown>) {
  if (!ENABLED) return;
  // eslint-disable-next-line no-console
  console.log(`[free-nav-debug] ${event}`, data ? safeDebugStringify(data) : '');
}

export function freeNavCallsite(skipFrames = 2): string {
  if (!ENABLED) return 'disabled';
  const stack = new Error().stack || '';
  const line = stack.split('\n')[skipFrames];
  return (line || 'unknown-callsite').trim().replace(/^at\s+/, '');
}
