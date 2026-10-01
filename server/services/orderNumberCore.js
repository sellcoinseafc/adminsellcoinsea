/**
 * Pure customer reference-number generation/validation.
 *
 * Kept separate from Firestore reservation logic so the format can be
 * regression-tested without initializing Firebase Admin.
 */
import crypto from "crypto";

const LETTERS = "ABCDEFGHJKMNOPQRSTUVWXYZ";
const MIDDLE_POSITIONS = [1, 2, 3, 4, 5, 6];

function randomDigit() {
  return String(crypto.randomInt(0, 10));
}

function randomDistinct(items, count) {
  const pool = [...items];
  const result = [];

  while (result.length < count) {
    const index = crypto.randomInt(0, pool.length);
    result.push(pool[index]);
    pool.splice(index, 1);
  }

  return result;
}

export function generateReferenceNumber() {
  const value = Array(8).fill("");

  value[0] = randomDigit();
  value[7] = randomDigit();

  const positions = randomDistinct(MIDDLE_POSITIONS, 3);
  const letters = randomDistinct([...LETTERS], 3);

  positions.forEach((position, index) => {
    value[position] = letters[index];
  });

  for (let i = 1; i < 7; i += 1) {
    if (!value[i]) value[i] = randomDigit();
  }

  return value.join("");
}

export function isValidReferenceNumber(reference) {
  if (typeof reference !== "string" || reference.length !== 8) {
    return false;
  }

  if (!/^\d[A-Z0-9]{6}\d$/.test(reference)) {
    return false;
  }

  const letters = reference.match(/[A-Z]/g) || [];
  const digits = reference.match(/\d/g) || [];

  return (
    letters.length === 3 &&
    digits.length === 5 &&
    new Set(letters).size === 3 &&
    letters.every((letter) => LETTERS.includes(letter))
  );
}
