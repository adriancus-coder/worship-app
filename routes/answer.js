'use strict';

const express = require('express');
const { createAnswerLinks } = require('../lib/answer-links');
const { createAttendanceStore, ANSWERS, MAX_NOTE } = require('../lib/attendance');
const { createEventStore } = require('../lib/events');

// The answer links of the invitation email (lib/answer-links.js), no session needed:
//   GET  /api/answer/:token   the event, the church, the person's answer now (404 unknown, 410 expired)
//   POST /api/answer/:token   { status: accepted|maybe|declined, note? } -> the same; the leaders are told
// The page itself is /answer/:token (routes/pages.js, public/answer.html). A link only opens the
// page: the answer is saved by a tap there (mail scanners open links on their own).
function createAnswerRouter({ db, logger, notifications }) {
  const router = express.Router();
  const links = createAnswerLinks(db);
  const attendance = createAttendanceStore(db);
  const events = createEventStore(db);
  const selectAdmin = db.prepare('SELECT name FROM admins WHERE id = ?').pluck();
  const selectUser = db.prepare('SELECT id, name FROM users WHERE id = ? AND admin_id = ? AND active = 1');

  router.use('/api/answer', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // The link and what it points at, or an error already sent.
  function load(req, res) {
    const link = links.find(req.params.token);
    const found = link && events.get(link.adminId, link.eventId);
    const user = link && selectUser.get(link.userId, link.adminId);
    if (!link || !found || !user || found.event.isTemplate) {
      res.status(404).json({ code: 'tokenInvalid', error: req.t('errors.tokenInvalid') });
      return null;
    }
    if (link.state !== 'valid' || found.event.status === 'finished') {
      res.status(410).json({ code: 'tokenExpired', error: req.t('answerPage.expired') });
      return null;
    }
    return { link, event: found.event, user };
  }

  const body = (req, { link, event, user }) => ({
    event: { name: event.name, eventDate: event.eventDate, startTime: event.startTime || null, notes: event.notes || null },
    church: selectAdmin.get(link.adminId) || '',
    name: user.name,
    answer: attendance.mine(link.adminId, event.id, user.id),
  });

  router.get('/api/answer/:token', (req, res) => {
    const found = load(req, res);
    if (found) res.json(body(req, found));
  });

  router.post('/api/answer/:token', (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { status, note } = req.body || {};
    if (!ANSWERS.includes(status)) return res.status(400).json({ error: req.t('errors.badRequest') });
    const clean = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : '';
    const before = attendance.mine(found.link.adminId, found.event.id, found.user.id);
    attendance.answer(found.link.adminId, found.event.id, found.user.id, status, clean);
    logger.info(`Event #${found.event.id}: user #${found.user.id} attendance ${status} by email link (admin #${found.link.adminId})`);
    if (!before || before.status !== status) {
      notifications.onAttendance(found.link.adminId, found.event, found.user, status, clean)
        .catch((err) => logger.error('attendance notification failed', err));
    }
    res.json(body(req, found));
  });

  return router;
}

module.exports = { createAnswerRouter };
