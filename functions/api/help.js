export async function onRequestPost({ request, env }) {
  const { token, guestId, reason, type } = await request.json();

  let resolvedGuestId = guestId;
  if (!resolvedGuestId && token) {
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return new Response('Invalid token', { status: 403 });
    resolvedGuestId = guest.id;
  }
  if (!resolvedGuestId) return new Response('Missing guest', { status: 400 });

  const id = crypto.randomUUID();
  const now = Date.now();
  const reqType = type || 'help';

  await env.DB.prepare(`
    INSERT INTO help_requests (id, guest_id, message, resolved, created_at, type) VALUES (?, ?, ?, 0, ?, ?)
  `).bind(id, resolvedGuestId, reason ?? null, now, reqType).run();

  // NOTE: We intentionally do NOT change guest.status here.
  // Help requests are tracked via help_requests table; guest status is for check-in queue only.

  return Response.json({ success: true, helpId: id });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const unresolvedOnly = url.searchParams.get('unresolved') === '1';
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type') || 'help';

  if (token) {
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return Response.json({ resolved: false });
    const latest = await env.DB.prepare(`
      SELECT resolved FROM help_requests WHERE guest_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1
    `).bind(guest.id, type).first();
    return Response.json({ resolved: latest?.resolved === 1 ?? false });
  }

  const typeFilter = `AND hr.type = '${type === 'accommodation' ? 'accommodation' : 'help'}'`;

  const query = unresolvedOnly
    ? `SELECT hr.id, hr.guest_id, hr.resolved, hr.created_at, hr.message, hr.type, g.first_name, g.last_name, g.seat, g.badge
       FROM help_requests hr JOIN guests g ON hr.guest_id = g.id
       WHERE hr.resolved = 0 ${typeFilter} ORDER BY hr.created_at DESC`
    : `SELECT hr.id, hr.guest_id, hr.resolved, hr.created_at, hr.message, hr.type, g.first_name, g.last_name, g.seat, g.badge
       FROM help_requests hr JOIN guests g ON hr.guest_id = g.id
       WHERE 1=1 ${typeFilter} ORDER BY hr.resolved ASC, hr.created_at DESC`;

  const { results } = await env.DB.prepare(query).all();
  return Response.json(results);
}

export async function onRequestPatch({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`UPDATE help_requests SET resolved = 1 WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
