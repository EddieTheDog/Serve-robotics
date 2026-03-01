// GET ?token=xxx  → fetch unread notices for this attendee
// GET ?all=1       → admin fetch all recent notices
// POST             → send notice (admin)
// PATCH            → dismiss a notice (attendee)

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (token) {
    // Attendee: get their unread notices
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return Response.json([]);

    const { results } = await env.DB.prepare(`
      SELECT id, message, duration, created_at FROM notices
      WHERE (guest_id = ? OR guest_id = 'ALL') AND dismissed = 0
      ORDER BY created_at DESC
    `).bind(guest.id).all();
    return Response.json(results);
  }

  // Admin: get all recent notices
  const { results } = await env.DB.prepare(`
    SELECT n.id, n.message, n.duration, n.dismissed, n.created_at,
           CASE WHEN n.guest_id = 'ALL' THEN 'Everyone' ELSE g.first_name || ' ' || g.last_name END as recipient
    FROM notices n
    LEFT JOIN guests g ON n.guest_id = g.id
    ORDER BY n.created_at DESC LIMIT 50
  `).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const { message, guestId, duration } = await request.json();
  if (!message) return new Response('Missing message', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  // guestId = specific guest ID, or 'ALL' for everyone
  const target = guestId || 'ALL';
  await env.DB.prepare(`
    INSERT INTO notices (id, guest_id, message, duration, dismissed, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).bind(id, target, message, duration ?? null, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestPatch({ request, env }) {
  const { id, token } = await request.json();
  // Verify ownership before dismissing
  if (token) {
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return new Response('Unauthorized', { status: 403 });
  }
  await env.DB.prepare(`UPDATE notices SET dismissed = 1 WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
