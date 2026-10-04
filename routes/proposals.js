'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { createEventStore } = require('../lib/events');
const { seesAllEvents } = require('../lib/roles');
const { createProposalStore } = require('../lib/proposals');

// Song proposals (lib/proposals.js):
//   GET  /api/events/:id/proposals              members: their own; event roles: all, with names
//   POST /api/events/:id/proposals              { songId, note? } - anyone, planned or live events
//   POST /api/events/:id/proposals/:pid/add     event roles: { target: 'setlist'|'projector', position: 'afterCurrent'|'end' }
//   POST /api/events/:id/proposals/:pid/decline event roles: { note? }
// Adding uses the existing paths: the live hub's addItem while live (the same command the
// console sends), the shared setlist otherwise.
function createProposalsRouter({ db, auth, logger, live, notifications }) {
  const router = express.Router();
  const events = createEventStore(db);
  const proposals = createProposalStore(db);

  router.use('/api/events/:id/proposals', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const isEditor = (req) => seesAllEvents(req.user); // the 'events' or the 'live' right

  function load(req, res) {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    const found = id && events.get(req.adminId, id, { teamOnly: !isEditor(req), t: req.t });
    if (!found) res.status(404).json({ error: req.t('errors.notFound') });
    return found || null;
  }

  const payload = (req, found) => {
    const editor = isEditor(req);
    const rows = proposals.list(req.adminId, found.event.id, { forUser: editor ? null : req.user.id });
    return { proposals: editor ? rows : rows.map((p) => ({ ...p, proposerName: undefined })), openCount: proposals.openCount(req.adminId, found.event.id), canDecide: editor, eventStatus: found.event.status };
  };

  router.get('/api/events/:id/proposals', (req, res) => {
    const found = load(req, res);
    if (!found) return;
    res.json(payload(req, found));
  });

  router.post('/api/events/:id/proposals', asyncRoute(async (req, res) => {
    const found = load(req, res);
    if (!found) return;
    if (found.event.isTemplate || found.event.status === 'finished') return res.status(409).json({ code: 'eventFinished', error: req.t('errors.proposalEventClosed') });
    const body = req.body || {};
    const out = proposals.create(req.adminId, found.event.id, body.songId, req.user.id, body.note);
    if (out.error === 'songInvalid') return res.status(400).json({ error: req.t('errors.songNotFound') });
    if (out.error === 'proposalExists') return res.status(409).json({ code: out.error, error: req.t('errors.proposalExists') });
    if (out.error === 'proposalLimit') return res.status(429).json({ code: out.error, error: req.t('errors.proposalLimit') });
    logger.info(`Proposal #${out.proposal.id}: song #${out.proposal.songId} for event #${found.event.id} by user #${req.user.id} (admin #${req.adminId})`);
    // the event roles: a notification (+ push) and, while live, a toast with the actions
    notifications.onProposal(req.adminId, found.event, out.proposal).catch((err) => logger.error('proposal notification failed', err));
    if (found.event.status === 'live') live.noticeAll(req.adminId, found.event.id, { type: 'proposal', proposal: { id: out.proposal.id, songTitle: out.proposal.songTitle, note: out.proposal.note }, by: req.user.name, byUserId: req.user.id });
    res.status(201).json({ proposal: { ...out.proposal, proposerName: undefined }, ...payload(req, found) });
  }));

  function openProposal(req, res, found) {
    const pid = /^\d{1,15}$/.test(req.params.pid) ? Number(req.params.pid) : null;
    const proposal = pid && proposals.get(req.adminId, found.event.id, pid);
    if (!proposal) { res.status(404).json({ error: req.t('errors.notFound') }); return null; }
    if (proposal.status !== 'open') { res.status(409).json({ code: 'proposalDecided', error: req.t('errors.proposalDecided') }); return null; }
    return proposal;
  }

  router.post('/api/events/:id/proposals/:pid/add', asyncRoute(async (req, res) => {
    if (!isEditor(req)) return res.status(403).json({ error: req.t('errors.forbidden') });
    const found = load(req, res);
    if (!found) return;
    const proposal = openProposal(req, res, found);
    if (!proposal) return;
    const body = req.body || {};
    const target = body.target === 'projector' ? 'projector' : 'setlist';
    const position = body.position === 'afterCurrent' ? 'afterCurrent' : 'end';
    const liveNow = found.event.status === 'live';
    if (target === 'projector' && !liveNow) return res.status(400).json({ error: req.t('errors.proposalProjectorNotLive') });
    if (found.event.status === 'finished' || found.event.isTemplate) return res.status(409).json({ code: 'eventFinished', error: req.t('errors.proposalEventClosed') });
    let itemId = null;
    if (liveNow) {
      const out = live.addItem(req.adminId, found.event.id, { target, position, item: { type: 'song', songId: proposal.songId } }, { role: req.user.liveRole, userId: req.user.id, userName: req.user.name });
      if (!out.ok) return res.status(409).json({ code: out.code, error: req.t(`live.errors.${out.code}`) });
      itemId = out.itemId;
    } else {
      const before = live.setlistBefore(req.adminId, found.event.id);
      itemId = events.addOperatorItem(req.adminId, found.event.id, { type: 'song', songId: proposal.songId, title: '', body: '', reference: '', url: '', durationMin: null }, null, 'shared');
      live.setlistChanged(req.adminId, found.event.id, before);
    }
    const settled = proposals.settle(req.adminId, found.event.id, proposal.id, { status: 'added', decidedBy: req.user.id, target, itemId });
    logger.info(`Proposal #${proposal.id} added (${target}, ${position}) by user #${req.user.id} (admin #${req.adminId})`);
    notifications.onProposalDecided(req.adminId, found.event, settled).catch((err) => logger.error('proposal decision notification failed', err));
    res.json({ proposal: settled, ...payload(req, found) });
  }));

  router.post('/api/events/:id/proposals/:pid/decline', asyncRoute(async (req, res) => {
    if (!isEditor(req)) return res.status(403).json({ error: req.t('errors.forbidden') });
    const found = load(req, res);
    if (!found) return;
    const proposal = openProposal(req, res, found);
    if (!proposal) return;
    const settled = proposals.settle(req.adminId, found.event.id, proposal.id, { status: 'declined', decidedBy: req.user.id, note: (req.body || {}).note });
    logger.info(`Proposal #${proposal.id} declined by user #${req.user.id} (admin #${req.adminId})`);
    notifications.onProposalDecided(req.adminId, found.event, settled).catch((err) => logger.error('proposal decision notification failed', err));
    res.json({ proposal: settled, ...payload(req, found) });
  }));

  return router;
}

module.exports = { createProposalsRouter };
