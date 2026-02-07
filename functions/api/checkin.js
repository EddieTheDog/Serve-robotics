export async function onRequestPost({ request, env }) {
  const { firstName, lastName, qrData } = await request.json();  // <- include qrData
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO guests (id, first_name, last_name, qr_data, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'waiting', ?, ?)
  `)
  .bind(id, firstName, lastName, qrData, now, now)
  .run();

  return Response.json({ guestId: id });
}
