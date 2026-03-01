// GET              → list all field definitions
// GET ?guestId=xxx  → list fields + this guest's values
// POST action=create → create a new field definition
// POST action=set-value → save a guest's value for a field
// PATCH             → reorder fields (array of {id, sort_order})
// DELETE            → delete a field definition

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const guestId = url.searchParams.get('guestId');

  const { results: fields } = await env.DB.prepare(`
    SELECT id, label, field_type, sort_order FROM custom_fields ORDER BY sort_order ASC
  `).all();

  if (!guestId) return Response.json(fields);

  // Also fetch this guest's values
  const { results: values } = await env.DB.prepare(`
    SELECT field_id, value FROM guest_field_values WHERE guest_id = ?
  `).bind(guestId).all();

  const valMap = {};
  values.forEach(v => valMap[v.field_id] = v.value);

  const merged = fields.map(f => ({ ...f, value: valMap[f.id] ?? '' }));
  return Response.json(merged);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.action === 'create') {
    const { label, field_type } = body;
    if (!label) return new Response('Missing label', { status: 400 });
    const id = crypto.randomUUID();
    const now = Date.now();
    const { results: existing } = await env.DB.prepare(`SELECT MAX(sort_order) as m FROM custom_fields`).all();
    const nextOrder = (existing[0]?.m ?? -1) + 1;
    await env.DB.prepare(`
      INSERT INTO custom_fields (id, label, field_type, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, label, field_type ?? 'text', nextOrder, now).run();
    return Response.json({ success: true, id });
  }

  if (body.action === 'set-value') {
    const { guestId, fieldId, value } = body;
    if (!guestId || !fieldId) return new Response('Missing guestId or fieldId', { status: 400 });
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO guest_field_values (id, guest_id, field_id, value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guest_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(id, guestId, fieldId, value ?? '', now).run();
    return Response.json({ success: true });
  }

  return new Response('Unknown action', { status: 400 });
}

export async function onRequestPatch({ request, env }) {
  // Reorder: body = { items: [{id, sort_order}, ...] }
  // OR rename: body = { id, label }
  const body = await request.json();

  if (body.items) {
    // Bulk reorder
    const stmts = body.items.map(({ id, sort_order }) =>
      env.DB.prepare(`UPDATE custom_fields SET sort_order = ? WHERE id = ?`).bind(sort_order, id)
    );
    await env.DB.batch(stmts);
    return Response.json({ success: true });
  }

  if (body.id && body.label !== undefined) {
    await env.DB.prepare(`UPDATE custom_fields SET label = ? WHERE id = ?`).bind(body.label, body.id).run();
    return Response.json({ success: true });
  }

  return new Response('Nothing to update', { status: 400 });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  if (!id) return new Response('Missing id', { status: 400 });
  await env.DB.prepare(`DELETE FROM custom_fields WHERE id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM guest_field_values WHERE field_id = ?`).bind(id).run();
  return Response.json({ success: true });
}
