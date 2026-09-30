import admin, { db } from "../services/firebase.js";

/**
 * ============================================================================
 * SAMI COINS - ADMIN AUTH MIDDLEWARE
 * ============================================================================
 *
 * مسؤول عن:
 * - التحقق من Firebase ID Token.
 * - التحقق من إلغاء الـ token.
 * - التحقق من وجود admin document.
 * - التحقق من حالة الحساب.
 * - التحقق من تطابق البريد الإلكتروني عند توفره.
 * - إنشاء req.admin آمن للـ routes اللاحقة.
 *
 * Expected header:
 *
 * Authorization: Bearer <Firebase ID Token>
 *
 * ملاحظات أمنية:
 * - لا يتم تخزين الـ ID Token داخل req.admin.
 * - لا يتم تسجيل Authorization header.
 * - لا يتم تسجيل بيانات الطلب.
 * - لا يتم إرجاع أخطاء Firebase الداخلية للعميل.
 * ============================================================================
 */

/* =========================================================
   Response Helpers
========================================================= */

function unauthorized(
  res,
  message = "غير مصرح. يجب تسجيل الدخول."
) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Expires",
    "0"
  );

  return res.status(401).json({
    success: false,
    message
  });
}

function forbidden(
  res,
  message = "ليس لديك صلاحية الوصول إلى لوحة الإدارة."
) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Expires",
    "0"
  );

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
    typeof req?.headers?.authorization === "string"
      ? req.headers.authorization.trim()
      : "";

  if (!authorization) {
    return null;
  }

  const match =
    authorization.match(
      /^Bearer\s+([^\s]+)$/i
    );

  if (!match) {
    return null;
  }

  const token =
    String(match[1] || "").trim();

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
  /*
   * لا نسمح بتخزين أي بيانات مصادقة
   * في حالة الطلب قبل نجاح التحقق.
   */
  req.admin = undefined;

  try {
    /* =====================================================
       1. Extract Token
    ===================================================== */

    const idToken =
      extractBearerToken(req);

    if (!idToken) {
      return unauthorized(
        res,
        "رمز الدخول مطلوب."
      );
    }

    /* =====================================================
       2. Verify Firebase ID Token
    ===================================================== */

    const decodedToken =
      await admin
        .auth()
        .verifyIdToken(
          idToken,
          true
        );

    if (
      !decodedToken ||
      typeof decodedToken !== "object" ||
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
       3. Load Admin Document
    ===================================================== */

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

    /* =====================================================
       4. Check Admin Status
    ===================================================== */

    /*
     * التوافق مع المستندات القديمة:
     *
     * active غير موجود
     * => الحساب يعتبر فعالًا.
     *
     * active === false
     * => الحساب معطل.
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
       5. Identity Validation
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
     * إذا كان البريد موجودًا في:
     *
     * admins/{uid}.email
     *
     * فيجب أن يطابق البريد الموجود
     * داخل Firebase ID Token.
     */
    if (
      storedEmail &&
      verifiedEmail &&
      storedEmail !== verifiedEmail
    ) {
      return forbidden(
        res,
        "بيانات حساب الإدارة غير متطابقة."
      );
    }

    /* =====================================================
       6. Firebase Account State
    ===================================================== */

    /*
     * verifyIdToken(..., true)
     * يتحقق من إلغاء الـ token.
     *
     * نستخدم أيضًا disabled من Firebase User Record
     * إذا كان متاحًا عبر decoded claims/الحساب.
     *
     * لا نعتمد على frontend في هذه النقطة.
     */

    if (
      decodedToken.disabled === true
    ) {
      return unauthorized(
        res,
        "حساب الإدارة غير صالح."
      );
    }

    /* =====================================================
       7. Safe Admin Identity
    ===================================================== */

    /*
     * البيانات التي تحتاجها routes فقط.
     *
     * ممنوع وضع:
     * - ID Token
     * - Authorization Header
     * - Service Account
     * - Firebase credentials
     * - بيانات الطلب الحساسة
     */
    req.admin = Object.freeze({
      uid,

      email:
        verifiedEmail ||
        storedEmail ||
        "",

      name:
        String(
          adminData.name || ""
        ).trim(),

      active:
        adminData.active !== false
    });

    /* =====================================================
       8. Security Headers
    ===================================================== */

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );

    res.setHeader(
      "Expires",
      "0"
    );

    return next();
  } catch (error) {
    /*
     * ممنوع تسجيل:
     * - ID Token
     * - Authorization header
     * - request body
     * - request headers
     * - بيانات الطلب
     * - بيانات المستخدم الحساسة
     *
     * نسجل فقط error code الآمن للتشخيص.
     */

    const errorCode =
      String(
        error?.code || ""
      ).trim();

    console.error(
      "Admin authentication error:",
      errorCode || "unknown_error"
    );

    /* =====================================================
       Firebase Authentication Errors
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

      case "auth/user-disabled":
      case "auth/user-not-found":
        return unauthorized(
          res,
          "حساب الإدارة غير صالح."
        );

      default:
        /*
         * لا نكشف هل المشكلة:
         * - Firebase
         * - Firestore
         * - Token
         * - Admin document
         *
         * للعميل.
         */
        return unauthorized(
          res,
          "تعذر التحقق من صلاحيات الإدارة."
        );
    }
  }
}

/* =========================================================
   Default Export
========================================================= */

export default requireAdmin;
