const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const CHANNEL = process.env.TELEGRAM_CHANNEL_USERNAME || '@kibo_korean';
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...args) {
  if (!redisUrl || !redisToken) throw new Error('Redis not configured');
  const r = await fetch(redisUrl.replace(/\/+$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`Redis request failed (${r.status})`);
  const d = await r.json();
  if (d.error) throw new Error('Redis command failed');
  return d.result;
}

async function get(key) {
  const value = await redis('GET', key);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function put(key, value, ttl) {
  return redis('SET', key, JSON.stringify(value), 'EX', ttl);
}

async function member(id) {
  if (!BOT_TOKEN) throw new Error('Telegram bot token is not configured');
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember` +
    `?chat_id=${encodeURIComponent(CHANNEL)}` +
    `&user_id=${encodeURIComponent(String(id))}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || !data.ok || !data.result) throw new Error('membership unavailable');
  const status = data.result.status;
  return ['creator', 'administrator', 'member'].includes(status) ||
    (status === 'restricted' && data.result.is_member === true);
}

async function reply(chatId, text) {
  if (!BOT_TOKEN) return;
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) console.error('Telegram sendMessage failed:', response.status);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  if (!BOT_TOKEN || !WEBHOOK_SECRET || !redisUrl || !redisToken) {
    return res.status(503).send('Webhook not configured');
  }

  const supplied = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof supplied !== 'string' ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(WEBHOOK_SECRET) ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(WEBHOOK_SECRET))) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const update = req.body || {};
    if (update.update_id !== undefined) {
      const fresh = await redis('SET', `kibo:tg:update:${update.update_id}`, '1', 'EX', 86400, 'NX');
      if (fresh !== 'OK') return res.status(200).send('OK');
    }

    const msg = update.message;
    if (msg && msg.chat && msg.from && msg.chat.type === 'private' &&
        String(msg.chat.id) === String(msg.from.id) && typeof msg.text === 'string') {
      // Supports /start TOKEN and /start@botname TOKEN.
      const match = msg.text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{30,50}))?\s*$/i);

      if (match && match[1]) {
        const startToken = match[1];
        const startKey = `kibo:tg:start:${startToken}`;
        const mapped = await get(startKey);

        if (!mapped || !mapped.sessionId) {
          await reply(msg.chat.id, 'Bu tasdiqlash havolasi yaroqsiz yoki muddati tugagan. Saytga qayting va yangi tasdiqlashni boshlang.');
        } else {
          const key = `kibo:tg:session:${mapped.sessionId}`;
          const session = await get(key);
          if (!session || Date.now() - session.createdAt > 600000) {
            await redis('DEL', startKey);
            await reply(msg.chat.id, 'Tasdiqlash sessiyasi muddati tugagan. Saytda qaytadan boshlang.');
          } else {
            session.telegramId = String(msg.from.id);
            session.startedAt = Date.now();
            try {
              session.subscribed = await member(msg.from.id);
              session.membershipError = false;
              session.status = session.subscribed ? 'approved' : 'not_subscribed';
            } catch (error) {
              session.subscribed = false;
              session.status = 'not_subscribed';
              session.membershipError = true;
              console.error('Telegram membership check failed:', error.message);
            }
            const ttl = Math.max(1, 600 - Math.floor((Date.now() - session.createdAt) / 1000));
            await put(key, session, ttl);
            await redis('DEL', startKey);
            if (session.subscribed) {
              await reply(msg.chat.id, 'Telegram hisobingiz tasdiqlandi va @kibo_korean kanaliga a’zoligingiz aniqlandi. Saytga qayting — lug‘at ochiladi.');
            } else {
              await reply(msg.chat.id, 'Telegram hisobingiz bog‘landi, ammo @kibo_korean kanaliga a’zolik tasdiqlanmadi. Kanalga a’zo bo‘ling, so‘ng saytdagi “A’zolikni qayta tekshirish” tugmasini bosing.');
            }
          }
        }
      } else if (/^\/start(?:@\w+)?\s*$/i.test(msg.text)) {
        await reply(msg.chat.id, 'KIBO KOREAN saytidagi “Telegram orqali tasdiqlash” tugmasi orqali boshlang. Telefon raqami kerak emas.');
      }
    }
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Telegram webhook error:', error.message);
    return res.status(500).send('Webhook error');
  }
};
