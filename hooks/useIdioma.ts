import { useState, useEffect } from 'react';
import { getIdioma, saveIdioma, Idioma, t, TraduccionKey } from '../lib/i18n';

export function useIdioma() {
  const [idioma, setIdiomaState] = useState<Idioma>('es');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIdiomaState(getIdioma());
  }, []);

  const setIdioma = (nuevoIdioma: Idioma) => {
    setIdiomaState(nuevoIdioma);
    saveIdioma(nuevoIdioma);
  };

  const tr = (key: TraduccionKey) => t(key, idioma);

  return { idioma, setIdioma, tr, mounted };
}