export async function onRequestPost({ request, env }) {
  const { guestId } = await request.json();

  await env.DB.prepare(`
    UPDATE guests
    SET status = 'completed', updated_at = ?
    WHERE id = ?
  `).bind(Date.now(), guestId).run();

  return Response.json({ ok: true });
}
