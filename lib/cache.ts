import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export function getContentHash(content: string): string {
  return crypto.createHash('md5').update(content.trim().toLowerCase()).digest('hex');
}

export async function getCachedContent(content: string) {
  const hash = getContentHash(content);
  const { data, error } = await supabase
    .from('content_cache')
    .select('*')
    .eq('content_hash', hash)
    .single();

  if (data) {
    // Incrementar contador de hits (uso)
    await supabase.from('content_cache').update({ hits: data.hits + 1 }).eq('id', data.id);
    return data;
  }
  return null;
}

export async function saveToCache(content: string, data: { flashcards?: any, analysis?: any }) {
  const hash = getContentHash(content);
  const wordCount = content.split(/\s+/).length;

  await supabase.from('content_cache').upsert({
    content_hash: hash,
    flashcards: data.flashcards || null,
    analysis: data.analysis || null,
    word_count: wordCount
  }, { onConflict: 'content_hash' });
}
