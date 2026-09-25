'use strict';

const express = require('express');

const EDITOR_ROLES = ['owner', 'leader'];

function createPagesRouter({ db, auth, sendPage }) {
  const router = express.Router();
  const selectAnyAdmin = db.prepare('SELECT 1 FROM admins LIMIT 1');
  const hasAdmin = () => selectAnyAdmin.get() !== undefined;

  // Page responses depend on the session, so never cache them.
  const noStore = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  router.get('/', noStore, (req, res) => {
    if (!hasAdmin()) return res.redirect('/setup');
    res.redirect(auth.getSession(req) ? '/app' : '/login');
  });

  router.get('/login', noStore, (req, res) => {
    if (!hasAdmin()) return res.redirect('/setup');
    if (auth.getSession(req)) return res.redirect('/app');
    sendPage(req, res, 'login');
  });

  router.get('/app', noStore, (req, res) => {
    if (!auth.getSession(req)) return res.redirect('/login');
    sendPage(req, res, 'app');
  });

  // Signed-in pages. Editing pages are only served to roles that may edit;
  // the API enforces the same rules.
  const signedIn = (req, res, next) => {
    req.session = auth.getSession(req);
    if (!req.session) return res.redirect('/login');
    next();
  };
  const canEdit = (req) => EDITOR_ROLES.includes(req.session.user.role);

  router.get('/library', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'library');
  });

  router.get('/events', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'events');
  });

  // The API decides what the user may see; the edit page is only served to editors.
  router.get('/events/:id(\\d+)', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'event');
  });

  router.get('/events/:id(\\d+)/rehearse', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'rehearse');
  });

  // Team phones follow the live position; the live room decides what the user may see.
  router.get('/events/:id(\\d+)/follow', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'follow');
  });

  // Live control: owner and leader only; the team follows the event page instead.
  router.get('/events/:id(\\d+)/live', noStore, signedIn, (req, res) => {
    if (!canEdit(req)) return res.redirect(`/events/${req.params.id}`);
    sendPage(req, res, 'live');
  });

  router.get('/events/:id(\\d+)/edit', noStore, signedIn, (req, res) => {
    if (!canEdit(req)) return res.redirect(`/events/${req.params.id}`);
    sendPage(req, res, 'event');
  });

  router.get('/songs/new', noStore, signedIn, (req, res) => {
    if (!canEdit(req)) return res.redirect('/library');
    sendPage(req, res, 'song-edit');
  });

  router.get('/songs/:id(\\d+)', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'song');
  });

  router.get('/songs/:id(\\d+)/edit', noStore, signedIn, (req, res) => {
    if (!canEdit(req)) return res.redirect(`/songs/${req.params.id}`);
    sendPage(req, res, 'song-edit');
  });

  return router;
}

module.exports = createPagesRouter;
