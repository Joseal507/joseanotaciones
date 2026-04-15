if (tipo === 'materias') {
  // Limpiar base64 antes de guardar
  const materiasLimpias = (datos || []).map((m: any) => ({
    ...m,
    temas: m.temas?.map((t: any) => ({
      ...t,
      documentos: t.documentos?.map((d: any) => ({
        ...d,
        archivoBase64: undefined,
        archivoUrl: undefined,
      })) || [],
    })) || [],
  }));

  const { data: existing } = await supabaseAdmin
    .from('materias').select('id').eq('user_id', uid).single();
  if (existing) {
    await supabaseAdmin.from('materias')
      .update({ datos: materiasLimpias, updated_at: new Date().toISOString() })
      .eq('user_id', uid);
  } else {
    await supabaseAdmin.from('materias')
      .insert({ user_id: uid, datos: materiasLimpias });
  }
}