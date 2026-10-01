/**
 * SAMI COINS - Canonical server-side order numbering.
 *
 * Customer-facing "رقم الطلب":
 *   8 chars, exactly 5 digits + 3 distinct letters.
 *   First/last chars are digits. I and L are excluded.
 *
 * Internal "الرقم المرجعي":
 *   FC-XXX-N
 *   N is a never-resetting Firestore sequence.
 *
 * Both identifiers are server generated.
 * Customer tracking uses only referenceNumber.
 */
import crypto from "crypto";
import admin, { db } from "./firebase.js";
import {
  generateReferenceNumber,
  isValidReferenceNumber
} from "./orderNumberCore.js";

const RESERVATION_COLLECTION = "orderReferences";
const NUMBERING_DOC = db.collection("system").doc("orderNumbering");
const MAX_RETRIES = 25;

async function reserveReferenceNumber(referenceNumber) {
  const reservationRef = db
    .collection(RESERVATION_COLLECTION)
    .doc(referenceNumber);

  await reservationRef.create({
    referenceNumber,
    reservedAt: admin.firestore.FieldValue.serverTimestamp(),
    permanent: true
  });

  return reservationRef;
}

async function reserveUniqueReference() {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const candidate = generateReferenceNumber();

    if (!isValidReferenceNumber(candidate)) {
      continue;
    }

    try {
      await reserveReferenceNumber(candidate);
      return candidate;
    } catch (error) {
      if (error?.code === 6 || error?.code === "already-exists") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to reserve a unique customer order number.");
}

async function nextInternalReference() {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(NUMBERING_DOC);
    const current = Number(snapshot.exists ? snapshot.data()?.sequence : 0);
    const sequence = Number.isSafeInteger(current) && current >= 0
      ? current + 1
      : 1;

    if (!Number.isSafeInteger(sequence)) {
      throw new Error("Internal reference sequence exceeded safe integer range.");
    }

    const randomPart = String(crypto.randomInt(0, 1000)).padStart(3, "0");

    transaction.set(
      NUMBERING_DOC,
      {
        sequence,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      sequence,
      internalReference: `FC-${randomPart}-${sequence}`
    };
  });
}

/**
 * Generates all server-side identifiers needed by order creation.
 * The customer-facing number is permanently reserved before the caller
 * is allowed to persist the order document.
 */
export async function generateOrderNumbers() {
  const referenceNumber = await reserveUniqueReference();
  const { sequence, internalReference } = await nextInternalReference();

  return {
    orderId: `ORD-${crypto.randomUUID()}`,
    referenceNumber,
    internalReference,
    dailyCode: null,
    serial: sequence
  };
}

export const generateInternalReference = nextInternalReference;
export const generateCustomerOrderNumber = reserveUniqueReference;
