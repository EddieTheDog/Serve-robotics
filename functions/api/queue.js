export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM guests
    WHERE status IN ('waiting','help','accepted','declined')
    ORDER BY created_at ASC
  `).all();

  return Response.json(results);
}
