export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return new Response('Missing token', { status: 400 });

  const guest = await env.DB.prepare(`
    SELECT id, first_name, last_name, status, locked, badge, seat, help_disabled, accom_enabled, accom_disabled, is_actor, actor_request_disabled, passes
    FROM guests WHERE app_token = ?
  `).bind(token).first();

  if (!guest) return new Response('Invalid token', { status: 404 });

  // Also fetch custom field definitions + this guest's values
  const { results: fields } = await env.DB.prepare(`
    SELECT cf.id, cf.label, cf.field_type, COALESCE(gfv.value, '') as value
    FROM custom_fields cf
    LEFT JOIN guest_field_values gfv ON cf.id = gfv.field_id AND gfv.guest_id = ?
    ORDER BY cf.sort_order ASC
  `).bind(guest.id).all();

  return Response.json({ ...guest, custom_fields: fields });
}
