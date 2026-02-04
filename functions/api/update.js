export async function onRequestPost({ request, env }) {
  const { guestId, status } = await request.json();

  await env.DB.prepare(`
    UPDATE guests SET status = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, Date.now(), guestId).run();

  return Response.json({ ok: true });
}
