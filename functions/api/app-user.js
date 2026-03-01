export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return new Response('Missing token', { status: 400 });

  const guest = await env.DB.prepare(`
    SELECT id, first_name, last_name, status, locked, badge, seat, help_disabled FROM guests WHERE app_token = ?
  `).bind(token).first();

  if (!guest) return new Response('Invalid token', { status: 404 });

  return Response.json(guest);
}
