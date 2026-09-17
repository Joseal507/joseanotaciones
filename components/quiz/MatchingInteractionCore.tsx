'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AcademicContent } from '../academic/AcademicContent';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface MatchingItem {
  id: string | number;
  text: string;
}

export interface MatchingInteractionCoreProps {
  leftItems: MatchingItem[];
  rightItems: MatchingItem[];
  connections: Record<string | number, string | number>;
  onConnectionsChange?: (connections: Record<string | number, string | number>) => void;
  disabled?: boolean;
  themeColor?: string;
  colors?: string[];
  strokeWidth?: number;
  connectionColors?: Record<string | number, string>;
  leftItemStyles?: Record<string | number, { borderColor?: string; backgroundColor?: string; color?: string }>;
  rightItemStyles?: Record<string | number, { borderColor?: string; backgroundColor?: string; color?: string }>;
  allowToggleDisconnect?: boolean;
  showInstruction?: boolean;
  instructionText?: string;
  fontFamily?: string;
}

const DEFAULT_COLORS = ['#0ea5e9', '#8b5cf6', '#f43f5e', '#10b981', '#f59e0b', '#ec4899'];

export default function MatchingInteractionCore({
  leftItems = [],
  rightItems = [],
  connections = {},
  onConnectionsChange,
  disabled = false,
  themeColor = '#22d3ee',
  colors = DEFAULT_COLORS,
  strokeWidth = 4,
  connectionColors,
  leftItemStyles,
  rightItemStyles,
  allowToggleDisconnect = true,
  showInstruction = false,
  instructionText = 'Toca uno de la izquierda y luego su pareja de la derecha.',
  fontFamily = 'var(--font-body, system-ui, -apple-system, sans-serif)',
}: MatchingInteractionCoreProps) {
  const [selectedLeft, setSelectedLeft] = useState<string | number | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const leftRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rightRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [lineLayout, setLineLayout] = useState<{
    width: number;
    height: number;
    left: Array<{ x: number; y: number }>;
    right: Array<{ x: number; y: number }>;
  }>({ width: 0, height: 0, left: [], right: [] });

  const measureAnchors = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const center = (node: HTMLButtonElement | null, edge: 'left' | 'right') => {
      if (!node) return { x: 0, y: 0 };
      const rect = node.getBoundingClientRect();
      return {
        x: (edge === 'right' ? rect.right : rect.left) - boardRect.left,
        y: rect.top - boardRect.top + rect.height / 2,
      };
    };
    setLineLayout({
      width: boardRect.width,
      height: boardRect.height,
      left: leftItems.map((_, index) => center(leftRefs.current[index], 'right')),
      right: rightItems.map((_, index) => center(rightRefs.current[index], 'left')),
    });
  }, [leftItems, rightItems]);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const frame = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(measureAnchors) : null;
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measureAnchors);
      if (boardRef.current) observer.observe(boardRef.current);
      leftRefs.current.forEach(node => { if (node) observer?.observe(node); });
      rightRefs.current.forEach(node => { if (node) observer?.observe(node); });
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', measureAnchors);
    }
    return () => {
      if (frame !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', measureAnchors);
      }
    };
  }, [measureAnchors]);

  const connect = (leftId: string | number, rightId: string | number) => {
    if (disabled || !onConnectionsChange) return;

    const next: Record<string | number, string | number> = { ...connections };

    if (allowToggleDisconnect && String(next[leftId]) === String(rightId)) {
      delete next[leftId];
      onConnectionsChange(next);
      setSelectedLeft(null);
      return;
    }

    for (const k of Object.keys(next)) {
      if (String(next[k]) === String(rightId)) {
        delete next[k];
      }
    }

    next[leftId] = rightId;
    onConnectionsChange(next);
    setSelectedLeft(null);
  };

  const maxRows = Math.max(leftItems.length, rightItems.length);

  return (
    <div className="matching-canvas">
      <div className="matching-board-scroll">
        <div ref={boardRef} className="matching-board">
          <svg
            viewBox={`0 0 ${lineLayout.width || 1} ${lineLayout.height || 1}`}
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              zIndex: 1,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            {Object.entries(connections).map(([leftIdStr, rightId], n) => {
              const leftIndex = leftItems.findIndex(it => String(it.id) === String(leftIdStr));
              const rightIndex = rightItems.findIndex(it => String(it.id) === String(rightId));

              if (leftIndex < 0 || rightIndex < 0) return null;

              const start = lineLayout.left[leftIndex];
              const end = lineLayout.right[rightIndex];
              if (!start || !end) return null;

              const color = (connectionColors && connectionColors[leftIdStr]) || colors[n % colors.length];

              const bend = Math.max(24, (end.x - start.x) * 0.42);

              return (
                <path
                  key={`${leftIdStr}-${rightId}`}
                  d={`M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  opacity={0.95}
                />
              );
            })}
          </svg>

          {Array.from({ length: maxRows }).map((_, i) => {
            const leftItem = leftItems[i];
            const rightItem = rightItems[i];

            const leftConnected = leftItem ? connections[leftItem.id] !== undefined : false;
            const leftSelected = leftItem && selectedLeft !== null && String(selectedLeft) === String(leftItem.id);
            const leftOverride = leftItem ? leftItemStyles?.[leftItem.id] : undefined;

            const leftColor = (leftConnected && connectionColors && connectionColors[leftItem.id])
              ? connectionColors[leftItem.id]
              : (leftConnected ? colors[i % colors.length] : themeColor);

            const usedEntry = rightItem
              ? Object.entries(connections).find(([, r]) => String(r) === String(rightItem.id))
              : undefined;
            const rightOverride = rightItem ? rightItemStyles?.[rightItem.id] : undefined;

            const rightColor = (usedEntry && connectionColors && connectionColors[usedEntry[0]])
              ? connectionColors[usedEntry[0]]
              : (usedEntry ? colors[Number(usedEntry[0]) % colors.length] : 'rgba(0,0,0,.18)');

            return (
              <div key={i} className="matching-row">
                {leftItem ? (
                  <button
                    ref={node => { leftRefs.current[i] = node; }}
                    onClick={() => {
                      if (!disabled) {
                        setSelectedLeft(leftSelected ? null : leftItem.id);
                      }
                    }}
                    type="button"
                    className="matching-card matching-card-left"
                    title={leftItem.text}
                    style={{
                      border: leftOverride?.borderColor
                        ? `2px solid ${leftOverride.borderColor}`
                        : (leftSelected
                            ? `3px solid ${themeColor}`
                            : `2px solid ${leftConnected ? leftColor : 'rgba(0,0,0,.18)'}`),
                      background: leftOverride?.backgroundColor
                        ? leftOverride.backgroundColor
                        : (leftSelected
                            ? `${themeColor}22`
                            : '#fff'),
                      color: leftOverride?.color || '#111',
                      fontWeight: 900,
                      fontFamily,
                      cursor: disabled ? 'default' : 'pointer',
                      boxShadow: leftConnected
                        ? `0 6px 18px ${leftColor}44`
                        : '0 2px 8px rgba(0,0,0,.08)',
                    }}
                  >
                    <span className="matching-card-text">
                      <AcademicContent content={leftItem.text} inline />
                    </span>
                    <span style={{ color: leftColor, marginLeft: 6 }}>●</span>
                  </button>
                ) : <div />}

                {rightItem ? (
                  <button
                    ref={node => { rightRefs.current[i] = node; }}
                    onClick={() => {
                      if (selectedLeft !== null && !disabled) {
                        connect(selectedLeft, rightItem.id);
                      }
                    }}
                    type="button"
                    className="matching-card matching-card-right"
                    title={rightItem.text}
                    style={{
                      border: rightOverride?.borderColor
                        ? `2px solid ${rightOverride.borderColor}`
                        : `2px solid ${rightColor}`,
                      background: rightOverride?.backgroundColor
                        ? rightOverride.backgroundColor
                        : (selectedLeft !== null && !disabled ? '#eff6ff' : '#fff'),
                      color: rightOverride?.color || '#111',
                      fontWeight: 900,
                      fontFamily,
                      cursor: disabled
                        ? 'default'
                        : selectedLeft !== null
                        ? 'crosshair'
                        : 'pointer',
                      boxShadow: usedEntry
                        ? `0 6px 18px ${rightColor}44`
                        : '0 2px 8px rgba(0,0,0,.08)',
                    }}
                  >
                    <span style={{ color: rightColor, marginRight: 6 }}>●</span>
                    <span className="matching-card-text">
                      <AcademicContent content={rightItem.text} inline />
                    </span>
                  </button>
                ) : <div />}
              </div>
            );
          })}
        </div>
      </div>

      {showInstruction && !disabled && (
        <div
          style={{
            textAlign: 'center',
            color: '#444',
            fontSize: 13,
            fontWeight: 700,
            fontFamily,
          }}
        >
          {instructionText}
        </div>
      )}

      <style jsx>{`
        .matching-canvas {
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .matching-board-scroll {
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 2px 0;
        }
        .matching-board {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          column-gap: clamp(64px, 9vw, 104px);
          row-gap: 9px;
          width: 100%;
          min-width: 0;
        }
        .matching-row { display: contents; }
        .matching-card {
          box-sizing: border-box;
          width: 100%;
          height: auto;
          min-height: 64px;
          padding: 9px 12px;
          border-radius: 14px;
          color: #111;
          font-size: 14px;
          font-weight: 850;
          line-height: 1.22;
          word-break: break-word;
          display: flex;
          align-items: center;
          align-self: stretch;
          position: relative;
          z-index: 2;
        }
        .matching-card-left { text-align: left; justify-content: space-between; }
        .matching-card-right { text-align: left; }
        .matching-card-text {
          min-width: 0;
          white-space: normal;
          overflow: visible;
        }
        @media (max-width: 640px) {
          .matching-board { min-width: 560px; column-gap: 56px; }
          .matching-card { min-height: 60px; font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
