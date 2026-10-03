// GET              → list all field definitions (options parsed)
// GET ?guestId=xxx  → list fields + this guest's values (parsed by type)
// POST action=create    → create a field: { label, field_type, options?, description?, icon? }
// POST action=set-value → save a guest's value: { guestId, fieldId, value }
// PATCH             → reorder: { items: [{id, sort_order}] }
//                     OR edit:  { id, label?, description?, icon?, options? }
// DELETE            → delete a field definition: { id }
//
// field_type: 'text' | 'checkbox' | 'dropdown' | 'multiselect'
//
// options by type:
//   text        → null
//   checkbox    → { checked: "Yes", unchecked: "No" }   (labels are customizable)
//   dropdown    → ["Option A", "Option B", ...]
//   multiselect → ["Option A", "Option B", ...]
//
// Value formats (as sent to set-value / returned by GET):
//   text        → string
//   checkbox    → boolean
//   dropdown    → string (one of the options, or '' for none)
//   multiselect → array of strings (each one of the options)
//
// Stored in guest_field_values.value as TEXT:
//   checkbox → '1' / '0', multiselect → JSON array string.
//
// REQUIRED MIGRATION (run once):
//   ALTER TABLE custom_fields ADD COLUMN options TEXT;
//   ALTER TABLE custom_fields ADD COLUMN description TEXT;   -- public description shown to guests
//   ALTER TABLE custom_fields ADD COLUMN icon TEXT;          -- emoji, like passes

const FIELD_TYPES = ['text', 'checkbox', 'dropdown', 'multiselect'];

