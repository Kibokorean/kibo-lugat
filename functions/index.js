const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { randomUUID } = require("crypto");
const YONSEI3_ANSWER_KEY = require("./yonsei3-answer-key.json");

initializeApp();
setGlobalOptions({ region: "us-east1", maxInstances: 10 });

const TOPIC_TITLES = {
  "1": "노벨 이야기",
  "2": "세계인의 취미",
  "3": "수집광 가족",
  "4": "이사 떡",
  "5": "우리 동네 슈퍼 이야기",
  "6": "숫자",
  "7": "감기",
  "8": "화",
  "9": "느리게 살기",
  "10": "담양 대나무 축제",
  "11": "1 달러짜리 공연",
  "12": "보는 그림, 읽는 그림",
  "13": "한국을 사랑한 언더우드",
  "14": "바보 온달과 평강공주",
  "15": "아버지",
  "16": "라면천국",
  "17": "그 남자, 그 여자",
  "18": "국경 없는 의사회",
  "19": "실수",
  "20": "실수에서 태어난 발명",
  "21": "노란 손수건",
  "22": "존경하는 선생님께",
  "23": "기적을 만든 선생님",
  "24": "서당 풍경",
  "25": "어머니의 마지막 부탁",
  "26": "완곡한 거절",
  "27": "부탁하는 광고",
  "28": "한국 속의 외국인",
  "29": "재미있는 지명 이야기",
  "30": "옛날에 쓰던 물건들"
};
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageSignatureIsValid(buffer, contentType) {
  if (contentType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (contentType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii",0,4) === "RIFF" && buffer.toString("ascii",8,12) === "WEBP";
  return false;
}

async function requireActiveTeacher(uid) {
  const profile = await getFirestore().collection("teacherProfiles").doc(uid).get();
  if (!profile.exists || profile.data().active !== true) {
    throw new HttpsError("permission-denied", "Bu amal faqat tasdiqlangan o'qituvchilar uchun.");
  }
}

// Storage yo'lini UID yoki topic qiymatini regex ichiga qo'shmasdan tekshirish.
function isValidStoredDictationPath(storagePath, uid, topicNumber) {
  if (typeof storagePath !== "string" || typeof uid !== "string") return false;
  const prefix = `dictations/${uid}/`;
  if (!storagePath.startsWith(prefix) || storagePath.includes("..") || storagePath.includes("\\")) return false;
  const fileName = storagePath.slice(prefix.length);
  return new RegExp(`^yonsei3-lesson-${Number(topicNumber)}-[0-9]+\\.(jpg|png|webp)$`).test(fileName);
}

function hasCanonicalSubmissionIdentity(submissionId, data) {
  const uid = data?.uid;
  const topicNumber = Number(data?.topicNumber);
  return typeof uid === "string" && uid.length >= 1 && uid.length <= 128 && !uid.includes("/")
    && Number.isInteger(topicNumber) && topicNumber >= 1 && topicNumber <= 30
    && submissionId === `${uid}_yonsei3_${topicNumber}`;
}

function normalizeWrittenAnswer(value) {
  return String(value || "").normalize("NFC").toLowerCase()
    .replace(/[\u200b\u200c\u200d]/g, "").replace(/\s+/g, " ").trim();
}

// Server-owned written-test sessions. The browser receives prompts, never the answer key.
exports.startYonsei3WrittenTest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const uid = request.auth.uid;
  const topicNumber = Number(request.data?.topicNumber);
  if (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > 30) {
    throw new HttpsError("invalid-argument", "Mavzu raqami noto'g'ri.");
  }
  const words = YONSEI3_ANSWER_KEY[String(topicNumber)] || [];
  if (!words.length) throw new HttpsError("failed-precondition", "Bu mavzu uchun test kaliti topilmadi.");
  const previousSessionId = String(request.data?.previousSessionId || "");
  let indices = words.map((_, i) => i);
  const db = getFirestore();
  if (previousSessionId) {
    if (!/^[a-f0-9-]{36}$/i.test(previousSessionId)) throw new HttpsError("invalid-argument", "Oldingi test sessiyasi noto'g'ri.");
    const previousRef = db.collection("yonsei3WrittenTestSessions").doc(previousSessionId);
    const previous = await previousRef.get();
    const d = previous.data();
    if (!previous.exists || d.uid !== uid || Number(d.topicNumber) !== topicNumber || d.completed !== true
      || Date.now() > Number(d.expiresAt || 0) || !Array.isArray(d.wrongIndices) || !d.wrongIndices.length) {
      throw new HttpsError("failed-precondition", "Qayta test uchun oldingi urinish tugallanmagan yoki mos emas.");
    }
    indices = [...new Set(d.wrongIndices.map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < words.length);
    if (!indices.length || indices.length !== d.wrongIndices.length) throw new HttpsError("failed-precondition", "Qayta test savollari noto'g'ri.");
  }
  const sessionId = randomUUID();
  await db.collection("yonsei3WrittenTestSessions").doc(sessionId).create({
    uid, topicNumber, indices, position: 0, wrongIndices: [], completed: false,
    createdAt: FieldValue.serverTimestamp(), expiresAt: Date.now() + 6 * 60 * 60 * 1000
  });
  return { sessionId, topicNumber, total: indices.length,
    prompts: indices.map(i => ({ index: i, meaning: words[i].back })) };
});

exports.submitYonsei3WrittenTestAnswer = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const uid = request.auth.uid;
  const sessionId = String(request.data?.sessionId || "");
  const answer = request.data?.answer;
  const expectedPosition = Number(request.data?.expectedPosition);
  const requestId = String(request.data?.requestId || "");
  if (!/^[a-f0-9-]{36}$/i.test(sessionId) || typeof answer !== "string" || answer.length > 200
    || !Number.isInteger(expectedPosition) || expectedPosition < 0
    || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Test javobi, savol pozitsiyasi yoki sessiya noto'g'ri.");
  }
  const db = getFirestore();
  const ref = db.collection("yonsei3WrittenTestSessions").doc(sessionId);
  let result;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Test sessiyasi topilmadi.");
    const d = snap.data();
    if (d.uid !== uid) throw new HttpsError("permission-denied", "Bu test sessiyasi sizga tegishli emas.");
    // Idempotent retry: if the server committed the previous request but the
    // response was lost, return its exact result instead of advancing twice.
    if (d.lastAnswerRequestId === requestId && d.lastAnswerResult) {
      result = d.lastAnswerResult;
      return;
    }
    if (d.completed || Date.now() > Number(d.expiresAt || 0)) throw new HttpsError("failed-precondition", "Test sessiyasi tugagan. Testni qayta boshlang.");
    if (!Array.isArray(d.indices) || !Number.isInteger(d.position) || d.position < 0 || d.position >= d.indices.length) throw new HttpsError("failed-precondition", "Test holati noto'g'ri.");
    if (d.position !== expectedPosition) throw new HttpsError("aborted", "Test savoli holati yangilangan. Sahifani yangilab, davom eting.");
    const originalIndex = Number(d.indices[d.position]);
    const correct = YONSEI3_ANSWER_KEY[String(d.topicNumber)]?.[originalIndex];
    if (!correct) throw new HttpsError("internal", "Javob kaliti topilmadi.");
    const isCorrect = normalizeWrittenAnswer(answer) === normalizeWrittenAnswer(correct.front);
    const wrongIndices = Array.isArray(d.wrongIndices) ? d.wrongIndices.slice() : [];
    if (!isCorrect && !wrongIndices.includes(originalIndex)) wrongIndices.push(originalIndex);
    const nextPosition = d.position + 1;
    result = { correct: isCorrect, correctAnswer: isCorrect ? null : correct.front,
      position: nextPosition, total: d.indices.length, finished: nextPosition >= d.indices.length };
    tx.update(ref, { position: nextPosition, wrongIndices, lastAnsweredAt: FieldValue.serverTimestamp(),
      lastAnswerRequestId: requestId, lastAnswerResult: result });
  });
  return result;
});

