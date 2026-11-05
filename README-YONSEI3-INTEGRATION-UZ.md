# KIBO KOREAN — Yonsei 3 integratsiyasi

Ushbu loyiha yuklangan amaldagi KIBO KOREAN saytiga Yonsei 3 kursi va ko‘p rasmli diktant topshirish tizimi birlashtirilgan versiyadir.

## Nimalar birlashtirildi
- Asosiy `index.html` saqlangan; Yonsei 3 kursi saytdagi yangi **Kurs** menyusiga ulangan.
- Mavjud lug‘at, takrorlash, Firebase Auth, statistika, profil va o‘qituvchi kabineti kodlari asos sifatida qoldirilgan.
- Yonsei 3 uchun Firebase Storage va Callable Functions compat SDK qo‘shilgan.
- O‘qituvchi kabinetiga Yonsei 3 diktant tekshiruv navbati qo‘shilgan.
- Bir mavzu uchun tanlangan barcha JPG/PNG/WEBP rasmlar bitta topshiriq sifatida yuboriladi.
- Ilova kodida rasm soni yoki fayl hajmi uchun maxsus limit qo‘yilmagan. Firebase, brauzer, tarmoq va hisob kvotalari kabi platforma cheklovlari baribir amal qiladi.
- Yuklash muvaffaqiyatsiz bo‘lsa, server faqat topshirilmagan va hech qaysi urinishga bog‘lanmagan batch fayllarini tozalashi mumkin.

## Fayllar
- `index.html` — saytning integratsiyalangan asosiy sahifasi.
- `functions/` — Yonsei 3 test, diktant, o‘qituvchi tekshiruvi va server funksiyalari.
- `firestore.rules` — mavjud Firestore qoidalariga Yonsei 3 qoidalari qo‘shilgan.
- `firestore.indexes.json` — Yonsei 3 so‘rovlari uchun indekslar.
- `firebase.json` va `.firebaserc` — Cloud Functions / Firestore deploy konfiguratsiyasi.
- `storage-dictation-rules-snippet.rules` — amaldagi Storage qoidalariga qo‘shilishi kerak bo‘lgan qoida bo‘lagi.

## Muhim: Firebase Storage qoidalari
`firebase.json` ichiga Storage deploy sozlamasi ataylab kiritilmadi. Sababi, amaldagi Firebase loyihasida boshqa fayllar yoki qoidalar bo‘lishi mumkin; ularni bilmasdan to‘liq almashtirish xavfli.

Siz yuborgan amaldagi Storage qoidalari asosida `storage-dictation-rules-snippet.rules` fayli endi to‘liq birlashtirilgan qoida fayli ko‘rinishida tayyorlandi. Eski bitta rasmli yo‘l va uning 2 MB cheklovi saqlandi; yangi ko‘p rasmli batch yo‘li uchun alohida qoida qo‘shildi. Yangi batch yo‘li uchun maxsus rasm hajmi yoki soni limiti belgilanmagan. Sizning eski qoidalaringizda boshqa Storage yo‘llari sukut bo‘yicha bloklangan; agar loyihada boshqa fayl yo‘llari ham ishlatilsa, ularning ruxsatlarini deploydan oldin qo‘shish kerak. Faylni Firebase Console → Storage → Rules bo‘limiga joylashtirishdan oldin ko‘zdan kechiring.

## Deploydan oldingi tekshiruv
1. `functions/` ichida `npm install` bajaring.
2. Firebase CLI orqali `kibo-lug-at` loyihasiga ulanganingizni tekshiring.
3. `firestore.rules` va `firestore.indexes.json` ni tekshiring.
4. Storage qoidalariga yuqoridagi snippetni ehtiyotkorlik bilan qo‘shing.
5. Avval test/staging muhitida sinab ko‘ring; so‘ng Cloud Functions va Firestore’ni deploy qiling.
6. Vercel’dagi mavjud environment variables (`.env.local` / `.env.production.local`) ni o‘zingizning xavfsiz lokal nusxangizda saqlang. Ular ushbu ZIP’ga xavfsizlik sababli kiritilmadi.

## Deploy holati
Bu paket tayyorlandi va statik tekshiruvdan o‘tkaziladi. Firebase’ga yoki Vercel’ga deploy qilinmagan; jonli loyiha ma’lumotlari o‘zgartirilmagan.
