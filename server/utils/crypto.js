/**
 * ============================================================================
 * SAMI COINS - ENCRYPTION CORE
 * ============================================================================
 *
 * Encryption:
 *   AES-256-GCM
 *
 * Stored format:
 *   Base64(
 *     IV        = 12 bytes
 *     Auth Tag  = 16 bytes
 *     Ciphertext
 *   )
 *
 * IMPORTANT:
 * - Do not change the stored format without a migration plan.
 * - ENCRYPTION_KEY remains backend-only.
 * - Never send ENCRYPTION_KEY to the frontend.
 * - Never log plaintext sensitive data.
 * ============================================================================
 */

import "dotenv/config";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

const SECRET = String(
  process.env.ENCRYPTION_KEY || ""
).trim();

if (SECRET.length < 32) {
  throw new Error(
    "ENCRYPTION_KEY must be at least 32 characters."
  );
}

/**
 * Derive a stable 32-byte AES key from the backend secret.
 *
 * SHA-256 gives exactly 32 bytes required by AES-256.
 *
 * IMPORTANT:
 * Keep this derivation unchanged so existing encrypted
 * Firestore values remain decryptable.
 */
const KEY = crypto
  .createHash("sha256")
  .update(SECRET, "utf8")
  .digest();

/**
 * Stored binary layout:
 *
 * [ 12 bytes IV ][ 16 bytes Auth Tag ][ Ciphertext ]
 */
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MIN_PAYLOAD_LENGTH =
  IV_LENGTH + AUTH_TAG_LENGTH;

/**
 * Encrypt a value.
 *
 * Empty/null/undefined values remain empty strings.
 *
 * Objects/arrays should be serialized by the caller:
 *   encrypt(JSON.stringify(value))
 */
export function encrypt(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "";
  }

  const plaintext = String(value);

  const iv = crypto.randomBytes(
    IV_LENGTH
  );

  const cipher =
    crypto.createCipheriv(
      ALGORITHM,
      KEY,
      iv
    );

  const encrypted = Buffer.concat([
    cipher.update(
      plaintext,
      "utf8"
    ),
    cipher.final()
  ]);

  const authTag =
    cipher.getAuthTag();

  return Buffer.concat([
    iv,
    authTag,
    encrypted
  ]).toString("base64");
}

/**
 * Decrypt a value.
 *
 * Throws on:
 * - malformed Base64
 * - incomplete encrypted payload
 * - invalid authentication tag
 * - wrong encryption key
 * - corrupted ciphertext
 *
 * Callers that want graceful failure should wrap this
 * function in try/catch, as safeDecrypt() does.
 */
export function decrypt(cipherText) {
  if (
    cipherText === undefined ||
    cipherText === null ||
    cipherText === ""
  ) {
    return "";
  }

  if (
    typeof cipherText !== "string"
  ) {
    throw new TypeError(
      "Encrypted value must be a string."
    );
  }

  const normalized =
    cipherText.trim();

  if (!normalized) {
    return "";
  }

  let data;

  try {
    data = Buffer.from(
      normalized,
      "base64"
    );
  } catch {
    throw new Error(
      "Invalid encrypted payload."
    );
  }

  if (
    data.length <
    MIN_PAYLOAD_LENGTH
  ) {
    throw new Error(
      "Invalid encrypted payload length."
    );
  }

  const iv = data.subarray(
    0,
    IV_LENGTH
  );

  const authTag = data.subarray(
    IV_LENGTH,
    MIN_PAYLOAD_LENGTH
  );

  const encrypted =
    data.subarray(
      MIN_PAYLOAD_LENGTH
    );

  const decipher =
    crypto.createDecipheriv(
      ALGORITHM,
      KEY,
      iv
    );

  decipher.setAuthTag(
    authTag
  );

  const decrypted =
    Buffer.concat([
      decipher.update(
        encrypted
      ),
      decipher.final()
    ]);

  return decrypted.toString(
    "utf8"
  );
}

/**
 * Optional helper for code that needs to determine whether a value
 * looks like one of our encrypted payloads without attempting to
 * expose/decrypt it.
 *
 * This is only a structural check.
 * It does NOT prove that the value can be decrypted.
 */
export function isEncryptedValue(value) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return false;
  }

  try {
    const data = Buffer.from(
      value.trim(),
      "base64"
    );

    return (
      data.length >=
      MIN_PAYLOAD_LENGTH
    );
  } catch {
    return false;
  }
}
