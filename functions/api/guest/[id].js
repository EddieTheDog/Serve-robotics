export async function onRequestGet({ params, env }) {
  const id = params.id;
  const guest = await env.DB.prepare(`
    SELECT id, first_name, last_name, qr_data, status FROM guests WHERE id = ?
  `).bind(id).first();

  if (!guest) return new Response("Guest not found", { status: 404 });

  return Response.json(guest);
}
