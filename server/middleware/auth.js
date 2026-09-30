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
 * Requirements:
 * 1. Valid Firebase ID token.
 * 2. Existing document: admins/{uid}.
 * 3. Admin document must not be explicitly disabled.
 *
 * The frontend authentication state is NOT trusted by the backend.
 * Never store the Firebase ID token in req.admin.
 * Never log Authorization headers or tokens.
 * ============================================================================
 */

function unauthorized(res, message = "غير مصرح. يجب تسجيل الدخول.") {
  return res.status(401).json({
    success: false,
    message
  });
}

function forbidden(res, message = "ليس لديك صلاحية الوصول إلى لوحة الإدارة.") {
  return res.status(403).json({
    success: false,
    message
  });
}

/**
 * Extract Firebase Bearer token from the request.
 */
function extractBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();

  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return null;
  }

  const token = String(match[1] || "").trim();

  return token || null;
}

/**
 * Firebase Admin authentication + backend authorization.
 */
export async function requireAdmin(req, res, next) {
  try {
    const idToken = extractBearerToken(req);

    if (!idToken) {
      return unauthorized(res);
    }

    /**
     * Verify the Firebase ID token server-side.
     *
     * checkRevoked=true makes revoked Firebase sessions invalid as well.
     */
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);

    if (!decodedToken?.uid) {
      return unauthorized(res, "رمز الدخول غير صالح.");
    }

    const uid = String(decodedToken.uid);

    /**
     * Backend-side admin authorization.
     *
     * The existence of admins/{uid} is the permission boundary.
     */
    const adminRef = db.collection("admins").doc(uid);
    const adminSnap = await adminRef.get();

    if (!adminSnap.exists) {
      return forbidden();
    }

    const adminData = adminSnap.data() || {};

    /**
     * Only explicitly disabled admins are rejected.
     *
     * This preserves compatibility with existing admin documents that
     * may not contain an "active" field.
     */
    if (adminData.active === false) {
      return forbidden(res, "حساب الإدارة غير مفعل.");
    }

    /**
     * Optional defensive check:
     * If an email is stored in admins/{uid}, it must match the verified
     * Firebase email. This prevents stale/mismatched admin metadata from
     * being treated as the authenticated identity.
     *
     * We do NOT require an email field because older admin documents may
     * not contain one.
     */
    const storedEmail = String(adminData.email || "")
      .trim()
      .toLowerCase();

    const verifiedEmail = String(decodedToken.email || "")
      .trim()
      .toLowerCase();

    if (storedEmail && verifiedEmail && storedEmail !== verifiedEmail) {
      return forbidden(res, "بيانات حساب الإدارة غير متطابقة.");
    }

    /**
     * Attach only safe identity information needed by downstream routes.
     *
     * Never attach:
     * - Firebase ID token
     * - Authorization header
     * - service-account credentials
     */
    req.admin = {
      uid,
      email: verifiedEmail || storedEmail || "",
      name: String(adminData.name || "").trim(),
      active: adminData.active !== false
    };

    return next();
  } catch (error) {
    /**
     * Never log:
     * - Authorization header
     * - Firebase ID token
     * - request body containing sensitive order data
     *
     * Only the Firebase/Admin SDK error code is logged.
     */
    const errorCode = String(error?.code || "").trim();

    console.error(
      "Admin authentication error:",
      errorCode || "unknown_error"
    );

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

      default:
        /**
         * Do not expose internal Firebase/Firestore errors to the client.
         */
        return unauthorized(
          res,
          "تعذر التحقق من صلاحيات الإدارة."
        );
    }
  }
}

export default requireAdmin;
