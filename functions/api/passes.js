// GET  → list all pass presets
// POST → create preset { name, emoji, color }
// DELETE → { id } delete preset
// PATCH → { presetName, targets } bulk-assign pass to guests
//   targets: 'ALL' | 'badge:Eddie +' | 'badge:VIP' | 'actor' | 'guest:ID'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, emoji, color, created_at FROM pass_presets ORDER BY created_at ASC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { name, emoji, color } = await request.json();
  if (!name) return new Response('Missing name', { status: 400 });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO pass_presets (id, name, emoji, color, created_at) VALUES (?,?,?,?,?)`
  ).bind(id, name, emoji || '🎟️', color || '#000000', Date.now()).run();
  return Response.json({ id, name, emoji, color });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM pass_presets WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}

export async function onRequestPatch({ request, env }) {
  const { presetName, targets } = await request.json();
  if (!presetName || !targets) return new Response('Missing fields', { status: 400 });

  // Fetch all accepted guests
  const { results: guests } = await env.DB.prepare(
    `SELECT id, badge, is_actor, passes FROM guests WHERE status = 'accepted'`
  ).all();

  const now = Date.now();
  let updated = 0;

  for (const g of guests) {
    let match = false;
    if (targets === 'ALL') match = true;
    else if (targets === 'actor') match = !!g.is_actor;
    else if (targets.startsWith('badge:')) match = g.badge === targets.slice(6);

    if (!match) continue;

    // Add presetName to passes JSON array if not already there
    let passes = [];
    try { passes = g.passes ? JSON.parse(g.passes) : []; } catch(e) {}
    if (!passes.includes(presetName)) {
      passes.push(presetName);
      await env.DB.prepare(`UPDATE guests SET passes = ?, updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(passes), now, g.id).run();
      updated++;
    }
  }

  return Response.json({ success: true, updated });
}