exports.finishYonsei3WrittenTest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const sessionId = String(request.data?.sessionId || "");
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new HttpsError("invalid-argument", "Test sessiyasi noto'g'ri.");
  const ref = getFirestore().collection("yonsei3WrittenTestSessions").doc(sessionId);
  let result;
  await getFirestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Test sessiyasi topilmadi.");
    const d = snap.data();
    if (d.uid !== request.auth.uid) throw new HttpsError("permission-denied", "Test sessiyasi sizga tegishli emas.");
    if (d.completed || Date.now() > Number(d.expiresAt || 0)) throw new HttpsError("failed-precondition", "Test sessiyasi tugagan. Testni qayta boshlang.");
    if (!Array.isArray(d.indices) || !Number.isInteger(d.position) || d.position !== d.indices.length) {
      throw new HttpsError("failed-precondition", "Barcha savollarga javob berilmagan.");
    }
    const passed = Array.isArray(d.wrongIndices) && d.wrongIndices.length === 0;
    tx.update(ref, { completed: true, passed, finishedAt: FieldValue.serverTimestamp() });
    result = { passed, wrongIndices: d.wrongIndices, total: d.indices.length };
  });
  return result;
});

exports.submitYonsei3Dictation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const uid = request.auth.uid;
  const topicNumber = Number(request.data?.topicNumber);
  const storagePath = request.data?.storagePath;
  const writtenTestSessionId = String(request.data?.writtenTestSessionId || "");

  if (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > 30 || !TOPIC_TITLES[String(topicNumber)]) {
    throw new HttpsError("invalid-argument", "Mavzu raqami noto'g'ri.");
  }
  // UID ni regex ichiga joylashtirmaymiz: Firebase UID qiymati regex metabelgilariga
  // o'xshash belgilarni o'z ichiga olsa ham, faqat aniq papka prefiksi qabul qilinadi.
  if (!isValidStoredDictationPath(storagePath, uid, topicNumber)) {
    throw new HttpsError("permission-denied", "Diktant fayli yo'li yoki nomi noto'g'ri.");
  }

  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  let metadata;
  try { [metadata] = await file.getMetadata(); }
  catch (_) { throw new HttpsError("not-found", "Diktant rasmi Storage'da topilmadi."); }

  const size = Number(metadata.size || 0);
  const contentType = metadata.contentType || "";
  const custom = metadata.metadata || {};
  if (!size || size > MAX_BYTES || !ALLOWED_TYPES.has(contentType)) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw new HttpsError("failed-precondition", "Rasm hajmi yoki formati talabga mos emas.");
  }
  if (custom.ownerUid !== uid || custom.course !== "yonsei3" || custom.topic !== String(topicNumber)) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw new HttpsError("permission-denied", "Rasm metama'lumotlari mos kelmadi.");
  }

  const [bytes] = await file.download();
  if (bytes.length !== size || !imageSignatureIsValid(bytes, contentType)) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw new HttpsError("invalid-argument", "Fayl haqiqiy JPG, PNG yoki WEBP rasm emas.");
  }

  const db = getFirestore();
  const submissionId = `${uid}_yonsei3_${topicNumber}`;
  const ref = db.collection("yonsei3DictationSubmissions").doc(submissionId);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists && existing.data().status !== "rejected") {
        throw new HttpsError("already-exists", "Bu mavzu uchun topshiriq allaqachon yuborilgan yoki tasdiqlangan.");
      }
      // First submission requires a one-time, server-passed written-test session.
      // Rejected dictation resubmissions intentionally skip memorization/test.
      let writtenTestRef = null;
      if (!existing.exists || existing.data().status !== "rejected") {
        if (!/^[a-f0-9-]{36}$/i.test(writtenTestSessionId)) {
          throw new HttpsError("failed-precondition", "Yozma test serverda yakunlanmagan.");
        }
        writtenTestRef = db.collection("yonsei3WrittenTestSessions").doc(writtenTestSessionId);
        const writtenTestSnap = await tx.get(writtenTestRef);
        const testData = writtenTestSnap.exists ? writtenTestSnap.data() : null;
        if (!testData || testData.uid !== uid || Number(testData.topicNumber) !== topicNumber
          || testData.completed !== true || testData.passed !== true || testData.consumed === true) {
          throw new HttpsError("failed-precondition", "Yozma test natijasi server tomonidan tasdiqlanmagan yoki avval ishlatilgan.");
        }
      }
      // Server-side ketma-ketlik himoyasi: faqat bevosita oldingi mavzuni emas,
      // undan avvalgi BARCHA mavzularni tekshiramiz. Aks holda client chetlab
      // o'tilib, oldingi mavzu rejected bo'lsa ham keyingi mavzu yuborilishi mumkin.
      for (let previousNumber = 1; previousNumber < topicNumber; previousNumber++) {
        const previousRef = db.collection("yonsei3DictationSubmissions")
          .doc(`${uid}_yonsei3_${previousNumber}`);
        const previous = await tx.get(previousRef);
        const previousData = previous.exists ? previous.data() : null;
        if (!previousData
          || previousData.uid !== uid
          || previousData.course !== "yonsei3"
          || !["submitted", "approved"].includes(previousData.status)) {
          throw new HttpsError(
            "failed-precondition",
            `${previousNumber}-mavzu diktanti hali muvaffaqiyatli topshirilmagan yoki rad etilgan. Avval shu mavzuni qayta topshiring.`
          );
        }
      }
      if (writtenTestRef) {
        tx.update(writtenTestRef, { consumed: true, consumedAt: FieldValue.serverTimestamp() });
      }
      const old = existing.exists ? existing.data() : null;
      const attempts = Array.isArray(old?.attempts) ? old.attempts.slice(-9) : [];
      if (old) {
        const oldVersion = Number(old.submissionVersion || 1);
        // Keep every future historical attempt in its own document. This avoids
        // truncating the audit trail or growing the parent document indefinitely.
        tx.set(ref.collection("attempts").doc(String(oldVersion)), {
          storagePath: old.storagePath,
          contentType: old.contentType || "",
          size: Number(old.size || 0),
          submittedAt: old.submittedAt || null,
          status: old.status || "unknown",
          reviewedAt: old.reviewedAt || null,
          reviewedBy: old.reviewedBy || null,
          teacherComment: old.teacherComment || "",
          submissionVersion: oldVersion
        });
        // Retain a small legacy copy for compatibility with older clients/data.
        attempts.push({ storagePath: old.storagePath, contentType: old.contentType, size: old.size, submittedAt: old.submittedAt || null, status: old.status, reviewedAt: old.reviewedAt || null, reviewedBy: old.reviewedBy || null, teacherComment: old.teacherComment || "", submissionVersion: oldVersion });
      }
      const submissionVersion = Number(old?.submissionVersion || 0) + 1;
      tx.set(ref, {
        uid,
        topicNumber,
        topicTitle: TOPIC_TITLES[String(topicNumber)],
        course: "yonsei3",
        storagePath,
        contentType,
        size,
        status: "submitted",
        submissionVersion,
        submittedAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp(),
        attempts,
        reviewedAt: FieldValue.delete(),
        reviewedBy: FieldValue.delete(),
        teacherComment: FieldValue.delete()
      }, { merge: true });
    });
  } catch (error) {
    // Idempotency/race protection: a repeated callable request may reference the
    // exact same client-generated Storage path as a successful concurrent request.
    // Never delete an object that is already referenced by the canonical submission
    // or by its retained attempt history.
    let isReferenced = false;
    try {
      const latest = await ref.get();
      if (latest.exists) {
        const data = latest.data() || {};
        isReferenced = data.storagePath === storagePath
          || (Array.isArray(data.attempts) && data.attempts.some((attempt) => attempt?.storagePath === storagePath));
        if (!isReferenced) {
          const historical = await ref.collection("attempts").where("storagePath", "==", storagePath).limit(1).get();
          isReferenced = !historical.empty;
        }
      }
    } catch (lookupError) {
      // Fail closed for cleanup: if reference state cannot be checked, keep the file.
      console.error("Could not verify dictation object reference after transaction failure", lookupError);
      isReferenced = true;
    }
    if (!isReferenced) await file.delete({ ignoreNotFound: true }).catch(() => {});
    if (error instanceof HttpsError) throw error;
    console.error("submitYonsei3Dictation transaction failed", error);
    throw new HttpsError("internal", "Topshiriqni saqlashda server xatoligi yuz berdi.");
  }

  const latest = await ref.get();
  return { ok: true, submissionId, topicNumber, topicTitle: TOPIC_TITLES[String(topicNumber)], status: "submitted", submissionVersion: Number(latest.data()?.submissionVersion || 1) };
});

