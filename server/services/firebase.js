/**
 * ============================================================================
 * SAMI COINS - FIREBASE ADMIN CORE
 * ============================================================================
 *
 * مسؤول عن:
 * - تهيئة Firebase Admin SDK مرة واحدة فقط.
 * - توفير Firestore Admin instance.
 * - توفير Firebase Admin Auth.
 *
 * ملاحظات أمنية:
 * - serviceAccountKey.json يبقى على السيرفر فقط.
 * - لا يتم إرسال بيانات المفتاح للواجهة.
 * - لا يتم تسجيل بيانات service account في logs.
 * - هذا الملف Backend-only.
 * ============================================================================
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * الخدمة موجودة داخل:
 *
 * server/services/serviceAccountKey.json
 *
 * استخدام __dirname يجعل المسار ثابتاً بغض النظر عن:
 * - PM2 cwd
 * - طريقة تشغيل Node
 * - مكان استدعاء الملف
 */
const serviceAccountPath = join(
  __dirname,
  "serviceAccountKey.json"
);

if (!existsSync(serviceAccountPath)) {
  throw new Error(
    "Firebase service account key was not found."
  );
}

const serviceAccount = JSON.parse(
  readFileSync(
    serviceAccountPath,
    "utf8"
  )
);

/**
 * Initialize Firebase Admin only once.
 *
 * هذا مهم لأن Node/PM2 قد يعيد تحميل modules أو يستوردها
 * من أكثر من مكان.
 */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      serviceAccount
    )
  });
}

/**
 * Shared Firestore instance.
 */
export const db = admin.firestore();

/**
 * Shared Firebase Admin SDK.
 *
 * يسمح للملفات الأخرى باستخدام:
 *
 * admin.auth()
 * admin.firestore()
 * admin.storage()
 * ...
 */
export default admin;
