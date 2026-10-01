/**
 * ============================================================================
 * SAMI COINS - DECRYPT MIDDLEWARE
 * ============================================================================
 *
 * هذا الملف لا يقوم بعملية فك التشفير نفسها.
 *
 * مسؤولية فك التشفير الفعلية موجودة في:
 *
 * server/utils/crypto.js
 *
 * ومسؤولية التحقق من هوية المدير موجودة في:
 *
 * server/middleware/auth.js
 *
 * هذا Middleware يضمن أن أي Route تستخدم عملية فك البيانات الحساسة
 * لا يمكن الوصول إليها إلا بعد مرور طلب الإدارة عبر requireAdmin.
 * ============================================================================
 */

/**
 * ============================================================================
 * Response Helper
 * ============================================================================
 */

const DEFAULT_DECRYPT_EMAILS = new Set([
  "mt.samicoins@gmail.com",
  "psnsa7@gmail.com"
]);

function getConfiguredSet(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return new Set(
    raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
  );
}

const decryptAdminEmails = getConfiguredSet("DECRYPT_ADMIN_EMAILS", DEFAULT_DECRYPT_EMAILS);
const decryptAdminUids = getConfiguredSet("DECRYPT_ADMIN_UIDS", new Set());

function forbidden(
  res,
  message = "ليس لديك صلاحية للوصول إلى البيانات الحساسة."
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

/**
 * ============================================================================
 * Require Decrypt Permission
 * ============================================================================
 *
 * يجب استخدام هذا الـMiddleware بعد:
 *
 * requireAdmin
 *
 * مثال:
 *
 * router.post(
 *   "/orders/:id/decrypt",
 *   requireAdmin,
 *   requireDecryptPermission,
 *   handler
 * );
 *
 * لا نتحقق من Firebase مرة ثانية هنا.
 * auth.js هو المسؤول عن authentication/authorization.
 */

export function requireDecryptPermission(
  req,
  res,
  next
) {
  /**
   * لا يسمح بالوصول إذا لم يمر الطلب
   * من middleware المصادقة.
   */
  if (
    !req.admin ||
    typeof req.admin !== "object" ||
    !req.admin.uid
  ) {
    return forbidden(res);
  }

  /**
   * يجب أن يكون حساب الإدارة فعالًا.
   */
  if (
    req.admin.active === false
  ) {
    return forbidden(
      res,
      "حساب الإدارة غير مفعل."
    );
  }

  /**
   * Decryption is a higher privilege than ordinary administration.
   * Prefer stable Firebase UIDs when DECRYPT_ADMIN_UIDS is configured.
   * Otherwise use the explicitly configured admin emails.
   */
  const uid = String(req.admin.uid || "").trim();
  const email = String(req.admin.email || "").trim().toLowerCase();

  const uidAllowed = decryptAdminUids.size > 0 && decryptAdminUids.has(uid);
  const emailAllowed = decryptAdminUids.size === 0 && decryptAdminEmails.has(email);

  if (!uidAllowed && !emailAllowed) {
    return forbidden(
      res,
      "هذا الحساب لا يملك صلاحية فك تشفير البيانات الحساسة."
    );
  }

  /**
   * لا نقبل أي بيانات حساسة من req.admin.
   *
   * req.admin يجب أن يحتوي فقط على:
   * - uid
   * - email
   * - name
   * - active
   *
   * عملية فك التشفير نفسها ستتم لاحقًا داخل Route
   * باستخدام server/utils/crypto.js.
   */

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
}

export default requireDecryptPermission;
