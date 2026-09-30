import admin, { db } from "../services/firebase.js";

/**
 * ============================================================================
 * SAMI COINS - ADMIN AUTH MIDDLEWARE
 * ============================================================================
 *
 * Backend authority for admin authentication and authorization.
 *
 * Expected header:
 * Authorization: Bearer <Firebase ID Token>
 *
 * Authorization requirements:
 * 1. Valid Firebase ID token.
 * 2. Existing document: admins/{uid}.
 * 3. Admin document must not be explicitly disabled.
 *
 * The frontend authentication state is NEVER trusted by the backend.
 *
 * Security rules:
 * - Never store the Firebase ID token in req.admin.
 * - Never log Authorization headers or tokens.
 * - Never log sensitive order data from failed requests.
 * - Never expose Firebase/Admin SDK errors to the client.
 * ============================================================================
 */

/* =========================================================
   Response Helpers
========================================================= */

function unauthorized(
  res,
  message = "غير مصرح. يجب تسجيل الدخول."
) {
  return res.status(401).json({
    success: false,
    message
  });
}

function forbidden(
  res,
  message = "ليس لديك صلاحية الوصول إلى لوحة الإدارة."
) {
  return res.status(403).json({
    success: false,
    message
  });
}

/* =========================================================
   Token Extraction
========================================================= */

/**
 * استخراج Firebase ID Token من:
 *
 * Authorization: Bearer <token>
 */
function extractBearerToken(req) {
  const authorization =
    String(
      req.headers.authorization || ""
    ).trim();

  if (!authorization) {
    return null;
  }

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );

  if (!match) {
    return null;
  }

  const token =
    String(
      match[1] || ""
    ).trim();

  return token || null;
}

/* =========================================================
   Admin Middleware
========================================================= */

/**
 * Firebase authentication +
 * backend admin authorization.
 */
export async function requireAdmin(
  req,
  res,
  next
) {
  try {
    const idToken =
      extractBearerToken(req);

    if (!idToken) {
      return unauthorized(res);
    }

    /*
     * التحقق من Firebase ID Token
     *
     * checkRevoked = true
     *
     * حتى يتم رفض الجلسات التي تم إلغاؤها
     * من Firebase.
     */
    const decodedToken =
      await admin
        .auth()
        .verifyIdToken(
          idToken,
          true
        );

    if (
      !decodedToken ||
      !decodedToken.uid
    ) {
      return unauthorized(
        res,
        "رمز الدخول غير صالح."
      );
    }

    const uid =
      String(
        decodedToken.uid
      ).trim();

    if (!uid) {
      return unauthorized(
        res,
        "رمز الدخول غير صالح."
      );
    }

    /* =====================================================
       Backend Authorization
    ===================================================== */

    /*
     * وجود:
     *
     * admins/{uid}
     *
     * هو حد الصلاحية الفعلي للوحة الإدارة.
     */
    const adminRef =
      db
        .collection("admins")
        .doc(uid);

    const adminSnap =
      await adminRef.get();

    if (!adminSnap.exists) {
      return forbidden();
    }

    const adminData =
      adminSnap.data() || {};

    /*
     * التوافق مع المستندات القديمة:
     *
     * إذا لم توجد active
     * يعتبر الحساب فعالًا.
     *
     * إذا كانت:
     * active === false
     *
     * يتم رفض الدخول.
     */
    if (
      adminData.active === false
    ) {
      return forbidden(
        res,
        "حساب الإدارة غير مفعل."
      );
    }

    /* =====================================================
       Identity Validation
    ===================================================== */

    const storedEmail =
      String(
        adminData.email || ""
      )
        .trim()
        .toLowerCase();

    const verifiedEmail =
      String(
        decodedToken.email || ""
      )
        .trim()
        .toLowerCase();

    /*
     * إذا كان البريد محفوظًا داخل
     * admins/{uid}، يجب أن يطابق البريد
     * الذي تم التحقق منه بواسطة Firebase.
     *
     * لا نفرض وجود email في المستند
     * حفاظًا على توافق المستندات القديمة.
     */
    if (
      storedEmail &&
      verifiedEmail &&
      storedEmail !==
        verifiedEmail
    ) {
      return forbidden(
        res,
        "بيانات حساب الإدارة غير متطابقة."
      );
    }

    /* =====================================================
       Safe Request Identity
    ===================================================== */

    /*
     * نضع فقط البيانات اللازمة
     * للـ routes اللاحقة.
     *
     * لا نضع:
     * - ID Token
     * - Authorization Header
     * - Service Account
     * - بيانات الطلب الحساسة
     */
    req.admin = {
      uid,
      email:
        verifiedEmail ||
        storedEmail ||
        "",
      name: String(
        adminData.name || ""
      ).trim(),
      active:
        adminData.active !== false
    };

    return next();
  } catch (error) {
    /*
     * لا نسجل:
     * - Authorization header
     * - Firebase ID Token
     * - body
     * - بيانات الطلب
     *
     * نسجل فقط Firebase error code.
     */
    const errorCode =
      String(
        error?.code || ""
      ).trim();

    console.error(
      "Admin authentication error:",
      errorCode ||
        "unknown_error"
    );

    /* =====================================================
       Authentication Errors
    ===================================================== */

    switch (errorCode) {
      case "auth/id-token-expired":
      case "auth/id-token-revoked":
        return unauthorized(
          res,
          "انتهت جلسة الدخول. يرجى تسجيل الدخول مرة أخرى."
        );

      case "auth/argument-error":
      case "auth/invalid-id-token":
      case "auth/invalid-credential":
        return unauthorized(
          res,
          "رمز الدخول غير صالح."
        );

      /*
       * بعض إصدارات Firebase Admin SDK
       * قد تستخدم رموزًا مختلفة لحالات
       * التحقق من الجلسة.
       */
      case "auth/user-disabled":
      case "auth/user-not-found":
        return unauthorized(
          res,
          "حساب الإدارة غير صالح."
        );

      default:
        /*
         * لا نكشف تفاصيل Firebase/Firestore
         * للعميل.
         *
         * إذا كان الخطأ متعلقًا بالمصادقة
         * نرجع 401 بشكل آمن.
         */
        return unauthorized(
          res,
          "تعذر التحقق من صلاحيات الإدارة."
        );
    }
  }
}

export default requireAdmin;
