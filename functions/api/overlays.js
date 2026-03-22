// GET    → list all overlays
// POST   → create { name, imageData }
// DELETE → { id }

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const row = await env.DB.prepare(`SELECT id, name, image_data FROM photo_overlays WHERE id = ?`).bind(id).first();
    if (!row) return new Response('Not found', { status: 404 });
    return Response.json(row);
  }
  const { results } = await env.DB.prepare(`
    SELECT id, name, created_at FROM photo_overlays ORDER BY created_at DESC
  `).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { name, imageData } = await request.json();
  if (!name || !imageData) return new Response('Missing fields', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO photo_overlays (id, name, image_data, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(id, name, imageData, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM photo_overlays WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
