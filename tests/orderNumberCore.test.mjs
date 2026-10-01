import test from "node:test";
import assert from "node:assert/strict";
import {
  generateReferenceNumber,
  isValidReferenceNumber
} from "../server/services/orderNumberCore.js";

test("customer reference format is valid and uses exactly three distinct approved letters", () => {
  for (let i = 0; i < 5000; i += 1) {
    const reference = generateReferenceNumber();

    assert.equal(reference.length, 8);
    assert.match(reference, /^\d[A-Z0-9]{6}\d$/);
    assert.equal(isValidReferenceNumber(reference), true);

    const letters = reference.match(/[A-Z]/g) || [];
    const digits = reference.match(/\d/g) || [];

    assert.equal(letters.length, 3);
    assert.equal(digits.length, 5);
    assert.equal(new Set(letters).size, 3);
    assert.equal(letters.includes("I"), false);
    assert.equal(letters.includes("L"), false);
  }
});

test("reference validation rejects malformed or reused-letter values", () => {
  const invalid = [
    "",
    "1234567",
    "A123BC45",
    "012AAB34",
    "012IAB34",
    "012LAB34",
    "012ABC3",
    "012abc34",
    "012ABCD4"
  ];

  for (const reference of invalid) {
    assert.equal(
      isValidReferenceNumber(reference),
      false,
      `Expected invalid reference: ${reference}`
    );
  }
});
