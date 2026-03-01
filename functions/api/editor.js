// GET: accepted guests waiting for editor setup
// PATCH: save seat and any extra info for a guest
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, first_name, last_name, status, app_token, seat, badge, qr_data
    FROM guests
    WHERE status = 'accepted'
    ORDER BY updated_at ASC
  `).all();
  return Response.json(results);
}

export async function onRequestPatch({ request, env }) {
  const body = await request.json();
  const { guestId, seat, badge } = body;
  if (!guestId) return new Response('Missing guestId', { status: 400 });

  const now = Date.now();
  const updates = ['updated_at = ?'];
  const binds = [now];

  if (seat !== undefined) { updates.push('seat = ?'); binds.push(seat); }
  if (badge !== undefined) { updates.push('badge = ?'); binds.push(badge); }

  binds.push(guestId);
  await env.DB.prepare(`UPDATE guests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

  return Response.json({ success: true });
}
