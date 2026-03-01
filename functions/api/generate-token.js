export async function onRequestPost({ request, env }) {
  const { guestId } = await request.json();

  // Check if already has a token
  const guest = await env.DB.prepare(`SELECT app_token FROM guests WHERE id = ?`).bind(guestId).first();
  if (!guest) return new Response('Not found', { status: 404 });
  if (guest.app_token) return Response.json({ token: guest.app_token });

  // Generate a new unique token
  const token = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(`UPDATE guests SET app_token = ?, updated_at = ? WHERE id = ?`)
    .bind(token, now, guestId).run();

  return Response.json({ token });
}
