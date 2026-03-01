export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, label, emoji, action, sort_order, visible
    FROM custom_buttons WHERE visible = 1 ORDER BY sort_order ASC
  `).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { label, emoji, action, sort_order } = await request.json();
  if (!label) return new Response('Missing label', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const { results: existing } = await env.DB.prepare(`SELECT MAX(sort_order) as m FROM custom_buttons`).all();
  const nextOrder = sort_order ?? ((existing[0]?.m ?? -1) + 1);
  await env.DB.prepare(`
    INSERT INTO custom_buttons (id, label, emoji, action, sort_order, visible, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).bind(id, label, emoji ?? '🔘', action ?? 'none', nextOrder, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestPatch({ request, env }) {
  const { id, label, emoji, visible } = await request.json();
  if (!id) return new Response('Missing id', { status: 400 });
  const updates = [];
  const binds = [];
  if (label !== undefined) { updates.push('label = ?'); binds.push(label); }
  if (emoji !== undefined) { updates.push('emoji = ?'); binds.push(emoji); }
  if (visible !== undefined) { updates.push('visible = ?'); binds.push(visible); }
  if (!updates.length) return new Response('Nothing to update', { status: 400 });
  binds.push(id);
  await env.DB.prepare(`UPDATE custom_buttons SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  return Response.json({ success: true });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM custom_buttons WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
