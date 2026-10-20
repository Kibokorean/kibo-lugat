# KIBO KOREAN — Telegram obuna tekshiruvi (server-side)

Telegram Login Widget olib tashlangan. Telefon raqami so‘ralmaydi. Sayt vaqtinchalik tasdiqlash sessiyasi yaratadi; botdagi `/start <token>` webhook orqali kelgandagina Telegram ID serverda saqlanadi. Server kanal a’zoligini `getChatMember` bilan tekshiradi. Brauzer Telegram ID yoki bot tokenini yubormaydi.

## Vercel Environment Variables

Vercel → Project → Settings → Environment Variables ichida quyidagilarni sozlang (Production va Preview kerak bo‘lsa ikkalasiga ham):

- `TELEGRAM_BOT_TOKEN` — BotFather bergan maxfiy bot tokeni. Faqat server environment’da.
- `TELEGRAM_CHANNEL_USERNAME` — `@kibo_korean`
- `TELEGRAM_WEBHOOK_SECRET` — kamida 32 ta tasodifiy belgidan iborat webhook maxfiy kaliti.
- `KV_REST_API_URL` — Vercel KV/Upstash Redis REST URL.
- `KV_REST_API_TOKEN` — shu Redis bazasining REST tokeni.
- `FIREBASE_API_KEY` — Firebase Web API key (sayt konfiguratsiyasidagi mavjud qiymat bilan bir xil; bu Firebase’ning public client key’i, bot/Redis maxfiy kaliti emas).

Agar Vercel KV o‘rniga Upstash integratsiyasining nomlari ishlatilsa, `UPSTASH_REDIS_REST_URL` va `UPSTASH_REDIS_REST_TOKEN` ham qo‘llab-quvvatlanadi. Bir xil bazaga tegishli URL va tokenni kiriting. Kod Redis REST API’dan foydalanadi, qo‘shimcha npm/framework talab qilmaydi.

Webhook secret yaratish uchun terminalda:
```bash
openssl rand -hex 32
```
Natijani `TELEGRAM_WEBHOOK_SECRET` ga kiriting. Tokenni HTML, repozitoriy, issue yoki loglarga joylamang.

## Bot va kanalni sozlash

1. `@Koreystilida_bot` botini `@kibo_korean` kanaliga **administrator** qilib qo‘shing. A’zolikni tekshirish uchun bot kanalga kirish huquqiga ega bo‘lishi shart.
2. Vercel environment variable’larini saqlang va deploy qiling.
3. Webhook’ni quyidagi buyruq bilan o‘rnating. `YOUR_DOMAIN` o‘rniga `https://www.kibo.uz` (yoki aynan deploy qilingan domen), `YOUR_BOT_TOKEN` va `YOUR_WEBHOOK_SECRET` o‘rniga serverdagi qiymatlarni terminalda qo‘ying. Buyruqni GitHub’ga commit qilmang yoki ommaviy joyda ulashmang:
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  --data '{"url":"https://www.kibo.uz/api/telegram-webhook","secret_token":"YOUR_WEBHOOK_SECRET","allowed_updates":["message"]}'
```
Telegram `{"ok":true,"result":true}` qaytarganini tekshiring. Tekshirish uchun `getWebhookInfo` endpointidan foydalaning; uning URL’i to‘g‘ri ekanini tekshiring, `last_error_message` bo‘lsa tuzating. Tokenni hech qachon brauzerda yoki loglarda ko‘rsatmang.

## Ishlash tartibi

1. Foydalanuvchi Google/Firebase orqali kirgan bo‘lishi kerak.
2. Lug‘at bo‘limini ochganda server UID’ga bog‘langan, 10 daqiqalik sessiya yaratadi.
3. “Telegram orqali tasdiqlash” botni `start` parametri bilan ochadi. Foydalanuvchi botda Start bosadi.
4. Webhook `X-Telegram-Bot-Api-Secret-Token` ni tekshiradi, start tokenni bir martalik iste’mol qiladi va `message.from.id` ni sessiyaga server tomonida bog‘laydi.
5. Server `getChatMember` bilan kanalni tekshiradi. A’zo bo‘lmasa, kanalga a’zo bo‘lib saytdagi “A’zolikni qayta tekshirish” tugmasini bosish kerak.
6. Muvaffaqiyatli sessiya bir marta iste’mol qilinadi. Sessiya 10 daqiqada tugaydi.

## API yo‘llari

- `POST /api/telegram-session` — `create` va `status` amallari; Firebase ID token bilan UID bog‘lanishi serverda tekshiriladi.
- `POST /api/telegram-webhook` — Telegram webhook; maxfiy header tekshiruvi, update deduplikatsiyasi va Redis sessiyasi.

## Deploydan keyingi tekshiruv

- `index.html` da `telegram-widget.js`, `data-request-access`, `onKiboTelegramAuth` yoki eski Telegram login localStorage kaliti yo‘qligini tekshiring.
- Google login, barcha kitoblar/bo‘limlar, flashcard `startDeckStudy`, lug‘at progressi va Firebase progress saqlashni sinang.
- Start bosilmagan sessiyada status `waiting` bo‘lib qolishi kerak.
- Kanalga a’zo bo‘lmagan hisob lug‘atni ochmasligi kerak; kanalga a’zo bo‘lgach qayta tekshiruvdan keyin ochilishi kerak.
- Har xil Google hisoblari bilan ikkita parallel sessiya yarating; sessiyalar almashmasligini tekshiring.
- Vercel Function logs’da tokenlar yoki Telegram ID yozilmasligini tekshiring.

Eslatma: deploy qilish va haqiqiy Telegram bot/webhook/Redis environment’lari ushbu manba arxivining ichidan bajarilmaydi. Vercel va BotFather sozlamalarini yuqoridagi amallar bilan bajarish zarur.
