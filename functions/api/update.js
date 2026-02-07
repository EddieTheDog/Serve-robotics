export async function onRequestPost({ request, env }) {
  const { guestId, status } = await request.json();
  const now = Date.now();

  await env.DB.prepare(`
    UPDATE guests SET status = ?, updated_at = ? WHERE id = ?
  `).bind(status, now, guestId).run();

  return new Response(JSON.stringify({ success: true }));
}
