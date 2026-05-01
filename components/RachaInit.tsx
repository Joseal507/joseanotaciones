'use client';

import { useEffect } from 'react';
import { cargarRachaDesdeDB, verificarRacha } from '@/lib/racha';

export default function RachaInit() {
  useEffect(() => {
    // ✅ Primero cargar desde DB, luego verificar
    cargarRachaDesdeDB()
      .then(() => verificarRacha())
      .catch(() => verificarRacha());
  }, []);

  return null;
}
