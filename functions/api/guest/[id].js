export async function onRequestGet({ params, env }) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM guests WHERE id = ?
  `).bind(params.id).all();

  if (!results.length) {
    return new Response("Not found", { status: 404 });
  }

  return Response.json(results[0]);
}
