// GET    /api/polls              → list all polls (admin)
// GET    /api/polls?id=X         → single poll with vote counts + guest's vote if token provided
// GET    /api/polls?id=X&token=Y → single poll + whether this guest has voted
// POST                            → create poll { question, options[], allow_multiple }
// PUT                             → update poll { id, question, options[], allow_multiple, active }
// DELETE                          → { id }
// PATCH                           → cast vote { id, token, choices[] }

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const token = url.searchParams.get('token');

  if (id) {
    const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(id).first();
    if (!poll) return new Response('Poll not found', { status: 404 });

    // Vote counts per option
    const { results: votes } = await env.DB.prepare(
      `SELECT choices FROM poll_votes WHERE poll_id = ?`
    ).bind(id).all();

    const options = JSON.parse(poll.options);
    const tallies = new Array(options.length).fill(0);
    const totalVoters = votes.length;
    votes.forEach(v => {
      try {
        const choices = JSON.parse(v.choices);
        choices.forEach(c => { if (c >= 0 && c < tallies.length) tallies[c]++; });
      } catch(e) {}
    });

    let myVote = null;
    if (token) {
      const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
      if (guest) {
        const vote = await env.DB.prepare(`SELECT choices FROM poll_votes WHERE poll_id = ? AND guest_id = ?`)
          .bind(id, guest.id).first();
        if (vote) myVote = JSON.parse(vote.choices);
      }
    }

    return Response.json({ ...poll, options, tallies, totalVoters, myVote });
  }

  // Admin: list all polls with vote counts
  const { results } = await env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM poll_votes pv WHERE pv.poll_id = p.id) as vote_count
     FROM polls p ORDER BY p.created_at DESC`
  ).all();
  return Response.json(results.map(p => ({ ...p, options: JSON.parse(p.options) })));
}

export async function onRequestPost({ request, env }) {
  const { question, options, allow_multiple } = await request.json();
  if (!question || !options?.length) return new Response('Missing fields', { status: 400 });
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO polls (id, question, options, allow_multiple, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)`
  ).bind(id, question, JSON.stringify(options), allow_multiple ? 1 : 0, now, now).run();
  return Response.json({ id, question, options, allow_multiple, active: 1 });
}

export async function onRequestPut({ request, env }) {
  const { id, question, options, allow_multiple, active } = await request.json();
  if (!id) return new Response('Missing id', { status: 400 });
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE polls SET question=?, options=?, allow_multiple=?, active=?, updated_at=? WHERE id=?`
  ).bind(question, JSON.stringify(options), allow_multiple ? 1 : 0, active ? 1 : 0, now, id).run();
  return Response.json({ success: true });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM polls WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}

export async function onRequestPatch({ request, env }) {
  const { id, token, choices } = await request.json();
  if (!id || !token || !choices) return new Response('Missing fields', { status: 400 });
  const guest = await env.DB.prepare(`SELECT id FROM guests WHERE app_token = ?`).bind(token).first();
  if (!guest) return new Response('Invalid token', { status: 403 });
  const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ? AND active = 1`).bind(id).first();
  if (!poll) return new Response('Poll not found or inactive', { status: 404 });

  const voteId = crypto.randomUUID();
  const now = Date.now();
  // Upsert — one vote per guest per poll
  await env.DB.prepare(
    `INSERT INTO poll_votes (id, poll_id, guest_id, choices, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(poll_id, guest_id) DO UPDATE SET choices=excluded.choices, created_at=excluded.created_at`
  ).bind(voteId, id, guest.id, JSON.stringify(choices), now).run();

  return Response.json({ success: true });
}
