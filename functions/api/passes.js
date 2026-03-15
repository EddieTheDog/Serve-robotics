// GET           → list all pass presets (with description, auto_assign)
// POST          → create { name, emoji, color, description, auto_assign }
// PUT           → update preset { id, name, emoji, color, description, auto_assign }
// DELETE        → { id }
// PATCH         → bulk assign { presetName, targets }

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, emoji, color, description, auto_assign, sort_order, created_at
     FROM pass_presets ORDER BY COALESCE(sort_order, 9999), created_at ASC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { name, emoji, color, description, auto_assign } = await request.json();
  if (!name) return new Response('Missing name', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const { results: existing } = await env.DB.prepare('SELECT MAX(sort_order) as m FROM pass_presets').all();
  const nextOrder = (existing[0]?.m ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO pass_presets (id, name, emoji, color, description, auto_assign, sort_order, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(id, name.trim(), emoji||'🎟️', color||'#000000',
         description||'', auto_assign||'', nextOrder, now).run();

  // If auto_assign set, immediately assign to matching guests
  if (auto_assign) {
    await bulkAssign(name.trim(), auto_assign, env, now);
  }
  return Response.json({ id, name, emoji, color, description, auto_assign });
}

export async function onRequestPut({ request, env }) {
  const body = await request.json();

  // Reorder batch: [{id, sort_order}, ...]
  if (body.reorder) {
    const stmts = body.reorder.map(({ id, sort_order }) =>
      env.DB.prepare(`UPDATE pass_presets SET sort_order=? WHERE id=?`).bind(sort_order, id)
    );
    await env.DB.batch(stmts);
    return Response.json({ success: true });
  }

  const { id, name, emoji, color, description, auto_assign } = body;
  if (!id) return new Response('Missing id', { status: 400 });

  // Get the current name before updating so we can rename it on guests
  const existing = await env.DB.prepare(`SELECT name FROM pass_presets WHERE id = ?`).bind(id).first();
  const oldName = existing?.name;

  await env.DB.prepare(
    `UPDATE pass_presets SET name=?, emoji=?, color=?, description=?, auto_assign=? WHERE id=?`
  ).bind(name, emoji||'🎟️', color||'#000000', description||'', auto_assign||'', id).run();

  // If the name changed, update every guest who has the old name in their passes array
  if (oldName && oldName !== name) {
    const { results: guests } = await env.DB.prepare(
      `SELECT id, passes FROM guests WHERE passes IS NOT NULL AND passes != '[]' AND passes LIKE ?`
    ).bind(`%${oldName}%`).all();

    const now = Date.now();
    const stmts = [];
    for (const g of guests) {
      let passes = [];
      try { passes = JSON.parse(g.passes || '[]'); } catch(e) { continue; }
      const idx = passes.indexOf(oldName);
      if (idx === -1) continue;
      passes[idx] = name;
      stmts.push(
        env.DB.prepare(`UPDATE guests SET passes=?, updated_at=? WHERE id=?`)
          .bind(JSON.stringify(passes), now, g.id)
      );
    }
    if (stmts.length > 0) await env.DB.batch(stmts);
  }

  return Response.json({ success: true });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM pass_presets WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}

export async function onRequestPatch({ request, env }) {
  const { presetName, targets, guestId } = await request.json();

  // Single guest assign
  if (guestId) {
    const guest = await env.DB.prepare(
      `SELECT id, passes FROM guests WHERE id = ?`
    ).bind(guestId).first();
    if (!guest) return new Response('Guest not found', { status: 404 });
    let passes = [];
    try { passes = guest.passes ? JSON.parse(guest.passes) : []; } catch(e) {}
    if (!passes.includes(presetName)) {
      passes.push(presetName);
      await env.DB.prepare(`UPDATE guests SET passes=?, updated_at=? WHERE id=?`)
        .bind(JSON.stringify(passes), Date.now(), guestId).run();
    }
    return Response.json({ success: true, updated: 1 });
  }

  // Bulk assign
  if (!presetName || !targets) return new Response('Missing fields', { status: 400 });
  const updated = await bulkAssign(presetName, targets, env, Date.now());
  return Response.json({ success: true, updated });
}

async function bulkAssign(presetName, targets, env, now) {
  const { results: guests } = await env.DB.prepare(
    `SELECT id, badge, is_actor, passes FROM guests WHERE status = 'accepted'`
  ).all();
  let updated = 0;
  for (const g of guests) {
    let match = false;
    if (targets === 'ALL') match = true;
    else if (targets === 'actor') match = !!g.is_actor;
    else if (targets.startsWith('badge:')) match = g.badge === targets.slice(6);
    if (!match) continue;
    let passes = [];
    try { passes = g.passes ? JSON.parse(g.passes) : []; } catch(e) {}
    if (!passes.includes(presetName)) {
      passes.push(presetName);
      await env.DB.prepare(`UPDATE guests SET passes=?, updated_at=? WHERE id=?`)
        .bind(JSON.stringify(passes), now, g.id).run();
      updated++;
    }
  }
  return updated;
}
