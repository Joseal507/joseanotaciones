"use client"

import React, { Component, useState, type ReactNode } from "react"
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
import { EquationView, FlowSvgView, GeometrySvgView, SourceImageView, StructureGraphSvgView } from "./UniversalVisualViews"
import { evaluateExpression } from "../../lib/adaptive/visual/engines/shared"

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
    if (spec.engine === "structured_grid") return `Tabla estructurada ${spec.data.title||spec.data.reaction}, filas: ${spec.data.species.join(", ")}.`
    if (spec.engine === "spatial_vector") return `Diagrama de cuerpo libre sobre ${spec.data.body}: ${spec.data.forces.map(f => `${f.label} (${f.magnitude ?? "?"} ${f.unit || ""} a ${f.angleDeg}°)`).join(", ")}.`
    if (spec.engine === "chemistry_2d") return `Estructura con átomos ${spec.data.atoms.map(a => `${a.id}=${a.element}`).join(", ")} y ${spec.data.bonds.length} enlace(s).`
    if (spec.engine === "code_execution") return `Traza de ejecución (${spec.data.language}) con ${spec.data.steps.length} paso(s).`
    if (spec.engine === "timeline") return `Cronología con ${spec.data.events.length} evento(s): ${spec.data.events.map(e => `${e.date ? `${e.date}: ` : ""}${e.label}`).join(", ")}.`
    if (spec.engine === "geometry_canvas") return `Construcción geométrica con ${spec.data.points.length} puntos y ${spec.data.segments.length} segmentos.`
    if (spec.engine === "structure_graph") return `Estructura con ${spec.data.nodes.length} nodos y ${spec.data.edges.length} relaciones.`
    if (spec.engine === "flow_state") return `Proceso de ${spec.data.stages.length} etapas.`
    if (spec.engine === "equation_expression") return `Transformación simbólica de ${spec.data.steps.length} pasos.`
    return `Figura fuente: ${spec.data.alt}.`
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
  if (spec.engine === "timeline") return <TimelineView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled} />
  if (spec.engine === "geometry_canvas") return <GeometrySvgView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled}/>
  if (spec.engine === "structure_graph") return <StructureGraphSvgView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled}/>
  if (spec.engine === "flow_state") return <FlowSvgView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled}/>
  if (spec.engine === "equation_expression") return <EquationView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled}/>
  return <SourceImageView data={spec.data} mode={mode} onSubmit={onSubmit} disabled={disabled}/>
}

// Técnica "sr-only" estándar (clip, no display:none/visibility:hidden) — visible
// para lectores de pantalla, invisible en la UI normal.
const srOnly: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
}

// Copia y color por modo pedagógico (Bug 4, StudyAL_Visual_System_Stress_Test):
// el mismo VisualSpec puede renderizarse en teach/practice/assess, y antes de
// este fix no había ninguna señal visual que distinguiera un ejemplo
// explicativo de una comprobación que bloquea Continuar — el usuario veía la
// misma tarjeta "📝 Ejemplo" con un formulario de examen sin previo aviso.
// No se crea un engine ni un dato nuevo: se reutiliza `mode` (ya existente en
// VisualInteractionMode) solo para decidir texto/color de esta cabecera.
function modeBanner(mode: VisualInteractionMode): { label: string; detail: string; color: string; bg: string; border: string } {
  if (mode === "teach") {
    return { label: "Explora el ejemplo", detail: "Contenido explicativo — no afecta tu progreso.", color: "#60a5fa", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.35)" }
  }
  if (mode === "practice") {
    return { label: "Práctica guiada", detail: "Recibe retroalimentación — puedes continuar sin acertar.", color: "#facc15", bg: "rgba(250,204,21,0.10)", border: "rgba(250,204,21,0.35)" }
  }
  return { label: "Comprobación requerida", detail: "Necesitas una respuesta correcta para continuar.", color: "#f472b6", bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.35)" }
}

function VisualModeHeader({ mode }: { mode: VisualInteractionMode }) {
  const copy = modeBanner(mode)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 14px", marginBottom: 8, background: copy.bg, border: `1px solid ${copy.border}`, borderRadius: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: copy.color }}>{copy.label}</span>
      <span style={{ fontSize: 12, color: "#9ca3af" }}>{copy.detail}</span>
    </div>
  )
}

