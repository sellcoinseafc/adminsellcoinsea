import "dotenv/config";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

// قراءة مفتاح التشفير من .env
const SECRET = (process.env.ENCRYPTION_KEY || "").trim();

if (SECRET.length < 32) {
  throw new Error("ENCRYPTION_KEY must be at least 32 characters.");
}

// اشتقاق مفتاح 32 بايت
const KEY = crypto.createHash("sha256").update(SECRET).digest();

export function encrypt(text) {
  if (text === undefined || text === null || text === "") return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(cipherText) {
  if (!cipherText) return "";

  const data = Buffer.from(cipherText, "base64");

  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
