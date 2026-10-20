# KIBO KOREAN — 10 000 ta bir martalik kod

Eski vaqtinchalik Telegram sessiyasi tasdiqlash tizimi olib tashlandi. Yangi oqim: foydalanuvchi Google orqali kiradi; so‘z yodlashga kirganda kod oynasi chiqadi; Telegram bot kanalga a’zolikni tekshiradi va har bir Telegram foydalanuvchisiga bitta kod beradi; kod saytga kiritilgach, Redis bazasida Google UID bilan bog‘lanadi. Bir kod faqat bitta Google hisobida ishlaydi, faollashgan hisob qayta kod kiritmaydi.

## Deploydan oldin 10 000 kodni bazaga joylash

1. Vercel Environment Variables’da `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_CHANNEL_USERNAME=@kibo_korean`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `FIREBASE_API_KEY` mavjudligini tekshiring.
2. Loyihani kompyuteringizga yuklab, Node.js 18+ bilan terminal oching.
3. Seed skripti 10 000 ta noyob kodni o‘zi yaratib, Redis bazasiga joylaydi. Kodlar fayl yoki ommaviy repozitoriyga yozilmaydi:

```powershell
$env:KV_REST_API_URL="https://YOUR-UPSTASH-URL"
$env:KV_REST_API_TOKEN="YOUR-UPSTASH-TOKEN"
node scripts/seed-access-codes.js
```

Skript `kibo:codes:all` to‘plamiga va `kibo:codes:available` navbatiga kodlarni joylaydi. Muvaffaqiyatli bajarilgach, qayta ishga tushirilsa kodlarni takroran yaratmaydi. Seed qilinmaguncha bot kod bera olmaydi.

## Telegram sozlamasi

- `@Koreystilida_bot` botini `@kibo_korean` kanaliga administrator qilib qo‘shing.
- Webhook URL `https://www.kibo.uz/api/telegram-webhook` bo‘lishi kerak; `secret_token` qiymati `TELEGRAM_WEBHOOK_SECRET` bilan bir xil bo‘lsin.
- Bot `/start` bosilganda a’zolikni tekshiradi. Obuna bo‘lmagan foydalanuvchiga kanal havolasini beradi; a’zo bo‘lgach `🔑 Kod olish` tugmasini bosadi.

## API

- `POST /api/access-code` — Firebase ID token orqali `status` yoki `redeem`.
- `POST /api/telegram-webhook` — Telegram update’larini qabul qiladi, kanal a’zoligini tekshiradi va navbatdan kod beradi.
- Eski `/api/telegram-session` sessiya API olib tashlangan.

## Xavfsizlik

Bot tokeni va Redis tokenini hech qachon HTML, GitHub yoki chatga qo‘ymang. Kodlar faqat Redis bazasida saqlanadi; bot kodni navbatdan oladi. Kodlarning amaldagi egasi va ishlatilganligi Redis’da tekshiriladi.