// A successful student submission completes/unlocks the topic immediately.
// A later teacher rejection blocks that topic and every topic after it until resubmission.
exports.getYonsei3Progress = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const uid = request.auth.uid;
  const snap = await getFirestore().collection("yonsei3DictationSubmissions")
    .where("uid", "==", uid).where("course", "==", "yonsei3").get();
  const byTopic = new Map();
  const rejected = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const n = Number(data.topicNumber);
    if (!Number.isInteger(n) || n < 1 || n > 30) continue;
    byTopic.set(n, { id: doc.id, status: data.status, topicNumber: n,
      topicTitle: data.topicTitle || TOPIC_TITLES[String(n)],
      teacherComment: data.teacherComment || "", reviewedAt: data.reviewedAt?.toMillis?.() || null });
    if (data.status === "rejected") rejected.push({ topicNumber: n,
      topicTitle: data.topicTitle || TOPIC_TITLES[String(n)],
      teacherComment: data.teacherComment || "O'qituvchi diktantni qayta ishlashni so'radi.",
      reviewedAt: data.reviewedAt?.toMillis?.() || null });
  }
  // Only the continuous, non-rejected sequence counts. This automatically locks later topics.
  const completed = [];
  for (let n = 1; n <= 30; n++) {
    const item = byTopic.get(n);
    if (!item || !["submitted", "approved"].includes(item.status)) break;
    completed.push(n);
  }
  rejected.sort((a, b) => a.topicNumber - b.topicNumber);
  return { completed, dictationSubmitted: completed, rejected };
});

