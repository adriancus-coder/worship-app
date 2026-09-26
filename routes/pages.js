'use strict';

const express = require('express');
const { EVENT_ROLES, EDITOR_ROLES, SCREEN_ROLES } = require('../lib/events');

// Library, media and screens pages: owner and leader.

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


  // The projector screen: no user session (it pairs with a code or a claim link).
  router.get('/screen', noStore, (req, res) => {
    sendPage(req, res, 'screen');
  });

  // The email links: no session needed (the token decides; the page signs the person in).
  router.get(['/invite/:token', '/reset/:token'], noStore, (req, res) => {
    sendPage(req, res, 'invite');
  });

  // Help for an internet outage during a service: no session needed (nothing private).
  router.get('/help/emergency', (req, res) => {
    sendPage(req, res, 'help-emergency');
  });

  // Signed-in pages. Editing pages are only served to roles that may edit;
  // the API enforces the same rules.
  // A temporary password must be changed first: every page leads to /change-password.
  const signedIn = (req, res, next) => {
    req.session = auth.getSession(req);
    if (!req.session) return res.redirect('/login');
    if (req.session.user.mustChangePassword && req.path !== '/change-password') return res.redirect('/change-password');
    next();
  };

  router.get('/app', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'app');
  });

  // Forced after a temporary password; later from "Mai mult" → "Schimbă parola".
  router.get('/change-password', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'change-password');
  });
  const canEdit = (req) => EDITOR_ROLES.includes(req.session.user.role);
  const eventRights = (req) => EVENT_ROLES.includes(req.session.user.role);

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

  // Rehearsal is the musical team's: the operator is sent to the event page.
  router.get('/events/:id(\\d+)/rehearse', noStore, signedIn, (req, res) => {
    if (req.session.user.role === 'operator') return res.redirect(`/events/${req.params.id}`);
    sendPage(req, res, 'rehearse');
  });

  // Team phones follow the live position; the live room decides what the user may see.
  router.get('/events/:id(\\d+)/follow', noStore, signedIn, (req, res) => {
    sendPage(req, res, 'follow');
  });

  // Live control: the event roles; the team follows the event page instead.
  router.get('/events/:id(\\d+)/live', noStore, signedIn, (req, res) => {
    if (!eventRights(req)) return res.redirect(`/events/${req.params.id}`);
    sendPage(req, res, 'live');
  });

  // Operator console: the owner and the operator (SCREEN_ROLES). The presenter and the leader
  // are sent to their live page; the team follows the event instead.
  router.get('/events/:id(\\d+)/operator', noStore, signedIn, (req, res) => {
    if (!eventRights(req)) return res.redirect(`/events/${req.params.id}`);
    if (!SCREEN_ROLES.includes(req.session.user.role)) return res.redirect(`/events/${req.params.id}/live`);
    sendPage(req, res, 'operator');
  });

  router.get('/events/:id(\\d+)/edit', noStore, signedIn, (req, res) => {
    if (!eventRights(req)) return res.redirect(`/events/${req.params.id}`);
    sendPage(req, res, 'event');
  });

  // Projector screens: pairing and management (owner / operator).
  router.get('/screens', noStore, signedIn, (req, res) => {
    if (!SCREEN_ROLES.includes(req.session.user.role)) return res.redirect('/app');
    sendPage(req, res, 'screens');
  });

  // Media library (videos for the projector): owner and leader.
  router.get('/media', noStore, signedIn, (req, res) => {
    if (!canEdit(req)) return res.redirect('/app');
    sendPage(req, res, 'media');
  });

  // The team (accounts, roles, temporary passwords): owner only.
  router.get('/team', noStore, signedIn, (req, res) => {
    if (req.session.user.role !== 'owner') return res.redirect('/app');
    sendPage(req, res, 'team');
  });

  // The platform page (churches on this server): the platform owner only.
  router.get('/platform', noStore, signedIn, (req, res) => {
    if (!req.session.platformOwner) return res.redirect('/app');
    sendPage(req, res, 'platform');
  });
  // One church on the platform page (its counts, team and screens).
  router.get('/platform/:id(\\d+)', noStore, signedIn, (req, res) => {
    if (!req.session.platformOwner) return res.redirect('/app');
    sendPage(req, res, 'platform-church');
  });

  // Admin settings (the church logo): owner only.
  router.get('/settings', noStore, signedIn, (req, res) => {
    if (req.session.user.role !== 'owner') return res.redirect('/app');
    sendPage(req, res, 'settings');
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
