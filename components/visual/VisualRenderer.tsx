"use client"

import { Component, useState, type ReactNode } from "react"
import type {
  Chemistry2DDataSpec,
  CodeExecutionDataSpec,
  GraphDataSpec,
  SpatialVectorDataSpec,
  StructuredGridDataSpec,
  TimelineDataSpec,
  VisualInteractionMode,
  VisualInteractionVerb,
  VisualSpec,
} from "../../lib/adaptive/visual/visualContract"

interface VisualRendererProps {
  spec: VisualSpec
  mode: VisualInteractionMode
  onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void
  disabled?: boolean
}

const wrap: React.CSSProperties = { border: "1px solid #2d2d38", borderRadius: 12, padding: 16, background: "#15151d", margin: "12px 0" }
const label: React.CSSProperties = { fontSize: 13, color: "#9ca3af", marginBottom: 8 }
const input: React.CSSProperties = { background: "#0c0c12", border: "1px solid #333", borderRadius: 6, color: "#e5e7eb", padding: "6px 8px", width: 90 }
const submitBtn: React.CSSProperties = { marginTop: 12, padding: "8px 16px", background: "#4ade80", color: "#052e16", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }

// Descripción textual accesible (screen readers, y fallback si el render falla) —
// nunca deja el contenido pedagógico dependiendo EXCLUSIVAMENTE del canvas/SVG.
// CONTRATO: esta función NUNCA lanza, sin importar la forma de `spec.data` — se
// invoca tanto fuera del error boundary (texto sr-only normal) como DENTRO del
// propio fallback del boundary (ver VisualErrorBoundary.render abajo); si lanzara
// ahí, no habría ningún boundary por encima que la proteja una segunda vez.
export function describeVisualSpec(spec: VisualSpec): string {
  try {
    if (spec.engine === "graph_2d") return `Gráfica de f(x) = ${spec.data.expression}, dominio [${spec.data.domain[0]}, ${spec.data.domain[1]}].`
    if (spec.engine === "structured_grid") return `Tabla ICE de la reacción ${spec.data.reaction}, especies: ${spec.data.species.join(", ")}.`
    if (spec.engine === "spatial_vector") return `Diagrama de cuerpo libre sobre ${spec.data.body}: ${spec.data.forces.map(f => `${f.label} (${f.magnitude ?? "?"} ${f.unit || ""} a ${f.angleDeg}°)`).join(", ")}.`
    if (spec.engine === "chemistry_2d") return `Estructura con átomos ${spec.data.atoms.map(a => `${a.id}=${a.element}`).join(", ")} y ${spec.data.bonds.length} enlace(s).`
    if (spec.engine === "code_execution") return `Traza de ejecución (${spec.data.language}) con ${spec.data.steps.length} paso(s).`
    return `Cronología con ${spec.data.events.length} evento(s): ${spec.data.events.map(e => `${e.date ? `${e.date}: ` : ""}${e.label}`).join(", ")}.`
  } catch {
    return `Visual de tipo ${spec.engine} (${spec.representation}) no disponible en este momento.`
  }
}

// Un fallo de render en un engine (bug de un tipo de visual concreto, dato límite no
// contemplado por la UI) NUNCA debe tumbar toda la sesión — cae a la descripción
// textual accesible en vez de una pantalla en blanco/crash (criterio de cierre #7/#8).
class VisualErrorBoundary extends Component<{ spec: VisualSpec; children: ReactNode }, { failed: boolean }> {
  constructor(props: { spec: VisualSpec; children: ReactNode }) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={wrap} role="note">
          <div style={label}>No se pudo mostrar el visual — descripción del contenido:</div>
          <div style={{ color: "#e5e7eb" }}>{describeVisualSpec(this.props.spec)}</div>
        </div>
      )
    }
    return this.props.children
  }
}

function VisualRendererInner({ spec, mode, onSubmit, disabled }: VisualRendererProps) {
  if (spec.engine === "graph_2d") return <GraphView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
  if (spec.engine === "structured_grid") return <StructuredGridView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
  if (spec.engine === "spatial_vector") return <SpatialVectorView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
  if (spec.engine === "chemistry_2d") return <Chemistry2DView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
  if (spec.engine === "code_execution") return <CodeExecutionView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
  return <TimelineView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
}

// Técnica "sr-only" estándar (clip, no display:none/visibility:hidden) — visible
// para lectores de pantalla, invisible en la UI normal.
const srOnly: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
}

export function VisualRenderer(props: VisualRendererProps) {
  return (
    <VisualErrorBoundary spec={props.spec}>
      <VisualRendererInner {...props} />
      <p style={srOnly}>{describeVisualSpec(props.spec)}</p>
    </VisualErrorBoundary>
  )
}

