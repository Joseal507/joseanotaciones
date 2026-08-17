'use client';

import { useMemo, useState } from 'react';
import MathText from '../MathText';

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
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);

  const connections = value || {};
  const colors = ['#0ea5e9', '#8b5cf6', '#f43f5e', '#10b981', '#f59e0b', '#ec4899'];

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

  const connect = (leftIndex: number, rightVisibleIndex: number) => {
    if (locked) return;

    const rightOriginalIndex = rightItems[rightVisibleIndex]?.originalIndex;
    if (rightOriginalIndex === undefined) return;

    const next: Record<number, number> = { ...connections };

    for (const k of Object.keys(next)) {
      if (next[Number(k)] === rightOriginalIndex) {
        delete next[Number(k)];
      }
    }

    next[leftIndex] = rightOriginalIndex;

    onChange(next);
    setSelectedLeft(null);
  };

  const correctCount = pairs.reduce(
    (acc, _p, i) => acc + (connections[i] === i ? 1 : 0),
    0
  );

  const rowH = 112;
  const height = Math.max(1, pairs.length) * rowH;

  const leftX = 252;
  const rightX = 468;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          fontSize: 18,
          fontFamily: "var(--font-body)",
        }}
      >
        {locked ? `${correctCount}/${pairs.length} correctas` : 'Conecta los conceptos'}
      </div>

      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 120px minmax(0, 1fr)',
          gap: 16,
          minHeight: height,
          overflow: 'visible',
        }}
      >
        <svg
          viewBox={`0 0 720 ${height}`}
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height,
            zIndex: 0,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {Object.entries(connections).map(([leftStr, rightOriginal], n) => {
            const leftIndex = Number(leftStr);
            const rightVisibleIndex = rightItems.findIndex(
              r => r.originalIndex === rightOriginal
            );

            if (rightVisibleIndex < 0) return null;

            const y1 = leftIndex * rowH + rowH / 2;
            const y2 = rightVisibleIndex * rowH + rowH / 2;
            const ok = leftIndex === rightOriginal;
            const color = locked ? (ok ? '#16a34a' : '#ef4444') : colors[n % colors.length];

            const bend = 42 + (Math.abs(leftIndex - rightVisibleIndex) * 16);
            const wave = ((leftIndex + rightVisibleIndex + n) % 2 === 0 ? 1 : -1) * 18;

            return (
              <path
                key={`${leftIndex}-${rightOriginal}`}
                d={`M ${leftX} ${y1} C ${leftX + bend} ${y1 + wave}, ${rightX - bend} ${y2 - wave}, ${rightX} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.95}
              />
            );
          })}
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, zIndex: 2 }}>
          {pairs.map((p, i) => {
            const isConnected = connections[i] !== undefined;
            const isSelected = selectedLeft === i;
            const color = isConnected ? colors[i % colors.length] : themeColor;

            return (
              <button
                key={i}
                onClick={() => !locked && setSelectedLeft(i)}
                style={{
                  minHeight: 96,
                  padding: '14px 16px',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  lineHeight: 1.28,
                  borderRadius: 16,
                  border: isSelected
                    ? `3px solid ${themeColor}`
                    : `2px solid ${isConnected ? color : 'rgba(0,0,0,.18)'}`,
                  background: isSelected ? `${themeColor}22` : '#fff',
                  color: '#111',
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: locked ? 'default' : 'pointer',
                  boxShadow: isConnected
                    ? `0 6px 18px ${color}44`
                    : '0 2px 8px rgba(0,0,0,.08)',
                  fontFamily: "var(--font-body)",
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ color, marginRight: 6 }}>●</span>
                <MathText text={p.left} />
              </button>
            );
          })}
        </div>

        <div style={{ zIndex: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, zIndex: 2 }}>
          {rightItems.map((item, visibleIndex) => {
            const used = Object.entries(connections).find(
              ([, r]) => r === item.originalIndex
            );

            const color = used
              ? colors[Number(used[0]) % colors.length]
              : 'rgba(0,0,0,.18)';

            return (
              <button
                key={item.originalIndex}
                onClick={() => selectedLeft !== null && connect(selectedLeft, visibleIndex)}
                style={{
                  minHeight: 96,
                  padding: '14px 16px',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  lineHeight: 1.28,
                  borderRadius: 16,
                  border: `2px solid ${color}`,
                  background: selectedLeft !== null && !locked ? '#eff6ff' : '#fff',
                  color: '#111',
                  fontWeight: 900,
                  fontSize: 15,
                  cursor:
                    locked
                      ? 'default'
                      : selectedLeft !== null
                      ? 'crosshair'
                      : 'pointer',
                  boxShadow: used
                    ? `0 6px 18px ${color}44`
                    : '0 2px 8px rgba(0,0,0,.08)',
                  fontFamily: "var(--font-body)",
                  textAlign: 'right',
                  width: '100%',
                }}
              >
                <MathText text={item.text} />
                <span style={{ color, marginLeft: 6 }}>●</span>
              </button>
            );
          })}
        </div>
      </div>

      {!locked && (
        <div
          style={{
            textAlign: 'center',
            color: '#444',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Toca uno de la izquierda y luego su pareja de la derecha.
        </div>
      )}

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
                {ok ? '✓' : '✗'} <MathText text={`${p.left} → ${chosen}`} />
                {!ok && (
                  <span style={{ color: '#333' }}>
                    {' '}· Correcta: <MathText text={p.right} />
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
