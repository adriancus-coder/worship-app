'use strict';

const express = require('express');

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

  return router;
}

module.exports = createPagesRouter;
