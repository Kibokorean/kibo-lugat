const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
  const relative = storagePath.slice(prefix.length);
  const topic = Number(topicNumber);
  // Legacy single-image object path remains readable for existing submissions.
  if (new RegExp(`^yonsei3-lesson-${topic}-[0-9]+\\.(jpg|png|webp)$`).test(relative)) return true;
  // New submission: one UUID folder per topic attempt, containing any number of UUID-named images.
  return new RegExp(`^yonsei3-lesson-${topic}-[a-f0-9-]{36}/[a-f0-9-]{36}\\.(jpg|png|webp)$`, "i").test(relative);
}

function isValidDictationBatchId(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

function readImageHeader(file) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = file.createReadStream({ start: 0, end: 11 });
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}


async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let failure = null;
  const runWorker = async () => {
    while (!failure) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failure = failure || error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  if (failure) throw failure;
  return results;
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


// Remove only an unsubmitted batch owned by the authenticated user.
// Submitted/current and historical attempts are protected from cleanup.
exports.cleanupYonsei3DictationBatch = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const uid = request.auth.uid;
  const topicNumber = Number(request.data?.topicNumber);
  const batchId = request.data?.batchId;
  if (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > 30 || !isValidDictationBatchId(batchId)) {
    throw new HttpsError("invalid-argument", "Diktant to'plami ma'lumoti noto'g'ri.");
  }
  const submissionRef = getFirestore().collection("yonsei3DictationSubmissions").doc(`${uid}_yonsei3_${topicNumber}`);
  const submission = await submissionRef.get();
  if (submission.exists) {
    const data = submission.data();
    const inLegacyHistory = Array.isArray(data.attempts) && data.attempts.some((item) => item?.batchId === batchId);
    if (data.batchId === batchId || inLegacyHistory) {
      throw new HttpsError("failed-precondition", "Yuborilgan diktant rasmlarini o'chirib bo'lmaydi.");
    }
    const history = await submissionRef.collection("attempts").where("batchId", "==", batchId).limit(1).get();
    if (!history.empty) throw new HttpsError("failed-precondition", "Tarixdagi diktant rasmlarini o'chirib bo'lmaydi.");
  }
  const prefix = `dictations/${uid}/yonsei3-lesson-${topicNumber}-${batchId}/`;
  await getStorage().bucket().deleteFiles({ prefix, force: true }).catch((error) => {
    console.error("Could not clean failed Yonsei 3 upload batch", error);
    throw new HttpsError("internal", "Yuklanmay qolgan rasmlarni tozalash amalga oshmadi.");
  });
  return { ok: true };
});

