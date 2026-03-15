export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, title, description, sort_order, is_live, button_triggers
    FROM schedule ORDER BY sort_order ASC, created_at ASC
  `).all();
  // Parse button_triggers JSON for each item
  return Response.json(results.map(r => ({
    ...r,
    button_triggers: (() => { try { return JSON.parse(r.button_triggers || '[]'); } catch(e) { return []; } })()
  })));
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const now = Date.now();

  if (body.action === 'create') {
    const id = crypto.randomUUID();
    const { results: existing } = await env.DB.prepare(`SELECT MAX(sort_order) as max_order FROM schedule`).all();
    const nextOrder = (existing[0]?.max_order ?? -1) + 1;
    await env.DB.prepare(`
      INSERT INTO schedule (id, title, description, sort_order, is_live, button_triggers, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, '[]', ?, ?)
    `).bind(id, body.title || 'New Item', body.description || '', nextOrder, now, now).run();
    return Response.json({ success: true, id });
  }

  if (body.action === 'go-live') {
    // Un-live everything first
    await env.DB.prepare(`UPDATE schedule SET is_live = 0, updated_at = ?`).bind(now).run();

    if (body.is_live === 1) {
      await env.DB.prepare(`UPDATE schedule SET is_live = 1, updated_at = ? WHERE id = ?`)
        .bind(now, body.id).run();

      // Fire button triggers for this schedule item
      try {
        const item = await env.DB.prepare(`SELECT button_triggers FROM schedule WHERE id = ?`)
          .bind(body.id).first();
        const triggers = JSON.parse(item?.button_triggers || '[]');

        if (triggers.length > 0) {
          const stmts = triggers.map(t => {
            if (t.mode === 'show') {
              // Make button live immediately — clear starts_at and expires_at
              return env.DB.prepare(
                `UPDATE custom_buttons SET starts_at = NULL, expires_at = NULL, visible = 1 WHERE id = ?`
              ).bind(t.buttonId);
            } else if (t.mode === 'hide') {
              // Hide button immediately — set expires_at to now
              return env.DB.prepare(
                `UPDATE custom_buttons SET expires_at = ? WHERE id = ?`
              ).bind(now, t.buttonId);
            }
            return null;
          }).filter(Boolean);

          if (stmts.length > 0) await env.DB.batch(stmts);
        }
      } catch(e) {
        // button_triggers column may not exist yet — safe to ignore
      }
    }

    return Response.json({ success: true });
  }

  return new Response('Unknown action', { status: 400 });
}

export async function onRequestPatch({ request, env }) {
  const { id, title, description, button_triggers } = await request.json();
  const now = Date.now();

  if (button_triggers !== undefined) {
    // Save button trigger config
    try {
      await env.DB.prepare(
        `UPDATE schedule SET button_triggers = ?, updated_at = ? WHERE id = ?`
      ).bind(JSON.stringify(button_triggers), now, id).run();
    } catch(e) {
      // column may not exist yet
    }
    return Response.json({ success: true });
  }

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
