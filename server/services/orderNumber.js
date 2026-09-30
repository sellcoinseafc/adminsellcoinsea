import crypto from "crypto";
import admin, { db } from "./firebase.js";

const NUMBERING_DOC = db
  .collection("system")
  .doc("orderNumbering");

const REFERENCE_COLLECTION = "orderReferences";

/*
 * Customer-facing reference alphabet.
 *
 * I and L are intentionally excluded because they can be confused
 * with 1 in some fonts/screens.
 */
const LETTERS = "ABCDEFGHJKMNOPQRSTUVWXYZ";

/*
 * Customer-facing order reference format:
 *
 * 8 characters total
 * 5 digits + 3 letters
 * first character = digit
 * last character  = digit
 * letters are distributed randomly across the six middle positions
 *
 * Example:
 * 7A42M8Q3
 */
const REFERENCE_LENGTH = 8;
const LETTER_COUNT = 3;
const DIGIT_COUNT = 5;
const MIN_MIDDLE_LETTER_POSITION = 1;
const MAX_MIDDLE_LETTER_POSITION = 6;

/**
 * Number of middle positions available for letters.
 * Positions are zero-based: 1..6.
 */
const MIDDLE_POSITIONS = Array.from(
  {
    length:
      MAX_MIDDLE_LETTER_POSITION -
      MIN_MIDDLE_LETTER_POSITION +
      1
  },
  (_, index) =>
    MIN_MIDDLE_LETTER_POSITION + index
);

/**
 * Selects n distinct items from an array using a cryptographically
 * secure random source.
 */
function randomDistinctItems(items, count) {
  if (count > items.length) {
    throw new Error(
      "Cannot select more distinct items than the source contains."
    );
  }

  const pool = [...items];
  const selected = [];

  for (let i = 0; i < count; i += 1) {
    const index = crypto.randomInt(
      0,
      pool.length
    );

    selected.push(pool[index]);
    pool.splice(index, 1);
  }

  return selected;
}

/**
 * Generate the customer-facing 8-character reference.
 *
 * Rules:
 * - exactly 5 digits
 * - exactly 3 letters
 * - first and last characters are digits
 * - letters are distributed randomly through the middle
 * - letters are distinct inside the same reference
 * - random source is Node crypto, not Math.random
 */
function generateReferenceNumber() {
  const characters =
    Array(REFERENCE_LENGTH).fill(null);

  /* First and last characters are always digits. */
  characters[0] = String(
    crypto.randomInt(0, 10)
  );

  characters[REFERENCE_LENGTH - 1] =
    String(
      crypto.randomInt(0, 10)
    );

  /* Pick 3 different middle positions for the letters. */
  const letterPositions =
    randomDistinctItems(
      MIDDLE_POSITIONS,
      LETTER_COUNT
    );

  /* Pick 3 different letters from the approved alphabet. */
  const selectedLetters =
    randomDistinctItems(
      [...LETTERS],
      LETTER_COUNT
    );

  for (
    let i = 0;
    i < LETTER_COUNT;
    i += 1
  ) {
    characters[letterPositions[i]] =
      selectedLetters[i];
  }

  /* Fill every remaining middle position with a digit. */
  for (
    let i = 1;
    i < REFERENCE_LENGTH - 1;
    i += 1
  ) {
    if (characters[i] === null) {
      characters[i] = String(
        crypto.randomInt(0, 10)
      );
    }
  }

  const reference =
    characters.join("");

  if (
    !isValidReferenceNumber(reference)
  ) {
    throw new Error(
      "Generated order reference failed validation."
    );
  }

  return reference;
}

/**
 * Validate the exact customer-facing reference format.
 */
function isValidReferenceNumber(
  reference
) {
  if (
    typeof reference !== "string" ||
    reference.length !== REFERENCE_LENGTH
  ) {
    return false;
  }

  if (!/^\d.*\d$/.test(reference)) {
    return false;
  }

  const letters =
    reference.match(/[A-Z]/g) || [];

  const digits =
    reference.match(/\d/g) || [];

  if (
    letters.length !== LETTER_COUNT
  ) {
    return false;
  }

  if (
    digits.length !== DIGIT_COUNT
  ) {
    return false;
  }

  if (
    new Set(letters).size !==
    LETTER_COUNT
  ) {
    return false;
  }

  return letters.every(
    (letter) =>
      LETTERS.includes(letter)
  );
}

/**
 * Generate a separate internal business order ID.
 *
 * This value is intentionally not the customer-facing reference.
 * It is cryptographically random and has no sequential information.
 */
function generateInternalOrderId() {
  return `ORD-${crypto.randomUUID()}`;
}

/**
 * Reserve a reference and advance the internal serial atomically.
 *
 * Important:
 * The reference reservation is permanent. Once a reference has been
 * successfully reserved, it is never returned to the available pool,
 * even if the related order is later deleted, archived, or destroyed.
 *
 * Firestore transaction guarantees that two concurrent requests cannot
 * reserve the same reference.
 */
async function reserveReferenceInTransaction() {
  return db.runTransaction(
    async (transaction) => {
      const numberingSnapshot =
        await transaction.get(
          NUMBERING_DOC
        );

      const data =
        numberingSnapshot.exists
          ? numberingSnapshot.data() || {}
          : {};

      const currentSerial =
        Number(data.serial || 0);

      const serial =
        Number.isSafeInteger(
          currentSerial
        )
          ? currentSerial + 1
          : 1;

      if (
        serial >
        Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(
          "Order numbering serial has reached the maximum safe integer."
        );
      }

      /*
       * Generate the candidate inside the transaction callback so a
       * transaction retry receives a fresh candidate.
       */
      const referenceNumber =
        generateReferenceNumber();

      const referenceRef =
        db
          .collection(
            REFERENCE_COLLECTION
          )
          .doc(referenceNumber);

      /*
       * Firestore requires all transaction reads to happen before writes.
       */
      const referenceSnapshot =
        await transaction.get(
          referenceRef
        );

      if (
        referenceSnapshot.exists
      ) {
        const collision =
          new Error(
            "ORDER_REFERENCE_COLLISION"
          );

        collision.code =
          "ORDER_REFERENCE_COLLISION";

        throw collision;
      }

      const orderId =
        generateInternalOrderId();

      transaction.set(
        referenceRef,
        {
          referenceNumber,

          orderId,

          serial,

          reservedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp()
        },
        {
          merge: false
        }
      );

      transaction.set(
        NUMBERING_DOC,
        {
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
        serial
      };
    }
  );
}

/**
 * Generate and permanently reserve a customer-facing order reference.
 *
 * The outer retry is intentionally defensive. Firestore already gives
 * us atomic transaction behavior, while this loop handles the extremely
 * unlikely case where a generated reference collides with an existing
 * reservation.
 */
export async function generateOrderNumbers() {
  const MAX_ATTEMPTS = 20;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const result =
        await reserveReferenceInTransaction();

      return {
        ...result,

        /*
         * Legacy compatibility field.
         * It is derived from the generated reference and is no longer
         * used to generate the customer-facing number.
         */
        dailyCode:
          result.referenceNumber
            .replace(/\D/g, "")
            .slice(0, 3)
      };
    } catch (error) {
      if (
        error?.code ===
          "ORDER_REFERENCE_COLLISION" &&
        attempt < MAX_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Unable to generate a unique order reference after multiple attempts."
  );
}

export default {
  generateOrderNumbers,
  isValidReferenceNumber
};
