export async function onRequestPost({ request, env }) {
  const { guestId } = await request.json();
  const now = Date.now();

  await env.DB.prepare(`
    UPDATE guests SET status = 'completed', updated_at = ? WHERE id = ?
  `).bind(now, guestId).run();

  return new Response(JSON.stringify({ success: true }));
}
