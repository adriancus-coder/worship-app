'use strict';

const path = require('path');
const express = require('express');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createPagesRouter({ db, auth }) {
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
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  });

  router.get('/app', noStore, (req, res) => {
    if (!auth.getSession(req)) return res.redirect('/login');
    res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
  });

  return router;
}

module.exports = createPagesRouter;
