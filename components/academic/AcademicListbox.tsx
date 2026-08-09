"use client"

import { useEffect, useId, useRef, useState } from 'react'
import { AcademicContent } from './AcademicContent'

export interface AcademicListboxOption {
  id: string
  content: string
  disabled?: boolean
}

interface AcademicListboxProps {
  label: string
  options: AcademicListboxOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}

export function AcademicListbox({
  label,
  options,
  value,
  onChange,
  placeholder = 'Selecciona…',
}: AcademicListboxProps) {
  const reactId = useId().replace(/:/g, '')
  const listboxId = `academic-listbox-${reactId}`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = options.findIndex(option => option.id === value)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex))
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [])

  useEffect(() => {
    if (selectedIndex >= 0) setActiveIndex(selectedIndex)
  }, [selectedIndex])

  const move = (direction: 1 | -1) => {
    if (!options.length) return
    let next = activeIndex
    do next = (next + direction + options.length) % options.length
    while (options[next]?.disabled && next !== activeIndex)
    setActiveIndex(next)
  }

  const chooseActive = () => {
    const option = options[activeIndex]
    if (option && !option.disabled) {
      onChange(option.id)
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', flex: 1, minWidth: 220 }}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) setOpen(true)
            else move(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Home' && open) {
            event.preventDefault()
            setActiveIndex(0)
          } else if (event.key === 'End' && open) {
            event.preventDefault()
            setActiveIndex(Math.max(0, options.length - 1))
          } else if ((event.key === 'Enter' || event.key === ' ') && open) {
            event.preventDefault()
            chooseActive()
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
          }
        }}
        style={{ width: '100%', minHeight: 48, padding: '10px 36px 10px 12px', textAlign: 'left', background: 'rgba(15,23,42,0.8)', color: selected ? '#e2e8f0' : '#94a3b8', border: '1px solid #60a5fa', borderRadius: 8, fontSize: 14, cursor: 'pointer', position: 'relative' }}
      >
        {selected ? <AcademicContent content={selected.content} inline /> : placeholder}
        <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: 13 }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          style={{ position: 'absolute', zIndex: 50, top: 'calc(100% + 6px)', left: 0, right: 0, maxHeight: 260, overflowY: 'auto', padding: 6, background: '#0f172a', border: '1px solid rgba(96,165,250,0.7)', borderRadius: 10, boxShadow: '0 16px 30px rgba(0,0,0,0.35)' }}
        >
          {options.map((option, index) => (
            <div
              id={`${listboxId}-option-${index}`}
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              aria-disabled={option.disabled || undefined}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                if (!option.disabled) {
                  onChange(option.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }
              }}
              style={{ padding: '10px 12px', borderRadius: 7, color: option.disabled ? '#64748b' : '#e2e8f0', background: index === activeIndex ? 'rgba(59,130,246,0.22)' : option.id === value ? 'rgba(16,185,129,0.14)' : 'transparent', cursor: option.disabled ? 'not-allowed' : 'pointer' }}
            >
              <AcademicContent content={option.content} inline />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