// Nota corta junto a la interacción misma (además de la cabecera general),
// para que la diferencia practice/assess sea visible exactamente donde el
// usuario va a escribir su respuesta, no solo arriba del todo.
function InteractionConsequenceNote({ mode }: { mode: VisualInteractionMode }) {
  if (mode === "assess") {
    return <div style={{ fontSize: 12, color: "#f472b6", marginBottom: 8 }}>Se requiere una respuesta correcta para continuar.</div>
  }
  return <div style={{ fontSize: 12, color: "#facc15", marginBottom: 8 }}>Práctica — tu respuesta no bloquea tu progreso.</div>
}

export function VisualRenderer(props: VisualRendererProps) {
  return (
    <VisualErrorBoundary spec={props.spec}>
      <VisualModeHeader mode={props.mode} />
      <VisualRendererInner {...props} />
      <p style={srOnly}>{describeVisualSpec(props.spec)}</p>
    </VisualErrorBoundary>
  )
}

// ---------------------------------------------------------------------------
// Genera marcas "redondas" (1/2/5 × 10^n) dentro de [min, max] — evita ticks
// como 3.333 que no aportan lectura a un estudiante (Bug 5, GraphEngine).
function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!(max > min)) return [min]
  const rawStep = (max - min) / targetCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const residual = rawStep / magnitude
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step)
  return ticks.length ? ticks : [min, max]
}

function fmtTick(v: number): string {
  return Math.abs(v) < 1e-9 ? "0" : Number(v.toFixed(4)).toString()
}

