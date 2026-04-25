import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const auth = req.headers.get('authorization')?.replace('Bearer ', '');

  if (!id || !auth) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });

  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

  const { error } = await supabase
    .from('comunidad_posts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id); // Solo el dueño borra

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
