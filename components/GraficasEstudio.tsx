'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getPerfil } from '../lib/storage';
import { useIdioma } from '../hooks/useIdioma';

interface DiaData {
  dia: string;
  fecha: string;
  total: number;
  acertadas: number;
  falladas: number;
}

interface TooltipData {
  x: number;
  y: number;
  content: string[];
  visible: boolean;
}

const hexToRgba = (hex: string, alpha: number) => {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  if (isNaN(r)) return `rgba(245,200,66,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
};

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl?: number) {
  if (bl === undefined) bl = br;
  if (h <= 0) return;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + Math.min(tr, h));
  ctx.lineTo(x + w, y + h - Math.min(br, h));
  ctx.quadraticCurveTo(x + w, y + h, x + w - Math.min(br, w), y + h);
  ctx.lineTo(x + Math.min(bl, w), y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - Math.min(bl, h));
  ctx.lineTo(x, y + Math.min(tl, h));
  ctx.quadraticCurveTo(x, y, x + Math.min(tl, w), y);
  ctx.closePath();
  ctx.fill();
}

export default function GraficasEstudio() {
  const [perfil, setPerfil] = useState<any>(null);
  const [rachaData, setRachaData] = useState<{ fecha: string; estudió: boolean; sesiones: number }[]>([]);
  const [tab, setTab] = useState<'semana' | 'materias' | 'racha'>('semana');
  const { idioma } = useIdioma();
  const canvasRefSemana = useRef<HTMLCanvasElement>(null);
  const canvasRefMaterias = useRef<HTMLCanvasElement>(null);
  const canvasRefRacha = useRef<HTMLCanvasElement>(null);
  const [tooltipSemana, setTooltipSemana] = useState<TooltipData>({ x: 0, y: 0, content: [], visible: false });
  const [tooltipMaterias, setTooltipMaterias] = useState<TooltipData>({ x: 0, y: 0, content: [], visible: false });
  const [tooltipRacha, setTooltipRacha] = useState<TooltipData>({ x: 0, y: 0, content: [], visible: false });

  useEffect(() => {
    const p = getPerfil();
    setPerfil(p);
    try {
      const r = localStorage.getItem('josea_racha');
      if (r) {
        const racha = JSON.parse(r);
        const dias: { fecha: string; estudió: boolean; sesiones: number }[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const fl = d.toLocaleDateString('es-ES');
          const fe = d.toLocaleDateString('en-US');
          const sesDB = (p?.sesiones || []).filter((s: any) => s.fecha === str || s.fecha === fl || s.fecha === fe).length;
          const estudió = racha.diasEstudiados?.includes(str) || false;
          // Si estudió pero no hay sesiones registradas, contar al menos 1
          const ses = sesDB > 0 ? sesDB : (estudió ? 1 : 0);
          dias.push({ fecha: str, estudió, sesiones: ses });
        }
        setRachaData(dias);
      }
    } catch {}
  }, []);

  // ── Datos semana ─────────────────────────────────────────────────────
  const diasNombres = idioma === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const diasSemana: DiaData[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const fs = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fl = d.toLocaleDateString('es-ES');
    const fe = d.toLocaleDateString('en-US');
    const ses = (perfil?.sesiones || []).filter((s: any) => s.fecha === fs || s.fecha === fl || s.fecha === fe);
    diasSemana.push({
      dia: diasNombres[d.getDay()],
      fecha: fs,
      total: ses.length,
      acertadas: ses.reduce((a: number, s: any) => a + (s.acertadas || 0), 0),
      falladas: ses.reduce((a: number, s: any) => a + (s.falladas || 0), 0),
    });
  }
  const maxSes = Math.max(...diasSemana.map(d => d.total), 1);
  const semAc = diasSemana.reduce((a, d) => a + d.acertadas, 0);
  const semFa = diasSemana.reduce((a, d) => a + d.falladas, 0);
  const semT = semAc + semFa;
  const precSem = semT > 0 ? Math.round((semAc / semT) * 100) : 0;

  // ── Materias ─────────────────────────────────────────────────────────
  const materiasArr = perfil
    ? Object.entries(perfil.materiasStats || {})
        .map(([id, s]: [string, any]) => ({ id, ...s }))
        .filter((m: any) => (m.totalFlashcards || 0) > 0 || (m.quizzes || 0) > 0)
        .sort((a: any, b: any) => ((b.totalFlashcards || 0) + (b.quizzes || 0)) - ((a.totalFlashcards || 0) + (a.quizzes || 0)))
        .slice(0, 8)
    : [];

  // ═══════════════════════════════════════════════════════════════════
  // CANVAS: SEMANA
  // ═══════════════════════════════════════════════════════════════════
  const semanaXPositions = useRef<{ x: number; data: DiaData; yVal: number }[]>([]);

  useEffect(() => {
    if (tab !== 'semana') return;
    const canvas = canvasRefSemana.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const pL = 40, pR = 20, pT = 24, pB = 44;
    const gW = W - pL - pR, gH = H - pT - pB;
    const maxV = Math.max(maxSes, 1);
    const getX = (i: number) => pL + (gW / 6) * i;
    const getY = (v: number) => pT + gH - (v / maxV) * gH;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pT + (gH / 4) * i;
      ctx.strokeStyle = 'rgba(100,100,100,0.12)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(W - pR, y); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxV - (maxV / 4) * i)), pL - 8, y + 3);
    }

    const positions: { x: number; data: DiaData; yVal: number }[] = [];

    if (diasSemana.some(d => d.total > 0)) {
      // Área
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(diasSemana[0].total));
      for (let i = 1; i < 7; i++) {
        const cp = (getX(i - 1) + getX(i)) / 2;
        ctx.bezierCurveTo(cp, getY(diasSemana[i - 1].total), cp, getY(diasSemana[i].total), getX(i), getY(diasSemana[i].total));
      }
      ctx.lineTo(getX(6), pT + gH); ctx.lineTo(getX(0), pT + gH); ctx.closePath();
      const grad = ctx.createLinearGradient(0, pT, 0, pT + gH);
      grad.addColorStop(0, 'rgba(56,189,248,0.22)');
      grad.addColorStop(0.7, 'rgba(56,189,248,0.04)');
      grad.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.fillStyle = grad; ctx.fill();

      // Línea
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(diasSemana[0].total));
      for (let i = 1; i < 7; i++) {
        const cp = (getX(i - 1) + getX(i)) / 2;
        ctx.bezierCurveTo(cp, getY(diasSemana[i - 1].total), cp, getY(diasSemana[i].total), getX(i), getY(diasSemana[i].total));
      }
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;

      // Puntos
      diasSemana.forEach((d, i) => {
        const x = getX(i), y = getY(d.total);
        const esHoy = i === 6;
        ctx.beginPath(); ctx.arc(x, y, esHoy ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = esHoy ? 'rgba(245,200,66,0.2)' : 'rgba(56,189,248,0.15)'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, esHoy ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = esHoy ? '#f5c842' : '#38bdf8'; ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.stroke();
        positions.push({ x, data: d, yVal: y });
      });
    } else {
      ctx.fillStyle = '#444'; ctx.font = '13px -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(idioma === 'en' ? 'No activity this week' : 'Sin actividad esta semana', W / 2, H / 2);
    }

    // Día labels
    diasSemana.forEach((d, i) => {
      const x = getX(i);
      const esHoy = i === 6;
      ctx.fillStyle = esHoy ? '#f5c842' : '#777';
      ctx.font = `${esHoy ? 'bold ' : ''}11px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(d.dia, x, H - pB + 16);
      if (esHoy) { ctx.fillStyle = 'rgba(245,200,66,0.6)'; ctx.font = 'bold 8px -apple-system, sans-serif'; ctx.fillText(idioma === 'en' ? 'TODAY' : 'HOY', x, H - pB + 28); }
    });

    semanaXPositions.current = positions;
  }, [tab, perfil, diasSemana, maxSes, idioma]);

  const handleSemanaMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRefSemana.current;
    if (!canvas || semanaXPositions.current.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    // Encontrar el punto más cercano en X
    let closest = semanaXPositions.current[0];
    let minDist = Infinity;
    for (const p of semanaXPositions.current) {
      const dist = Math.abs(mx - p.x);
      if (dist < minDist) { minDist = dist; closest = p; }
    }
    const d = closest.data;
    const lines = [`📅 ${d.dia} · ${d.fecha}`, `📊 ${d.total} ${idioma === 'en' ? 'sessions' : 'sesiones'}`];
    if (d.acertadas + d.falladas > 0) {
      lines.push(`✅ ${d.acertadas} · ❌ ${d.falladas}`);
      lines.push(`🎯 ${Math.round((d.acertadas / (d.acertadas + d.falladas)) * 100)}%`);
    }
    setTooltipSemana({ x: closest.x, y: closest.yVal - 10, content: lines, visible: true });
  }, [idioma]);

  // ═══════════════════════════════════════════════════════════════════
  // CANVAS: MATERIAS — barras verticales
  // ═══════════════════════════════════════════════════════════════════
  // CANVAS: MATERIAS — barras verticales profesionales
  const materiasHitAreas = useRef<{ x: number; w: number; data: any }[]>([]);

  useEffect(() => {
    if (tab !== 'materias') return;
    const canvas = canvasRefMaterias.current;
    if (!canvas || materiasArr.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const pL = 8, pR = 8, pT = 28, pB = 64;
    const gW = W - pL - pR, gH = H - pT - pB;
    const n = materiasArr.length;
    const barGroupW = gW / n;
    const barW = Math.min(Math.max(barGroupW * 0.65, 24), 60);
    const maxVal = Math.max(...materiasArr.map((m: any) => (m.totalFlashcards || 0) + (m.quizzes || 0)), 1);

    // Grid lines suaves
    for (let i = 0; i <= 3; i++) {
      const y = pT + (gH / 3) * i;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(W - pR, y); ctx.stroke();
    }

    const hits: { x: number; w: number; data: any }[] = [];

    materiasArr.forEach((m: any, i: number) => {
      const fT = m.totalFlashcards || 0;
      const qC = m.quizzes || 0;
      const total = fT + qC;
      const barH = Math.max((total / maxVal) * gH, 4);
      const x = pL + (barGroupW - barW) / 2 + i * barGroupW;
      const y = pT + gH - barH;

      const color = m.color || '#f5c842';

      if (total > 0) {
        const flashH = (fT / total) * barH;
        const quizH = (qC / total) * barH;

        // === FLASH (abajo) ===
        if (flashH > 0) {
          ctx.save();
          ctx.shadowColor = hexToRgba(color, 0.4);
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
          const grad = ctx.createLinearGradient(x, y + quizH, x, y + quizH + flashH);
          grad.addColorStop(0, hexToRgba(color, 1));
          grad.addColorStop(1, hexToRgba(color, 0.5));
          ctx.fillStyle = grad;
          // Esquinas redondeadas
          const rTop = qC > 0 ? 0 : 8;
          const r = 8;
          const fy = y + quizH;
          ctx.beginPath();
          ctx.moveTo(x + rTop, fy);
          ctx.lineTo(x + barW - rTop, fy);
          ctx.quadraticCurveTo(x + barW, fy, x + barW, fy + Math.min(rTop, flashH));
          ctx.lineTo(x + barW, fy + flashH - r);
          ctx.quadraticCurveTo(x + barW, fy + flashH, x + barW - r, fy + flashH);
          ctx.lineTo(x + r, fy + flashH);
          ctx.quadraticCurveTo(x, fy + flashH, x, fy + flashH - r);
          ctx.lineTo(x, fy + Math.min(rTop, flashH));
          ctx.quadraticCurveTo(x, fy, x + rTop, fy);
          ctx.closePath();
          ctx.fill();

          // Brillo superior
          const shine = ctx.createLinearGradient(x, fy, x + barW, fy);
          shine.addColorStop(0, 'rgba(255,255,255,0.15)');
          shine.addColorStop(0.5, 'rgba(255,255,255,0.05)');
          shine.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = shine;
          ctx.fillRect(x, fy, barW * 0.5, Math.min(flashH, 20));
          ctx.restore();
        }

        // === QUIZ (arriba) ===
        if (quizH > 0) {
          ctx.save();
          ctx.shadowColor = 'rgba(167,139,250,0.35)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 3;
          const grad = ctx.createLinearGradient(x, y, x, y + quizH);
          grad.addColorStop(0, 'rgba(167,139,250,1)');
          grad.addColorStop(1, 'rgba(167,139,250,0.55)');
          ctx.fillStyle = grad;
          const rr = 8;
          const rBot = fT > 0 ? 0 : 8;
          ctx.beginPath();
          ctx.moveTo(x + rr, y);
          ctx.lineTo(x + barW - rr, y);
          ctx.quadraticCurveTo(x + barW, y, x + barW, y + rr);
          ctx.lineTo(x + barW, y + quizH - rBot);
          ctx.quadraticCurveTo(x + barW, y + quizH, x + barW - rBot, y + quizH);
          ctx.lineTo(x + rBot, y + quizH);
          ctx.quadraticCurveTo(x, y + quizH, x, y + quizH - rBot);
          ctx.lineTo(x, y + rr);
          ctx.quadraticCurveTo(x, y, x + rr, y);
          ctx.closePath();
          ctx.fill();

          // Brillo
          const shine = ctx.createLinearGradient(x, y, x + barW, y);
          shine.addColorStop(0, 'rgba(255,255,255,0.12)');
          shine.addColorStop(0.5, 'rgba(255,255,255,0.03)');
          shine.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = shine;
          ctx.fillRect(x, y, barW * 0.4, Math.min(quizH, 16));
          ctx.restore();
        }

        // Valor encima
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(total), x + barW / 2, y - 8);
      }

      // Nombre de materia
      ctx.save();
      ctx.fillStyle = '#999';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      const name = m.nombre.length > 9 ? m.nombre.slice(0, 8) + '…' : m.nombre;
      ctx.fillText(name, x + barW / 2, H - pB + 18);

      // Dot color
      ctx.beginPath();
      ctx.arc(x + barW / 2, H - pB + 32, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      // Borde del dot
      ctx.strokeStyle = hexToRgba(color, 0.3);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Precisión
      const fAcert = m.acertadas || 0;
      const qPunt = m.quizPuntuacion || 0;
      let prec = 0;
      if (fT > 0 && qC > 0) {
        prec = Math.round(((fAcert / fT + Math.min(qPunt / qC / 100, 1)) / 2) * 100);
      } else if (fT > 0) prec = Math.round((fAcert / fT) * 100);
      else if (qC > 0) prec = Math.min(Math.round(qPunt / qC), 100);
      ctx.fillStyle = prec >= 70 ? '#4ade80' : prec >= 50 ? '#f5c842' : prec > 0 ? '#ff4d6d' : '#555';
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.fillText(prec + '%', x + barW / 2, H - pB + 48);
      ctx.restore();

      hits.push({ x, w: barW, data: m });
    });

    materiasHitAreas.current = hits;
  }, [tab, perfil, materiasArr]);

  const handleMateriasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRefMaterias.current;
    if (!canvas || materiasHitAreas.current.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // Encontrar la barra más cercana en X
    let closest = materiasHitAreas.current[0];
    let minDist = Infinity;
    for (const h of materiasHitAreas.current) {
      const cx = h.x + h.w / 2;
      const dist = Math.abs(mx - cx);
      if (dist < minDist) { minDist = dist; closest = h; }
    }
    // Solo mostrar si el cursor está razonablemente cerca
    if (minDist > closest.w * 1.5) {
      setTooltipMaterias(p => p.visible ? { ...p, visible: false } : p);
      return;
    }
    const m = closest.data;
    const fT = m.totalFlashcards || 0, fA = m.acertadas || 0, qC = m.quizzes || 0, qP = m.quizPuntuacion || 0;
    let prec = 0;
    if (fT > 0 && qC > 0) prec = Math.round(((fA / fT + Math.min(qP / qC / 100, 1)) / 2) * 100);
    else if (fT > 0) prec = Math.round((fA / fT) * 100);
    else if (qC > 0) prec = Math.min(Math.round(qP / qC), 100);
    const lines = [
      `📚 ${m.nombre}`,
      ...(fT > 0 ? [`🎴 ${fT} flashcards · ✅${fA} ❌${fT - fA} · ${Math.round((fA / fT) * 100)}%`] : []),
      ...(qC > 0 ? [`🤓 ${qC} quizzes · ${Math.min(Math.round(qP / qC), 100)}%`] : []),
      `🎯 Precisión: ${prec}%`,
    ];
    setTooltipMaterias({ x: closest.x + closest.w / 2, y: my, content: lines, visible: true });
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // CANVAS: RACHA — gráfica acumulativa con datos reales
  // ═══════════════════════════════════════════════════════════════════
  const rachaXPositions = useRef<{ x: number; data: any; acum: number; y: number }[]>([]);

  useEffect(() => {
    if (tab !== 'racha' || rachaData.length === 0) return;
    const canvas = canvasRefRacha.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const pL = 36, pR = 14, pT = 20, pB = 28;
    const gW = W - pL - pR, gH = H - pT - pB;

    // Acumulado
    const acum: number[] = [];
    let sum = 0;
    rachaData.forEach(d => { sum += d.sesiones; acum.push(sum); });
    const maxV = Math.max(acum[29] || 1, 1);

    const getX = (i: number) => pL + (gW / 29) * i;
    const getY = (v: number) => pT + gH - (v / maxV) * gH;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pT + (gH / 4) * i;
      ctx.strokeStyle = 'rgba(100,100,100,0.1)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(W - pR, y); ctx.stroke();
      ctx.fillStyle = '#555'; ctx.font = '9px -apple-system, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxV - (maxV / 4) * i)), pL - 5, y + 3);
    }

    // Labels cada 7 días
    rachaData.forEach((d, i) => {
      if (i % 7 === 0 || i === 29) {
        ctx.fillStyle = i === 29 ? '#f5c842' : '#555';
        ctx.font = `${i === 29 ? 'bold ' : ''}9px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(d.fecha.slice(5), getX(i), H - 5);
      }
    });

    // Solo dibujar si hay datos
    if (acum[29] > 0) {
      // Área
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(acum[0]));
      for (let i = 1; i < 30; i++) {
        const cp = (getX(i - 1) + getX(i)) / 2;
        ctx.bezierCurveTo(cp, getY(acum[i - 1]), cp, getY(acum[i]), getX(i), getY(acum[i]));
      }
      ctx.lineTo(getX(29), pT + gH); ctx.lineTo(getX(0), pT + gH); ctx.closePath();
      const grad = ctx.createLinearGradient(0, pT, 0, pT + gH);
      grad.addColorStop(0, 'rgba(245,200,66,0.3)');
      grad.addColorStop(0.6, 'rgba(245,200,66,0.06)');
      grad.addColorStop(1, 'rgba(245,200,66,0)');
      ctx.fillStyle = grad; ctx.fill();

      // Línea
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(acum[0]));
      for (let i = 1; i < 30; i++) {
        const cp = (getX(i - 1) + getX(i)) / 2;
        ctx.bezierCurveTo(cp, getY(acum[i - 1]), cp, getY(acum[i]), getX(i), getY(acum[i]));
      }
      ctx.strokeStyle = '#f5c842'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.shadowColor = '#f5c842'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;

      // Puntos activos
      rachaData.forEach((d, i) => {
        if (d.estudió) {
          ctx.beginPath(); ctx.arc(getX(i), getY(acum[i]), 3, 0, Math.PI * 2);
          ctx.fillStyle = '#f5c842'; ctx.fill();
        }
      });

      // Punto final
      const lx = getX(29), ly = getY(acum[29]);
      ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#f5c842'; ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(acum[29]), lx, ly - 12);
    } else {
      ctx.fillStyle = '#444'; ctx.font = '13px -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(idioma === 'en' ? 'No sessions in 30 days' : 'Sin sesiones en 30 días', W / 2, H / 2);
    }

    // Guardar posiciones para tooltip
    const positions: { x: number; data: any; acum: number; y: number }[] = [];
    rachaData.forEach((d, i) => {
      positions.push({ x: getX(i), data: d, acum: acum[i], y: getY(acum[i]) });
    });
    rachaXPositions.current = positions;
  }, [tab, rachaData, idioma]);

  const handleRachaMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRefRacha.current;
    if (!canvas || rachaXPositions.current.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    // Encontrar punto más cercano en X
    let closest = rachaXPositions.current[0];
    let minDist = Infinity;
    for (const p of rachaXPositions.current) {
      const dist = Math.abs(mx - p.x);
      if (dist < minDist) { minDist = dist; closest = p; }
    }
    const d = closest.data;
    const lines = [
      `📅 ${d.fecha}`,
      d.estudió ? '🔥 Día activo' : '⬜ Inactivo',
      `📊 ${d.sesiones} ${idioma === 'en' ? 'sessions that day' : 'sesiones ese día'}`,
      `📈 ${closest.acum} ${idioma === 'en' ? 'cumulative total' : 'total acumulado'}`,
    ];
    setTooltipRacha({ x: closest.x, y: closest.y - 10, content: lines, visible: true });
  }, [idioma]);

  // ── Early return ─────────────────────────────────────────────────────
  if (!perfil) return null;

  const tFA = Object.values(perfil.flashcardsAcertadas || {}).reduce((a: number, b: any) => a + b, 0) as number;
  const tFF = Object.values(perfil.flashcardsFalladas || {}).reduce((a: number, b: any) => a + b, 0) as number;
  const tF = tFA + tFF;
  const sQ = (perfil.sesiones || []).filter((s: any) => s.tipo === 'quiz');
  const qA = sQ.reduce((a: number, s: any) => a + (s.acertadas || 0), 0);
  const qF = sQ.reduce((a: number, s: any) => a + (s.falladas || 0), 0);
  const tQP = qA + qF;
  const tAcert = tFA + qA;
  const tFall = tFF + qF;
  const tTot = tAcert + tFall;
  const precGlobal = tTot > 0 ? Math.round((tAcert / tTot) * 100) : 0;
  const diasAct = diasSemana.filter(d => d.total > 0 || rachaData.find(r => r.fecha === d.fecha && r.estudió)).length;
  const totalSesSem = diasSemana.reduce((a, d) => a + d.total, 0);

  // ── Tooltip ──────────────────────────────────────────────────────────
  const Tooltip = ({ data, parentRef }: { data: TooltipData; parentRef: React.RefObject<HTMLCanvasElement | null> }) => {
    if (!data.visible || !parentRef.current) return null;
    const pr = parentRef.current.getBoundingClientRect();
    const tW = 210;
    let left = data.x - tW / 2;
    if (left < 4) left = 4;
    if (left + tW > pr.width - 4) left = pr.width - tW - 4;
    const above = data.y > 60;
    const top = above ? data.y - data.content.length * 18 - 20 : data.y + 20;
    return (
      <div style={{ position: 'absolute', left: `${left}px`, top: `${Math.max(4, top)}px`, background: 'rgba(8,8,18,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '10px 14px', pointerEvents: 'none', zIndex: 10, backdropFilter: 'blur(12px)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', width: `${tW}px` }}>
        {data.content.map((line, i) => (
          <div key={i} style={{ fontSize: '11px', color: i === 0 ? '#fff' : '#aaa', fontWeight: i === 0 ? 700 : 500, lineHeight: '18px' }}>{line}</div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{ width: '4px', height: '28px', background: 'var(--blue)', borderRadius: '2px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>📈 Tu progreso</h2>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-color)', borderRadius: '14px', overflow: 'hidden', marginBottom: '12px' }}>
        {[
          { label: 'Total', value: tTot, color: 'var(--gold)', emoji: '📚' },
          { label: 'Acertadas', value: tAcert, color: '#4ade80', emoji: '✅' },
          { label: 'Falladas', value: tFall, color: 'var(--red)', emoji: '❌' },
          { label: 'Precisión', value: `${precGlobal}%`, color: 'var(--blue)', emoji: '🎯' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--bg-card)', padding: '14px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', marginBottom: '2px' }}>{s.emoji}</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '2px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {(tF > 0 || tQP > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🎴</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: 'var(--gold)' }}>{tF}</div>
              <div style={{ fontSize: '9px', color: 'var(--text-faint)' }}>✅{tFA} ❌{tFF}{tF > 0 && <span style={{ color: '#4ade80', marginLeft: 3 }}>{Math.round((tFA / tF) * 100)}%</span>}</div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🤓</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 900, color: '#a78bfa' }}>{tQP > 0 ? tQP : sQ.length}</div>
              <div style={{ fontSize: '9px', color: 'var(--text-faint)' }}>{tQP > 0 ? <>✅{qA} ❌{qF}<span style={{ color: '#4ade80', marginLeft: 3 }}>{Math.round((qA / tQP) * 100)}%</span></> : <>{sQ.length} sesiones</>}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {[{ id: 'semana', label: '📅 Esta semana' }, { id: 'materias', label: '📚 Por materia' }, { id: 'racha', label: '🔥 Racha 30d' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ padding: '7px 12px', borderRadius: '10px', border: `2px solid ${tab === t.id ? 'var(--blue)' : 'var(--border-color)'}`, background: tab === t.id ? 'var(--blue-dim)' : 'transparent', color: tab === t.id ? 'var(--blue)' : 'var(--text-muted)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ SEMANA ═══ */}
      {tab === 'semana' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--blue)' }} />
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Sesiones de la semana</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '20px', height: '3px', borderRadius: '2px', background: '#38bdf8' }} />
                <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>Sesiones</span>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <canvas ref={canvasRefSemana} onMouseMove={handleSemanaMove} onMouseLeave={() => setTooltipSemana(p => ({ ...p, visible: false }))} style={{ width: '100%', height: '220px', display: 'block', cursor: 'crosshair' }} />
              <Tooltip data={tooltipSemana} parentRef={canvasRefSemana} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '14px' }}>
              {[
                { label: 'Días activos', value: diasAct, color: 'var(--blue)' },
                { label: 'Sesiones', value: totalSesSem, color: 'var(--text-primary)' },
                { label: 'Precisión semanal', value: `${precSem}%`, color: precSem >= 70 ? '#4ade80' : precSem >= 50 ? 'var(--gold)' : precSem === 0 ? 'var(--text-faint)' : 'var(--red)' },
              ].map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 900, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '9px', color: 'var(--text-faint)', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ MATERIAS ═══ */}
      {tab === 'materias' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--gold)' }} />
          <div style={{ padding: '20px' }}>
            {materiasArr.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📚</div>
                <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>Estudia flashcards o quizzes para ver stats</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Actividad por materia</span>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--gold)' }} />
                      <span style={{ fontSize: '9px', color: 'var(--text-faint)' }}>Flashcards</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#a78bfa' }} />
                      <span style={{ fontSize: '9px', color: 'var(--text-faint)' }}>Quizzes</span>
                    </div>
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <canvas ref={canvasRefMaterias} onMouseMove={handleMateriasMove} onMouseLeave={() => setTooltipMaterias(p => ({ ...p, visible: false }))} style={{ width: '100%', height: '280px', display: 'block', cursor: 'crosshair' }} />
                  <Tooltip data={tooltipMaterias} parentRef={canvasRefMaterias} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ RACHA ═══ */}
      {tab === 'racha' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--red)' }} />
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Crecimiento acumulado (30 días)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '20px', height: '3px', borderRadius: '2px', background: '#f5c842' }} />
                <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>Acumulado</span>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <canvas ref={canvasRefRacha} onMouseMove={handleRachaMove} onMouseLeave={() => setTooltipRacha(p => ({ ...p, visible: false }))} style={{ width: '100%', height: '180px', display: 'block', cursor: 'crosshair' }} />
              <Tooltip data={tooltipRacha} parentRef={canvasRefRacha} />
            </div>

            <div style={{ marginTop: '16px', marginBottom: '14px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '0 0 8px', fontWeight: 600 }}>Mapa de actividad</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: '3px' }}>
                {rachaData.map((d, i) => (
                  <div key={i} title={`${d.fecha}${d.estudió ? ' 🔥' : ''}`}
                    style={{ aspectRatio: '1', borderRadius: '4px', background: d.estudió ? 'var(--gold)' : 'var(--bg-secondary)', border: i === 29 ? '2px solid var(--gold)' : '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px' }}>
                    {d.estudió && '🔥'}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[
                { label: 'Activos', value: rachaData.filter(d => d.estudió).length, color: 'var(--gold)' },
                { label: 'Inactivos', value: rachaData.filter(d => !d.estudió).length, color: 'var(--text-faint)' },
                { label: 'Actividad', value: `${Math.round((rachaData.filter(d => d.estudió).length / 30) * 100)}%`, color: 'var(--blue)' },
              ].map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 900, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-faint)', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
