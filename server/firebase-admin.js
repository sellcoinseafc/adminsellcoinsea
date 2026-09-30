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
 * الأمان:
 * - لا يتم استخدام serviceAccountKey.json من المشروع.
 * - بيانات Firebase الحساسة تأتي من Environment Variables فقط.
 * - لا يتم إرسال بيانات Firebase للواجهة.
 * - لا يتم تسجيل بيانات service account في logs.
 * - هذا الملف Backend-only.
 * ============================================================================
 */

import "dotenv/config";
import admin from "firebase-admin";

/**
 * ============================================================================
 * Environment Variables
 * ============================================================================
 *
 * يجب تعريف القيم التالية على السيرفر:
 *
 * FIREBASE_PROJECT_ID
 * FIREBASE_CLIENT_EMAIL
 * FIREBASE_PRIVATE_KEY
 *
 * مثال FIREBASE_PRIVATE_KEY:
 *
 * -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
 *
 * يتم تحويل \n النصية إلى أسطر فعلية قبل تمرير المفتاح إلى Firebase.
 * ============================================================================
 */

const projectId = String(
  process.env.FIREBASE_PROJECT_ID || ""
).trim();

const clientEmail = String(
  process.env.FIREBASE_CLIENT_EMAIL || ""
).trim();

const privateKey = String(
  process.env.FIREBASE_PRIVATE_KEY || ""
).replace(/\\n/g, "\n");

/**
 * ============================================================================
 * Environment Validation
 * ============================================================================
 */

const missingVariables = [];

if (!projectId) {
  missingVariables.push("FIREBASE_PROJECT_ID");
}

if (!clientEmail) {
  missingVariables.push("FIREBASE_CLIENT_EMAIL");
}

if (!privateKey) {
  missingVariables.push("FIREBASE_PRIVATE_KEY");
}

if (missingVariables.length > 0) {
  throw new Error(
    `Missing required Firebase environment variables: ${missingVariables.join(
      ", "
    )}`
  );
}

/**
 * ============================================================================
 * Firebase Admin Initialization
 * ============================================================================
 *
 * نمنع تهيئة Firebase أكثر من مرة.
 *
 * هذا مهم مع:
 * - PM2
 * - تعدد imports
 * - إعادة تحميل بعض أجزاء التطبيق
 * ============================================================================
 */

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey
    })
  });
}

/**
 * ============================================================================
 * Shared Firestore Instance
 * ============================================================================
 */

export const db = admin.firestore();

/**
 * ============================================================================
 * Shared Firebase Admin SDK
 * ============================================================================
 *
 * يسمح للملفات الأخرى باستخدام:
 *
 * admin.auth()
 * admin.firestore()
 * admin.storage()
 * وغيرها.
 * ============================================================================
 */

export default admin;
