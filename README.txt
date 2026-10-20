KIBO Lug‘at website files. Upload index.html and favicon.ico together to the root of the GitHub repository.

Telegram majburiy obuna tekshiruvi (Vercel)
1. Vercel Project Settings > Environment Variables ichida TELEGRAM_BOT_TOKEN nomli maxfiy o‘zgaruvchini yarating va @BotFather bergan bot tokenini qiymat sifatida kiriting. Tokenni HTML, GitHub commit yoki chatga joylamang.
2. TELEGRAM_CHANNEL_USERNAME qiymatini @kibo_korean qilib belgilang.
3. FIREBASE_API_KEY ixtiyoriy: agar kibo-lugat Firebase loyihasining API key’i o‘zgarsa, uni ham server environment variable sifatida kiriting.
4. BotFather ichida /setdomain buyrug‘i orqali bot uchun kibo.uz domenini belgilang (Telegram Login Widget domen tekshiruvi uchun).
5. Bot @kibo_korean kanalida administrator bo‘lib qolishi kerak. U kanal a’zoligini tekshirishga yetarli ruxsatga ega bo‘lsin.
6. Ushbu loyihani Vercel’ga deploy qiling. API endpoint /api/telegram-subscription orqali ishlaydi. So‘ng Google hisob bilan kirib, yodlashni boshlaganda Telegram hisobini widget orqali bir marta tasdiqlang.

Eslatma: bot tokeni ataylab loyihaga kiritilmagan. Environment variable sozlanmaguncha API tekshiruvni muvaffaqiyatli bajarmaydi.
