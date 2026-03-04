export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, first_name, last_name, status, app_token, locked, qr_data, seat, badge, help_disabled, accom_enabled, accom_disabled, is_actor, created_at
    FROM guests ORDER BY created_at DESC
  `).all();
  return Response.json(results);
}

export async function onRequestPatch({ request, env }) {
  const body = await request.json();
  const { guestId } = body;
  const now = Date.now();
  if (!guestId) return new Response('Missing guestId', { status: 400 });

  const updates = ['updated_at = ?'];
  const binds = [now];

  if (body.first_name !== undefined) { updates.push('first_name = ?'); binds.push(body.first_name); }
  if (body.last_name !== undefined) { updates.push('last_name = ?'); binds.push(body.last_name); }
  if (body.locked !== undefined) { updates.push('locked = ?'); binds.push(body.locked); }
  if (body.badge !== undefined) { updates.push('badge = ?'); binds.push(body.badge); }
  if (body.seat !== undefined) { updates.push('seat = ?'); binds.push(body.seat); }
  if (body.help_disabled !== undefined) { updates.push('help_disabled = ?'); binds.push(body.help_disabled); }
  if (body.accom_enabled !== undefined) { updates.push('accom_enabled = ?'); binds.push(body.accom_enabled); }
  if (body.accom_disabled !== undefined) { updates.push('accom_disabled = ?'); binds.push(body.accom_disabled); }
  if (body.is_actor !== undefined) { updates.push('is_actor = ?'); binds.push(body.is_actor); }

  binds.push(guestId);
  await env.DB.prepare(`UPDATE guests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  return Response.json({ success: true });
}

export async function onRequestDelete({ request, env }) {
  const { guestId } = await request.json();
  if (!guestId) return new Response('Missing guestId', { status: 400 });
  await env.DB.prepare(`DELETE FROM help_requests WHERE guest_id = ?`).bind(guestId).run();
  await env.DB.prepare(`DELETE FROM guests WHERE id = ?`).bind(guestId).run();
  return Response.json({ success: true });
}
