import crypto from "crypto";
import admin, { db } from "./firebase.js";

/*
 * Internal numbering document.
 *
 * The serial stored here is NOT exposed to the customer.
 * It exists as a permanent internal sequence and is never reset.
 */
const NUMBERING_DOC = db
  .collection("system")
  .doc("orderNumbering");

/*
 * Every customer-facing reference is permanently reserved
 * in this collection.
 *
 * Document ID = customer-facing reference number.
 *
 * Example:
 *
 * orderReferences/7A42M8Q3
 */
const REFERENCE_COLLECTION =
  "orderReferences";

/*
 * Customer-facing alphabet.
 *
 * I and L are intentionally excluded because they can be
 * confused with the number 1 in some fonts/screens.
 */
const LETTERS =
  "ABCDEFGHJKMNOPQRSTUVWXYZ";

/*
 * Customer-facing reference format:
 *
 * 8 characters
 * 5 digits
 * 3 letters
 *
 * First character = digit
 * Last character  = digit
 *
 * The three letters are distributed randomly
 * across the six middle positions.
 *
 * Example:
 *
 * 7A42M8Q3
 */
const REFERENCE_LENGTH = 8;
const LETTER_COUNT = 3;
const DIGIT_COUNT = 5;

/*
 * Zero-based positions available for letters.
 *
 * Position 0 = first character and MUST be a digit.
 * Position 7 = last character and MUST be a digit.
 *
 * Therefore letters can only occupy positions 1..6.
 */
const MIDDLE_POSITIONS = [
  1,
  2,
  3,
  4,
  5,
  6
];

/* =========================================================
   Random Helpers
========================================================= */

/**
 * Returns a cryptographically secure random item.
 */
function randomItem(items) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error(
      "Cannot select a random item from an empty collection."
    );
  }

  return items[
    crypto.randomInt(
      0,
      items.length
    )
  ];
}

/**
 * Returns distinct random items.
 */
function randomDistinctItems(
  items,
  count
) {
  if (
    !Array.isArray(items) ||
    items.length < count
  ) {
    throw new Error(
      "Not enough unique items available."
    );
  }

  const pool = [...items];
  const result = [];

  while (
    result.length < count
  ) {
    const index =
      crypto.randomInt(
        0,
        pool.length
      );

    result.push(
      pool[index]
    );

    pool.splice(
      index,
      1
    );
  }

  return result;
}

/**
 * Generates one random decimal digit.
 */
function randomDigit() {
  return String(
    crypto.randomInt(
      0,
      10
    )
  );
}

/* =========================================================
   Customer Reference Generation
========================================================= */

/**
 * Generates the final customer-facing order reference.
 *
 * Rules:
 *
 * - Exactly 8 characters.
 * - Exactly 5 digits.
 * - Exactly 3 letters.
 * - First character is always a digit.
 * - Last character is always a digit.
 * - Letters are randomly distributed through the middle.
 * - Letters are unique within the same reference.
 * - I and L are excluded.
 * - Uses Node.js crypto instead of Math.random().
 *
 * Examples:
 *
 * 7A42M8Q3
 * 3N6C91W8
 * 8K27R5D4
 */
function generateReferenceNumber() {
  const reference =
    Array(
      REFERENCE_LENGTH
    ).fill(null);

  /*
   * First character must be a number.
   */
  reference[0] =
    randomDigit();

  /*
   * Last character must be a number.
   */
  reference[
    REFERENCE_LENGTH - 1
  ] = randomDigit();

  /*
   * Select three different positions
   * from the six middle positions.
   */
  const letterPositions =
    randomDistinctItems(
      MIDDLE_POSITIONS,
      LETTER_COUNT
    );

  /*
   * Select three different letters.
   */
  const selectedLetters =
    randomDistinctItems(
      [...LETTERS],
      LETTER_COUNT
    );

  /*
   * Place the letters.
   */
  for (
    let i = 0;
    i < LETTER_COUNT;
    i += 1
  ) {
    reference[
      letterPositions[i]
    ] =
      selectedLetters[i];
  }

  /*
   * Fill the remaining middle positions
   * with random digits.
   */
  for (
    let position = 1;
    position <
      REFERENCE_LENGTH - 1;
    position += 1
  ) {
    if (
      reference[position] ===
      null
    ) {
      reference[position] =
        randomDigit();
    }
  }

  return reference.join("");
}

/* =========================================================
   Validation
========================================================= */

/**
 * Validates the customer-facing reference.
 */
export function isValidReferenceNumber(
  reference
) {
  if (
    typeof reference !==
      "string" ||
    reference.length !==
      REFERENCE_LENGTH
  ) {
    return false;
  }

  /*
   * First and last must be digits.
   */
  if (
    !/^\d/.test(reference) ||
    !/\d$/.test(reference)
  ) {
    return false;
  }

  /*
   * Only approved digits/letters
   * are allowed.
   */
  if (
    !/^[0-9A-Z]+$/.test(
      reference
    )
  ) {
    return false;
  }

  const letters =
    reference.match(
      /[A-Z]/g
    ) || [];

  const digits =
    reference.match(
      /[0-9]/g
    ) || [];

  /*
   * Exactly 3 letters.
   */
  if (
    letters.length !==
    LETTER_COUNT
  ) {
    return false;
  }

  /*
   * Exactly 5 digits.
   */
  if (
    digits.length !==
    DIGIT_COUNT
  ) {
    return false;
  }

  /*
   * Letters must be unique.
   */
  if (
    new Set(letters).size !==
    LETTER_COUNT
  ) {
    return false;
  }

  /*
   * Make sure every letter belongs
   * to our approved alphabet.
   */
  if (
    !letters.every(
      (letter) =>
        LETTERS.includes(
          letter
        )
    )
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   Internal Order ID
========================================================= */

/**
 * Generates the internal order ID.
 *
 * This value is NOT the customer-facing order number.
 *
 * It is intentionally independent from the visible reference.
 */
function generateInternalOrderId() {
  return `ORD-${crypto.randomUUID()}`;
}

/* =========================================================
  