function GraphView({ data, mode, onSubmit, disabled }: { data: GraphDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [x, setX] = useState("")
  const [y, setY] = useState("")
  const [exploredPoint, setExploredPoint] = useState(0)
  const [sliderX,setSliderX]=useState(data.domain[0])
  // Área de trazado en un sistema de coordenadas interno fijo (viewBox) que
  // escala al 100% del ancho disponible — antes era un SVG de 320×200 fijo
  // que dejaba la mitad de una tarjeta ancha en blanco.
  const vbWidth = 480, vbHeight = 280
  const margin = { top: 26, right: 16, bottom: 32, left: 40 }
  const plotW = vbWidth - margin.left - margin.right
  const plotH = vbHeight - margin.top - margin.bottom
  const [domainMin, domainMax] = data.domain
  const ys = data.points.map(p => p.y)
  const rawYMin = Math.min(0, ...ys), rawYMax = Math.max(0, ...ys) || 1
  const yPad = (rawYMax - rawYMin) * 0.1 || 1
  const yMin = rawYMin - yPad, yMax = rawYMax + yPad
  const toScreenX = (px: number) => margin.left + ((px - domainMin) / (domainMax - domainMin || 1)) * plotW
  const toScreenY = (py: number) => margin.top + plotH - ((py - yMin) / (yMax - yMin || 1)) * plotH
  const path = data.points.map(p => `${toScreenX(p.x)},${toScreenY(p.y)}`).join(" ")
  const xTicks = niceTicks(domainMin, domainMax)
  const yTicks = niceTicks(yMin, yMax)
  const zeroInX = domainMin <= 0 && domainMax >= 0
  const zeroInY = yMin <= 0 && yMax >= 0
  const sliderY=evaluateExpression(data.expression,sliderX)
  const derivedRoots=data.points.filter(point=>Math.abs(point.y)<1e-9)
  const axisX = zeroInY ? toScreenY(0) : margin.top + plotH
  const axisY = zeroInX ? toScreenX(0) : margin.left
  return (
    <div style={wrap}>
      <div style={{ ...label, fontSize: 14, fontWeight: 700, color: "#e5e7eb", marginBottom: 4 }}>f(x) = {data.expression}</div>
      <div style={label}>dominio [{domainMin}, {domainMax}]</div>
      <svg data-testid="graph-svg" viewBox={`0 0 ${vbWidth} ${vbHeight}`} style={{ width: "100%", height: "auto", background: "#0c0c12", borderRadius: 8, display: "block", touchAction:"manipulation" }} role="img" aria-label={`Gráfica de ${data.expression}`}>
        {/* grid */}
        {xTicks.map((t, i) => <line key={`gx${i}`} x1={toScreenX(t)} y1={margin.top} x2={toScreenX(t)} y2={margin.top + plotH} stroke="#1f2430" strokeWidth={1} />)}
        {yTicks.map((t, i) => <line key={`gy${i}`} x1={margin.left} y1={toScreenY(t)} x2={margin.left + plotW} y2={toScreenY(t)} stroke="#1f2430" strokeWidth={1} />)}
        {/* axes */}
        <line x1={margin.left} y1={axisX} x2={margin.left + plotW} y2={axisX} stroke="#4b5563" strokeWidth={1.5} />
        <line x1={axisY} y1={margin.top} x2={axisY} y2={margin.top + plotH} stroke="#4b5563" strokeWidth={1.5} />
        {/* ticks + labels */}
        {xTicks.map((t, i) => (
          <g key={`tx${i}`}>
            <line x1={toScreenX(t)} y1={axisX - 3} x2={toScreenX(t)} y2={axisX + 3} stroke="#6b7280" />
            <text x={toScreenX(t)} y={margin.top + plotH + 16} fill="#9ca3af" fontSize={10} textAnchor="middle">{fmtTick(t)}</text>
          </g>
        ))}
        {yTicks.map((t, i) => (
          <g key={`ty${i}`}>
            <line x1={axisY - 3} y1={toScreenY(t)} x2={axisY + 3} y2={toScreenY(t)} stroke="#6b7280" />
            <text x={margin.left - 8} y={toScreenY(t) + 3} fill="#9ca3af" fontSize={10} textAnchor="end">{fmtTick(t)}</text>
          </g>
        ))}
        <text x={margin.left + plotW} y={margin.top + plotH + 16} fill="#6b7280" fontSize={10} textAnchor="end">x</text>
        <text x={margin.left} y={margin.top - 10} fill="#6b7280" fontSize={10} textAnchor="start">f(x)</text>
        {data.points.length > 1 && <polyline points={path} fill="none" stroke="#4ade80" strokeWidth={2} />}
        {data.points.map((p, i) => (
          <g key={i} tabIndex={0} focusable="true" role="button" aria-label={`Punto ${p.x}, ${p.y}`} onClick={()=>{setExploredPoint(i);if(mode!=="teach")onSubmit?.("select_region",{x:p.x,y:p.y})}} onKeyDown={e=>{if(e.key==="Enter"){setExploredPoint(i);if(mode!=="teach")onSubmit?.("select_region",{x:p.x,y:p.y})}}}>
            <circle cx={toScreenX(p.x)} cy={toScreenY(p.y)} r={exploredPoint===i?7:4} fill={exploredPoint===i?"#facc15":"#60a5fa"} stroke="#0c0c12" strokeWidth={1.5}>
              <title>{p.label ? `${p.label}: ` : ""}({fmtTick(p.x)}, {fmtTick(p.y)})</title>
            </circle>
            {p.label && <text x={toScreenX(p.x)} y={toScreenY(p.y) - 8} fill="#93c5fd" fontSize={10} textAnchor="middle">{p.label}</text>}
          </g>
        ))}
        {mode==="teach"&&sliderY!==null&&<g><line x1={toScreenX(sliderX)} y1={axisX} x2={toScreenX(sliderX)} y2={toScreenY(sliderY)} stroke="#facc15" strokeDasharray="4 3"/><circle cx={toScreenX(sliderX)} cy={toScreenY(sliderY)} r="6" fill="#facc15"/></g>}
      </svg>
      {mode === "teach" && data.points.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={label}>Explora x:</span>
          {data.points.map((point, index) => <button key={`${point.x}:${index}`} type="button" style={{ ...submitBtn, marginTop: 0, padding: "5px 10px", background: exploredPoint === index ? "#60a5fa" : "#273449", color: "white" }} onClick={() => setExploredPoint(index)}>{fmtTick(point.x)}</button>)}
          <span style={{ color: "#93c5fd" }}>x={fmtTick(data.points[exploredPoint].x)} → y={fmtTick(data.points[exploredPoint].y)}</span>
          <input aria-label="Seleccionar valor de x" type="range" min={domainMin} max={domainMax} step={(domainMax-domainMin)/100||1} value={sliderX} onChange={e=>setSliderX(Number(e.target.value))}/>
          {sliderY!==null&&<span style={{color:"#facc15"}}>f({fmtTick(sliderX)}) = {fmtTick(sliderY)}</span>}
          {derivedRoots.length>0&&<span style={{color:"#4ade80"}}>Raíz observada: {derivedRoots.map(root=>fmtTick(root.x)).join(", ")}</span>}
        </div>
      )}
      {data.annotations && data.annotations.length > 0 && (
        <ul style={{ marginTop: 8, paddingLeft: 18, color: "#9ca3af", fontSize: 12 }}>
          {data.annotations.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}
      {(mode === "practice" || mode === "assess") && (
        <div style={{ marginTop: 10 }}>
          <InteractionConsequenceNote mode={mode} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#9ca3af" }}>¿Cuánto vale f(</span>
            <input style={input} value={x} onChange={e => setX(e.target.value)} placeholder="x" disabled={disabled} />
            <span style={{ color: "#9ca3af" }}>) ?</span>
            <input style={input} value={y} onChange={e => setY(e.target.value)} placeholder="y" disabled={disabled} />
            <button style={submitBtn} disabled={disabled || !x || !y} onClick={() => onSubmit?.("select_region", { x: Number(x), y: Number(y) })}>Comprobar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function StructuredGridView({ data, mode, onSubmit, disabled }: { data: StructuredGridDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [exploredRow, setExploredRow] = useState<"initial" | "change" | "equilibrium">("initial")
  const interactive = mode === "practice" || mode === "assess"
  const stages=data.stageLabels||{initial:"Inicial",change:"Cambio",equilibrium:"Equilibrio"}
  return (
    <div style={wrap}>
      <div style={label}>{data.title||data.reaction}</div>
      <div style={{overflowX:"auto"}}><table data-testid="structured-grid" style={{ width: "100%", minWidth:420,borderCollapse: "collapse", color: "#e5e7eb" }}>
        <thead>
          <tr>{["Elemento", stages.initial, stages.change, stages.equilibrium].map(h => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #333", fontSize: 13, color: "#9ca3af" }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.species.map(id => (
            <tr key={id} style={mode === "teach" ? { background: exploredRow === "initial" ? "rgba(96,165,250,.08)" : exploredRow === "change" ? "rgba(250,204,21,.08)" : "rgba(74,222,128,.08)" } : undefined}>
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
      </table></div>
      {mode === "teach" && <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>{([['initial',stages.initial],['change',stages.change],['equilibrium',stages.equilibrium]] as const).map(([row,text])=><button key={row} type="button" style={{...submitBtn,marginTop:0,padding:"5px 10px",background:exploredRow===row?"#60a5fa":"#273449",color:"white"}} onClick={()=>setExploredRow(row)}>{text}</button>)}<span style={{color:"#9ca3af"}}>Selecciona una columna para seguir su relación con todas las filas.</span></div>}
      {interactive && (
        <div style={{ marginTop: 10 }}>
          <InteractionConsequenceNote mode={mode} />
          <button style={submitBtn} disabled={disabled || data.species.some(id => !values[id])} onClick={() => onSubmit?.("fill_cell", values)}>Comprobar</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function SpatialVectorView({ data, mode, onSubmit, disabled }: { data: SpatialVectorDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [attempt, setAttempt] = useState<Record<string, { angleDeg?: number; magnitude?: number }>>({})
  const [selectedForce, setSelectedForce] = useState(data.forces[0]?.id || "")
  const interactive = mode === "practice" || mode === "assess"
  const width = 520, height = 360, cx = width / 2, cy = height / 2
  const magnitudes = data.forces.map(force=>force.magnitude).filter((value):value is number=>typeof value==='number'&&value>0)
  const maxMagnitude = Math.max(1,...magnitudes)
  const angleChoices = [...new Set([...data.forces.map(force=>force.angleDeg),0,30,90,180,270])].sort((a,b)=>a-b)
  return (
    <div style={wrap}>
      <div style={label}>Diagrama de cuerpo libre — {data.body}</div>
      <svg data-testid="spatial-vector-system" viewBox={`0 0 ${width} ${height}`} style={{ width:"100%",height:"auto",maxHeight:420,background: "#0c0c12", borderRadius: 8 }} role="img" aria-label={`Diagrama con ${data.forces.length} fuerzas sobre ${data.body}`}>
        <line x1={36} y1={cy} x2={width-36} y2={cy} stroke="#334155" strokeDasharray="5 6"/><line x1={cx} y1={28} x2={cx} y2={height-28} stroke="#334155" strokeDasharray="5 6"/>
        <text x={width-48} y={cy-9} fill="#64748b" fontSize={13}>x</text><text x={cx+10} y={38} fill="#64748b" fontSize={13}>y</text>
        <rect x={cx-38} y={cy-28} width={76} height={56} rx={8} fill="#1e293b" stroke="#cbd5e1" strokeWidth={2}/><text x={cx} y={cy+5} textAnchor="middle" fill="#f8fafc" fontSize={14}>{data.body}</text>
        {data.forces.map((force, i) => {
          const rad = (force.angleDeg * Math.PI) / 180
          const len = force.magnitude===null?105:Math.max(82,Math.min(142,82+(force.magnitude/maxMagnitude)*60))
          const x2 = cx + len * Math.cos(rad)
          const y2 = cy - len * Math.sin(rad)
          const selected=selectedForce===force.id
          const labelX=x2+(Math.cos(rad)>=0?12:-12),labelY=y2+(Math.sin(rad)>=0?-10:20)
          return (
            <g key={force.id} tabIndex={0} role="button" aria-label={`${force.label}, ${force.magnitude??'magnitud no indicada'} ${force.unit||''}, ${force.angleDeg} grados`} onClick={()=>setSelectedForce(force.id)} onFocus={()=>setSelectedForce(force.id)} style={{cursor:'pointer',opacity:selected||!selectedForce?1:.42}}>
              <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={["#4ade80", "#60a5fa", "#f472b6", "#facc15"][i % 4]} strokeWidth={selected?5:3} markerEnd="url(#arrow)" />
              <circle cx={x2} cy={y2} r={selected?5:3} fill="#f8fafc"/>
              <text x={labelX} y={labelY} textAnchor={Math.cos(rad)>=0?'start':'end'} fill={selected?'#f8fafc':'#cbd5e1'} fontSize={15} fontWeight={selected?700:500}>{force.label}</text>
            </g>
          )
        })}
        {data.decomposition&&(()=>{const force=data.forces.find(item=>item.id===data.decomposition!.forceId);if(!force)return null;const rad=force.angleDeg*Math.PI/180;const len=force.magnitude===null?105:Math.max(82,Math.min(142,82+(force.magnitude/maxMagnitude)*60));const x2=cx+len*Math.cos(rad),y2=cy-len*Math.sin(rad);return <g data-testid="vector-decomposition"><line x1={cx} y1={cy} x2={x2} y2={cy} stroke="#38bdf8" strokeWidth={3} markerEnd="url(#arrow)"/><line x1={x2} y1={cy} x2={x2} y2={y2} stroke="#fbbf24" strokeWidth={3} markerEnd="url(#arrow)"/><line x1={cx} y1={y2} x2={x2} y2={y2} stroke="#64748b" strokeDasharray="5 5"/><path d={`M ${cx+30} ${cy} A 30 30 0 0 0 ${cx+30*Math.cos(rad)} ${cy-30*Math.sin(rad)}`} fill="none" stroke="#f8fafc"/><text x={cx+38} y={cy-8} fill="#38bdf8" fontSize={14}>Fx ≈ {data.decomposition.xMagnitude} {data.decomposition.unit||''}</text><text x={x2+10} y={(cy+y2)/2} fill="#fbbf24" fontSize={14}>Fy = {data.decomposition.yMagnitude} {data.decomposition.unit||''}</text><text x={cx+34} y={cy-22} fill="#f8fafc" fontSize={13}>θ={data.decomposition.angleDeg}°</text></g>})()}
        <defs>
          <marker id="arrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#e5e7eb" /></marker>
        </defs>
      </svg>
      {mode === "teach" && <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8}}>{data.forces.map(force=><button key={force.id} type="button" style={{...submitBtn,marginTop:0,padding:"5px 10px",background:selectedForce===force.id?"#60a5fa":"#273449",color:"white"}} onClick={()=>setSelectedForce(force.id)}>{force.label}</button>)}{data.forces.filter(force=>force.id===selectedForce).map(force=><span key={force.id} style={{color:"#93c5fd"}}>{force.magnitude ?? "?"} {force.unit || ""}, dirección {force.angleDeg}°</span>)}</div>}
      {interactive && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <InteractionConsequenceNote mode={mode} />
          {data.forces.map(force => (
            <div key={force.id} style={{ display: "flex", gap: 8, alignItems: "center",flexWrap:'wrap' }}>
              <button type="button" style={{...submitBtn,margin:0,minWidth:110,background:selectedForce===force.id?'#2563eb':'#273449'}} onClick={()=>setSelectedForce(force.id)}>{force.label}</button>
              <span style={{color:'#94a3b8'}}>Dirección:</span>{angleChoices.map(angle=><button type="button" key={angle} disabled={disabled} style={{...submitBtn,margin:0,padding:'5px 9px',background:attempt[force.id]?.angleDeg===angle?'#2563eb':'#273449'}} onClick={()=>setAttempt(v=>({...v,[force.id]:{...v[force.id],angleDeg:angle}}))}>{angle}°</button>)}
              {force.magnitude!==null&&<><span style={{color:'#94a3b8'}}>Magnitud:</span>{[...new Set([force.magnitude,...magnitudes])].slice(0,4).map(magnitude=><button type="button" key={magnitude} disabled={disabled} style={{...submitBtn,margin:0,padding:'5px 9px',background:attempt[force.id]?.magnitude===magnitude?'#2563eb':'#273449'}} onClick={()=>setAttempt(v=>({...v,[force.id]:{...v[force.id],magnitude}}))}>{magnitude} {force.unit||''}</button>)}</>}
            </div>
          ))}
          <button style={submitBtn} onClick={() => onSubmit?.("place_vector", Object.fromEntries(
            Object.entries(attempt).map(([id, v]) => [id, v]),
          ))} disabled={disabled}>Comprobar</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function Chemistry2DView({ data, mode, onSubmit, disabled }: { data: Chemistry2DDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [selectedAtom, setSelectedAtom] = useState(data.atoms[0]?.id || "")
  const [selectedBond,setSelectedBond]=useState("")
  const interactive = mode === "practice" || mode === "assess"
  const byId = new Map(data.atoms.map(atom => [atom.id, atom]))
  const width = Math.max(240, ...data.atoms.map(a => a.x)) + 70
  const height = Math.max(150,...data.atoms.map(a=>a.y))+50
  return (
    <div style={wrap}>
      <div style={label}>Estructura</div>
      <svg data-testid="chemistry-structure" viewBox={`0 0 ${width} ${height}`} style={{ width:"100%",height:"auto",background: "#0c0c12", borderRadius: 8 }} role="img" aria-label="Estructura química interactiva">
        {data.bonds.map((bond, i) => {
          const from = byId.get(bond.from), to = byId.get(bond.to)
          if (!from || !to) return null
          const offset = bond.order === 2 ? 3 : 0
          return (
            <g key={i} tabIndex={0} role="button" aria-label={`Enlace ${bond.from}-${bond.to}`} onClick={()=>setSelectedBond(`${bond.from}-${bond.to}`)}>
              <line x1={from.x + 20} y1={from.y + 40 - offset} x2={to.x + 20} y2={to.y + 40 - offset} stroke={selectedBond===`${bond.from}-${bond.to}`?"#facc15":"#9ca3af"} strokeWidth={selectedBond?3:2} />
              {bond.order >= 2 && <line x1={from.x + 20} y1={from.y + 40 + offset} x2={to.x + 20} y2={to.y + 40 + offset} stroke="#9ca3af" strokeWidth={2} />}
            </g>
          )
        })}
        {data.atoms.map(atom => (
          <g key={atom.id} tabIndex={mode === "teach" ? 0 : undefined} onClick={mode === "teach" ? ()=>setSelectedAtom(atom.id) : undefined} style={mode === "teach" ? {cursor:"pointer"} : undefined}>
            <circle cx={atom.x + 20} cy={atom.y + 40} r={14} fill={selectedAtom===atom.id?"#1d4ed8":"#1f2937"} stroke="#4ade80" />
            <text x={atom.x + 20} y={atom.y + 44} fill="#e5e7eb" fontSize={11} textAnchor="middle">{interactive ? "?" : atom.element}</text>
          </g>
        ))}
      </svg>
      {mode === "teach" && <div style={{color:"#93c5fd",fontSize:13,marginTop:8}}>Átomo seleccionado: {selectedAtom} ({data.atoms.find(atom=>atom.id===selectedAtom)?.element}). Selecciona otro átomo para comparar su posición y enlaces.</div>}
      {interactive && (
        <div style={{ marginTop: 10 }}>
          <InteractionConsequenceNote mode={mode} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {data.atoms.map(atom => (
            <div key={atom.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ color: "#9ca3af" }}>{atom.id}</span>
              <input style={{ ...input, width: 50 }} value={labels[atom.id] || ""} disabled={disabled}
                onChange={e => setLabels(v => ({ ...v, [atom.id]: e.target.value }))} />
            </div>
          ))}
          <button style={submitBtn} onClick={() => onSubmit?.("label_structure", labels)} disabled={disabled}>Comprobar</button>
        </div>
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
        <div style={{ marginTop: 10 }}>
          <InteractionConsequenceNote mode={mode} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#9ca3af" }}>En la línea</span>
          <input style={{ ...input, width: 50 }} value={line} onChange={e => setLine(e.target.value)} disabled={disabled} />
          <span style={{ color: "#9ca3af" }}>¿cuál es la salida?</span>
          <input style={input} value={value} onChange={e => setValue(e.target.value)} disabled={disabled} />
          <button style={submitBtn} disabled={disabled || !line || !value} onClick={() => onSubmit?.("predict_output", { line: Number(line), variable: "output", value })}>Comprobar</button>
        </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function TimelineView({ data, mode, onSubmit, disabled }: { data: TimelineDataSpec; mode: VisualInteractionMode; onSubmit?: (verb: VisualInteractionVerb, response: unknown) => void; disabled?: boolean }) {
  const sorted = [...data.events].sort((a, b) => a.order - b.order)
  const [order, setOrder] = useState(mode === "teach" ? sorted.map(e => e.id) : [...sorted.map(e => e.id)].reverse())
  const [selectedEvent, setSelectedEvent] = useState(sorted[0]?.id || "")
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
      {mode==="teach"&&<div data-testid="timeline-track" style={{display:"flex",alignItems:"flex-start",gap:0,width:"100%",padding:"20px 0",flexWrap:"wrap"}}>{sorted.map((event,index)=><button key={event.id} onClick={()=>setSelectedEvent(event.id)} style={{flex:"1 1 140px",minHeight:72,border:0,borderTop:`3px solid ${selectedEvent===event.id?"#60a5fa":"#475569"}`,background:selectedEvent===event.id?"rgba(96,165,250,.15)":"transparent",color:"#e5e7eb",padding:8,textAlign:"left"}}><strong>{event.date||`Evento ${index+1}`}{event.endDate?`–${event.endDate}`:""}</strong><br/><span>{event.label}</span></button>)}</div>}
      {interactive&&<ol style={{ paddingLeft: 20, color: "#e5e7eb" }}>
        {(interactive ? order : sorted.map(e => e.id)).map((id, index) => {
          const event = byId.get(id)!
          return (
            <li key={id} style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{padding:4}}>{event.label}</span>
              {interactive && (
                <span style={{ display: "flex", gap: 4 }}>
                  <button style={{ ...submitBtn, padding: "2px 8px", marginTop: 0 }} disabled={disabled} onClick={() => move(index, -1)}>↑</button>
                  <button style={{ ...submitBtn, padding: "2px 8px", marginTop: 0 }} disabled={disabled} onClick={() => move(index, 1)}>↓</button>
                </span>
              )}
            </li>
          )
        })}
      </ol>}
      {mode === "teach" && selectedEvent && <div style={{color:"#93c5fd",fontSize:13}}>Evento {sorted.findIndex(event=>event.id===selectedEvent)+1} de {sorted.length}: {byId.get(selectedEvent)?.label}{byId.get(selectedEvent)?.detail?` — ${byId.get(selectedEvent)?.detail}`:""}</div>}
      {interactive && (
        <div>
          <InteractionConsequenceNote mode={mode} />
          <button style={submitBtn} disabled={disabled} onClick={() => onSubmit?.("order_sequence", order)}>Comprobar</button>
        </div>
      )}
    </div>
  )
}