// Teacher-only queue. The server independently checks the teacher profile.
exports.listYonsei3Submissions = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  await requireActiveTeacher(request.auth.uid);
  const status = ["submitted", "approved", "rejected"].includes(request.data?.status) ? request.data.status : "submitted";
  const snap = await getFirestore().collection("yonsei3DictationSubmissions")
    .where("course", "==", "yonsei3").where("status", "==", status)
    .orderBy("submittedAt", "desc").limit(50).get();
  const items = await Promise.all(snap.docs.map(async (doc) => {
    const d = doc.data();
    const legacyAttempts = Array.isArray(d.attempts) ? d.attempts : [];
    const historySnap = await doc.ref.collection("attempts").orderBy("submissionVersion", "asc").get();
    const byVersion = new Map();
    for (const a of legacyAttempts) byVersion.set(Number(a.submissionVersion || 0), a);
    for (const attemptDoc of historySnap.docs) byVersion.set(Number(attemptDoc.data().submissionVersion || attemptDoc.id), attemptDoc.data());
    const attempts = [...byVersion.values()].sort((a, b) => Number(a.submissionVersion || 0) - Number(b.submissionVersion || 0)).map((a) => ({
      contentType: a.contentType || "",
      size: Number(a.size || 0),
      submittedAt: a.submittedAt?.toMillis?.() || null,
      status: a.status || "unknown",
      reviewedAt: a.reviewedAt?.toMillis?.() || null,
      reviewedBy: a.reviewedBy || null,
      teacherComment: a.teacherComment || "",
      submissionVersion: Number(a.submissionVersion || 0)
    }));
    return { id: doc.id, uid: d.uid, topicNumber: d.topicNumber, topicTitle: d.topicTitle,
      contentType: d.contentType, size: d.size,
      status: d.status, submissionVersion: Number(d.submissionVersion || 1),
      submittedAt: d.submittedAt?.toMillis?.() || null,
      teacherComment: d.teacherComment || "", attempts };
  }));
  return { items };
});

