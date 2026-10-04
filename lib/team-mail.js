'use strict';

// Emails for the team notices, to the people the push did not reach ("Trimite programarea",
// "Trimite invitația"): only when email is on and the person has no push subscription.
//   const mail = createTeamMail({ db, config, logger, email, push });
//   await mail.withoutPush(req, userIds, kind, (user, lang, baseUrl) => email.templates.x(lang, vars)) -> emailed count

function createTeamMail({ db, config, logger, email, push }) {
  const selectUser = db.prepare('SELECT id, name, email, locale FROM users WHERE id = ? AND admin_id = ? AND active = 1');

  async function withoutPush(req, userIds, kind, build) {
    if (!email.enabled || !userIds.length) return 0;
    const baseUrl = config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    let emailed = 0;
    for (const userId of userIds) {
      if (push.enabled && push.hasSubscription(req.adminId, userId)) continue;
      const user = selectUser.get(userId, req.adminId);
      if (!user) continue;
      const lang = user.locale === 'en' ? 'en' : 'ro';
      try {
        await email.send(req.adminId, { ...build(user, lang, baseUrl), to: user.email, kind, userId });
        emailed += 1;
      } catch (err) {
        logger.warn(`Email "${kind}" to user #${userId} not sent: ${err.code || err.message}`);
      }
    }
    return emailed;
  }

  return { withoutPush };
}

module.exports = { createTeamMail };
