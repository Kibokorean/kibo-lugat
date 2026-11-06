KIBO KOREAN — O‘QUVCHILAR KURS PROGRESSI NAZORATI

TARKIBI
- index.html — mavjud kurslar va ruxsat boshqaruvini saqlagan, o‘qituvchi paneliga ruxsat berilgan o‘quvchilar progressi qo‘shilgan asosiy HTML.
- functions/index.js — mavjud Yonsei 3 server funksiyalari va ikkita yangi progress callable funksiyasi.
- functions/package.json — Node.js 22 runtime.
- functions/yonsei3-answer-key.json — mavjud maxfiy Yonsei 3 test kaliti.

O‘RNATISH
1. Avval loyihangizning index.html va functions papkasidan zaxira nusxa oling.
2. ZIP ichidagi index.html ni loyihangizdagi asosiy index.html o‘rniga qo‘ying.
3. ZIP ichidagi functions/index.js va functions/package.json ni loyihangizdagi mos fayllar bilan almashtiring. functions/yonsei3-answer-key.json ni ham mavjud fayl bilan solishtiring; ZIP dagi nusxa aynan shu server paketining javob kalitidir.
4. Mavjud firebase.json, firestore.rules, firestore.indexes.json, Storage Rules va boshqa hosting sozlamalarini almashtirmang. Progress hujjatlari faqat Admin SDK callable Functions orqali o‘qiladi/yoziladi; yangi Firestore client rule talab qilinmaydi.
5. Loyiha root papkasida terminal oching. functions/package.json Node.js 22 talab qiladi. Node 22 o‘rnatilgan muhitdan foydalaning.
6. Deploy qiling:
   firebase deploy --only functions:saveStudentCourseProgress,functions:getTeacherCourseProgress
7. HTML faylni Vercel hostingga deploy qiling.

ISHLASHI
- O‘qituvchi faqat teacherProfiles/{uid}.active == true bo‘lsa progressni ko‘ra oladi.
- Ro‘yxat kiboCourseAccess/{studentUid} hujjatidagi tanlangan kurs flagi true bo‘lgan o‘quvchilardan tuziladi.
- KIBO Korean 1/2 uchun mavzu boshlanishi, tugatilgan mavzular va yozma testda xato qilingan (takrorlash kerak bo‘lgan) so‘zlar yuboriladi.
- Yonsei 3 tugatilgan mavzulari serverdagi diktant submission holatidan olinadi; faol mavzu va xato so‘zlar progress sync orqali keladi.
- Yangi o‘quvchi hali progress yubormagan bo‘lsa, u “hali sinxronlanmagan” deb ko‘rinadi. Eski tarixni orqaga qarab tiklab bo‘lmaydi; deploydan keyin o‘quvchi kursdan foydalangani sari ma’lumot yig‘iladi.
- Takrorlash ro‘yxati hozircha kurs ichidagi yozma testda xato qilingan so‘zlarni anglatadi. Bosh sahifadagi global SRS kalendaridagi due so‘zlar bu versiyada alohida sinxronlanmaydi.

TEKSHIRISH
1. O‘quvchi kursga ruxsat olgan bo‘lishi va Google/Firebase hisobiga kirishi kerak.
2. O‘quvchi kursda mavzu ochib, testni yakunlagach progress serverga yuboriladi.
3. O‘qituvchi kabineti → O‘qish nazorati → kursni tanlash → Yangilash.
4. O‘quvchini bosib, mavzular holati va takrorlash so‘zlarini ko‘ring.

ESLATMA
Bu o‘zgarishlar real Firebase loyihasiga deploy qilinmadi va brauzerda end-to-end sinovdan o‘tkazilmadi. Avval test hisoblari bilan tekshiring. Mavjud server funksiyalarining qolganlari saqlangan.
