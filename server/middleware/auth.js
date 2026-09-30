import admin, { db } from "../services/firebase.js";

/**
 * Firebase Admin authentication middleware
 *
 * Expected header:
 * Authorization: Bearer <Firebase ID Token>
 *
 * Requirements:
 * - Valid Firebase ID token
 * - Existing document: admins/{uid}
 * - Admin must not be explicitly disabled
 *
 * The backend is the final authority for admin permissions.
 * Never trust frontend-only authentication checks.
 */

export async function requireAdmin(req, res, next) {
  try {
    const authorization = String(req.headers.authorization || "").trim();

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح. يجب تسجيل الدخول."
      });
    }

    const idToken = authorization.slice("Bearer ".length).trim();

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: "رمز الدخول غير موجود."
      });
    }

    // Verify the Firebase ID token server-side.
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    if (!decodedToken?.uid) {
      return res.status(401).json({
        success: false,
        message: "رمز الدخول غير صالح."
      });
    }

    const uid = decodedToken.uid;

    // Backend-side admin authorization.
    const adminSnap = await db
      .collection("admins")
      .doc(uid)
      .get();

    if (!adminSnap.exists) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية الوصول إلى لوحة الإدارة."
      });
    }

    const adminData = adminSnap.data() || {};

    // Only an explicitly disabled account is rejected.
    if (adminData.active === false) {
      return res.status(403).json({
        success: false,
        message: "حساب الإدارة غير مفعل."
      });
    }

    /**
     * Attach only the information needed by downstream routes.
     *
     * Keep the Firebase token itself out of req.admin.
     * Never store or log the ID token.
     */
    req.admin = {
      uid,
      email: decodedToken.email || adminData.email || "",
      name: adminData.name || "",
      active: adminData.active !== false
    };

    return next();
  } catch (error) {
    /**
     * Do not log tokens or request headers.
     * Only log Firebase's error code/message.
     */
    console.error(
      "Admin authentication error:",
      error?.code || error?.message || "unknown_error"
    );

    switch (error?.code) {
      case "auth/id-token-expired":
      case "auth/id-token-revoked":
        return res.status(401).json({
          success: false,
          message: "انتهت جلسة الدخول. يرجى تسجيل الدخول مرة أخرى."
        });

      case "auth/argument-error":
      case "auth/invalid-id-token":
      case "auth/invalid-credential":
        return res.status(401).json({
          success: false,
          message: "رمز الدخول غير صالح."
        });

      default:
        return res.status(401).json({
          success: false,
          message: "تعذر التحقق من صلاحيات الإدارة."
        });
    }
  }
}