exports.submitYonsei3Dictation = onCall({ timeoutSeconds: 540, memory: "1GiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  const uid = request.auth.uid;
  const topicNumber = Number(request.data?.topicNumber);
  const batchId = request.data?.batchId;
  const writtenTestSessionId = String(request.data?.writtenTestSessionId || "");

  if (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > 30 || !TOPIC_TITLES[String(topicNumber)]) {
    throw new HttpsError("invalid-argument", "Mavzu raqami noto'g'ri.");
  }
  if (!isValidDictationBatchId(batchId)) {
    throw new HttpsError("invalid-argument", "Topshiriq to'plami identifikatori noto'g'ri.");
  }

  const bucket = getStorage().bucket();
  const folder = `yonsei3-lesson-${topicNumber}-${batchId}/`;
  const prefix = `dictations/${uid}/${folder}`;
  // Paginate Storage listing to avoid holding an unbounded image collection in memory.
  // The page size is an internal processing batch, not a submission image-count limit.
  let pageToken = undefined;
  let imageCount = 0;
  let totalSize = 0;
  let firstContentType = "";
  // Validate every uploaded object independently. No application-level file-count or file-size cap.
  // Only the first 12 bytes are streamed for signature checks, so large images are not loaded into RAM.
  try {
    do {
      const [files, , apiResponse] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 100, pageToken });
      const validatedFiles = await mapWithConcurrency(files, 8, async (file) => {
        const path = file.name;
        if (!isValidStoredDictationPath(path, uid, topicNumber)) {
          throw new HttpsError("permission-denied", "Diktant fayli yo'li yoki nomi noto'g'ri.");
        }
        let metadata;
        try { [metadata] = await file.getMetadata(); }
        catch (_) { throw new HttpsError("not-found", "Diktant rasmlaridan biri Storage'da topilmadi."); }
        const size = Number(metadata.size || 0);
        const contentType = metadata.contentType || "";
        const custom = metadata.metadata || {};
        if (!size || !ALLOWED_TYPES.has(contentType)) {
          throw new HttpsError("failed-precondition", "Rasmlardan birining formati talabga mos emas.");
        }
        if (custom.ownerUid !== uid || custom.course !== "yonsei3" || custom.topic !== String(topicNumber)
          || custom.batchId !== batchId) {
          throw new HttpsError("permission-denied", "Rasm metama'lumotlari mos kelmadi.");
        }
        const header = await readImageHeader(file);
        if (!imageSignatureIsValid(header, contentType)) {
          throw new HttpsError("invalid-argument", "Fayllardan biri haqiqiy JPG, PNG yoki WEBP rasm emas.");
        }
        return { size, contentType };
      });
      for (const item of validatedFiles) {
        totalSize += item.size;
        imageCount += 1;
        if (!firstContentType) firstContentType = item.contentType;
      }
      pageToken = apiResponse?.nextPageToken;
    } while (pageToken);
  } catch (error) {
    await bucket.deleteFiles({ prefix, force: true }).catch((cleanupError) => {
      console.error("Could not clean invalid dictation batch", cleanupError);
    });
    if (error instanceof HttpsError) throw error;
    console.error("Could not validate dictation batch", error);
    throw new HttpsError("internal", "Diktant rasmlarini tekshirishda server xatoligi yuz berdi.");
  }
  if (!imageCount) throw new HttpsError("failed-precondition", "Topshiriq uchun birorta ham rasm yuklanmagan.");

  const db = getFirestore();
  const submissionId = `${uid}_yonsei3_${topicNumber}`;
  const ref = db.collection("yonsei3DictationSubmissions").doc(submissionId);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists && existing.data().status !== "rejected") {
        throw new HttpsError("already-exists", "Bu mavzu uchun topshiriq allaqachon yuborilgan yoki tasdiqlangan.");
      }
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
      for (let previousNumber = 1; previousNumber < topicNumber; previousNumber++) {
        const previousRef = db.collection("yonsei3DictationSubmissions").doc(`${uid}_yonsei3_${previousNumber}`);
        const previous = await tx.get(previousRef);
        const previousData = previous.exists ? previous.data() : null;
        if (!previousData || previousData.uid !== uid || previousData.course !== "yonsei3"
          || !["submitted", "approved"].includes(previousData.status)) {
          throw new HttpsError("failed-precondition", `${previousNumber}-mavzu diktanti hali muvaffaqiyatli topshirilmagan yoki rad etilgan. Avval shu mavzuni qayta topshiring.`);
        }
      }
      if (writtenTestRef) tx.update(writtenTestRef, { consumed: true, consumedAt: FieldValue.serverTimestamp() });
      const old = existing.exists ? existing.data() : null;
      const oldVersion = Number(old?.submissionVersion || 0);
      if (old) {
        tx.set(ref.collection("attempts").doc(String(oldVersion)), {
          storagePath: old.storagePath || null,
          batchId: old.batchId || null,
          imageCount: Number(old.imageCount || (old.storagePath ? 1 : 0)),
          totalSize: Number(old.totalSize || old.size || 0),
          contentType: old.contentType || "",
          size: Number(old.size || old.totalSize || 0),
          submittedAt: old.submittedAt || null,
          status: old.status || "unknown",
          reviewedAt: old.reviewedAt || null,
          reviewedBy: old.reviewedBy || null,
          teacherComment: old.teacherComment || "",
          submissionVersion: oldVersion
        });
      }
      const submissionVersion = oldVersion + 1;
      tx.set(ref, {
        uid, topicNumber, topicTitle: TOPIC_TITLES[String(topicNumber)], course: "yonsei3",
        batchId, imageCount, totalSize,
        // Keep legacy fields for old UI/data compatibility; new submissions use batchId.
        contentType: imageCount === 1 ? firstContentType : "multiple",
        size: totalSize,
        status: "submitted", submissionVersion,
        submittedAt: FieldValue.serverTimestamp(), verifiedAt: FieldValue.serverTimestamp(),
        reviewedAt: FieldValue.delete(), reviewedBy: FieldValue.delete(), teacherComment: FieldValue.delete()
      }, { merge: true });
    });
  } catch (error) {
    // Delete only this unreferenced batch. If Firestore cannot be checked, retain files safely.
    let isReferenced = false;
    try {
      const latest = await ref.get();
      if (latest.exists) {
        const data = latest.data() || {};
        isReferenced = data.batchId === batchId
          || (Array.isArray(data.attempts) && data.attempts.some((a) => a?.batchId === batchId));
        if (!isReferenced) {
          const historical = await ref.collection("attempts").where("batchId", "==", batchId).limit(1).get();
          isReferenced = !historical.empty;
        }
      }
    } catch (lookupError) {
      console.error("Could not verify dictation batch reference after transaction failure", lookupError);
      isReferenced = true;
    }
    if (!isReferenced) {
      await bucket.deleteFiles({ prefix, force: true }).catch((cleanupError) => {
        console.error("Could not clean unreferenced dictation batch", cleanupError);
      });
    }
    if (error instanceof HttpsError) throw error;
    console.error("submitYonsei3Dictation transaction failed", error);
    throw new HttpsError("internal", "Topshiriqni saqlashda server xatoligi yuz berdi.");
  }

  const latest = await ref.get();
  return { ok: true, submissionId, topicNumber, topicTitle: TOPIC_TITLES[String(topicNumber)], status: "submitted",
    submissionVersion: Number(latest.data()?.submissionVersion || 1), imageCount, totalSize };
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
      size: Number(a.totalSize || a.size || 0),
      imageCount: Number(a.imageCount || (a.storagePath ? 1 : 0)),
      submittedAt: a.submittedAt?.toMillis?.() || null,
      status: a.status || "unknown",
      reviewedAt: a.reviewedAt?.toMillis?.() || null,
      reviewedBy: a.reviewedBy || null,
      teacherComment: a.teacherComment || "",
      submissionVersion: Number(a.submissionVersion || 0)
    }));
    return { id: doc.id, uid: d.uid, topicNumber: d.topicNumber, topicTitle: d.topicTitle,
      contentType: d.contentType, size: Number(d.totalSize || d.size || 0), imageCount: Number(d.imageCount || (d.storagePath ? 1 : 0)),
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
  if (!snap.exists || snap.data().course !== "yonsei3") throw new HttpsError("not-found", "Diktant topshirig'i topilmadi.");
  const data = snap.data();
  if (!hasCanonicalSubmissionIdentity(submissionId, data)) throw new HttpsError("failed-precondition", "Topshiriq identifikatori noto'g'ri.");

  let batchId = null;
  let legacyPath = null;
  if (Number(data.submissionVersion || 1) === version) {
    batchId = data.batchId || null;
    legacyPath = data.storagePath || null;
  } else {
    const attemptSnap = await snap.ref.collection("attempts").doc(String(version)).get();
    if (attemptSnap.exists) {
      batchId = attemptSnap.data().batchId || null;
      legacyPath = attemptSnap.data().storagePath || null;
    }
    if (!batchId && !legacyPath) {
      const legacyAttempt = (Array.isArray(data.attempts) ? data.attempts : []).find((item) => Number(item.submissionVersion || 0) === version);
      batchId = legacyAttempt?.batchId || null;
      legacyPath = legacyAttempt?.storagePath || null;
    }
  }

  const bucket = getStorage().bucket();
  const requestedPageToken = typeof request.data?.pageToken === "string" ? request.data.pageToken : undefined;
  let paths = [];
  let nextPageToken = null;
  if (isValidDictationBatchId(batchId)) {
    const prefix = `dictations/${data.uid}/yonsei3-lesson-${data.topicNumber}-${batchId}/`;
    const [objects, , apiResponse] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 100, pageToken: requestedPageToken });
    paths = objects.map((file) => file.name).filter((path) => isValidStoredDictationPath(path, data.uid, data.topicNumber));
    nextPageToken = apiResponse?.nextPageToken || null;
  } else if (!requestedPageToken && isValidStoredDictationPath(legacyPath, data.uid, data.topicNumber)) {
    paths = [legacyPath];
  }
  if (!paths.length && !nextPageToken) throw new HttpsError("not-found", "Ushbu urinish uchun rasmlar topilmadi.");
  const images = await Promise.all(paths.map(async (path) => {
    const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 5 * 60 * 1000 });
    return { url };
  }));
  return { images, url: images[0]?.url || null, imageCount: images.length, nextPageToken, expiresInSeconds: 300 };
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


