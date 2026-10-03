'use strict';

// The positions a church uses in its worship team (migration 029): seeded per admin on first
// use with Voce, Chitară, Pian/Clape, Bas, Tobe, Operator, Prezentator; the owner and the
// leader add, rename, reorder and deactivate them (a deactivated position stays on old
// assignments, never in the pickers). Each user has their usual positions (users_positions),
// set by the owner in Echipa or by the person on "Profilul meu".

const DEFAULT_POSITIONS = ['Voce', 'Chitară', 'Pian/Clape', 'Bas', 'Tobe', 'Operator', 'Prezentator'];
const DEFAULT_EMOJI = { Voce: '🎤', Chitară: '🎸', 'Pian/Clape': '🎹', Bas: '🎸', Tobe: '🥁', Operator: '💻', Prezentator: '🎙️' };
const MAX_NAME_LENGTH = 40;

// An emoji per position (migration 044): a guess from the name for the defaults and for new
// positions (Romanian, English, Norwegian words); the owner / leader can change or clear it.
const EMOJI_GUESSES = [
  [/voce|vocal|voice|sang|cântăr|solist|cor\b|choir|kor\b/i, '🎤'],
  [/bas/i, '🎸'],
  [/chitar|guitar|gitar/i, '🎸'],
  [/pian|clap|keys|keyboard|orgă|organ|synth/i, '🎹'],
  [/tobe|drum|trommer|percu|cajon/i, '🥁'],
  [/vioar|violin|fiolin|cello|violoncel/i, '🎻'],
  [/trompet|trumpet|saxo|alamă|brass|flaut|flute|fløyte/i, '🎺'],
  [/sunet|sound|lyd|mixer|audio/i, '🎚️'],
  [/operator|proiec|project|slide|media/i, '💻'],
  [/prezent|present|host|moderat|anunț/i, '🎙️'],
  [/video|camer|kamera|stream|live/i, '🎥'],
  [/lumin|light|lys/i, '💡'],
  [/foto|photo/i, '📷'],
  [/lider|leader|leder|dirij|conduc/i, '⭐'],
  [/copii|kids|barn/i, '🧒'],
];
const guessEmoji = (name) => (EMOJI_GUESSES.find(([re]) => re.test(String(name || ''))) || [])[1] || null;

