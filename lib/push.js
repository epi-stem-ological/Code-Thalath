'use strict';

const webpush = require('web-push');
const { db, setting, setSetting } = require('./db');

let keys = null;

function getKeys() {
  if (keys) return keys;
  let pub = process.env.VAPID_PUBLIC_KEY || setting('vapid_public');
  let priv = process.env.VAPID_PRIVATE_KEY || setting('vapid_private');
  if (!pub || !priv) {
    const generated = webpush.generateVAPIDKeys();
    pub = generated.publicKey;
    priv = generated.privateKey;
    setSetting('vapid_public', pub);
    setSetting('vapid_private', priv);
  }
  const subject = process.env.VAPID_SUBJECT || 'mailto:tom@thalath.space';
  webpush.setVapidDetails(subject, pub, priv);
  keys = { publicKey: pub, privateKey: priv };
  return keys;
}

const listSubs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?');
const dropSub = db.prepare('DELETE FROM push_subs WHERE id = ?');

async function sendToUser(userId, payload) {
  const { publicKey } = getKeys();
  if (!publicKey) return;
  const subs = listSubs.all(userId);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 3600 }
        );
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) dropSub.run(s.id);
      }
    })
  );
}

module.exports = { getKeys, sendToUser };
