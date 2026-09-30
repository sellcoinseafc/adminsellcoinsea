import crypto from "crypto";
import admin, { db } from "./firebase.js";

const DAILY_CODES_COLLECTION = "system";
const DAILY_CODES_DOC = "orderNumbering";

const LETTERS = "SAMICOINS";
const DAILY_CODE_COUNT = 4;

/**
 * Generates two random letters from "SAMI COINS".
 * Repetition is allowed.
 */
function randomLetters() {
  const first =
    LETTERS[crypto.randomInt(0, LETTERS.length)];

  const second =
    LETTERS[crypto.randomInt(0, LETTERS.length)];

  return `${first}${second}`;
}

/**
 * Generates a random 3-digit daily code.
 */
function randomDailyCode() {
  return String(crypto.randomInt(100, 1000));
}

/**
 * Returns today's UTC date in YYYY-MM-DD format.
 */
function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Creates the four daily codes once per day.
 *
 * They are stored in:
 * system/orderNumbering
 *
 * The same four codes are reused for every order created
 * during that day.
 */
async function getDailyCodes(transaction) {
  const ref = db
    .collection(DAILY_CODES_COLLECTION)
    .doc(DAILY_CODES_DOC);

  const snap = await transaction.get(ref);
  const today = getTodayKey();

  if (snap.exists) {
    const data = snap.data() || {};

    if (
      data.date === today &&
      Array.isArray(data.codes) &&
      data.codes.length === DAILY_CODE_COUNT
    ) {
      return {
        ref,
        date: today,
        codes: data.codes
      };
    }
  }

  const codes = new Set();

  while (codes.size < DAILY_CODE_COUNT) {
    codes.add(randomDailyCode());
  }

  const dailyCodes = [...codes];

  transaction.set(
    ref,
    {
      date: today,
      codes: dailyCodes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return {
    ref,
    date: today,
    codes: dailyCodes
  };
}

/**
 * Creates the next atomic serial number.
 *
 * Serial is stored separately from the formatted order ID.
 */
async function getNextSerial(transaction, date) {
  const ref = db
    .collection(DAILY_CODES_COLLECTION)
    .doc(DAILY_CODES_DOC);

  const snap = await transaction.get(ref);
  const data = snap.exists ? snap.data() || {} : {};

  const serialDate = data.serialDate === date
    ? date
    : date;

  const currentSerial =
    data.serialDate === serialDate
      ? Number(data.serial || 0)
      : 0;

  const nextSerial = currentSerial + 1;

  transaction.set(
    ref,
    {
      serialDate,
      serial: nextSerial,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return nextSerial;
}

/**
 * Creates:
 *
 * Order ID:
 * XXDDDNN
 *
 * Reference:
 * FC-RRR-NN
 *
 * Example:
 * SA42715
 * FC-583-15
 *
 * The daily code is selected from the four codes generated
 * for the current day.
 */
export async function generateOrderNumbers() {
  return db.runTransaction(async (transaction) => {
    const daily = await getDailyCodes(transaction);

    const serial = await getNextSerial(
      transaction,
      daily.date
    );

    const dailyCode =
      daily.codes[
        crypto.randomInt(0, daily.codes.length)
      ];

    const letters = randomLetters();

    const orderId =
      `${letters}${dailyCode}${serial}`;

    const referenceNumber =
      `FC-${dailyCode}-${serial}`;

    return {
      orderId,
      referenceNumber,
      dailyCode,
      serial
    };
  });
}
