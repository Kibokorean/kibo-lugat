const crypto = require('crypto');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const CHANNEL = process.env.TELEGRAM_CHANNEL_USERNAME || '@kibo_korean';
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...args) {
 if(!redisUrl||!redisToken)throw new Error('Redis not configured');
 const r=await fetch(redisUrl.replace(/\/$/,''),{method:'POST',headers:{Authorization:`Bearer ${redisToken}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
 if(!r.ok)throw new Error('Redis request failed');const d=await r.json();if(d.error)throw new Error('Redis command failed');return d.result;
}
async function get(key){const x=await redis('GET',key);if(!x)return null;try{return JSON.parse(x)}catch{return null}}
async function put(key,v,ttl){return redis('SET',key,JSON.stringify(v),'EX',ttl)}
async function member(id){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${encodeURIComponent(String(id))}`);const d=await r.json();if(!r.ok||!d.ok||!d.result)throw new Error('membership unavailable');const m=d.result;return ['creator','administrator','member'].includes(m.status)||(m.status==='restricted'&&m.is_member===true)}
async function reply(chatId,text,keyboard){
 const payload={chat_id:chatId,text,disable_web_page_preview:true};
 if(keyboard)payload.reply_markup={inline_keyboard:keyboard};
 await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
}
module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).send('Method not allowed');
 if(!BOT_TOKEN||!WEBHOOK_SECRET||!redisUrl||!redisToken)return res.status(503).send('Webhook not configured');
 const supplied=req.headers['x-telegram-bot-api-secret-token'];
 if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(WEBHOOK_SECRET)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(WEBHOOK_SECRET)))return res.status(401).send('Unauthorized');
 try{
  const update=req.body||{};
  if(update.update_id!==undefined){const fresh=await redis('SET',`kibo:tg:update:${update.update_id}`,'1','EX',86400,'NX');if(fresh!=='OK')return res.status(200).send('OK');}
  const msg=update.message;
  if(msg&&msg.chat&&msg.from&&msg.chat.type==='private'&&String(msg.chat.id)===String(msg.from.id)&&typeof msg.text==='string'){
   const match=msg.text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{30,50}))?\s*$/);
   if(match&&match[1]){
    const startKey=`kibo:tg:start:${match[1]}`, mapped=await get(startKey);
    if(!mapped){await reply(msg.chat.id,'Bu tasdiqlash havolasi yaroqsiz yoki muddati tugagan. Saytga qayting va yangi tasdiqlashni boshlang.');}
    else{
     const key=`kibo:tg:session:${mapped.sessionId}`,session=await get(key);
     if(!session||Date.now()-session.createdAt>600000){await redis('DEL',startKey);await reply(msg.chat.id,'Tasdiqlash sessiyasi muddati tugagan. Saytda qaytadan boshlang.');}
     else{
      session.telegramId=String(msg.from.id);session.startedAt=Date.now();
      try{session.subscribed=await member(msg.from.id);session.status=session.subscribed?'approved':'not_subscribed';}
      catch(e){session.subscribed=false;session.status='not_subscribed';session.membershipError=true;}
      await put(key,session,Math.max(1,600-Math.floor((Date.now()-session.createdAt)/1000)));
      await redis('DEL',startKey);
      if(session.subscribed)await reply(msg.chat.id,'Telegram hisobingiz tasdiqlandi va @kibo_korean kanaliga a’zoligingiz aniqlandi. Quyidagi tugma orqali saytga qayting. Saytda tasdiqlash avtomatik yakunlanadi.',[[{text:'🌐 Saytga qaytish',url:'https://www.kibo.uz/?telegram_return=1&tg_session='+encodeURIComponent(mapped.sessionId)}]]);
      else await reply(msg.chat.id,'Telegram hisobingiz tasdiqlandi, ammo @kibo_korean kanaliga a’zolik topilmadi. Kanalga a’zo bo‘ling, so‘ng saytdagi “A’zolikni qayta tekshirish” tugmasini bosing.',[[{text:'📢 Kanalga a’zo bo‘lish',url:'https://t.me/kibo_korean'},{text:'🌐 Saytga qaytish',url:'https://www.kibo.uz/?telegram_return=1&tg_session='+encodeURIComponent(mapped.sessionId)}]]);
     }
    }
   } else if(/^\/start(?:@\w+)?\s*$/.test(msg.text)) await reply(msg.chat.id,'KIBO KOREAN saytidagi “Telegram orqali tasdiqlash” tugmasi orqali boshlang. Telefon raqami kerak emas.');
  }
  return res.status(200).send('OK');
 }catch(e){console.error('Telegram webhook error:',e.message);return res.status(500).send('Webhook error');}
};
