const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_USERNAME = process.env.TELEGRAM_CHANNEL_USERNAME || '@kibo_korean';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyC0etf5lvsRa5wd0rlqllzNNmMpUerj3sk';

function send(res, status, body) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(body);
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyTelegramAuth(data) {
  if (!BOT_TOKEN || !data || typeof data !== 'object' || !data.hash || !data.id || !data.auth_date) return false;
  const fields = Object.keys(data).filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(fields).digest('hex');
  if (!safeEqual(expected, data.hash)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(data.auth_date);
  return Number.isFinite(ageSeconds) && ageSeconds >= -60 && ageSeconds <= 60 * 60 * 24 * 30;
}

async function checkFirebaseToken(idToken) {
  if (!idToken) return false;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  if (!response.ok) return false;
  const data = await response.json();
  return Array.isArray(data.users) && data.users.length > 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST so‘rovi kerak.' });
  if (!BOT_TOKEN) return send(res, 503, { ok: false, error: 'Telegram bot tokeni serverda sozlanmagan.' });
  try {
    const body = req.body || {};
    const idToken = body.idToken;
    const telegram = body.telegram;
    if (!(await checkFirebaseToken(idToken))) return send(res, 401, { ok: false, error: 'Google hisobingizga qayta kiring.' });
    if (!verifyTelegramAuth(telegram)) return send(res, 400, { ok: false, error: 'Telegram hisobini ulang yoki Telegram orqali qayta tasdiqlang.', needsTelegramLogin: true });

    const chatMemberResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(CHANNEL_USERNAME)}&user_id=${encodeURIComponent(telegram.id)}`);
    const chatMember = await chatMemberResponse.json();
    if (!chatMemberResponse.ok || !chatMember.ok) {
      return send(res, 502, { ok: false, error: 'Telegram obunasini tekshirib bo‘lmadi. Bot kanal administratori ekanini va kanal username’ini tekshiring.' });
    }
    const status = chatMember.result && chatMember.result.status;
    const subscribed = ['creator', 'administrator', 'member'].includes(status) || (status === 'restricted' && chatMember.result.is_member === true);
    return send(res, 200, { ok: true, subscribed, status: subscribed ? 'subscribed' : 'not_subscribed', channel: CHANNEL_USERNAME });
  } catch (error) {
    console.error('Telegram subscription check failed:', error);
    return send(res, 500, { ok: false, error: 'Obunani tekshirishda server xatosi yuz berdi.' });
  }
};
