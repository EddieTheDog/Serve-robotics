// GET: accepted guests with their custom field values
//      → { guests: [{ ..., fieldValues: { [fieldId]: typedValue } }], fields: [{ ..., options }] }
// PATCH: save seat, badge, is_actor, accom_enabled, passes, actor_request_disabled,
//        and custom field values
//
// fieldValues in PATCH: { [fieldId]: value }, where value is typed per field:
//   text        → string
//   checkbox    → boolean
//   dropdown    → string (one of the field's options, or '')
//   multiselect → array of strings (each one of the field's options)
//
// Requires custom_fields.options (see the custom fields endpoint):
//   ALTER TABLE custom_fields ADD COLUMN options TEXT;
//   ALTER TABLE custom_fields ADD COLUMN description TEXT;
//   ALTER TABLE custom_fields ADD COLUMN icon TEXT;

function parseJSON(str, fallback = null) {
  if (str === null || str === undefined || str === '') return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// Validate a value against a field and turn it into the stored TEXT form.
function serializeValue(field, value) {
  const options = parseJSON(field.options);

  switch (field.field_type) {
    case 'checkbox':
      return { stored: value === true || value === '1' || value === 1 || value === 'true' ? '1' : '0' };

    case 'dropdown': {
      const v = value == null ? '' : String(value);
      if (v !== '' && !(options || []).includes(v)) return { error: `"${v}" is not a valid option for "${field.label}"` };
      return { stored: v };
    }

    case 'multiselect': {
      const arr = Array.isArray(value) ? value.map(String) : [];
      const invalid = arr.filter(v => !(options || []).includes(v));
      if (invalid.length) return { error: `Invalid option(s) for "${field.label}": ${invalid.join(', ')}` };
      const ordered = (options || []).filter(o => arr.includes(o));
      return { stored: JSON.stringify(ordered) };
    }

    case 'text':
    default:
      return { stored: value == null ? '' : String(value) };
  }
}

// Turn a stored TEXT value back into the typed value for the client.
function deserializeValue(field, stored) {
  switch (field.field_type) {
    case 'checkbox':
      return stored === '1' || stored === 'true';
    case 'multiselect': {
      const arr = parseJSON(stored, []);
      return Array.isArray(arr) ? arr : [];
    }
    default:
      return stored ?? '';
  }
}

export async function onRequestGet({ env }) {
  const { results: guests } = await env.DB.prepare(`
    SELECT id, first_name, last_name, status, app_token, seat, badge, qr_data,
           is_actor, accom_enabled, accom_disabled, help_disabled, actor_request_disabled, passes
    FROM guests
    WHERE status = 'accepted'
    ORDER BY last_name ASC
  `).all();

  const { results: fieldRows } = await env.DB.prepare(`
    SELECT id, label, field_type, options, description, icon, sort_order FROM custom_fields ORDER BY sort_order ASC
  `).all();

  const fields = fieldRows.map(f => ({ ...f, options: parseJSON(f.options) }));

  // All stored values for accepted guests, in one query
  const { results: valueRows } = await env.DB.prepare(`
    SELECT v.guest_id, v.field_id, v.value
    FROM guest_field_values v
    JOIN guests g ON g.id = v.guest_id
    WHERE g.status = 'accepted'
  `).all();

  const fieldById = Object.fromEntries(fields.map(f => [f.id, f]));
  const valuesByGuest = {};
  for (const row of valueRows) {
    const field = fieldById[row.field_id];
    if (!field) continue; // orphaned value from a deleted field
    (valuesByGuest[row.guest_id] ??= {})[row.field_id] = deserializeValue(field, row.value);
  }

  // Every guest gets a typed value for every field (empty default if never set)
  const guestsWithValues = guests.map(g => {
    const fieldValues = {};
    for (const f of fields) {
      fieldValues[f.id] = valuesByGuest[g.id]?.[f.id] ?? deserializeValue(f, undefined);
    }
    return { ...g, fieldValues };
  });

  return Response.json({ guests: guestsWithValues, fields });
}

export async function onRequestPatch({ request, env }) {
  const body = await request.json();
  const { guestId, seat, badge, is_actor, accom_enabled, accom_disabled,
          help_disabled, actor_request_disabled, passes, fieldValues } = body;
  if (!guestId) return new Response('Missing guestId', { status: 400 });

  const now = Date.now();
  const updates = ['updated_at = ?'];
  const binds = [now];

  if (seat !== undefined)                   { updates.push('seat = ?');                    binds.push(seat); }
  if (badge !== undefined)                  { updates.push('badge = ?');                   binds.push(badge); }
  if (is_actor !== undefined)               { updates.push('is_actor = ?');                binds.push(is_actor); }
  if (accom_enabled !== undefined)          { updates.push('accom_enabled = ?');           binds.push(accom_enabled); }
  if (accom_disabled !== undefined)         { updates.push('accom_disabled = ?');          binds.push(accom_disabled); }
  if (help_disabled !== undefined)          { updates.push('help_disabled = ?');           binds.push(help_disabled); }
  if (actor_request_disabled !== undefined) { updates.push('actor_request_disabled = ?'); binds.push(actor_request_disabled); }
  if (passes !== undefined)                 { updates.push('passes = ?');                 binds.push(passes); }
  binds.push(guestId);

  const stmts = [];

  // Validate every custom field value BEFORE writing anything,
  // so a bad value doesn't leave the guest half-saved.
  if (fieldValues && typeof fieldValues === 'object') {
    const { results: fieldRows } = await env.DB.prepare(
      `SELECT id, label, field_type, options FROM custom_fields`
    ).all();
    const fieldById = Object.fromEntries(fieldRows.map(f => [f.id, f]));

    for (const [fieldId, value] of Object.entries(fieldValues)) {
      const field = fieldById[fieldId];
      if (!field) return new Response(`Unknown field: ${fieldId}`, { status: 400 });

      const { stored, error } = serializeValue(field, value);
      if (error) return new Response(error, { status: 400 });

      stmts.push(env.DB.prepare(`
        INSERT INTO guest_field_values (id, guest_id, field_id, value, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guest_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), guestId, fieldId, stored, now));
    }
  }

  // Guest update + all field values in one atomic batch
  await env.DB.batch([
    env.DB.prepare(`UPDATE guests SET ${updates.join(', ')} WHERE id = ?`).bind(...binds),
    ...stmts,
  ]);

  return Response.json({ success: true });
}
