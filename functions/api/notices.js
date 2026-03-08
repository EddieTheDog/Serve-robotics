// GET ?token=xxx  → fetch unread notices for this guest
// GET (no token)  → admin: all recent notices
// POST            → send notice { message, target, duration, action? }
// PATCH           → guest dismisses notice { id, token }

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (token) {
    const guest = await env.DB.prepare(
      `SELECT id, badge, is_actor, passes, created_at FROM guests WHERE app_token = ?`
    ).bind(token).first();
    if (!guest) return Response.json([]);

    let passes = [];
    try { passes = guest.passes ? JSON.parse(guest.passes) : []; } catch(e) {}

    // Only show notices created after this guest account was created
    // Prevents new guests from seeing a backlog of old notices
    const guestCreatedAt = guest.created_at || 0;

    // Fetch undismissed notices — try per-guest dismissal table first, fall back to global flag
    let all = [];
    try {
      const { results } = await env.DB.prepare(`
        SELECT n.id, n.message, n.duration, n.action, n.created_at, n.guest_id
        FROM notices n
        LEFT JOIN notice_dismissals nd ON nd.notice_id = n.id AND nd.guest_id = ?
        WHERE n.dismissed = 0 AND nd.notice_id IS NULL AND n.created_at > ?
        ORDER BY n.created_at DESC
      `).bind(guest.id, guestCreatedAt).all();
      all = results;
    } catch(e) {
      // notice_dismissals table may not exist yet — fall back to global dismissed flag only
      const { results } = await env.DB.prepare(`
        SELECT id, message, duration, action, created_at, guest_id
        FROM notices
        WHERE dismissed = 0 AND created_at > ?
        ORDER BY created_at DESC
      `).bind(guestCreatedAt).all();
      all = results;
    }

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

    return Response.json(mine.map(({ guest_id, ...rest }) => ({
      ...rest,
      action: rest.action || ''
    })));
  }

  // Admin: get all recent
  let results = [];
  try {
    const r = await env.DB.prepare(`
      SELECT n.id, n.message, n.duration, n.action, n.dismissed, n.created_at, n.guest_id,
             (SELECT COUNT(*) FROM notice_dismissals nd WHERE nd.notice_id = n.id) as seen_count
      FROM notices n
      ORDER BY n.created_at DESC LIMIT 50
    `).all();
    results = r.results;
  } catch(e) {
    const r = await env.DB.prepare(`
      SELECT id, message, duration, action, dismissed, created_at, guest_id
      FROM notices
      ORDER BY created_at DESC LIMIT 50
    `).all();
    results = r.results;
  }

  return Response.json(results.map(n => ({
    ...n,
    action: n.action || '',
    recipient: labelForTarget(n.guest_id),
    dismissed: (n.seen_count > 0) || n.dismissed === 1
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
  const { message, target, duration, action } = await request.json();
  if (!message) return new Response('Missing message', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  const dest = target || 'ALL';

  // Try inserting with action column; fall back if column doesn't exist yet
  try {
    await env.DB.prepare(`
      INSERT INTO notices (id, guest_id, message, duration, action, dismissed, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).bind(id, dest, message, duration ?? null, action || '', now).run();
  } catch(e) {
    await env.DB.prepare(`
      INSERT INTO notices (id, guest_id, message, duration, dismissed, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).bind(id, dest, message, duration ?? null, now).run();
  }

  return Response.json({ success: true, id });
}

export async function onRequestPatch({ request, env }) {
  const { id, token } = await request.json();
  if (!id) return new Response('Missing id', { status: 400 });

  if (token) {
    const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
    if (!guest) return new Response('Unauthorized', { status: 403 });
    const now = Date.now();
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO notice_dismissals (notice_id, guest_id, dismissed_at) VALUES (?, ?, ?)`
      ).bind(id, guest.id, now).run();
    } catch(e) {
      // notice_dismissals not yet created — fall back to global dismiss
      await env.DB.prepare(`UPDATE notices SET dismissed = 1 WHERE id = ?`).bind(id).run();
    }
  } else {
    // Admin: dismiss globally for everyone
    await env.DB.prepare(`UPDATE notices SET dismissed = 1 WHERE id = ?`).bind(id).run();
  }

  return Response.json({ success: true });
}
