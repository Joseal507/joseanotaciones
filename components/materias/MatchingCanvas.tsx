'use client';

import { useMemo } from 'react';
import MatchingInteractionCore from '../quiz/MatchingInteractionCore';
import { AcademicContent } from '../academic/AcademicContent';

type Pair = { left: string; right: string };

function stableShuffle<T extends { originalIndex?: number }>(items: T[], seed: string): T[] {
  let h = 2166136261;

  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const arr = [...items];

  for (let i = arr.length - 1; i > 0; i--) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;

    const j = Math.abs(h) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  const sameOrder = arr.every((item, idx) => item.originalIndex === idx);

  if (sameOrder && arr.length > 1) {
    arr.push(arr.shift() as T);
  }

  return arr;
}

export default function MatchingCanvas({
  pairs = [],
  value,
  onChange,
  locked = false,
  themeColor = '#22d3ee',
}: {
  pairs: Pair[];
  value?: Record<number, number>;
  onChange: (v: Record<number, number>) => void;
  locked?: boolean;
  themeColor?: string;
}) {
  const connections = value || {};

  const rightItems = useMemo(() => {
    const base = pairs.map((p, i) => ({
      text: p.right,
      originalIndex: i,
    }));

    return stableShuffle(
      base,
      pairs.map(p => `${p.left}:${p.right}`).join('|')
    );
  }, [pairs]);

  const correctCount = pairs.reduce(
    (acc, _p, i) => acc + (connections[i] === i ? 1 : 0),
    0
  );

  const leftItems = useMemo(
    () => pairs.map((p, i) => ({ id: i, text: p.left })),
    [pairs]
  );

  const coreRightItems = useMemo(
    () => rightItems.map(r => ({ id: r.originalIndex, text: r.text })),
    [rightItems]
  );

  const connectionColors = useMemo(() => {
    if (!locked) return undefined;
    const map: Record<string | number, string> = {};
    for (const [l, r] of Object.entries(connections)) {
      map[l] = Number(l) === Number(r) ? '#16a34a' : '#ef4444';
    }
    return map;
  }, [locked, connections]);

  const leftItemStyles = useMemo(() => {
    if (!locked) return undefined;
    const map: Record<string | number, { borderColor?: string; backgroundColor?: string }> = {};
    for (const p of leftItems) {
      if (connections[p.id] !== undefined) {
        const ok = Number(connections[p.id]) === Number(p.id);
        map[p.id] = {
          borderColor: ok ? '#16a34a' : '#ef4444',
          backgroundColor: ok ? '#f0fdf4' : '#fef2f2',
        };
      }
    }
    return map;
  }, [locked, leftItems, connections]);

  const rightItemStyles = useMemo(() => {
    if (!locked) return undefined;
    const map: Record<string | number, { borderColor?: string; backgroundColor?: string }> = {};
    for (const r of coreRightItems) {
      const used = Object.entries(connections).find(([, rightId]) => Number(rightId) === Number(r.id));
      if (used) {
        const ok = Number(used[0]) === Number(r.id);
        map[r.id] = {
          borderColor: ok ? '#16a34a' : '#ef4444',
          backgroundColor: ok ? '#f0fdf4' : '#fef2f2',
        };
      }
    }
    return map;
  }, [locked, coreRightItems, connections]);

  const handleConnectionsChange = (next: Record<string | number, string | number>) => {
    const numericMap: Record<number, number> = {};
    for (const [k, v] of Object.entries(next)) {
      numericMap[Number(k)] = Number(v);
    }
    onChange(numericMap);
  };

  return (
    <div className="matching-canvas-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div
        style={{
          textAlign: 'center',
          color:
            locked
              ? correctCount === pairs.length
                ? '#16a34a'
                : '#dc2626'
              : themeColor,
          fontWeight: 950,
          fontSize: 16,
          fontFamily: 'var(--font-body)',
        }}
      >
        {locked ? `${correctCount}/${pairs.length} correctas` : 'Conecta los conceptos'}
      </div>

      <MatchingInteractionCore
        leftItems={leftItems}
        rightItems={coreRightItems}
        connections={connections}
        onConnectionsChange={handleConnectionsChange}
        disabled={locked}
        themeColor={themeColor}
        allowToggleDisconnect={false}
        connectionColors={connectionColors}
        leftItemStyles={leftItemStyles}
        rightItemStyles={rightItemStyles}
        showInstruction={!locked}
        instructionText="Toca uno de la izquierda y luego su pareja de la derecha."
      />

      {locked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: '#111' }}>
          {pairs.map((p, i) => {
            const chosen = pairs[connections[i]]?.right || 'sin conectar';
            const ok = connections[i] === i;

            return (
              <div
                key={i}
                style={{
                  color: ok ? '#166534' : '#991b1b',
                  fontWeight: 800,
                  lineHeight: 1.35,
                }}
              >
                {ok ? '✓' : '✗'} <AcademicContent inline content={`${p.left} → ${chosen}`} />
                {!ok && (
                  <span style={{ color: '#333' }}>
                    {' '}· Correcta: <AcademicContent inline content={p.right} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