// Teacher-only short-lived image access. Do not issue permanent Firebase download-token URLs.
// A teacher can request only the current submission image or a recorded prior attempt.
exports.getYonsei3DictationImage = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  await requireActiveTeacher(request.auth.uid);
  const submissionId = String(request.data?.submissionId || "");
  const version = Number(request.data?.submissionVersion);
  if (!submissionId || submissionId.length > 180 || submissionId.includes("/") || !Number.isInteger(version) || version < 1) {
    throw new HttpsError("invalid-argument", "Topshiriq yoki urinish raqami noto'g'ri.");
  }
  const snap = await getFirestore().collection("yonsei3DictationSubmissions").doc(submissionId).get();
  if (!snap.exists || snap.data().course !== "yonsei3") {
    throw new HttpsError("not-found", "Diktant topshirig'i topilmadi.");
  }
  const data = snap.data();
  if (!hasCanonicalSubmissionIdentity(submissionId, data)) {
    throw new HttpsError("failed-precondition", "Topshiriq identifikatori noto'g'ri.");
  }
  let storagePath = null;
  if (Number(data.submissionVersion || 1) === version) {
    storagePath = data.storagePath;
  } else {
    const attemptSnap = await snap.ref.collection("attempts").doc(String(version)).get();
    if (attemptSnap.exists) storagePath = attemptSnap.data().storagePath || null;
    if (!storagePath) {
      const legacyAttempt = (Array.isArray(data.attempts) ? data.attempts : [])
        .find((item) => Number(item.submissionVersion || 0) === version);
      storagePath = legacyAttempt?.storagePath || null;
    }
  }
  if (!isValidStoredDictationPath(storagePath, data.uid, data.topicNumber)) {
    throw new HttpsError("not-found", "Ushbu urinish uchun rasm topilmadi.");
  }
  const [url] = await getStorage().bucket().file(storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 5 * 60 * 1000
  });
  return { url, expiresInSeconds: 300 };
});

