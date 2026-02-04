export async function onRequestPost({ request, env }) {
  const { firstName, lastName } = await request.json();
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO guests (id, first_name, last_name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'waiting', ?, ?)
  `).bind(id, firstName, lastName, now, now).run();

  return Response.json({ guestId: id });
}