// ---------------------------------------------------------------------------
function GraphView({ data, mode, onSubmit, disabled }: { data: GraphDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [x, setX] = useState("")
  const [y, setY] = useState("")
  const width = 320, height = 200
  const [domainMin, domainMax] = data.domain
  const ys = data.points.map(p => p.y)
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys) || 1
  const toScreenX = (px: number) => ((px - domainMin) / (domainMax - domainMin || 1)) * width
  const toScreenY = (py: number) => height - ((py - yMin) / (yMax - yMin || 1)) * height
  const path = data.points.map(p => `${toScreenX(p.x)},${toScreenY(p.y)}`).join(" ")
  return (
    <div style={wrap}>
      <div style={label}>f(x) = {data.expression} · dominio [{domainMin}, {domainMax}]</div>
      <svg width={width} height={height} style={{ background: "#0c0c12", borderRadius: 8 }}>
        <line x1={0} y1={toScreenY(0)} x2={width} y2={toScreenY(0)} stroke="#333" />
        <line x1={toScreenX(0)} y1={0} x2={toScreenX(0)} y2={height} stroke="#333" />
        {data.points.length > 1 && <polyline points={path} fill="none" stroke="#4ade80" strokeWidth={2} />}
        {data.points.map((p, i) => <circle key={i} cx={toScreenX(p.x)} cy={toScreenY(p.y)} r={3} fill="#60a5fa" />)}
      </svg>
      {(mode === "practice" || mode === "assess") && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#9ca3af" }}>¿Cuánto vale f(</span>
          <input style={input} value={x} onChange={e => setX(e.target.value)} placeholder="x" disabled={disabled} />
          <span style={{ color: "#9ca3af" }}>) ?</span>
          <input style={input} value={y} onChange={e => setY(e.target.value)} placeholder="y" disabled={disabled} />
          <button style={submitBtn} disabled={disabled || !x || !y} onClick={() => onSubmit?.("select_region", { x: Number(x), y: Number(y) })}>Comprobar</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function StructuredGridView({ data, mode, onSubmit, disabled }: { data: StructuredGridDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const interactive = mode === "practice" || mode === "assess"
  return (
    <div style={wrap}>
      <div style={label}>{data.reaction}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", color: "#e5e7eb" }}>
        <thead>
          <tr>{["Especie", "Inicial", "Cambio", "Equilibrio"].map(h => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #333", fontSize: 13, color: "#9ca3af" }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.species.map(id => (
            <tr key={id}>
              <td style={{ padding: 6 }}>[{id}]</td>
              <td style={{ padding: 6 }}>{String(data.initial[id])}</td>
              <td style={{ padding: 6 }}>{data.change[id]}</td>
              <td style={{ padding: 6 }}>
                {interactive
                  ? <input style={input} value={values[id] || ""} onChange={e => setValues(v => ({ ...v, [id]: e.target.value }))} disabled={disabled} placeholder="?" />
                  : String(data.equilibrium[id])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {interactive && (
        <button style={submitBtn} disabled={disabled || data.species.some(id => !values[id])} onClick={() => onSubmit?.("fill_cell", values)}>Comprobar</button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function SpatialVectorView({ data, mode, onSubmit, disabled }: { data: SpatialVectorDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [attempt, setAttempt] = useState<Record<string, { angleDeg: string; magnitude: string }>>({})
  const interactive = mode === "practice" || mode === "assess"
  const size = 220, cx = size / 2, cy = size / 2
  const scale = 1.6
  return (
    <div style={wrap}>
      <div style={label}>Diagrama de cuerpo libre — {data.body}</div>
      <svg width={size} height={size} style={{ background: "#0c0c12", borderRadius: 8 }}>
        <circle cx={cx} cy={cy} r={4} fill="#e5e7eb" />
        {data.forces.map((force, i) => {
          const rad = (force.angleDeg * Math.PI) / 180
          const len = Math.min(90, (force.magnitude || 20) * scale)
          const x2 = cx + len * Math.cos(rad)
          const y2 = cy - len * Math.sin(rad)
          return (
            <g key={force.id}>
              <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={["#4ade80", "#60a5fa", "#f472b6", "#facc15"][i % 4]} strokeWidth={2} markerEnd="url(#arrow)" />
              <text x={x2} y={y2} fill="#9ca3af" fontSize={11}>{force.label}</text>
            </g>
          )
        })}
        <defs>
          <marker id="arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#e5e7eb" /></marker>
        </defs>
      </svg>
      {interactive && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {data.forces.map(force => (
            <div key={force.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#9ca3af", minWidth: 90 }}>{force.label}</span>
              <input style={input} placeholder="° ángulo" value={attempt[force.id]?.angleDeg || ""} disabled={disabled}
                onChange={e => setAttempt(v => ({ ...v, [force.id]: { ...v[force.id], angleDeg: e.target.value } }))} />
              <input style={input} placeholder="magnitud" value={attempt[force.id]?.magnitude || ""} disabled={disabled}
                onChange={e => setAttempt(v => ({ ...v, [force.id]: { ...v[force.id], magnitude: e.target.value } }))} />
            </div>
          ))}
          <button style={submitBtn} onClick={() => onSubmit?.("place_vector", Object.fromEntries(
            Object.entries(attempt).map(([id, v]) => [id, { angleDeg: Number(v.angleDeg), magnitude: Number(v.magnitude) }]),
          ))} disabled={disabled}>Comprobar</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function Chemistry2DView({ data, mode, onSubmit, disabled }: { data: Chemistry2DDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [labels, setLabels] = useState<Record<string, string>>({})
  const interactive = mode === "practice" || mode === "assess"
  const byId = new Map(data.atoms.map(atom => [atom.id, atom]))
  const width = Math.max(160, ...data.atoms.map(a => a.x)) + 40
  const height = 100
  return (
    <div style={wrap}>
      <div style={label}>Estructura</div>
      <svg width={width} height={height} style={{ background: "#0c0c12", borderRadius: 8 }}>
        {data.bonds.map((bond, i) => {
          const from = byId.get(bond.from), to = byId.get(bond.to)
          if (!from || !to) return null
          const offset = bond.order === 2 ? 3 : 0
          return (
            <g key={i}>
              <line x1={from.x + 20} y1={from.y + 40 - offset} x2={to.x + 20} y2={to.y + 40 - offset} stroke="#9ca3af" strokeWidth={2} />
              {bond.order >= 2 && <line x1={from.x + 20} y1={from.y + 40 + offset} x2={to.x + 20} y2={to.y + 40 + offset} stroke="#9ca3af" strokeWidth={2} />}
            </g>
          )
        })}
        {data.atoms.map(atom => (
          <g key={atom.id}>
            <circle cx={atom.x + 20} cy={atom.y + 40} r={14} fill="#1f2937" stroke="#4ade80" />
            <text x={atom.x + 20} y={atom.y + 44} fill="#e5e7eb" fontSize={11} textAnchor="middle">{interactive ? "?" : atom.element}</text>
          </g>
        ))}
      </svg>
      {interactive && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {data.atoms.map(atom => (
            <div key={atom.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ color: "#9ca3af" }}>{atom.id}</span>
              <input style={{ ...input, width: 50 }} value={labels[atom.id] || ""} disabled={disabled}
                onChange={e => setLabels(v => ({ ...v, [atom.id]: e.target.value }))} />
            </div>
          ))}
          <button style={submitBtn} onClick={() => onSubmit?.("label_structure", labels)} disabled={disabled}>Comprobar</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function CodeExecutionView({ data, mode, onSubmit, disabled }: { data: CodeExecutionDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [line, setLine] = useState(String(data.steps[data.steps.length - 1]?.line ?? ""))
  const [value, setValue] = useState("")
  const interactive = mode === "practice" || mode === "assess"
  return (
    <div style={wrap}>
      <div style={label}>{data.language}</div>
      <pre style={{ background: "#0c0c12", padding: 10, borderRadius: 8, color: "#e5e7eb", overflowX: "auto", fontSize: 13 }}>{data.code}</pre>
      {mode === "teach" && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: "#9ca3af", fontSize: 13 }}>línea {data.steps[stepIndex]?.line}: {JSON.stringify(data.steps[stepIndex]?.variables)}{data.steps[stepIndex]?.output ? ` → salida: ${data.steps[stepIndex].output}` : ""}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button style={submitBtn} disabled={stepIndex === 0} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>← anterior</button>
            <button style={submitBtn} disabled={stepIndex >= data.steps.length - 1} onClick={() => setStepIndex(i => Math.min(data.steps.length - 1, i + 1))}>siguiente →</button>
          </div>
        </div>
      )}
      {interactive && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#9ca3af" }}>En la línea</span>
          <input style={{ ...input, width: 50 }} value={line} onChange={e => setLine(e.target.value)} disabled={disabled} />
          <span style={{ color: "#9ca3af" }}>¿cuál es la salida?</span>
          <input style={input} value={value} onChange={e => setValue(e.target.value)} disabled={disabled} />
          <button style={submitBtn} disabled={disabled || !line || !value} onClick={() => onSubmit?.("predict_output", { line: Number(line), variable: "output", value })}>Comprobar</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function TimelineView({ data, mode, onSubmit, disabled }: { data: TimelineDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const sorted = [...data.events].sort((a, b) => a.order - b.order)
  const [order, setOrder] = useState(mode === "teach" ? sorted.map(e => e.id) : [...sorted.map(e => e.id)].reverse())
  const interactive = mode === "practice" || mode === "assess"
  const byId = new Map(data.events.map(e => [e.id, e]))
  const move = (index: number, delta: number) => {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrder(next)
  }
  return (
    <div style={wrap}>
      <div style={label}>Orden cronológico</div>
      <ol style={{ paddingLeft: 20, color: "#e5e7eb" }}>
        {(interactive ? order : sorted.map(e => e.id)).map((id, index) => {
          const event = byId.get(id)!
          return (
            <li key={id} style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{!interactive && event.date ? `${event.date} — ` : ""}{event.label}</span>
              {interactive && (
                <span style={{ display: "flex", gap: 4 }}>
                  <button style={{ ...submitBtn, padding: "2px 8px", marginTop: 0 }} disabled={disabled} onClick={() => move(index, -1)}>↑</button>
                  <button style={{ ...submitBtn, padding: "2px 8px", marginTop: 0 }} disabled={disabled} onClick={() => move(index, 1)}>↓</button>
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {interactive && <button style={submitBtn} disabled={disabled} onClick={() => onSubmit?.("order_sequence", order)}>Comprobar</button>}
    </div>
  )
}
