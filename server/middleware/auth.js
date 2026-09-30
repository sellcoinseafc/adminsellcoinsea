import admin, { db } from "../services/firebase.js";

/**
 * Firebase Admin authentication middleware
 *
 * Expected header:
 * Authorization: Bearer <Firebase ID Token>
 */

export async function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";

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

    const decodedToken = await admin.auth().verifyIdToken(idToken);

    if (!decodedToken?.uid) {
      return res.status(401).json({
        success: false,
        message: "رمز الدخول غير صالح."
      });
    }

    const adminSnap = await db
      .collection("admins")
      .doc(decodedToken.uid)
      .get();

    if (!adminSnap.exists) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية الوصول إلى لوحة الإدارة."
      });
    }

    const adminData = adminSnap.data() || {};

    if (adminData.active === false) {
      return res.status(403).json({
        success: false,
        message: "حساب الإدارة غير مفعل."
      });
    }

    req.admin = {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      name: adminData.name || "",
      ...adminData
    };

    next();
  } catch (error) {
    console.error(
      "Admin authentication error:",
      error?.code || error?.message
    );

    if (
      error?.code === "auth/id-token-expired" ||
      error?.code === "auth/id-token-revoked"
    ) {
      return res.status(401).json({
        success: false,
        message: "انتهت جلسة الدخول. يرجى تسجيل الدخول مرة أخرى."
      });
    }

    if (
      error?.code === "auth/argument-error" ||
      error?.code === "auth/invalid-id-token"
    ) {
      return res.status(401).json({
        success: false,
        message: "رمز الدخول غير صالح."
      });
    }

    return res.status(401).json({
      success: false,
      message: "تعذر التحقق من صلاحيات الإدارة."
    });
  }
}
