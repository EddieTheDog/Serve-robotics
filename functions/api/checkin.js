export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO guests (id, first_name, last_name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'waiting', ?, ?)
  `).bind(id, body.firstName, body.lastName, now, now).run();

  return Response.json({
    guestId: id,
    hardLink: `/guest.html?id=${id}`
  });
}
