import "dotenv/config";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/*
 * مفتاح التشفير لا يظهر في الكود.
 *
 * يتم قراءته من:
 * ENCRYPTION_KEY
 */
const SECRET =
  (process.env.ENCRYPTION_KEY || "").trim();

if (SECRET.length < 32) {
  throw new Error(
    "ENCRYPTION_KEY must be at least 32 characters."
  );
}

/*
 * اشتقاق مفتاح AES-256 بطول 32 بايت.
 */
const KEY =
  crypto
    .createHash("sha256")
    .update(SECRET)
    .digest();

/* =========================================================
   Encrypt
========================================================= */

/**
 * تشفير قيمة باستخدام:
 *
 * AES-256-GCM
 *
 * التخزين النهائي:
 *
 * [ IV 12 bytes ]
 * [ Auth Tag 16 bytes ]
 * [ Ciphertext ]
 *
 * ثم Base64.
 */
export function encrypt(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "";
  }

  const iv =
    crypto.randomBytes(
      IV_LENGTH
    );

  const cipher =
    crypto.createCipheriv(
      ALGORITHM,
      KEY,
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        String(value),
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

/* =========================================================
   Decrypt
========================================================= */

/**
 * فك تشفير قيمة AES-256-GCM.
 *
 * إذا كانت القيمة غير صالحة،
 * سيتم رمي الخطأ ليتم التعامل معه
 * في الطبقة المستدعية.
 */
export function decrypt(
  cipherText
) {
  if (
    cipherText === undefined ||
    cipherText === null ||
    cipherText === ""
  ) {
    return "";
  }

  const value =
    String(cipherText);

  const data =
    Buffer.from(
      value,
      "base64"
    );

  /*
   * أقل حجم ممكن:
   *
   * IV 12
   * TAG 16
   */
  if (
    data.length <
    IV_LENGTH +
      AUTH_TAG_LENGTH
  ) {
    throw new Error(
      "Invalid encrypted value."
    );
  }

  const iv =
    data.subarray(
      0,
      IV_LENGTH
    );

  const authTag =
    data.subarray(
      IV_LENGTH,
      IV_LENGTH +
        AUTH_TAG_LENGTH
    );

  const encrypted =
    data.subarray(
      IV_LENGTH +
        AUTH_TAG_LENGTH
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

/* =========================================================
   Encryption Detection
========================================================= */

/**
 * يتحقق بشكل أولي من أن القيمة
 * تبدو كـ ciphertext صادر من نظامنا.
 *
 * مهم:
 * هذه الدالة لا تعتبر القيمة موثوقة
 * ولا تقوم مقام decrypt().
 *
 * تستخدم فقط لتجنب تشفير قيمة مشفرة
 * مرة أخرى في طبقة التوافق القديمة.
 */
export function isEncryptedValue(
  value
) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return false;
  }

  const text =
    value.trim();

  /*
   * Base64 صالح.
   */
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(
      text
    )
  ) {
    return false;
  }

  let decoded;

  try {
    decoded =
      Buffer.from(
        text,
        "base64"
      );
  } catch {
    return false;
  }

  /*
   * يجب أن يحتوي على الأقل على:
   *
   * IV + AuthTag
   */
  if (
    decoded.length <
    IV_LENGTH +
      AUTH_TAG_LENGTH
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   Safe Decrypt
========================================================= */

/**
 * فك تشفير آمن للاستخدام في الأماكن
 * التي لا نريد فيها إسقاط الطلب كاملًا
 * بسبب قيمة تالفة أو قديمة.
 */
export function safeDecrypt(
  value
) {
  try {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "";
    }

    return decrypt(value);
  } catch {
    return "";
  }
}
