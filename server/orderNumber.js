import crypto from "crypto";
import admin, { db } from "./firebase.js";

const NUMBERING_DOC = db
  .collection("system")
  .doc("orderNumbering");

const LETTERS = "SAMICOINS";
const DAILY_CODE_COUNT = 4;

/*
 * المنطقة الزمنية الرسمية المستخدمة لتوليد
 * الأكواد اليومية.
 *
 * الموقع المستهدف للنظام:
 * السعودية - الرياض
 */
const NUMBERING_TIME_ZONE =
  "Asia/Riyadh";

/* =========================================================
   Date Helpers
========================================================= */

/**
 * يرجع مفتاح اليوم بصيغة:
 *
 * YYYY-MM-DD
 *
 * حسب توقيت الرياض، وليس UTC.
 */
function getTodayKey() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          NUMBERING_TIME_ZONE,

        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    );

  return formatter.format(
    new Date()
  );
}

/* =========================================================
   Random Helpers
========================================================= */

/**
 * حرف عشوائي من:
 *
 * SAMI COINS
 *
 * التكرار مسموح.
 */
function randomLetter() {
  return LETTERS[
    crypto.randomInt(
      0,
      LETTERS.length
    )
  ];
}

/**
 * حرفان عشوائيان.
 */
function randomLetters() {
  return (
    randomLetter() +
    randomLetter()
  );
}

/**
 * كود يومي مكوّن من 3 أرقام:
 *
 * 100 - 999
 */
function randomDailyCode() {
  return String(
    crypto.randomInt(
      100,
      1000
    )
  );
}

/**
 * إنشاء 4 أكواد يومية مختلفة.
 *
 * يتم استدعاؤها فقط عند بداية يوم جديد
 * أو عند اكتشاف بيانات ترقيم غير صالحة.
 */
function createDailyCodes() {
  const codes = new Set();

  while (
    codes.size <
    DAILY_CODE_COUNT
  ) {
    codes.add(
      randomDailyCode()
    );
  }

  return Array.from(codes);
}

/* =========================================================
   Validation
========================================================= */

function isValidDailyCodes(
  codes
) {
  if (
    !Array.isArray(codes) ||
    codes.length !==
      DAILY_CODE_COUNT
  ) {
    return false;
  }

  const unique =
    new Set(codes);

  if (
    unique.size !==
    DAILY_CODE_COUNT
  ) {
    return false;
  }

  return codes.every(
    (code) =>
      /^\d{3}$/.test(
        String(code)
      )
  );
}

/* =========================================================
   Generate Order Numbers
========================================================= */

/**
 * إنشاء أرقام الطلبات داخل Firestore Transaction.
 *
 * Order ID:
 *
 * XXDDDNN
 *
 * حيث:
 * XX = حرفان من SAMI COINS
 * DDD = أحد أكواد اليوم الأربعة
 * NN  = الرقم التسلسلي بدون leading zero
 *
 * مثال:
 *
 * SA42715
 *
 * Reference:
 *
 * FC-RRR-NN
 *
 * مثال:
 *
 * FC-427-15
 *
 * ---------------------------------------------------------
 *
 * ملاحظة:
 * - الأكواد الأربعة تُنشأ مرة واحدة في اليوم.
 * - جميع الطلبات في نفس اليوم تستخدم نفس مجموعة الأكواد.
 * - الرقم التسلسلي يبدأ من 1 كل يوم.
 * - Firestore Transaction تمنع تضارب التسلسل عند
 *   إنشاء طلبات متزامنة.
 * - الطلبات القديمة لا تتأثر.
 */
export async function generateOrderNumbers() {
  return db.runTransaction(
    async (transaction) => {
      /*
       * Firestore requires reads before writes
       * inside a transaction.
       */
      const snapshot =
        await transaction.get(
          NUMBERING_DOC
        );

      const today =
        getTodayKey();

      const data =
        snapshot.exists
          ? snapshot.data() || {}
          : {};

      let dailyCodes =
        Array.isArray(
          data.codes
        )
          ? data.codes
          : [];

      let storedDate =
        data.date || "";

      /*
       * إذا بدأ يوم جديد أو أصبحت بيانات الأكواد
       * غير صالحة، ننشئ مجموعة جديدة.
       */
      if (
        storedDate !== today ||
        !isValidDailyCodes(
          dailyCodes
        )
      ) {
        dailyCodes =
          createDailyCodes();

        storedDate =
          today;
      }

      /*
       * التسلسل الخاص باليوم الحالي.
       *
       * يبدأ من:
       * 1
       *
       * وليس:
       * 01
       */
      const currentSerial =
        data.serialDate === today
          ? Number(
              data.serial || 0
            )
          : 0;

      const serial =
        currentSerial + 1;

      /*
       * اختيار أحد الأكواد اليومية الأربعة.
       */
      const dailyCode =
        dailyCodes[
          crypto.randomInt(
            0,
            dailyCodes.length
          )
        ];

      /*
       * Order ID:
       *
       * XXDDDNN
       *
       * مثال:
       * SA42715
       */
      const orderId =
        `${randomLetters()}${dailyCode}${serial}`;

      /*
       * Reference:
       *
       * FC-RRR-NN
       *
       * مثال:
       * FC-427-15
       */
      const referenceNumber =
        `FC-${dailyCode}-${serial}`;

      /*
       * تحديث سجل الترقيم.
       */
      transaction.set(
        NUMBERING_DOC,
        {
          date:
            storedDate,

          codes:
            dailyCodes,

          serialDate:
            today,

          serial,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp()
        },
        {
          merge: true
        }
      );

      return {
        orderId,
        referenceNumber,
        dailyCode,
        serial
      };
    }
  );
}

export default {
  generateOrderNumbers
};
