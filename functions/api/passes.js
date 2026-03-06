// GET           → list all pass presets (with description, auto_assign)
// POST          → create { name, emoji, color, description, auto_assign }
// PUT           → update preset { id, name, emoji, color, description, auto_assign }
// DELETE        → { id }
// PATCH         → bulk assign { presetName, targets }

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, emoji, color, description, auto_assign, created_at
     FROM pass_presets ORDER BY created_at ASC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { name, emoji, color, description, auto_assign } = await request.json();
  if (!name) return new Response('Missing name', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO pass_presets (id, name, emoji, color, description, auto_assign, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(id, name.trim(), emoji||'🎟️', color||'#000000',
         description||'', auto_assign||'', now).run();

  // If auto_assign set, immediately assign to matching guests
  if (auto_assign) {
    await bulkAssign(name.trim(), auto_assign, env, now);
  }
  return Response.json({ id, name, emoji, color, description, auto_assign });
}

export async function onRequestPut({ request, env }) {
  const { id, name, emoji, color, description, auto_assign } = await request.json();
  if (!id) return new Response('Missing id', { status: 400 });
  await env.DB.prepare(
    `UPDATE pass_presets SET name=?, emoji=?, color=?, description=?, auto_assign=? WHERE id=?`
  ).bind(name, emoji||'🎟️', color||'#000000', description||'', auto_assign||'', id).run();
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
