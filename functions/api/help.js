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
  const reqType = type || 'help'; // 'help' or 'accommodation'

  await env.DB.prepare(`
    INSERT INTO help_requests (id, guest_id, message, resolved, created_at, type) VALUES (?, ?, ?, 0, ?, ?)
  `).bind(id, resolvedGuestId, reason ?? null, now, reqType).run();

  // Only flip guest status to 'help' for emergency help, not accommodations
  if (reqType === 'help') {
    await env.DB.prepare(`UPDATE guests SET status = 'help', updated_at = ? WHERE id = ?`)
      .bind(now, resolvedGuestId).run();
  }

  return Response.json({ success: true, helpId: id });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const unresolvedOnly = url.searchParams.get('unresolved') === '1';
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type') || 'help'; // default to 'help' type

  // Attendee polling: check if their latest request (of given type) was resolved
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

  // Reset guest status only for 'help' type requests
  const req = await env.DB.prepare(`SELECT guest_id, type FROM help_requests WHERE id = ?`).bind(id).first();
  if (req?.guest_id && req.type !== 'accommodation') {
    await env.DB.prepare(`UPDATE guests SET status = 'accepted', updated_at = ? WHERE id = ? AND status = 'help'`)
      .bind(Date.now(), req.guest_id).run();
  }

  return Response.json({ success: true });
}