exports.reviewYonsei3Submission = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  await requireActiveTeacher(request.auth.uid);
  const submissionId = String(request.data?.submissionId || "");
  const decision = String(request.data?.decision || "");
  const expectedVersion = Number(request.data?.submissionVersion);
  const teacherComment = String(request.data?.teacherComment || "").trim().slice(0, 1000);
  if (!submissionId || submissionId.length > 180 || submissionId.includes("/") || !["approved", "rejected"].includes(decision) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new HttpsError("invalid-argument", "Topshiriq yoki qaror ma'lumoti noto'g'ri.");
  }
  if (decision === "rejected" && teacherComment.length < 3) {
    throw new HttpsError("invalid-argument", "Rad etish uchun kamida 3 belgidan iborat izoh yozing.");
  }
  const db = getFirestore();
  const ref = db.collection("yonsei3DictationSubmissions").doc(submissionId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Topshiriq topilmadi.");
    const data = snap.data();
    if (data.course !== "yonsei3" || !hasCanonicalSubmissionIdentity(submissionId, data)) {
      throw new HttpsError("failed-precondition", "Topshiriq ma'lumotlari noto'g'ri.");
    }
    if (data.status !== "submitted") {
      throw new HttpsError("failed-precondition", "Bu topshiriq allaqachon ko'rib chiqilgan.");
    }
    if (Number(data.submissionVersion || 1) !== expectedVersion) {
      throw new HttpsError("aborted", "Bu topshiriq yangilangan. O'qituvchi ro'yxatini yangilab, yangi rasmni tekshiring.");
    }
    tx.update(ref, { status: decision, reviewedBy: request.auth.uid,
      reviewedAt: FieldValue.serverTimestamp(), teacherComment });
  });
  return { ok: true, submissionId, status: decision };
});
