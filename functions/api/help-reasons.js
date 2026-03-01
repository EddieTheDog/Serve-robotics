export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, label, emoji FROM help_reasons ORDER BY sort_order ASC
  `).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { label, emoji } = await request.json();
  if (!label) return new Response('Missing label', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const { results } = await env.DB.prepare(`SELECT MAX(sort_order) as m FROM help_reasons`).all();
  const nextOrder = (results[0]?.m ?? -1) + 1;
  await env.DB.prepare(`
    INSERT INTO help_reasons (id, label, emoji, sort_order, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(id, label, emoji ?? '🙋', nextOrder, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM help_reasons WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