// One emoji (a short pictographic sequence, no letters or digits) or '' / null to clear it.
function validatePositionEmoji(value, t) {
  if (value === null || value === undefined) return { value: null };
  const emoji = typeof value === 'string' ? value.trim() : null;
  if (emoji === '') return { value: null };
  if (emoji === null || emoji.length > 16 || !/\p{Extended_Pictographic}/u.test(emoji) || /[\p{L}\p{N}\s]/u.test(emoji.replace(/[#*0-9]\uFE0F?\u20E3/gu, ''))) {
    return { error: t('errors.positionEmojiInvalid') };
  }
  return { value: emoji };
}
const MAX_POSITIONS = 40;

function validatePositionName(value, t) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_NAME_LENGTH) return { error: t('errors.positionNameInvalid', { max: MAX_NAME_LENGTH }) };
  return { value: name };
}

const toPosition = (row) => ({ id: row.id, name: row.name, emoji: row.emoji || null, sort: row.sort, active: Boolean(row.active) });

function createPositionStore(db) {
  const countAll = db.prepare('SELECT COUNT(*) FROM positions WHERE admin_id = ?').pluck();
  const insert = db.prepare('INSERT INTO positions (admin_id, name, emoji, sort, active) VALUES (?, ?, ?, ?, 1)');
  const listAll = db.prepare('SELECT * FROM positions WHERE admin_id = ? ORDER BY sort, id');
  const selectOne = db.prepare('SELECT * FROM positions WHERE id = ? AND admin_id = ?');
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) FROM positions WHERE admin_id = ?').pluck();
  const rename = db.prepare('UPDATE positions SET name = ? WHERE id = ? AND admin_id = ?');
  const setEmoji = db.prepare('UPDATE positions SET emoji = ? WHERE id = ? AND admin_id = ?');
  const setActive = db.prepare('UPDATE positions SET active = ? WHERE id = ? AND admin_id = ?');
  const setSort = db.prepare('UPDATE positions SET sort = ? WHERE id = ? AND admin_id = ?');
  const userRows = db.prepare(`SELECT up.user_id, up.position_id FROM users_positions up JOIN positions p ON p.id = up.position_id
    WHERE up.admin_id = ? ORDER BY p.sort, p.id`);
  const ofUser = db.prepare(`SELECT up.position_id FROM users_positions up JOIN positions p ON p.id = up.position_id
    WHERE up.admin_id = ? AND up.user_id = ? ORDER BY p.sort, p.id`).pluck();
  const clearUser = db.prepare('DELETE FROM users_positions WHERE admin_id = ? AND user_id = ?');
  const addUser = db.prepare('INSERT OR IGNORE INTO users_positions (user_id, position_id, admin_id) VALUES (?, ?, ?)');
  const userOfAdmin = db.prepare('SELECT 1 FROM users WHERE id = ? AND admin_id = ?').pluck();

  // The defaults, once, for an admin without any position yet.
  const ensure = db.transaction((adminId) => {
    if (countAll.get(adminId) > 0) return false;
    DEFAULT_POSITIONS.forEach((name, i) => insert.run(adminId, name, DEFAULT_EMOJI[name], i));
    return true;
  });

  // Every position (the pickers skip inactive ones), in order.
  function list(adminId, { activeOnly = false } = {}) {
    ensure(adminId);
    return listAll.all(adminId).map(toPosition).filter((p) => !activeOnly || p.active);
  }

  function get(adminId, id) {
    const row = selectOne.get(id, adminId);
    return row ? toPosition(row) : null;
  }

  // emoji: undefined = a guess from the name, null = none.
  function create(adminId, name, emoji) {
    ensure(adminId);
    if (countAll.get(adminId) >= MAX_POSITIONS) return null;
    const icon = emoji === undefined ? guessEmoji(name) : emoji;
    return get(adminId, Number(insert.run(adminId, name, icon, maxSort.get(adminId) + 1).lastInsertRowid));
  }

  function update(adminId, id, { name, emoji, active }) {
    if (!get(adminId, id)) return null;
    if (name !== undefined) rename.run(name, id, adminId);
    if (emoji !== undefined) setEmoji.run(emoji, id, adminId);
    if (active !== undefined) setActive.run(active ? 1 : 0, id, adminId);
    return get(adminId, id);
  }

  // The new order: every id of the admin, once. -> boolean
  const reorder = db.transaction((adminId, ids) => {
    const current = listAll.all(adminId).map((p) => p.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) return false;
    ids.forEach((id, i) => setSort.run(i, id, adminId));
    return true;
  });

  // user id -> [position ids], for the whole admin (Echipa, the assignment picker).
  function byUser(adminId) {
    const out = new Map();
    for (const row of userRows.all(adminId)) {
      if (!out.has(row.user_id)) out.set(row.user_id, []);
      out.get(row.user_id).push(row.position_id);
    }
    return out;
  }

  function ofUserIds(adminId, userId) {
    return ofUser.all(adminId, userId);
  }

  // Replaces a user's positions with the given ACTIVE positions of the admin. -> boolean
  const setForUser = db.transaction((adminId, userId, ids) => {
    if (!userOfAdmin.get(userId, adminId)) return false;
    const active = new Set(list(adminId, { activeOnly: true }).map((p) => p.id));
    clearUser.run(adminId, userId);
    for (const id of [...new Set(ids)].filter((id) => active.has(id))) addUser.run(userId, id, adminId);
    return true;
  });

  return { ensure, list, get, create, update, reorder, byUser, ofUserIds, setForUser };
}

module.exports = { DEFAULT_POSITIONS, DEFAULT_EMOJI, MAX_NAME_LENGTH, MAX_POSITIONS, guessEmoji, validatePositionName, validatePositionEmoji, createPositionStore };
