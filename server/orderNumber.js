import crypto from "crypto";
import admin, { db } from "./firebase.js";

const NUMBERING_DOC = db
  .collection("system")
  .doc("orderNumbering");

const LETTERS = "SAMICOINS";
const DAILY_CODE_COUNT = 4;

/**
 * تاريخ اليوم بتوقيت UTC.
 * يتم حفظ الأكواد والتسلسل بحسب هذا التاريخ.
 */
function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * حرف عشوائي من SAMI COINS.
 * التكرار مسموح.
 */
function randomLetter() {
  return LETTERS[crypto.randomInt(0, LETTERS.length)];
}

/**
 * حرفان عشوائيان.
 */
function randomLetters() {
  return `${randomLetter()}${randomLetter()}`;
}

/**
 * كود يومي من 3 أرقام.
 */
function randomDailyCode() {
  return String(crypto.randomInt(100, 1000));
}

/**
 * إنشاء 4 أكواد يومية مختلفة.
 */
function createDailyCodes() {
  const codes = new Set();

  while (codes.size < DAILY_CODE_COUNT) {
    codes.add(randomDailyCode());
  }

  return [...codes];
}

/**
 * توليد رقم الطلب والمرجع بشكل ذري داخل Firestore Transaction.
 *
 * Order ID:
 * XXDDDNN
 *
 * Reference:
 * FC-DDD-NN
 *
 * مثال:
 * SA42715
 * FC-427-15
 */
export async function generateOrderNumbers() {
  return db.runTransaction(async (transaction) => {
    // يجب إجراء جميع القراءات قبل أي write داخل الـ transaction.
    const snap = await transaction.get(NUMBERING_DOC);

    const today = getTodayKey();
    const data = snap.exists ? snap.data() || {} : {};

    let dailyCodes = Array.isArray(data.codes)
      ? data.codes
      : [];

    let storedDate = data.date || "";

    /*
     * إذا تغير اليوم أو كانت الأكواد غير صالحة،
     * ننشئ 4 أكواد جديدة لهذا اليوم.
     */
    if (
      storedDate !== today ||
      dailyCodes.length !== DAILY_CODE_COUNT ||
      new Set(dailyCodes).size !== DAILY_CODE_COUNT
    ) {
      dailyCodes = createDailyCodes();
      storedDate = today;
    }

    /*
     * التسلسل يبدأ من 1 في كل يوم.
     * لا يوجد leading zero.
     */
    const currentSerial =
      data.serialDate === today
        ? Number(data.serial || 0)
        : 0;

    const serial = currentSerial + 1;

    /*
     * اختيار أحد الأكواد الأربعة اليومية.
     */
    const dailyCode =
      dailyCodes[
        crypto.randomInt(0, dailyCodes.length)
      ];

    const orderId =
      `${randomLetters()}${dailyCode}${serial}`;

    const referenceNumber =
      `FC-${dailyCode}-${serial}`;

    /*
     * كتابة الحالة الجديدة بعد إتمام جميع القراءات.
     */
    transaction.set(
      NUMBERING_DOC,
      {
        date: storedDate,
        codes: dailyCodes,
        serialDate: today,
        serial,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      orderId,
      referenceNumber,
      dailyCode,
      serial
    };
  });
}
