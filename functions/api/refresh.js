export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (token) {
    // Heartbeat — update last_seen for this guest
    const now = Date.now();
    try {
      await env.DB.prepare(`UPDATE guests SET last_seen = ? WHERE app_token = ?`).bind(now, token).run();
    } catch(e) {} // last_seen column may not exist yet — safe to ignore
  }
  const row = await env.DB.prepare(`SELECT value, updated_at FROM app_config WHERE key = 'refresh_signal'`).first();
  return Response.json({ signal: row?.value ?? '0', updated_at: row?.updated_at ?? 0 });
}

export async function onRequestPost({ env }) {
  const now = Date.now();
  const signal = String(now);
  await env.DB.prepare(`UPDATE app_config SET value = ?, updated_at = ? WHERE key = 'refresh_signal'`)
    .bind(signal, now).run();
  return Response.json({ success: true, signal });
}
