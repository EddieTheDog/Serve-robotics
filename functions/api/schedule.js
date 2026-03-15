export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, title, description, sort_order, is_live
    FROM schedule ORDER BY sort_order ASC, created_at ASC
  `).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const now = Date.now();

  if (body.action === 'create') {
    const id = crypto.randomUUID();
    const { results: existing } = await env.DB.prepare(`SELECT MAX(sort_order) as max_order FROM schedule`).all();
    const nextOrder = (existing[0]?.max_order ?? -1) + 1;
    await env.DB.prepare(`
      INSERT INTO schedule (id, title, description, sort_order, is_live, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).bind(id, body.title || 'New Item', body.description || '', nextOrder, now, now).run();
    return Response.json({ success: true, id });
  }

  if (body.action === 'go-live') {
    // Un-live everything first
    await env.DB.prepare(`UPDATE schedule SET is_live = 0, updated_at = ?`).bind(now).run();

    if (body.is_live === 1) {
      await env.DB.prepare(`UPDATE schedule SET is_live = 1, updated_at = ? WHERE id = ?`)
        .bind(now, body.id).run();

      // Fire button schedule triggers
      // Any button with show_on_schedule_id = this item → make live (clear starts_at/expires_at)
      // Any button with hide_on_schedule_id = this item → hide (set expires_at = now)
      try {
        const { results: showBtns } = await env.DB.prepare(
          `SELECT id FROM custom_buttons WHERE show_on_schedule_id = ? AND visible = 1`
        ).bind(body.id).all();

        const { results: hideBtns } = await env.DB.prepare(
          `SELECT id FROM custom_buttons WHERE hide_on_schedule_id = ? AND visible = 1`
        ).bind(body.id).all();

        const stmts = [
          ...showBtns.map(b =>
            env.DB.prepare(`UPDATE custom_buttons SET starts_at = NULL, expires_at = NULL WHERE id = ?`).bind(b.id)
          ),
          ...hideBtns.map(b =>
            env.DB.prepare(`UPDATE custom_buttons SET expires_at = ? WHERE id = ?`).bind(now, b.id)
          )
        ];
        if (stmts.length > 0) await env.DB.batch(stmts);
      } catch(e) {
        // columns may not exist yet — safe to ignore
      }
    }

    return Response.json({ success: true });
  }

  return new Response('Unknown action', { status: 400 });
}

export async function onRequestPatch({ request, env }) {
  const { id, title, description } = await request.json();
  const now = Date.now();
  await env.DB.prepare(`
    UPDATE schedule SET title = ?, description = ?, updated_at = ? WHERE id = ?
  `).bind(title, description ?? '', now, id).run();
  return Response.json({ success: true });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  await env.DB.prepare(`DELETE FROM schedule WHERE id = ?`).bind(id).run();
  return Response.json({ success: true });
}