function parseJSON(str, fallback = null) {
  if (str === null || str === undefined || str === '') return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// Validate + normalize options for a field type. Returns { error } or { options }.
function normalizeOptions(fieldType, options) {
  if (fieldType === 'text') return { options: null };

  if (fieldType === 'checkbox') {
    const checked = String(options?.checked ?? 'Yes').trim() || 'Yes';
    const unchecked = String(options?.unchecked ?? 'No').trim() || 'No';
    return { options: { checked, unchecked } };
  }

  // dropdown / multiselect
  if (!Array.isArray(options)) return { error: 'options must be an array of strings' };
  const cleaned = [...new Set(options.map(o => String(o).trim()).filter(Boolean))];
  if (cleaned.length === 0) return { error: 'At least one option is required' };
  return { options: cleaned };
}

// Validate a value against a field and turn it into the stored TEXT form.
function serializeValue(field, value) {
  const options = parseJSON(field.options);

  switch (field.field_type) {
    case 'text':
      return { stored: value == null ? '' : String(value) };

    case 'checkbox':
      return { stored: value === true || value === '1' || value === 1 || value === 'true' ? '1' : '0' };

    case 'dropdown': {
      const v = value == null ? '' : String(value);
      if (v !== '' && !options.includes(v)) return { error: `"${v}" is not a valid option` };
      return { stored: v };
    }

    case 'multiselect': {
      const arr = Array.isArray(value) ? value.map(String) : [];
      const invalid = arr.filter(v => !options.includes(v));
      if (invalid.length) return { error: `Invalid option(s): ${invalid.join(', ')}` };
      // Keep the order defined on the field, drop duplicates
      const ordered = options.filter(o => arr.includes(o));
      return { stored: JSON.stringify(ordered) };
    }

    default:
      return { stored: value == null ? '' : String(value) };
  }
}

// Turn a stored TEXT value back into the typed value for the client.
function deserializeValue(field, stored) {
  switch (field.field_type) {
    case 'checkbox':
      return stored === '1';
    case 'multiselect': {
      const arr = parseJSON(stored, []);
      return Array.isArray(arr) ? arr : [];
    }
    default:
      return stored ?? '';
  }
}

function emptyValue(field) {
  return deserializeValue(field, undefined);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const guestId = url.searchParams.get('guestId');

  const { results: rows } = await env.DB.prepare(`
    SELECT id, label, field_type, options, description, icon, sort_order FROM custom_fields ORDER BY sort_order ASC
  `).all();

  const fields = rows.map(f => ({ ...f, options: parseJSON(f.options) }));

  if (!guestId) return Response.json(fields);

  const { results: values } = await env.DB.prepare(`
    SELECT field_id, value FROM guest_field_values WHERE guest_id = ?
  `).bind(guestId).all();

  const valMap = {};
  values.forEach(v => { valMap[v.field_id] = v.value; });

  const merged = fields.map(f => ({
    ...f,
    value: f.id in valMap ? deserializeValue(f, valMap[f.id]) : emptyValue(f),
  }));
  return Response.json(merged);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.action === 'create') {
    const { label } = body;
    const field_type = body.field_type ?? 'text';
    if (!label || !String(label).trim()) return new Response('Missing label', { status: 400 });
    if (!FIELD_TYPES.includes(field_type)) {
      return new Response(`Invalid field_type. Use one of: ${FIELD_TYPES.join(', ')}`, { status: 400 });
    }

    const norm = normalizeOptions(field_type, body.options);
    if (norm.error) return new Response(norm.error, { status: 400 });

    const id = crypto.randomUUID();
    const now = Date.now();
    const { results: existing } = await env.DB.prepare(`SELECT MAX(sort_order) as m FROM custom_fields`).all();
    const nextOrder = (existing[0]?.m ?? -1) + 1;

    await env.DB.prepare(`
      INSERT INTO custom_fields (id, label, field_type, options, description, icon, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      String(label).trim(),
      field_type,
      norm.options === null ? null : JSON.stringify(norm.options),
      String(body.description ?? '').trim() || null,
      String(body.icon ?? '').trim().slice(0, 16) || null,
      nextOrder,
      now
    ).run();

    return Response.json({ success: true, id });
  }

  if (body.action === 'set-value') {
    const { guestId, fieldId, value } = body;
    if (!guestId || !fieldId) return new Response('Missing guestId or fieldId', { status: 400 });

    const field = await env.DB.prepare(
      `SELECT id, field_type, options FROM custom_fields WHERE id = ?`
    ).bind(fieldId).first();
    if (!field) return new Response('Field not found', { status: 404 });

    const { stored, error } = serializeValue(field, value);
    if (error) return new Response(error, { status: 400 });

    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO guest_field_values (id, guest_id, field_id, value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guest_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(id, guestId, fieldId, stored, now).run();

    return Response.json({ success: true });
  }

  return new Response('Unknown action', { status: 400 });
}

export async function onRequestPatch({ request, env }) {
  // Reorder: body = { items: [{id, sort_order}, ...] }
  // Edit:    body = { id, label?, options? }
  const body = await request.json();

  if (body.items) {
    const stmts = body.items.map(({ id, sort_order }) =>
      env.DB.prepare(`UPDATE custom_fields SET sort_order = ? WHERE id = ?`).bind(sort_order, id)
    );
    await env.DB.batch(stmts);
    return Response.json({ success: true });
  }

  if (body.id && (body.label !== undefined || body.options !== undefined || body.description !== undefined || body.icon !== undefined)) {
    const field = await env.DB.prepare(
      `SELECT id, field_type FROM custom_fields WHERE id = ?`
    ).bind(body.id).first();
    if (!field) return new Response('Field not found', { status: 404 });

    if (body.label !== undefined) {
      if (!String(body.label).trim()) return new Response('Label cannot be empty', { status: 400 });
      await env.DB.prepare(`UPDATE custom_fields SET label = ? WHERE id = ?`)
        .bind(String(body.label).trim(), body.id).run();
    }

    if (body.description !== undefined) {
      await env.DB.prepare(`UPDATE custom_fields SET description = ? WHERE id = ?`)
        .bind(String(body.description ?? '').trim() || null, body.id).run();
    }

    if (body.icon !== undefined) {
      await env.DB.prepare(`UPDATE custom_fields SET icon = ? WHERE id = ?`)
        .bind(String(body.icon ?? '').trim().slice(0, 16) || null, body.id).run();
    }

    if (body.options !== undefined) {
      const norm = normalizeOptions(field.field_type, body.options);
      if (norm.error) return new Response(norm.error, { status: 400 });
      await env.DB.prepare(`UPDATE custom_fields SET options = ? WHERE id = ?`)
        .bind(norm.options === null ? null : JSON.stringify(norm.options), body.id).run();
    }

    return Response.json({ success: true });
  }

  return new Response('Nothing to update', { status: 400 });
}

export async function onRequestDelete({ request, env }) {
  const { id } = await request.json();
  if (!id) return new Response('Missing id', { status: 400 });
  await env.DB.prepare(`DELETE FROM custom_fields WHERE id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM guest_field_values WHERE field_id = ?`).bind(id).run();
  return Response.json({ success: true });
}
