import React, { type CSSProperties } from 'react'

interface Props {
  label: string
  count: number
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
}

/** Presentation-only row: academic label and count remain separate values. */
export default function RepasarGapGroupSummary({ label, count }: Props) {
  return (
    <div style={rowStyle}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span aria-label={`${count} conceptos`} style={{ color: 'var(--text-muted)', fontWeight: 900 }}>
        {' · '}{count}
      </span>
    </div>
  )
}
