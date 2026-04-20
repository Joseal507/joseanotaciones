import { createHash } from 'crypto';
import { supabase } from './supabase';

export const getHash = (text: string) => {
  return createHash('md5').update(text.trim().substring(0, 5000)).digest('hex');
};

export const checkCache = async (hash: string) => {
  const { data } = await supabase
    .from('analisis_cache')
    .select('*')
    .eq('content_hash', hash)
    .single();
  return data;
};

export const saveCache = async (hash: string, analysis: any, flashcards: any) => {
  await supabase.from('analisis_cache').upsert({
    content_hash: hash,
    analysis,
    flashcards
  });
};