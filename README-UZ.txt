KIBO KOREAN — KURSLAR + YONSEI 3 SERVER PAKETI (BIRLASHTIRILGAN)

PAKET TARKIBI
- index.html: Kurslar uchun oldingi ruxsat tizimi qo‘shilgan KIBO HTML.
- firestore.rules: Asosiy Firestore qoidalaringiz + kiboCourseAccess + server paketidagi Yonsei 3 diktant qoidalari + yonsei3WrittenTestSessions deny.
- functions/: Yonsei 3 server callable funksiyalari va maxfiy javoblar kaliti.
- firestore.indexes.additive.json: Server funksiyalari talab qiladigan indekslar (mavjud indekslarga qo‘shish uchun).
- storage-dictation-rules-snippet.rules: Mavjud Storage Rules ichiga qo‘shiladigan diktant yo‘li qoidasi.
- storage.rules-REFERENCE-DO-NOT-REPLACE-EXISTING: Mustaqil misol; mavjud Storage Rules o‘rniga qo‘ymang.
- firebase.functions-and-indexes.fragment.json: firebase.json ga qo‘shiladigan konfiguratsiya qismi.

MUHIM XAVFSIZLIK VA DEPLOY ESLATMALARI
1. Firestore:
   - firestore.rules — birlashtirilgan to‘liq rules fayli. U asosiy rules qoidalaringizni saqlaydi.
   - Eski /yonsei3DictationSubmissions/{submissionId} match bloki uning o‘rniga server paketining toraytirilgan qoidalari bilan almashtirildi.
   - /yonsei3WrittenTestSessions/{sessionId} client uchun to‘liq yopildi.
   - /kiboCourseAccess/{uid} alohida kurs ruxsatlarini saqlaydi.
   - Firestore ruxsatlari bir nechta mos match bo‘lsa OR bo‘yicha birlashadi. Eski, keng ruxsat beruvchi duplicate match qoidalari boshqa joyda qolmaganini tekshiring.

2. Storage:
   - Mavjud Storage Rules faylingizni to‘liq almashtirmang.
   - storage-dictation-rules-snippet.rules ichidagi function va match blokini mavjud service firebase.storage ichiga birlashtiring.
   - Agar /dictations/{uid}/{fileName} uchun eski keng ruxsatli match bo‘lsa, uni olib tashlang yoki toraytiring. Mos qoidalar OR bo‘yicha birlashadi.
   - Screenshotda ko‘rsatilgan Storage Rules'ning to‘liq matni bizda yo‘q; shu sababli mavjud boshqa Storage papkalarini xavfsiz saqlagan holda avtomatik to‘liq merge qilish imkoni bo‘lmadi.

3. Firebase konfiguratsiyasi:
   - firebase.functions-and-indexes.fragment.json ni mavjud firebase.json bilan birlashtiring. Agar unda hosting, emulators yoki boshqa sozlamalar bo‘lsa, ularni o‘chirmang.
   - firestore.indexes.additive.json dagi indekslarni mavjud firestore.indexes.json ichidagi indexes ro‘yxatiga qo‘shing; mavjud indekslarni o‘chirmang. Bir xil field kombinatsiyasi bor bo‘lsa, dublikat qo‘shmang.
   - functions/package.json Node.js 20 runtime va firebase-admin/firebase-functions dependencies ашиглана.

4. Functions deploy:
   - functions/ папкасын проект root-да сақланг.
   - Firebase project alias kibo-lug-at ekanini .firebaserc orqali tekshiring.
   - Billing/Blaze, Node.js 20 va kerakli API'lar tayyorligini tekshirmasdan deploy qilmang.
   - Birinchi deploydan oldin `firebase deploy --only functions` va rules/index deploy jarayonini alohida rejalashtiring.
   - Bu paket Firebase emulator yoki real loyihada integratsion testdan o‘tkazilmagan. Hozircha avtomatik deploy qilmang.

5. Kurs ruxsatlari:
   - O‘qituvchi profili teacherProfiles/{uid}.active == true bo‘lishi kerak.
   - KIBO HTML ruxsat hujjatini kiboCourseAccess/{studentUid} da saqlaydi.
   - Ruxsatlar yonsei3, kiboKorean1, kiboKorean2 maydonlari bo‘yicha alohida.
   - Bu ruxsatlar kurs menyusi/kartalarini boshqaradi. HTML ichidagi kontentni source code ko‘rishdan himoya qilmaydi.

6. Server funksiyalari:
   - 8 ta callable function: startYonsei3WrittenTest, submitYonsei3WrittenTestAnswer, finishYonsei3WrittenTest, submitYonsei3Dictation, getYonsei3Progress, listYonsei3Submissions, getYonsei3DictationImage, reviewYonsei3Submission.
   - Barcha teacher-only amallar serverda teacherProfiles/{uid}.active == true ni tekshiradi.
   - getYonsei3Progress query uchun uid + course indeks; teacher queue uchun course + status + submittedAt indeks berilgan.

7. TEST HOLATI
   - functions/index.js Node sintaksisi va JSON fayllar tekshirildi.
   - Firestore/Storage Rules emulatorda kompilyatsiya qilinmadi.
   - Firebase Functions deploy qilinmadi.
   - Browser end-to-end test qilinmadi.
   - Mavjud Storage Rules va mavjud firebase.json/indexes bilan to‘liq integratsiya hali yakunlanmagan.

