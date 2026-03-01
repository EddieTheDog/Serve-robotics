export async function onRequestPost({ request, env }) {
  const { token, guestId } = await request.json();

  // Verify guest by token or direct guestId
  let resolvedGuestId = guestId;
  if (!resolvedGuestId && token) {
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return new Response('Invalid token', { status: 403 });
    resolvedGuestId = guest.id;
  }

  if (!resolvedGuestId) return new Response('Missing guest', { status: 400 });

  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO help_requests (id, guest_id, resolved, created_at) VALUES (?, ?, 0, ?)
  `).bind(id, resolvedGuestId, now).run();

  // Also update guest status to 'help' so it shows in queue
  await env.DB.prepare(`UPDATE guests SET status = 'help', updated_at = ? WHERE id = ?`)
    .bind(now, resolvedGuestId).run();

  return Response.json({ success: true });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const unresolvedOnly = url.searchParams.get('unresolved') === '1';

  const query = unresolvedOnly
    ? `SELECT hr.id, hr.guest_id, hr.resolved, hr.created_at, g.first_name, g.last_name
       FROM help_requests hr JOIN guests g ON hr.guest_id = g.id
       WHERE hr.resolved = 0 ORDER BY hr.created_at DESC`
    : `SELECT hr.id, hr.guest_id, hr.resolved, hr.created_at, g.first_name, g.last_name
       FROM help_requests hr JOIN guests g ON hr.guest_id = g.id
       ORDER BY hr.resolved ASC, hr.created_at DESC`;

  const { results } = await env.DB.prepare(query).all();
  return Response.json(results);
}

export async function onRequestPatch({ request, env }) {
  const { id } = await request.json();
  const now = Date.now();
  await env.DB.prepare(`UPDATE help_requests SET resolved = 1 WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
