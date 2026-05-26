'use client';

import { useRango } from '../hooks/useRango';
import RangoSubidaModal from './RangoSubidaModal';

export default function RangoWatcher() {
  const { mostrarAnimacion, rangoAnterior, rangoNuevo, cerrarAnimacion } = useRango();

  if (!mostrarAnimacion || !rangoAnterior || !rangoNuevo) return null;

  return (
    <RangoSubidaModal
      rangoAnterior={rangoAnterior}
      rangoNuevo={rangoNuevo}
      onClose={cerrarAnimacion}
    />
  );
}