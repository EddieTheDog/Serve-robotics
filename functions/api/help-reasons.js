// GET ?type=help or ?type=accommodation — returns reasons for that type
// POST — create a reason with a type
// DELETE — remove a reason

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'help';
  const { results } = await env.DB.prepare(`
    SELECT id, label, emoji, type FROM help_reasons WHERE type = ? ORDER BY sort_order ASC
  `).bind(type).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { label, emoji, type } = await request.json();
  if (!label) return new Response('Missing label', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const reasonType = type || 'help';
  const { results } = await env.DB.prepare(`SELECT MAX(sort_order) as m FROM help_reasons WHERE type = ?`).bind(reasonType).all();
  const nextOrder = (results[0]?.m ?? -1) + 1;
  await env.DB.prepare(`
    INSERT INTO help_reasons (id, label, emoji, sort_order, created_at, type) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, label, emoji ?? '🙋', nextOrder, now, reasonType).run();
  return Response.json({ success: true, id });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM help_reasons WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
