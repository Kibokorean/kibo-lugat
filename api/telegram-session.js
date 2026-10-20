const crypto = require('crypto');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL_USERNAME || '@kibo_korean';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyC0etf5lvsRa5wd0rlqllzNNmMpUerj3sk';
const TTL = 10 * 60;
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
function send(res, code, data) { res.setHeader('Cache-Control','no-store, private'); res.setHeader('Pragma','no-cache'); return res.status(code).json(data); }
function randomToken(bytes=32) { return crypto.randomBytes(bytes).toString('base64url'); }
async function redis(...args) {
  if (!redisUrl || !redisToken) throw new Error('Redis serverda sozlanmagan.');
  const r = await fetch(redisUrl.replace(/\/$/,''), {method:'POST', headers:{Authorization:`Bearer ${redisToken}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
  if (!r.ok) throw new Error('Redis so‘rovi bajarilmadi.');
  const d = await r.json(); if (d.error) throw new Error('Redis so‘rovi bajarilmadi.'); return d.result;
}
async function get(key) { const x=await redis('GET',key); if(!x)return null; try{return JSON.parse(x)}catch{return null;} }
async function put(key,value,ttl=TTL) { return redis('SET',key,JSON.stringify(value),'EX',ttl); }
async function firebaseUser(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 10000) return null;
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})});
  if(!r.ok)return null; const d=await r.json(); const u=d.users&&d.users[0];
  return u && u.localId ? {uid:u.localId, disabled:u.disabled===true} : null;
}
async function membership(telegramId) {
  if(!BOT_TOKEN) throw new Error('Telegram bot serverda sozlanmagan.');
  const url=`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${encodeURIComponent(String(telegramId))}`;
  const r=await fetch(url); const d=await r.json();
  if(!r.ok||!d.ok||!d.result) throw new Error('Kanal a’zoligini tekshirib bo‘lmadi. Bot kanal administratori ekanini tekshiring.');
  const m=d.result; return ['creator','administrator','member'].includes(m.status)||(m.status==='restricted'&&m.is_member===true);
}
module.exports = async function handler(req,res) {
 if(req.method!=='POST') return send(res,405,{ok:false,error:'POST so‘rovi kerak.'});
 try {
  const body=req.body||{}, action=body.action;
  if(action==='create') {
   const user=await firebaseUser(body.idToken);
   if(!user||user.disabled)return send(res,401,{ok:false,error:'Avval Google orqali hisobingizga kiring.'});
   const sessionId=randomToken(24), startToken=randomToken(32);
   const session={uid:user.uid,createdAt:Date.now(),status:'waiting',telegramId:null};
   await put(`kibo:tg:session:${sessionId}`,session);
   await put(`kibo:tg:start:${startToken}`,{sessionId},TTL);
   return send(res,200,{ok:true,sessionId,startToken,expiresIn:TTL});
  }
  if(action==='status') {
   const user=await firebaseUser(body.idToken);
   if(!user||user.disabled)return send(res,401,{ok:false,error:'Google hisobingiz muddati tugagan. Qayta kiring.'});
   if(typeof body.sessionId!=='string'||!/^[A-Za-z0-9_-]{30,50}$/.test(body.sessionId))return send(res,400,{ok:false,error:'Tasdiqlash sessiyasi noto‘g‘ri. Qaytadan boshlang.'});
   const key=`kibo:tg:session:${body.sessionId}`;
   const usedKey=`kibo:tg:used:${body.sessionId}`;
   const session=await get(key);
   // A successful approval may be received by another poll before the browser handles it.
   // Keep approval idempotent so a lost response or parallel tab cannot turn it into 410.
   if(!session){
    const prior=await get(usedKey);
    if(prior&&prior.uid===user.uid)return send(res,200,{ok:true,status:'approved',subscribed:true});
    return send(res,200,{ok:true,status:'expired',subscribed:false,error:'Tasdiqlash sessiyasi tugagan. Qaytadan boshlang.'});
   }
   if(session.uid!==user.uid)return send(res,403,{ok:false,error:'Bu tasdiqlash sessiyasi boshqa hisobga tegishli.'});
   if(Date.now()-session.createdAt>TTL*1000){
    const prior=await get(usedKey);
    if(prior&&prior.uid===user.uid)return send(res,200,{ok:true,status:'approved',subscribed:true});
    return send(res,200,{ok:true,status:'expired',subscribed:false,error:'Tasdiqlash sessiyasi tugagan. Qaytadan boshlang.'});
   }
   if(!session.telegramId)return send(res,200,{ok:true,status:'waiting',subscribed:false});
   let subscribed=session.subscribed===true;
   if(body.checkMembership===true) {
    try{subscribed=await membership(session.telegramId);}catch(e){return send(res,503,{ok:false,error:e.message||'A’zolikni tekshirib bo‘lmadi.'});}
    session.subscribed=subscribed;session.status=subscribed?'approved':'not_subscribed';await put(key,session,Math.max(1,TTL-Math.floor((Date.now()-session.createdAt)/1000)));
   }
   if(subscribed) {
    // Store who owns the approval and preserve it for repeated polls until TTL expires.
    const claimed=await redis('SET',usedKey,JSON.stringify({uid:user.uid,approvedAt:Date.now()}),'EX',TTL,'NX');
    if(claimed!=='OK'){
     const prior=await get(usedKey);
     if(!prior||prior.uid!==user.uid)return send(res,409,{ok:false,error:'Bu tasdiqlash boshqa hisobda ishlatilgan. Yangi sessiya boshlang.'});
    }
    session.subscribed=true; session.status='approved';
    await put(key,session,Math.max(1,TTL-Math.floor((Date.now()-session.createdAt)/1000)));
    return send(res,200,{ok:true,status:'approved',subscribed:true,pending:session.pending||null});
   }
   return send(res,200,{ok:true,status:session.status==='not_subscribed'?'not_subscribed':'waiting',subscribed:false});
  }
  return send(res,400,{ok:false,error:'Noma’lum so‘rov.'});
 } catch(e) { console.error('Telegram session endpoint error:',e.message); return send(res,500,{ok:false,error:'Serverda vaqtinchalik xatolik. Keyinroq qayta urinib ko‘ring.'}); }
};
