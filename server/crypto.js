/**
 * Legacy compatibility shim.
 *
 * Canonical cryptography lives in:
 *   server/utils/crypto.js
 */
export {
  encrypt,
  decrypt,
  isEncryptedValue,
  safeDecrypt
} from "./utils/crypto.js";