// -----------------------------------------------------------------------------
// KIBO SERVER-OWNED LEADERBOARD
// Client SDKs can never write leaderboard or ledger documents. The server
// records one deterministic entry per user/word and derives all counters.
// -----------------------------------------------------------------------------
const KIBO_REVIEW_KEY = "kibo_spaced_review_v1";
const KIBO_LEDGER = "kiboLeaderboardProgress";
const KIBO_LEADERBOARD = "leaderboard";
const KIBO_MIGRATIONS = "kiboLeaderboardMigrations";
const crypto = require("crypto");

function kiboWordHash(ko, uz, source) {
  return crypto.createHash("sha256").update(JSON.stringify([String(source || ""), String(ko), String(uz)])).digest("hex");
}
function validKiboWord(data) {
  return data && typeof data.ko === "string" && data.ko.trim().length > 0 && data.ko.length <= 160
    && typeof data.uz === "string" && data.uz.trim().length > 0 && data.uz.length <= 500;
}
function kiboSafeText(value, max, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}
async function requireKiboUser(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Avval hisobingizga kiring.");
  return request.auth.uid;
}

// One-time import of the legacy cloud review store. Existing records are
// explicitly tagged legacy-unverified: old client-writable data cannot be
// retroactively proven authentic. The import is idempotent and preserves keys.
exports.migrateKiboLegacyProgress = onCall({ maxInstances: 5 }, async (request) => {
  const uid = await requireKiboUser(request);
  const db = getFirestore();
  const markerRef = db.collection(KIBO_MIGRATIONS).doc(uid);
  const userRef = db.collection("users").doc(uid);
  const claim = await db.runTransaction(async (tx) => {
    const marker = await tx.get(markerRef);
    if (marker.exists && marker.data().status === "complete") return { alreadyComplete: true };
    if (marker.exists && marker.data().status === "running") return { alreadyRunning: true };
    tx.set(markerRef, { uid, status: "running", startedAt: FieldValue.serverTimestamp(), version: 1 }, { merge: true });
    return { start: true };
  });
  if (claim.alreadyComplete) return { ok: true, migrated: false, reason: "already-complete" };
  if (claim.alreadyRunning) return { ok: true, migrated: false, reason: "already-running" };
  try {
    const userSnap = await userRef.get();
    const progress = userSnap.exists ? userSnap.data()?.progress : null;
    const legacy = progress && typeof progress === "object" ? progress[KIBO_REVIEW_KEY] : null;
    const entries = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? Object.entries(legacy) : [];
    if (entries.length > 20000) throw new HttpsError("resource-exhausted", "Legacy progress juda katta; administrator migratsiyasi talab qilinadi.");
    let batch = db.batch(), writes = 0, imported = 0;
    for (const [legacyKey, item] of entries) {
      if (!validKiboWord(item) || !Number.isFinite(Number(item.due)) || !Number.isFinite(Number(item.last))) continue;
      let keySource = "";
      try { const parsedKey = JSON.parse(String(legacyKey)); if (Array.isArray(parsedKey) && typeof parsedKey[0] === "string") keySource = parsedKey[0]; } catch (_) {}
      const source = kiboSafeText(keySource || item.reviewSourceId || item.sectionTitle || item.bookName || item.sourceTitle || item.section || "legacy", 240, "legacy");
      const hash = kiboWordHash(item.ko.trim(), item.uz.trim(), source);
      const ref = db.collection(KIBO_LEDGER).doc(uid).collection("words").doc(hash);
      const last = Math.min(Number(item.last), Date.now());
      batch.set(ref, {
        uid, wordHash: hash, ko: item.ko.trim(), uz: item.uz.trim(), source,
        sectionTitle: kiboSafeText(item.sectionTitle || item.bookName || item.sourceTitle, 240),
        learnedAt: new Date(last), lastReviewedAt: new Date(last), dueAt: new Date(Number(item.due)),
        sourceType: "legacy-unverified", legacyKey: String(legacyKey).slice(0, 500),
        migratedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      writes++; imported++;
      if (writes >= 400) { await batch.commit(); batch = db.batch(); writes = 0; }
    }
    if (writes) await batch.commit();
    await markerRef.set({ uid, status: "complete", imported, completedAt: FieldValue.serverTimestamp(), legacyTrust: "unverified-client-origin" }, { merge: true });
    await recomputeKiboLeaderboardUser(uid);
    return { ok: true, migrated: true, imported, legacyTrust: "unverified-client-origin" };
  } catch (error) {
    await markerRef.set({ uid, status: "failed", failedAt: FieldValue.serverTimestamp(), errorCode: error.code || "internal" }, { merge: true });
    if (error instanceof HttpsError) throw error;
    console.error("KIBO legacy progress migration failed", error);
    throw new HttpsError("internal", "Eski progress migratsiyasida server xatoligi yuz berdi.");
  }
});

async function recomputeKiboLeaderboardUser(uid) {
  const db = getFirestore();
  const now = Date.now();
  const ledger = db.collection(KIBO_LEDGER).doc(uid).collection("words");
  const [activeSnap, recentSnap] = await Promise.all([
    ledger.where("dueAt", ">", new Date(now)).get(),
    ledger.where("lastReviewedAt", ">=", new Date(now - 7 * 86400000)).get()
  ]);
  const weekCount = recentSnap.docs.filter(doc => {
    const due = doc.data().dueAt?.toMillis?.() ?? new Date(doc.data().dueAt || 0).getTime();
    return due > now;
  }).length;
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : {};
  await db.collection(KIBO_LEADERBOARD).doc(uid).set({
    uid,
    displayName: kiboSafeText(user.profileName || user.accountDisplayName, 80, "KIBO o‘quvchisi"),
    photoURL: typeof user.profileImage === "string" && user.profileImage.length <= 500000 ? user.profileImage : null,
    allCount: activeSnap.size,
    weekCount,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { allCount: activeSnap.size, weekCount };
}

// Called only after the existing spaced-repetition registrar records a word.
// The server assigns timestamps, deduplicates by deterministic hash and
// throttles requests. It does not accept client-supplied counters/timestamps.
exports.recordKiboLearnedWord = onCall({ maxInstances: 10 }, async (request) => {
  const uid = await requireKiboUser(request);
  const data = request.data || {};
  if (!validKiboWord(data)) throw new HttpsError("invalid-argument", "Lug‘at ma’lumoti noto‘g‘ri.");
  const ko = data.ko.trim(), uz = data.uz.trim();
  const source = kiboSafeText(data.source || data.sectionTitle, 240, "KIBO");
  const hash = kiboWordHash(ko, uz, source);
  const db = getFirestore();
  const rateRef = db.collection("kiboLeaderboardRateLimits").doc(uid);
  const wordRef = db.collection(KIBO_LEDGER).doc(uid).collection("words").doc(hash);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const [rateSnap, wordSnap] = await Promise.all([tx.get(rateRef), tx.get(wordRef)]);
    const rate = rateSnap.exists ? rateSnap.data() : {};
    const windowStart = Number(rate.windowStart || 0);
    const count = windowStart > now - 60000 ? Number(rate.count || 0) : 0;
    if (count >= 120) throw new HttpsError("resource-exhausted", "Juda ko‘p so‘rov yuborildi. Bir ozdan keyin urinib ko‘ring.");
    tx.set(rateRef, { windowStart: windowStart > now - 60000 ? windowStart : now, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (wordSnap.exists) {
      const prior = wordSnap.data();
      const step = Math.min(5, Math.max(0, Number(prior.reviewStep || 0) + 1));
      const intervals = [1, 3, 7, 14, 21, 30];
      tx.update(wordRef, { reviewStep: step, lastReviewedAt: FieldValue.serverTimestamp(), dueAt: new Date(now + intervals[step] * 86400000), lastSourceType: "server-event" });
      return { created: false, reviewed: true };
    }
    tx.create(wordRef, {
      uid, wordHash: hash, ko, uz, source,
      sectionTitle: kiboSafeText(data.sectionTitle, 240), reviewStep: 0,
      learnedAt: FieldValue.serverTimestamp(), lastReviewedAt: FieldValue.serverTimestamp(), dueAt: new Date(now + 86400000),
      sourceType: "server-event"
    });
    return { created: true, reviewed: false };
  });
  if (result.created || result.reviewed) await recomputeKiboLeaderboardUser(uid);
  return { ok: true, created: result.created };
});

// Keep public leaderboard identity fields synchronized from the user's own
// profile document; clients never write leaderboard documents directly.
exports.updateKiboLeaderboardProfile = onCall({ maxInstances: 10 }, async (request) => {
  const uid = await requireKiboUser(request);
  const db = getFirestore();
  const snap = await db.collection("users").doc(uid).get();
  const user = snap.exists ? snap.data() : {};
  const ref = db.collection(KIBO_LEADERBOARD).doc(uid);
  await ref.set({
    uid,
    displayName: kiboSafeText(user.profileName || user.accountDisplayName || request.auth.token.name, 80, "KIBO o‘quvchisi"),
    photoURL: typeof user.profileImage === "string" && user.profileImage.length <= 500000 ? user.profileImage : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// Recalculate rolling 7-day counts so old events naturally expire from the
// weekly leaderboard. Deploying this scheduler is separate from static tests.
exports.refreshKiboWeeklyLeaderboard = onSchedule("every 24 hours", async () => {
  const snap = await getFirestore().collection(KIBO_LEADERBOARD).get();
  for (const doc of snap.docs) await recomputeKiboLeaderboardUser(doc.id);
});
