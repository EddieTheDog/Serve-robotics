export async function onRequestGet({ env }) {
  const now = Date.now();
  const { results } = await env.DB.prepare(`
    SELECT id, label, emoji, action, sort_order, visible, starts_at, expires_at
    FROM custom_buttons
    WHERE visible = 1
      AND (starts_at IS NULL OR starts_at = 0 OR starts_at <= ?)
      AND (expires_at IS NULL OR expires_at = 0 OR expires_at > ?)
    ORDER BY sort_order ASC
  `).bind(now, now).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { label, emoji, action, sort_order, starts_at, expires_at } = await request.json();
  if (!label) return new Response('Missing label', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const { results: existing } = await env.DB.prepare(`SELECT MAX(sort_order) as m FROM custom_buttons`).all();
  const nextOrder = sort_order ?? ((existing[0]?.m ?? -1) + 1);
  await env.DB.prepare(`
    INSERT INTO custom_buttons (id, label, emoji, action, sort_order, visible, starts_at, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).bind(id, label, emoji ?? '🔘', action ?? 'none', nextOrder, starts_at ?? null, expires_at ?? null, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestPatch({ request, env }) {
  const body = await request.json();

  if (body.reorder) {
    const stmts = body.reorder.map(({ id, sort_order }) =>
      env.DB.prepare(`UPDATE custom_buttons SET sort_order = ? WHERE id = ?`).bind(sort_order, id)
    );
    await env.DB.batch(stmts);
    return Response.json({ success: true });
  }

  const { id, label, emoji, visible, starts_at, expires_at } = body;
  if (!id) return new Response('Missing id', { status: 400 });
  const updates = [];
  const binds = [];
  if (label !== undefined)     { updates.push('label = ?');      binds.push(label); }
  if (emoji !== undefined)     { updates.push('emoji = ?');       binds.push(emoji); }
  if (visible !== undefined)   { updates.push('visible = ?');     binds.push(visible); }
  if (starts_at !== undefined) { updates.push('starts_at = ?');  binds.push(starts_at); }
  if (expires_at !== undefined){ updates.push('expires_at = ?'); binds.push(expires_at); }
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
