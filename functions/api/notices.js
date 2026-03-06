// GET ?token=xxx  → fetch unread notices for attendee
// GET (no token)  → admin fetch all recent notices
// POST            → send notice (admin)
//   target: 'ALL' | 'badge:Eddie +' | 'badge:VIP' | 'badge:Staff' | 'badge:Press'
//           | 'pass:Drink Pass' | 'actor' | 'guest:<id>'
// PATCH           → dismiss a notice (attendee)

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (token) {
    const guest = await env.DB.prepare(
      `SELECT id, badge, is_actor, passes FROM guests WHERE app_token = ?`
    ).bind(token).first();
    if (!guest) return Response.json([]);

    // Attendee sees: notices for them directly, ALL notices,
    // badge-group notices matching their badge,
    // pass-group notices matching their passes,
    // and actor notices if they're an actor
    let passes = [];
    try { passes = guest.passes ? JSON.parse(guest.passes) : []; } catch(e) {}

    const { results: all } = await env.DB.prepare(`
      SELECT id, message, duration, created_at, guest_id FROM notices
      WHERE dismissed = 0
      ORDER BY created_at DESC
    `).all();

    const mine = all.filter(n => {
      if (n.guest_id === 'ALL') return true;
      if (n.guest_id === `guest:${guest.id}`) return true;
      if (n.guest_id === 'actor' && guest.is_actor) return true;
      if (n.guest_id.startsWith('badge:') && n.guest_id === `badge:${guest.badge}`) return true;
      if (n.guest_id.startsWith('pass:')) {
        const pname = n.guest_id.slice(5);
        return passes.some(p => p === pname);
      }
      return false;
    });

    return Response.json(mine.map(({ guest_id, ...rest }) => rest));
  }

  // Admin: get all recent
  const { results } = await env.DB.prepare(`
    SELECT id, message, duration, dismissed, created_at, guest_id FROM notices
    ORDER BY created_at DESC LIMIT 50
  `).all();

  return Response.json(results.map(n => ({
    ...n,
    recipient: labelForTarget(n.guest_id)
  })));
}

function labelForTarget(t) {
  if (!t || t === 'ALL') return 'Everyone';
  if (t === 'actor') return 'Actors';
  if (t.startsWith('badge:')) return t.slice(6) + ' badge holders';
  if (t.startsWith('pass:')) return t.slice(5) + ' pass holders';
  if (t.startsWith('guest:')) return 'Individual guest';
  return t;
}

export async function onRequestPost({ request, env }) {
  const { message, target, duration } = await request.json();
  if (!message) return new Response('Missing message', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const dest = target || 'ALL';
  await env.DB.prepare(`
    INSERT INTO notices (id, guest_id, message, duration, dismissed, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).bind(id, dest, message, duration ?? null, now).run();
  return Response.json({ success: true, id });
}

export async function onRequestPatch({ request, env }) {
  const { id, token } = await request.json();
  if (token) {
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return new Response('Unauthorized', { status: 403 });
  }
  await env.DB.prepare(`UPDATE notices SET dismissed = 1 WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
