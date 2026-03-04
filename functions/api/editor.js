// GET: accepted guests with their custom field values
// PATCH: save seat, badge, and custom field values

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, first_name, last_name, status, app_token, seat, badge, qr_data, is_actor, accom_enabled, help_disabled, accom_disabled
    FROM guests
    WHERE status = 'accepted'
    ORDER BY updated_at ASC
  `).all();

  // Also return field definitions so editor can render the form
  const { results: fields } = await env.DB.prepare(`
    SELECT id, label, field_type, sort_order FROM custom_fields ORDER BY sort_order ASC
  `).all();

  return Response.json({ guests: results, fields });
}

export async function onRequestPatch({ request, env }) {
  const body = await request.json();
  const { guestId, seat, badge, fieldValues, accom_enabled, help_disabled } = body;
  if (!guestId) return new Response('Missing guestId', { status: 400 });

  const now = Date.now();
  const updates = ['updated_at = ?'];
  const binds = [now];

  if (seat !== undefined) { updates.push('seat = ?'); binds.push(seat); }
  if (badge !== undefined) { updates.push('badge = ?'); binds.push(badge); }
  if (is_actor !== undefined) { updates.push('is_actor = ?'); binds.push(is_actor); }
  if (accom_enabled !== undefined) { updates.push('accom_enabled = ?'); binds.push(accom_enabled); }
  if (help_disabled !== undefined) { updates.push('help_disabled = ?'); binds.push(help_disabled); }
  binds.push(guestId);

  await env.DB.prepare(`UPDATE guests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();

  // Save custom field values
  if (fieldValues && typeof fieldValues === 'object') {
    for (const [fieldId, value] of Object.entries(fieldValues)) {
      const id = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO guest_field_values (id, guest_id, field_id, value, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guest_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(id, guestId, fieldId, String(value), now).run();
    }
  }

  return Response.json({ success: true });
}
