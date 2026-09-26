'use strict';

// Outgoing email through the Resend HTTP API (no SDK: one fetch). OPTIONAL: without
// RESEND_API_KEY or EMAIL_FROM email is disabled - every email feature hides its buttons and
// the API answers 503 { code: 'emailDisabled' }; the app works exactly as without email.
//
//   const email = createEmail({ config, logger, fetch? })
//   email.enabled, email.status()                 -> { enabled, from }
//   await email.send(adminId, { to, subject, text, html, kind })   // throws EmailError
//   email.templates.test / invite / reset(lang, vars) -> { subject, text, html }
//
// Rules: 20 emails an hour per admin (church); one retry on a 5xx; an audit line per send
// (who, what kind, to whom - never a token or a link); RO / EN templates: plain text plus a
// minimal HTML with the app name and the church name.

const { t } = require('./i18n');
const { createRequestLimiter } = require('./rate-limit');

const DEFAULT_API_URL = 'https://api.resend.com/emails';
const PER_ADMIN_PER_HOUR = 20;
const TIMEOUT_MS = 10000;

class EmailError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code; // emailDisabled | emailRateLimited | emailFailed
    this.detail = detail;
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The minimal HTML: the app name, the church name, paragraphs, an optional button + the
// same link as text (mail clients that drop buttons), a footer note.
function html({ appName, churchName, heading, paragraphs, button, footer }) {
  const parts = paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#1b1a1f">${escapeHtml(p)}</p>`);
  const cta = button ? `<p style="margin:20px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 20px;background:#6d4aff;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#5a5866;word-break:break-all">${escapeHtml(button.url)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f3f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6d4aff">${escapeHtml(appName)}</p>
<p style="margin:0 0 16px;font-size:14px;color:#5a5866">${escapeHtml(churchName)}</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#1b1a1f">${escapeHtml(heading)}</h1>
${parts.join('\n')}
${cta}
${footer ? `<p style="margin:20px 0 0;font-size:13px;color:#5a5866">${escapeHtml(footer)}</p>` : ''}
</div></body></html>`;
}

// vars: { appName, churchName, url?, invitedBy?, expiresIn?, email? }
function template(kind, lang, vars) {
  const tr = (key, more) => t(`email.${kind}.${key}`, { ...vars, ...more }, lang);
  const paragraphs = [tr('p1'), tr('p2')].filter((p) => p && !/^email\./.test(p));
  const button = vars.url ? { url: vars.url, label: tr('button') } : null;
  const footer = t(`email.${kind}.footer`, vars, lang);
  const text = [
    `${vars.appName} · ${vars.churchName}`,
    '',
    tr('heading'),
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    footer && !/^email\./.test(footer) ? footer : '',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    subject: tr('subject'),
    text,
    html: html({ appName: vars.appName, churchName: vars.churchName, heading: tr('heading'), paragraphs, button, footer: /^email\./.test(footer) ? '' : footer }),
  };
}

function createEmail({ config, logger, fetch: doFetch = globalThis.fetch }) {
  const apiKey = config.RESEND_API_KEY || '';
  const from = config.EMAIL_FROM || '';
  const replyTo = config.EMAIL_REPLY_TO || '';
  const apiUrl = config.EMAIL_API_URL || DEFAULT_API_URL;
  const enabled = Boolean(apiKey && from);
  const limiter = createRequestLimiter({ maxRequests: PER_ADMIN_PER_HOUR, windowMs: 60 * 60 * 1000 });

  async function post(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await doFetch(apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // Sends one email for an admin. kind: 'test' | 'invite' | 'reset' (the audit line);
  // userId (optional): whose email it is. Resolves with the provider's id.
  async function send(adminId, { to, subject, text, html: body, kind = 'email', userId = null }) {
    if (!enabled) throw new EmailError('emailDisabled');
    const retryAfter = limiter.take(`admin:${adminId}`);
    if (retryAfter > 0) throw new EmailError('emailRateLimited', retryAfter);
    const payload = { from, to: [to], subject, text, html: body, ...(replyTo ? { reply_to: replyTo } : {}) };
    let res;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await post(payload);
      } catch (err) {
        lastError = err;
        res = null;
      }
      if (res && res.status < 500) break; // a 5xx (or a network error) is tried once more
    }
    if (!res || !res.ok) {
      const detail = res ? `${res.status} ${await res.text().catch(() => '')}`.trim() : (lastError && lastError.message) || 'network';
      logger.warn(`Email "${kind}" to ${to} (admin #${adminId}) failed: ${detail.slice(0, 200)}`);
      throw new EmailError('emailFailed', detail);
    }
    const out = await res.json().catch(() => ({}));
    logger.info(`Email "${kind}" sent to ${to}${userId ? ` (user #${userId})` : ''} (admin #${adminId}, id ${out.id || '?'})`);
    return out.id || null;
  }

  return {
    enabled,
    status: () => ({ enabled, from: enabled ? from : null }),
    send,
    templates: {
      test: (lang, vars) => template('test', lang, vars),
      invite: (lang, vars) => template('invite', lang, vars),
      reset: (lang, vars) => template('reset', lang, vars),
    },
  };
}

module.exports = { EmailError, PER_ADMIN_PER_HOUR, DEFAULT_API_URL, template, createEmail };
