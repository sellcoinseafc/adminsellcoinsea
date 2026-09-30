import admin, {
  db
} from "../services/firebase.js";

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
 * 2. Token must not be revoked.
 * 3. Existing document: admins/{uid}.
 * 4. Admin document must not be explicitly disabled.
 * 5. If an email is stored in the admin document,
 *    it must match the verified Firebase identity.
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

/**
 * ============================================================================
 * Response Helpers
 * ============================================================================
 */

function unauthorized(
  res,
  message = "غير مصرح. يجب تسجيل الدخول."
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  return res.status(401).json({
    success: false,
    message
  });
}

function forbidden(
  res,
  message =
    "ليس لديك صلاحية الوصول إلى لوحة الإدارة."
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  return res.status(403).json({
    success: false,
    message
  });
}

/**
 * ============================================================================
 * Token Extraction
 * ============================================================================
 */

/**
 * استخراج Firebase ID Token من:
 *
 * Authorization: Bearer <token>
 *
 * لا يتم تسجيل القيمة أو إرجاعها للعميل.
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

  if (!token) {
    return null;
  }

  return token;
}

/**
 * ============================================================================
 * Admin Document
 * ============================================================================
 */

/**
 * قراءة مستند المدير من Firestore.
 *
 * يتم استخدام UID القادم من Firebase فقط.
 *
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
async function getAdminRecord(uid) {
  const adminRef =
    db
      .collection("admins")
      .doc(uid);

  const adminSnap =
    await adminRef.get();

  if (!adminSnap.exists) {
    return null;
  }

  return {
    ref: adminRef,
    data:
      adminSnap.data() || {}
  };
}

/**
 * ============================================================================
 * Admin Middleware
 * ============================================================================
 */

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

    /**
     * ================================================================
     * Firebase Token Verification
     * ================================================================
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
      typeof decodedToken !== "object"
    ) {
      return unauthorized(
        res,
        "رمز الدخول غير صالح."
      );
    }

    const uid =
      String(
        decodedToken.uid || ""
      ).trim();

    if (!uid) {
      return unauthorized(
        res,
        "رمز الدخول غير صالح."
      );
    }

    /**
     * ================================================================
     * Backend Authorization
     * ================================================================
     *
     * وجود:
     *
     * admins/{uid}
     *
     * هو حد الصلاحية الفعلي للوحة الإدارة.
     */
    const adminRecord =
      await getAdminRecord(uid);

    if (!adminRecord) {
      return forbidden();
    }

    const adminData =
      adminRecord.data || {};

    /**
     * ================================================================
     * Admin Active State
     * ================================================================
     *
     * التوافق مع المستندات القديمة:
     *
     * إذا لم توجد active
     * يعتبر الحساب فعالًا.
     *
     * إذا كانت:
     *
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

    /**
     * ================================================================
     * Firebase User Disabled State
     * ================================================================
     *
     * verifyIdToken مع checkRevoked=true
     * يتعامل مع revoked/disabled authentication
     * حسب Firebase Admin SDK.
     *
     * لا نعتمد على بيانات frontend.
     */

    /**
     * ================================================================
     * Identity Validation
     * ================================================================
     */

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

    /**
     * إذا كان البريد محفوظًا في:
     *
     * admins/{uid}
     *
     * يجب أن يطابق البريد الموجود
     * في Firebase ID Token.
     *
     * إذا لم يكن البريد محفوظًا في المستند،
     * لا نفرض وجوده حفاظًا على التوافق
     * مع المستندات القديمة.
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

    /**
     * إذا كان المستند يحتوي على email
     * لكن Firebase Token لا يحتوي على email،
     * لا نسمح بالدخول.
     *
     * هذا يمنع تجاوز مطابقة الهوية.
     */
    if (
      storedEmail &&
      !verifiedEmail
    ) {
      return forbidden(
        res,
        "تعذر التحقق من هوية حساب الإدارة."
      );
    }

    /**
     * ================================================================
     * Safe Request Identity
     * ================================================================
     *
     * نضع فقط البيانات اللازمة للـroutes اللاحقة.
     *
     * لا نضع:
     * - ID Token
     * - Authorization Header
     * - Service Account
     * - Passwords
     * - Backup Codes
     * - IBAN
     * - Payment credentials
     * - أي بيانات حساسة للطلب
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

    return next();

  } catch (error) {
    /**
     * ================================================================
     * Secure Error Handling
     * ================================================================
     *
     * لا نسجل:
     * - Authorization header
     * - Firebase ID Token
     * - request body
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

    /**
     * ================================================================
     * Authentication Errors
     * ================================================================
     */

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

        /**
         * لا نكشف تفاصيل Firebase أو Firestore
         * للعميل.
         *
         * جميع الأخطاء غير المعروفة تتحول
         * إلى رسالة عامة.
         */
        return unauthorized(
          res,
          "تعذر التحقق من صلاحيات الإدارة."
        );
    }
  }
}

export default requireAdmin;
