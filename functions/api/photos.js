// GET ?guestId=xxx     → fetch photos for a guest
// GET ?guestToken=xxx  → fetch photos for guest by app token
// POST                 → save photo { imageData, guestIds, overlayId? }
// DELETE               → { id }

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const guestId = url.searchParams.get('guestId');
  const guestToken = url.searchParams.get('guestToken');
  const admin = url.searchParams.get('admin');

  // Admin: return all photos
  if (admin === '1') {
    const { results } = await env.DB.prepare(`
      SELECT id, image_data, guest_ids, overlay_id, taken_at
      FROM photos ORDER BY taken_at DESC LIMIT 100
    `).all();
    return Response.json(results);
  }

  let id = guestId;
  if (!id && guestToken) {
    const g = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(guestToken).first();
    if (!g) return Response.json([]);
    id = g.id;
  }
  if (!id) return Response.json([]);

  const { results } = await env.DB.prepare(`
    SELECT id, image_data, guest_ids, overlay_id, taken_at
    FROM photos WHERE guest_ids LIKE ?
    ORDER BY taken_at DESC
  `).bind(`%${id}%`).all();

  const filtered = results.filter(p => {
    try { return JSON.parse(p.guest_ids || '[]').includes(id); } catch(e) { return false; }
  });

  return Response.json(filtered);
}

export async function onRequestPost({ request, env }) {
  const { imageData, guestIds, overlayId } = await request.json();
  if (!imageData || !guestIds?.length) return new Response('Missing fields', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO photos (id, image_data, guest_ids, overlay_id, taken_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, imageData, JSON.stringify(guestIds), overlayId || null, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
