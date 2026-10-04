'use strict';

// `npm run vapid`: prints a fresh VAPID key pair for web push (docs/PUSH.md). Put the three
// lines in the environment (Render: the service's Environment tab; locally: .env).
const { generateVapidKeys } = require('../lib/push');

const keys = generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:admin@example.org\n`);
