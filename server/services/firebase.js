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
 * الأسرار لا تُخزّن في GitHub:
 * - يمكن تشغيل السيرفر باستخدام متغيرات البيئة.
 * - يوجد fallback لملف serviceAccountKey.json على الـVPS فقط.
 * ============================================================================
 */

import admin from "firebase-admin";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadServiceAccount() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim();

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL?.trim();

  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();

  /*
   * Preferred production path:
   * credentials are supplied through the process environment.
   *
   * This avoids coupling PM2/deployment to a credentials file
   * and makes key rotation possible without changing source code.
   */
  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey
    };
  }

  /*
   * VPS-only fallback for the existing deployment.
   *
   * The file is explicitly ignored by Git and must never be committed.
   */
  const serviceAccountPath = join(
    __dirname,
    "serviceAccountKey.json"
  );

  if (!existsSync(serviceAccountPath)) {
    throw new Error(
      "Firebase credentials are not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY, or provide server/services/serviceAccountKey.json on the server."
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(
      readFileSync(
        serviceAccountPath,
        "utf8"
      )
    );
  } catch {
    throw new Error(
      "Firebase service account key could not be read or parsed."
    );
  }

  if (
    !serviceAccount?.project_id ||
    !serviceAccount?.client_email ||
    !serviceAccount?.private_key
  ) {
    throw new Error(
      "Firebase service account key is missing required credentials."
    );
  }

  return {
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key
  };
}

const serviceAccount = loadServiceAccount();

/**
 * Initialize Firebase Admin only once.
 */
if (!admin.apps.length) {
  admin.initializeApp({
    credential:
      admin.credential.cert(serviceAccount)
  });
}

/**
 * Shared Firestore instance.
 */
export const db = admin.firestore();

/**
 * Shared Firebase Admin SDK.
 */
export default admin;
