/* SAMI_COINS_ADMIN_V3: canonical admin/security lifecycle */
import express from "express";
import admin from "firebase-admin";
import { db } from "../services/firebase.js";
import {
  decrypt,
  isEncryptedValue
} from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import {
  requireDecryptPermission
} from "../middleware/decrypt.js";

const router = express.Router();

/**
 * ============================================================================
 * SAMI COINS - ADMIN ROUTES
 * ============================================================================
 *
 * مسؤول عن:
 * - التحقق من وجود الطلب.
 * - فك تشفير البيانات الحساسة للمشرف المصرح له فقط.
 * - دعم الطلبات القديمة والجديدة.
 * - توحيد payoutDetails مع paymentInfoData القديمة.
 * - إدارة نافذة كشف البيانات الحساسة لمدة 90 ثانية على الخادم.
 *
 * ملاحظات أمنية:
 * - لا يتم إرسال Firestore document كامل للواجهة.
 * - لا يتم تسجيل البيانات المفكوكة.
 * - لا يتم تخزين البيانات المفكوكة في Firestore.
 * - requireAdmin هو الحاجز الأساسي.
 * - البيانات القديمة غير المشفرة تبقى قابلة للقراءة للتوافق.
 * - البيانات المشفرة لا يتم إرسال ciphertext الخاص بها.
 * - بعد الإتلاف لا يمكن إعادة كشف بيانات EA.
 * ============================================================================
 */

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DECRYPT_WINDOW_MS = 90_000;

const adminMutationRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) =>
    `admin:${String(req.admin?.uid || req.ip || "unknown")}`,
  message: "عدد عمليات الإدارة مرتفع جدًا. حاول مرة أخرى بعد قليل."
});

const decryptRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) =>
    `decrypt:${String(req.admin?.uid || req.ip || "unknown")}`,
  message: "محاولات فك التشفير كثيرة جدًا. حاول مرة أخرى بعد قليل."
});

const MAX_IDENTIFIER_LENGTH = 200;

/**
 * ============================================================================
 * Server-side decrypt windows
 * ============================================================================
 *
 * المفتاح:
 *
 *   admin UID + Firestore document ID
 *
 * القيمة:
 *
 *   وقت بداية نافذة الكشف.
 *
 * السلوك:
 *
 * - أول طلب كشف يبدأ نافذة 90 ثانية.
 * - إعادة طلب نفس الطلب خلال النافذة لا تمددها.
 * - بعد انتهاء النافذة، يبدأ طلب كشف جديد نافذة جديدة.
 * - إعادة تشغيل Node/PM2 تنظف الذاكرة تلقائياً.
 *
 * ملاحظة:
 * هذه النافذة تمنع تمديد الكشف عن طريق إعادة استدعاء API.
 * أما البيانات التي سبق إرسالها للمتصفح فلا يمكن للسيرفر
 * حذفها من ذاكرة المتصفح؛ لذلك الواجهة أيضاً تطبق مؤقت الـ90 ثانية.
 */

const decryptWindows = new Map();

function getDecryptWindowKey(
  uid,
  orderDocumentId
) {
  return [
    String(uid || ""),
    String(orderDocumentId || "")
  ].join(":");
}

function cleanupExpiredDecryptWindows() {
  const now = Date.now();

  for (
    const [key, startedAt]
    of decryptWindows.entries()
  ) {
    if (
      !Number.isFinite(startedAt) ||
      now - startedAt >= DECRYPT_WINDOW_MS
    ) {
      decryptWindows.delete(key);
    }
  }
}

function getOrCreateDecryptWindow(
  uid,
  orderDocumentId
) {
  cleanupExpiredDecryptWindows();

  const key =
    getDecryptWindowKey(
      uid,
      orderDocumentId
    );

  const now = Date.now();

  let startedAt =
    decryptWindows.get(key);

  /**
   * لا نمدد النافذة الموجودة.
   */
  if (
    !Number.isFinite(startedAt) ||
    now - startedAt >= DECRYPT_WINDOW_MS
  ) {
    startedAt = now;

    decryptWindows.set(
      key,
      startedAt
    );
  }

  const expiresAt =
    startedAt +
    DECRYPT_WINDOW_MS;

  return {
    startedAt,
    expiresAt,
    remainingMs:
      Math.max(
        0,
        expiresAt - now
      )
  };
}

/**
 * تنظيف دوري للذاكرة.
 *
 * unref() حتى لا يمنع المؤقت عملية Node من الإغلاق.
 */
const decryptCleanupTimer =
  setInterval(
    cleanupExpiredDecryptWindows,
    30_000
  );

if (
  typeof decryptCleanupTimer.unref ===
  "function"
) {
  decryptCleanupTimer.unref();
}

/**
 * ============================================================================
 * Safe decrypt
 * ============================================================================
 *
 * الحالات المدعومة:
 *
 * 1. encrypted value
 * 2. legacy plaintext
 * 3. empty value
 * 4. array/object legacy values
 *
 * مهم:
 * إذا كانت القيمة encrypted وفشل فكها،
 * نرجع قيمة فارغة وليس ciphertext.
 */

function safeDecrypt(value) {
  try {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "";
    }

    /**
     * لا نحاول فك object/array هنا.
     * التعامل معها يتم في helpers المتخصصة.
     */
    if (
      Array.isArray(value) ||
      typeof value === "object"
    ) {
      return value;
    }

    const stringValue =
      String(value).trim();

    if (!stringValue) {
      return "";
    }

    /**
     * قيمة قديمة plaintext.
     */
    if (
      !isEncryptedValue(
        stringValue
      )
    ) {
      return stringValue;
    }

    /**
     * قيمة جديدة encrypted.
     */
    const decrypted =
      decrypt(stringValue);

    if (
      decrypted === null ||
      decrypted === undefined
    ) {
      return "";
    }

    return decrypted;
  } catch {
    /**
     * لا نعيد ciphertext عند الفشل.
     */
    return "";
  }
}

/**
 * ============================================================================
 * Identifier validation
 * ============================================================================
 */

function normalizeIdentifier(value) {
  const identifier =
    String(value || "")
      .trim();

  if (!identifier) {
    return "";
  }

  if (
    identifier.length >
    MAX_IDENTIFIER_LENGTH
  ) {
    return "";
  }

  return identifier;
}

/**
 * ============================================================================
 * Find order
 * ============================================================================
 *
 * البحث بالترتيب:
 *
 * 1. Firestore document ID
 * 2. business orderId
 * 3. customer referenceNumber
 *
 * هذا يحافظ على:
 * - الطلبات القديمة.
 * - الطلبات الجديدة.
 */

async function findOrder(
  identifier
) {
  const value =
    normalizeIdentifier(
      identifier
    );

  if (!value) {
    return null;
  }

  /**
   * --------------------------------------------------------------------------
   * 1. Firestore document ID
   * --------------------------------------------------------------------------
   */

  const directSnap =
    await db
      .collection("orders")
      .doc(value)
      .get();

  if (directSnap.exists) {
    return {
      id: directSnap.id,
      data:
        directSnap.data() || {}
    };
  }

  /**
   * --------------------------------------------------------------------------
   * 2. Business orderId
   * --------------------------------------------------------------------------
   */

  const orderIdSnap =
    await db
      .collection("orders")
      .where(
        "orderId",
        "==",
        value
      )
      .limit(1)
      .get();

  if (!orderIdSnap.empty) {
    const orderDoc =
      orderIdSnap.docs[0];

    return {
      id: orderDoc.id,
      data:
        orderDoc.data() || {}
    };
  }

  /**
   * --------------------------------------------------------------------------
   * 3. Customer referenceNumber
   * --------------------------------------------------------------------------
   */

  const referenceSnap =
    await db
      .collection("orders")
      .where(
        "referenceNumber",
        "==",
        value
      )
      .limit(1)
      .get();

  if (!referenceSnap.empty) {
    const orderDoc =
      referenceSnap.docs[0];

    return {
      id: orderDoc.id,
      data:
        orderDoc.data() || {}
    };
  }

  return null;
}

/**
 * ============================================================================
 * Payment normalization
 * ============================================================================
 *
 * الجديد:
 *   payoutDetails
 *
 * القديم:
 *   paymentInfoData
 */

function getPayoutDetails(order) {
  const payout =
    order.payoutDetails &&
    typeof order.payoutDetails === "object" &&
    !Array.isArray(order.payoutDetails)
      ? order.payoutDetails
      : null;

  if (payout) {
    const method =
      String(
        payout.method ||
        order.paymentMethodType ||
        order.paymentMethod ||
        ""
      )
        .trim()
        .toLowerCase();

    let payoutType =
      String(
        payout.payoutType ||
        ""
      )
        .trim()
        .toLowerCase();

    if (!payoutType) {
      payoutType =
        method === "bank" ||
        method === "wallet"
          ? "local"
          : "international";
    }

    return {
      ...payout,
      method,
      payoutType
    };
  }

  /**
   * Legacy paymentInfoData.
   */
  const legacy =
    order.paymentInfoData &&
    typeof order.paymentInfoData === "object" &&
    !Array.isArray(order.paymentInfoData)
      ? order.paymentInfoData
      : {};

  const method =
    String(
      order.paymentMethodType ||
      order.paymentMethod ||
      legacy.method ||
      ""
    )
      .trim()
      .toLowerCase();

  return {
    ...legacy,
    method,
    payoutType:
      method === "bank" ||
      method === "wallet"
        ? "local"
        : "international"
  };
}

/**
 * ============================================================================
 * EA account helpers
 * ============================================================================
 */

function getAccountData(order) {
  if (
    order.accountData &&
    typeof order.accountData === "object" &&
    !Array.isArray(order.accountData)
  ) {
    return order.accountData;
  }

  return {};
}

function normalizeBackupCodes(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return [];
  }

  /**
   * Legacy/new array.
   */
  if (Array.isArray(value)) {
    return value
      .map((code) =>
        String(code ?? "")
      )
      .filter(Boolean);
  }

  const decrypted =
    safeDecrypt(value);

  if (
    Array.isArray(decrypted)
  ) {
    return decrypted
      .map((code) =>
        String(code ?? "")
      )
      .filter(Boolean);
  }

  const stringValue =
    String(
      decrypted ?? ""
    ).trim();

  if (!stringValue) {
    return [];
  }

  /**
   * encrypted JSON array
   * after decryption.
   */
  try {
    const parsed =
      JSON.parse(
        stringValue
      );

    if (
      Array.isArray(parsed)
    ) {
      return parsed
        .map((code) =>
          String(code ?? "")
        )
        .filter(Boolean);
    }
  } catch {
    // fallback below
  }

  /**
   * Legacy strings.
   */
  return stringValue
    .split(/\r?\n|,|\s+/)
    .map((code) =>
      String(code ?? "")
    )
    .filter(Boolean);
}

function buildAccountResponse(
  order
) {
  /**
   * بعد الإتلاف:
   * لا نحاول فك البيانات مرة أخرى.
   */
  if (
    order.sensitivePurged === true ||
    order.sensitiveDataPurged === true ||
    order.purgedAt
  ) {
    return {
      eaEmail: "",
      eaPassword: "",
      backupCodes: []
    };
  }

  const account =
    getAccountData(order);

  return {
    eaEmail:
      safeDecrypt(
        account.eaEmail
      ),

    eaPassword:
      safeDecrypt(
        account.eaPassword
      ),

    backupCodes:
      normalizeBackupCodes(
        account.backupCodes
      )
  };
}

/**
 * ============================================================================
 * Payment response
 * ============================================================================
 *
 * هنا فقط يتم فك بيانات الدفع للمشرف المصرح له.
 *
 * لا يتم حفظ النتيجة في Firestore.
 */

function buildPaymentResponse(
  order
) {
  const payout =
    getPayoutDetails(order);

  const method =
    String(
      payout.method || ""
    )
      .trim()
      .toLowerCase();

  const response = {
    payoutType:
      payout.payoutType || "",

    method,

    bankName: "",
    fullName: "",
    iban: "",
    recipientName: "",

    walletName: "",
    walletPhone: "",

    walletAddress: "",
    network: "",

    paypalEmail: "",

    fullNameEnglish: "",
    country: ""
  };

  switch (method) {
    /**
     * ------------------------------------------------------------------------
     * Bank
     * ------------------------------------------------------------------------
     */

    case "bank": {
      response.bankName =
        String(
          payout.bankName ||
          ""
        );

      response.fullName =
        safeDecrypt(
          payout.fullName
        );

      response.iban =
        safeDecrypt(
          payout.iban
        );

      response.recipientName =
        safeDecrypt(
          payout.recipientName
        );

      break;
    }

    /**
     * ------------------------------------------------------------------------
     * Wallet
     * ------------------------------------------------------------------------
     */

    case "wallet": {
      response.walletName =
        String(
          payout.walletName ||
          payout.name ||
          ""
        );

      response.walletPhone =
        safeDecrypt(
          payout.phone ||
          payout.walletPhone ||
          payout.walletNumber
        );

      break;
    }

    /**
     * ------------------------------------------------------------------------
     * USDT
     * ------------------------------------------------------------------------
     */

    case "usdt": {
      response.walletAddress =
        safeDecrypt(
          payout.wallet ||
          payout.usdtWallet ||
          payout.walletAddress
        );

      response.network =
        String(
          payout.network ||
          ""
        );

      break;
    }

    /**
     * ------------------------------------------------------------------------
     * PayPal
     * ------------------------------------------------------------------------
     */

    case "paypal": {
      response.paypalEmail =
        safeDecrypt(
          payout.email ||
          payout.paypalEmail
        );

      break;
    }

    /**
     * ------------------------------------------------------------------------
     * Western Union
     * ------------------------------------------------------------------------
     */

    case "western": {
      response.fullNameEnglish =
        safeDecrypt(
          payout.fullNameEnglish ||
          payout.fullName ||
          payout.westernName
        );

      response.country =
        safeDecrypt(
          payout.country ||
          payout.westernCountry
        );

      break;
    }

    default:
      break;
  }

  return response;
}

/**
 * ============================================================================
 * Public admin API health
 * ============================================================================
 *
 * هذا endpoint لا يحتاج بيانات حساسة.
 */

router.get(
  "/",
  (_, res) => {
    return res.json({
      success: true,
      message:
        "Admin API Ready"
    });
  }
);

router.get(
  "/session",
  requireAdmin,
  async (req, res) => {
    return res.json({
      success: true,
      admin: {
        uid: String(req.admin?.uid || ""),
        email: String(req.admin?.email || ""),
        name: String(req.admin?.name || "مشرف النظام"),
        role: "admin",
        active: req.admin?.active !== false
      }
    });
  }
);

/**
 * ============================================================================
 * POST /api/admin/decrypt-order
 * ============================================================================
 *
 * Protected:
 *   requireAdmin
 *
 * مدة نافذة الكشف:
 *   90 ثانية.
 *
 * مهم:
 *
 * expiresAt ليس مجرد قيمة للواجهة.
 * يتم حسابه من نافذة محفوظة على الخادم.
 *
 * إعادة استدعاء نفس الطلب خلال الـ90 ثانية:
 * لا تمدد النافذة.
 */

router.post(
  "/decrypt-order",
  requireAdmin,
  adminMutationRateLimit,
  requireDecryptPermission,
  decryptRateLimit,
  async (req, res) => {
    try {
      const orderIdentifier =
        normalizeIdentifier(
          req.body?.orderId
        );

      if (!orderIdentifier) {
        return res.status(400).json({
          success: false,
          message:
            "رقم الطلب مطلوب"
        });
      }

      /**
       * البحث عن الطلب.
       */
      const found =
        await findOrder(
          orderIdentifier
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message:
            "الطلب غير موجود"
        });
      }

      const order =
        found.data || {};

      /**
       * ----------------------------------------------------------------------
       * الإتلاف النهائي
       * ----------------------------------------------------------------------
       *
       * إذا تم حذف بيانات EA:
       * لا يمكن إعادة كشفها.
       */

      if (
        order.sensitivePurged === true ||
        order.sensitiveDataPurged === true ||
        order.purgedAt
      ) {
        return res.status(410).json({
          success: false,
          message:
            "تم إتلاف البيانات الحساسة لهذا الطلب نهائياً."
        });
      }

      /**
       * ----------------------------------------------------------------------
       * Server-side decrypt window
       * ----------------------------------------------------------------------
       */

      const decryptWindow =
        getOrCreateDecryptWindow(
          req.admin.uid,
          found.id
        );

      /**
       * ----------------------------------------------------------------------
       * فك بيانات EA
       * ----------------------------------------------------------------------
       */

      const account =
        buildAccountResponse(
          order
        );

      /**
       * ----------------------------------------------------------------------
       * فك بيانات الدفع
       * ----------------------------------------------------------------------
       */

      const payment =
        buildPaymentResponse(
          order
        );

      const payout =
        getPayoutDetails(
          order
        );

      /**
       * ----------------------------------------------------------------------
       * Build safe admin response
       * ----------------------------------------------------------------------
       *
       * لا نرسل order كامل.
       */

      const response = {
        orderId:
          String(
            order.orderId ||
            found.id
          ),

        referenceNumber:
          String(
            order.referenceNumber ||
            ""
          ),

        internalReference:
          String(
            order.internalReference ||
            ""
          ),

        customerName:
          String(
            order.customerName ||
            ""
          ),

        phone:
          String(
            order.phone ||
            ""
          ),

        adminNote:
          String(
            order.adminNote ||
            ""
          ),

        customerEmail:
          String(
            order.customerEmail ||
            ""
          ),

        platform:
          String(
            order.platform ||
            ""
          ),

        paymentMethod:
          String(
            payout.method ||
            order.paymentMethodType ||
            order.paymentMethod ||
            ""
          ),

        payoutType:
          String(
            payout.payoutType ||
            ""
          ),

        account,

        payment,

        /**
         * وقت انتهاء النافذة الحقيقي
         * على الخادم.
         */
        expiresAt:
          decryptWindow.expiresAt
      };

      await writeSecurityAudit({
        adminIdentity: req.admin,
        headers: req.headers,
        action: "فك تشفير بيانات حساسة",
        targetOrder: response.referenceNumber || response.orderId,
        details: "تم كشف بيانات حساسة ضمن نافذة الخادم المحددة"
      });

      return res.json({
        success: true,
        data: response
      });
    } catch (error) {
      /**
       * ممنوع تسجيل:
       * - Authorization token
       * - EA credentials
       * - backup codes
       * - IBAN
       * - wallet address
       * - PayPal email
       * - ciphertext
       */
      console.error(
        "Admin decrypt-order error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر فك تشفير بيانات الطلب."
      });
    }
  }
);

/**
 * ============================================================================
 * POST /api/admin/destroy-sensitive-data
 * ============================================================================
 *
 * إتلاف نهائي للبيانات الحساسة للطلب.
 *
 * - يتطلب مديرًا موثقًا.
 * - يحذف فقط الحقول الحساسة المعروفة.
 * - لا يحذف سجل الطلب.
 * - بعد النجاح يتم وضع علامة sensitivePurged.
 *
 * ملاحظة:
 * Firestore update/deleteField() يجعل الحقول غير قابلة للاسترجاع من السجل.
 * ============================================================================
 */

router.post(
  "/destroy-sensitive-data",
  requireAdmin,
  adminMutationRateLimit,
  async (req, res) => {
    try {
      const orderIdentifier =
        normalizeIdentifier(
          req.body?.orderId
        );

      if (req.body?.confirm !== true) {
        return res.status(400).json({
          success: false,
          message: "يجب تأكيد إتلاف البيانات الحساسة."
        });
      }

      if (!orderIdentifier) {
        return res.status(400).json({
          success: false,
          message:
            "رقم الطلب مطلوب"
        });
      }

      const found =
        await findOrder(
          orderIdentifier
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message:
            "الطلب غير موجود"
        });
      }

      const order =
        found.data || {};

      /*
       * إذا تم الإتلاف مسبقًا، لا نعيد العملية.
       */
      if (
        order.sensitivePurged === true ||
        order.sensitiveDataPurged === true ||
        order.purgedAt
      ) {
        return res.status(409).json({
          success: false,
          message:
            "تم إتلاف البيانات الحساسة لهذا الطلب مسبقًا."
        });
      }

      const status =
        String(order.status || "").toLowerCase();

      if (status !== "completed") {
        return res.status(400).json({
          success: false,
          message: "لا يمكن إتلاف البيانات الحساسة قبل اكتمال الطلب."
        });
      }

      const completedAt = order.completedAt?.toDate
        ? order.completedAt.toDate()
        : order.completedAt
          ? new Date(order.completedAt)
          : null;

      const purgeDueAt = order.purgeDueAt?.toDate
        ? order.purgeDueAt.toDate()
        : order.purgeDueAt
          ? new Date(order.purgeDueAt)
          : completedAt
            ? new Date(completedAt.getTime() + 5 * 24 * 60 * 60 * 1000)
            : null;

      if (!purgeDueAt || Number.isNaN(purgeDueAt.getTime()) || purgeDueAt.getTime() > Date.now()) {
        return res.status(400).json({
          success: false,
          message: "لم يحِن موعد إتلاف البيانات الحساسة بعد."
        });
      }

      const FieldValue =
        admin.firestore.FieldValue;

      const updateData = {
        "accountData.eaEmail":
          FieldValue.delete(),

        "accountData.eaPassword":
          FieldValue.delete(),

        "accountData.backupCodes":
          FieldValue.delete(),

        /* Legacy top-level copies. */
        eaEmail:
          FieldValue.delete(),

        eaPassword:
          FieldValue.delete(),

        backupCodes:
          FieldValue.delete(),

        "payoutDetails.fullName":
          FieldValue.delete(),

        "payoutDetails.iban":
          FieldValue.delete(),

        "payoutDetails.phone":
          FieldValue.delete(),

        "payoutDetails.walletPhone":
          FieldValue.delete(),

        "payoutDetails.walletNumber":
          FieldValue.delete(),

        "payoutDetails.wallet":
          FieldValue.delete(),

        "payoutDetails.usdtWallet":
          FieldValue.delete(),

        "payoutDetails.walletAddress":
          FieldValue.delete(),

        "payoutDetails.email":
          FieldValue.delete(),

        "payoutDetails.paypalEmail":
          FieldValue.delete(),

        "payoutDetails.fullNameEnglish":
          FieldValue.delete(),

        "payoutDetails.westernName":
          FieldValue.delete(),

        "payoutDetails.country":
          FieldValue.delete(),

        "payoutDetails.westernCountry":
          FieldValue.delete(),

        /*
         * Legacy paymentInfoData.
         */
        "paymentInfoData.fullName":
          FieldValue.delete(),

        "paymentInfoData.iban":
          FieldValue.delete(),

        "paymentInfoData.phone":
          FieldValue.delete(),

        "paymentInfoData.walletPhone":
          FieldValue.delete(),

        "paymentInfoData.walletNumber":
          FieldValue.delete(),

        "paymentInfoData.wallet":
          FieldValue.delete(),

        "paymentInfoData.usdtWallet":
          FieldValue.delete(),

        "paymentInfoData.walletAddress":
          FieldValue.delete(),

        "paymentInfoData.email":
          FieldValue.delete(),

        "paymentInfoData.paypalEmail":
          FieldValue.delete(),

        "paymentInfoData.fullNameEnglish":
          FieldValue.delete(),

        "paymentInfoData.westernName":
          FieldValue.delete(),

        "paymentInfoData.country":
          FieldValue.delete(),

        "paymentInfoData.westernCountry":
          FieldValue.delete(),

        sensitivePurged: true,

        sensitiveDataPurged: true,

        purgedAt:
          FieldValue.serverTimestamp(),

        purgedBy:
          String(
            req.admin.uid
          )
      };

      const purgeRef = db.collection("orders").doc(found.id);
      const purgeAuditRef = db.collection("audit_logs").doc();

      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(purgeRef);

        if (!freshSnap.exists) {
          const error = new Error("ORDER_NOT_FOUND");
          error.code = "ORDER_NOT_FOUND";
          throw error;
        }

        const freshOrder = freshSnap.data() || {};

        if (
          freshOrder.sensitivePurged === true ||
          freshOrder.sensitiveDataPurged === true ||
          freshOrder.purgedAt
        ) {
          const error = new Error("ALREADY_PURGED");
          error.code = "ALREADY_PURGED";
          throw error;
        }

        const freshStatus = String(freshOrder.status || "").toLowerCase();
        if (freshStatus !== "completed") {
          const error = new Error("ORDER_NOT_COMPLETED");
          error.code = "ORDER_NOT_COMPLETED";
          throw error;
        }

        const freshCompletedAt = freshOrder.completedAt?.toDate
          ? freshOrder.completedAt.toDate()
          : freshOrder.completedAt
            ? new Date(freshOrder.completedAt)
            : null;

        const freshPurgeDueAt = freshOrder.purgeDueAt?.toDate
          ? freshOrder.purgeDueAt.toDate()
          : freshOrder.purgeDueAt
            ? new Date(freshOrder.purgeDueAt)
            : freshCompletedAt
              ? new Date(freshCompletedAt.getTime() + 5 * 24 * 60 * 60 * 1000)
              : null;

        if (
          !freshPurgeDueAt ||
          Number.isNaN(freshPurgeDueAt.getTime()) ||
          freshPurgeDueAt.getTime() > Date.now()
        ) {
          const error = new Error("PURGE_NOT_DUE");
          error.code = "PURGE_NOT_DUE";
          throw error;
        }

        transaction.update(purgeRef, updateData);
        transaction.set(purgeAuditRef, {
          timestamp: FieldValue.serverTimestamp(),
          timeString: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
          user: String(req.admin?.name || req.admin?.email || "مشرف").slice(0, 200),
          userId: String(req.admin?.uid || "").slice(0, 200),
          action: "إتلاف البيانات الحساسة",
          targetOrder: String(
            freshOrder.referenceNumber ||
            freshOrder.orderId ||
            found.id
          ).slice(0, 200),
          details: "تم إتلاف بيانات الحساب وبيانات الدفع الحساسة نهائيًا",
          userAgent: String(req.headers["user-agent"] || "").slice(0, 80),
          source: "server"
        });
      });

      /*
       * تنظيف أي نافذة decrypt موجودة لهذا الطلب
       * لهذا المدير حتى لا تبقى نافذة قديمة في الذاكرة.
       */
      decryptWindows.delete(
        getDecryptWindowKey(
          req.admin.uid,
          found.id
        )
      );

      return res.json({
        success: true,
        message:
          "تم إتلاف البيانات الحساسة بنجاح.",
        data: {
          orderId:
            String(
              order.orderId ||
              found.id
            ),

          referenceNumber:
            String(
              order.referenceNumber ||
              ""
            ),

          sensitivePurged: true
        }
      });
    } catch (error) {
      console.error(
        "Admin destroy-sensitive-data error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر إتلاف البيانات الحساسة."
      });
    }
  }
);


/**
 * ============================================================================
 * POST /api/admin/archive-order
 * ============================================================================
 *
 * Archive is a lifecycle flag, not a customer-facing status message.
 * The order remains queryable for audit/history.
 */
router.post(
  "/archive-order",
  requireAdmin,
  adminMutationRateLimit,
  async (req, res) => {
    try {
      const orderIdentifier =
        normalizeIdentifier(req.body?.orderId);

      if (!orderIdentifier) {
        return res.status(400).json({
          success: false,
          message: "رقم الطلب مطلوب"
        });
      }

      const found = await findOrder(orderIdentifier);

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "الطلب غير موجود"
        });
      }

      const order = found.data || {};

      if (order.archived === true) {
        return res.status(409).json({
          success: false,
          message: "الطلب مؤرشف مسبقًا."
        });
      }

      if (String(order.status || "").toLowerCase() !== "completed") {
        return res.status(400).json({
          success: false,
          message: "لا يمكن أرشفة الطلب قبل اكتماله."
        });
      }

      const archiveRef = db.collection("orders").doc(found.id);
      const archiveAuditRef = db.collection("audit_logs").doc();

      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(archiveRef);

        if (!freshSnap.exists) {
          const error = new Error("ORDER_NOT_FOUND");
          error.code = "ORDER_NOT_FOUND";
          throw error;
        }

        const freshOrder = freshSnap.data() || {};

        if (freshOrder.archived === true) {
          const error = new Error("ALREADY_ARCHIVED");
          error.code = "ALREADY_ARCHIVED";
          throw error;
        }

        if (String(freshOrder.status || "").toLowerCase() !== "completed") {
          const error = new Error("ORDER_NOT_COMPLETED");
          error.code = "ORDER_NOT_COMPLETED";
          throw error;
        }

        transaction.update(archiveRef, {
          archived: true,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          archivedBy: String(req.admin.uid),
          lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
          history: admin.firestore.FieldValue.arrayUnion({
            type: "archived",
            actor: req.admin.email || req.admin.name || req.admin.uid,
            at: new Date()
          })
        });

        transaction.set(archiveAuditRef, {
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          timeString: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
          user: String(req.admin?.name || req.admin?.email || "مشرف").slice(0, 200),
          userId: String(req.admin?.uid || "").slice(0, 200),
          action: "أرشفة طلب",
          targetOrder: String(
            freshOrder.referenceNumber ||
            freshOrder.orderId ||
            found.id
          ).slice(0, 200),
          details: "تمت أرشفة الطلب بعد اكتماله",
          userAgent: String(req.headers["user-agent"] || "").slice(0, 80),
          source: "server"
        });
      });

      return res.json({
        success: true,
        orderId: String(order.orderId || found.id),
        referenceNumber: String(order.referenceNumber || ""),
        archived: true
      });
    } catch (error) {
      console.error(
        "Admin archive-order error:",
        error?.code || error?.message || "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message: "تعذر أرشفة الطلب."
      });
    }
  }
);



/**
 * POST /api/admin/audit
 *
 * Audit entries are server-authored so the browser cannot spoof
 * actor identity, timestamps, or unrestricted audit metadata.
 */
function sanitizeAuditText(value, maxLength) {
  return String(value || "")
    .replace(/(?:password|كلمة\s*المرور|backup\s*codes?|الأكواد?\s*الاحتياطية)[^,;\n]*/gi, "[REDACTED]")
    .replace(/(?:iban|رقم\s*الآيبان)[^,;\n]*/gi, "[REDACTED]")
    .replace(/(?:wallet|المحفظة|walletAddress)[^,;\n]*/gi, "[REDACTED]")
    .slice(0, maxLength);
}

async function writeSecurityAudit({
  adminIdentity,
  headers,
  action,
  targetOrder = "عام",
  details = ""
}) {
  await db.collection("audit_logs").add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    timeString: new Date().toLocaleString("ar-SA", {
      timeZone: "Asia/Riyadh"
    }),
    user: String(adminIdentity?.name || adminIdentity?.email || "مشرف").slice(0, 200),
    userId: String(adminIdentity?.uid || "").slice(0, 200),
    action: sanitizeAuditText(action, 200),
    targetOrder: sanitizeAuditText(targetOrder, 200),
    details: sanitizeAuditText(details, 1000),
    userAgent: String(headers?.["user-agent"] || "").slice(0, 80)
  });
}

router.post(
  "/audit",
  requireAdmin,
  async (req, res) => {
    try {
      /*
       * This endpoint is intentionally limited to UI activity telemetry.
       * It is NOT a source of truth for security events or completed
       * business mutations. Security-sensitive routes write their own
       * server-authored audit records.
       */
      const action = sanitizeAuditText(req.body?.action, 120);
      const targetOrder = sanitizeAuditText(req.body?.targetOrder, 120);
      const details = sanitizeAuditText(req.body?.details, 600);

      const allowedUiActions = new Set([
        "تسجيل دخول المشرف",
        "تسجيل خروج",
        "تسجيل مشكلة للطلب",
        "إزالة مشكلة من الطلب",
        "تغيير حالة المتجر",
        "حفظ إعدادات الأسعار",
        "إضافة بنك",
        "حذف بنك",
        "إضافة محفظة رقمية",
        "حذف محفظة رقمية",
        "إضافة طريقة دفع",
        "حذف طريقة دفع",
        "إضافة شرط وأحكام",
        "حذف شرط وأحكام",
        "تفعيل الشروط والأحكام",
        "تعطيل الشروط والأحكام",
        "تحديث رسائل الحالات",
        "تحويل مالي"
      ]);

      if (!allowedUiActions.has(action)) {
        return res.status(400).json({
          success: false,
          message: "نوع سجل الإدارة غير مسموح."
        });
      }

      await db.collection("audit_logs").add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        timeString: new Date().toLocaleString("ar-SA", {
          timeZone: "Asia/Riyadh"
        }),
        source: "admin-ui",
        user: String(req.admin?.name || req.admin?.email || "مشرف").slice(0, 200),
        userId: String(req.admin?.uid || "").slice(0, 200),
        action,
        targetOrder,
        details,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 80)
      });

      return res.json({ success: true });
    } catch (error) {
      console.error(
        "Admin audit error:",
        error?.code || error?.message || "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message: "تعذر تسجيل حركة الإدارة."
      });
    }
  }
);

/**
 * POST /api/admin/log-whatsapp
 * Logs a non-sensitive WhatsApp action initiated by an admin.
 */
router.post(
  "/log-whatsapp",
  requireAdmin,
  async (req, res) => {
    try {
      const orderId = normalizeIdentifier(req.body?.orderId);
      const referenceNumber = normalizeIdentifier(req.body?.referenceNumber);
      const recipientRaw = String(req.body?.recipient || "")
        .replace(/[^0-9+]/g, "")
        .slice(0, 32);
      const message = String(req.body?.message || "").trim().slice(0, 4000);
      const templateCode = String(req.body?.templateCode || "").trim().slice(0, 100);

      if (!orderId || !message) {
        return res.status(400).json({
          success: false,
          message: "بيانات رسالة واتساب غير مكتملة."
        });
      }

      /*
       * Data minimization:
       * the audit log records that a message was prepared/sent, but does not
       * persist the full customer message or recipient phone number.
       */
      const maskedRecipient =
        recipientRaw.length > 4
          ? `••••${recipientRaw.slice(-4)}`
          : "••••";

      await db.collection("whatsappLogs").add({
        orderId,
        referenceNumber,
        recipientMasked: maskedRecipient,
        messageLength: message.length,
        templateCode,
        sentBy: String(req.admin.uid),
        sentByEmail: String(req.admin.email || ""),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ success: true });
    } catch (error) {
      console.error(
        "Admin log-whatsapp error:",
        error?.code || error?.message || "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message: "تعذر تسجيل رسالة واتساب."
      });
    }
  }
);


router.post(
  "/update-note",
  requireAdmin,
  adminMutationRateLimit,
  async (req,res)=>{
    try{
      const orderIdentifier=normalizeIdentifier(req.body?.orderId);
      if(!orderIdentifier)return res.status(400).json({success:false,message:"رقم الطلب مطلوب."});
      const found=await findOrder(orderIdentifier);
      if(!found)return res.status(404).json({success:false,message:"الطلب غير موجود."});

      const note=String(req.body?.note||"").trim().slice(0,2000);
      const orderRef=db.collection("orders").doc(found.id);
      const auditRef=db.collection("audit_logs").doc();
      const batch=db.batch();
      const actor=String(req.admin?.email||req.admin?.name||req.admin?.uid||"Admin").slice(0,200);

      batch.update(orderRef,{
        adminNote:note,
        lastUpdate:admin.firestore.FieldValue.serverTimestamp(),
        history:admin.firestore.FieldValue.arrayUnion({
          type:"admin_note",
          note:note?"تم تحديث الملاحظة الإدارية":"تم حذف الملاحظة الإدارية",
          actor,
          at:new Date()
        })
      });

      batch.set(auditRef,{
        timestamp:admin.firestore.FieldValue.serverTimestamp(),
        timeString:new Date().toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"}),
        user:actor,
        userId:String(req.admin?.uid||"").slice(0,200),
        action:note?"تحديث الملاحظة الإدارية":"حذف الملاحظة الإدارية",
        targetOrder:String(found.data?.referenceNumber||found.data?.orderId||found.id).slice(0,200),
        details:"تم تعديل الملاحظة الإدارية دون تسجيل محتواها.",
        userAgent:String(req.headers["user-agent"]||"").slice(0,80),
        source:"server"
      });

      await batch.commit();
      return res.json({success:true});
    }catch(error){
      console.error("Admin update-note error:",error?.code||error?.message||"unknown_error");
      return res.status(500).json({success:false,message:"تعذر حفظ الملاحظة."});
    }
  }
);

/**
 * ============================================================================
 * POST /api/admin/settings
 * ============================================================================
 *
 * جميع كتابات إعدادات النظام تمر من هنا.
 * لا يسمح للمتصفح بالكتابة المباشرة إلى system/settings.
 */

const SETTINGS_ACTIONS = new Set([
  "update_pricing",
  "add_bank",
  "delete_bank",
  "add_wallet",
  "delete_wallet",
  "add_payment_method",
  "delete_payment_method",
  "add_term",
  "delete_term",
  "toggle_terms_enabled",
  "update_issue_messages",
  "update_status_messages",
  "toggle_store"
]);

const SETTINGS_STRING_FIELDS = new Set([
  "storeName","arabicStoreName","gameName","storeLogo","supportWhatsapp",
  "supportEmail","siteUrl","announcementText","announcementBgColor",
  "announcementTextColor","psWithdrawDuration","psTransferDuration",
  "pcWithdrawDuration","pcTransferDuration","offerText","promoExpiry"
]);

const SETTINGS_NUMBER_FIELDS = new Set([
  "gameVersion","usdSarRate","psRate","psMin","psMax",
  "pcRate","pcMin","pcMax","promoRate"
]);

function cleanSettingString(value, fallback = "") {
  const valueText = String(value ?? "").trim();
  return valueText || fallback;
}

function cleanSettingNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSettingArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeSettingIndex(value, length) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= length) return -1;
  return index;
}

function normalizeIssueMessageMap(value, current = {}) {
  const allowed = [
    "wrong_credentials",
    "wrong_backup_codes",
    "logged_in_platform",
    "market_closed",
    "wrong_platform",
    "other_issue"
  ];
  const result = { ...current };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }

  for (const key of allowed) {
    if (typeof value[key] === "string" && value[key].trim()) {
      result[key] = value[key].trim();
    }
  }

  return result;
}

router.post(
  "/settings",
  requireAdmin,
  async (req, res) => {
    try {
      const action = String(req.body?.action || "").trim();

      if (!SETTINGS_ACTIONS.has(action)) {
        return res.status(400).json({
          success: false,
          message: "عملية إعدادات غير صالحة."
        });
      }

      const settingsRef = db.collection("system").doc("settings");
      const snapshot = await settingsRef.get();
      const current = snapshot.exists ? snapshot.data() || {} : {};
      let patch = {};
      let result = null;

      switch (action) {
        case "update_pricing": {
          const input =
            req.body?.data &&
            typeof req.body.data === "object" &&
            !Array.isArray(req.body.data)
              ? req.body.data
              : {};

          for (const field of SETTINGS_STRING_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(input, field)) {
              patch[field] = cleanSettingString(input[field], String(current[field] ?? ""));
            }
          }

          for (const field of SETTINGS_NUMBER_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(input, field)) {
              const currentValue = Number(current[field]);
              patch[field] = cleanSettingNumber(
                input[field],
                Number.isFinite(currentValue) ? currentValue : 0
              );
            }
          }

          if (Object.prototype.hasOwnProperty.call(input, "offers")) {
            patch.offers = Boolean(input.offers);
          }
          if (Object.prototype.hasOwnProperty.call(input, "announcementActive")) {
            patch.announcementActive = Boolean(input.announcementActive);
          }
          if (Object.prototype.hasOwnProperty.call(input, "storeOpen")) {
            patch.storeOpen = Boolean(input.storeOpen);
          }
          if (
            input.paymentCategories &&
            typeof input.paymentCategories === "object" &&
            !Array.isArray(input.paymentCategories)
          ) {
            patch.paymentCategories = input.paymentCategories;
          }
          if (input.issueMessages) {
            patch.issueMessages = normalizeIssueMessageMap(
              input.issueMessages,
              current.issueMessages || {}
            );
          }
          break;
        }

        case "add_bank": {
          const value = cleanSettingString(req.body?.value);
          const banks = normalizeSettingArray(current.banks);
          if (!value) return res.status(400).json({success:false,message:"اسم البنك مطلوب."});
          if (!banks.some((item) => item.toLowerCase() === value.toLowerCase())) banks.push(value);
          patch.banks = banks;
          result = banks;
          break;
        }

        case "delete_bank": {
          const banks = normalizeSettingArray(current.banks);
          const index = normalizeSettingIndex(req.body?.index, banks.length);
          if (index < 0) return res.status(400).json({success:false,message:"رقم البنك غير صالح."});
          banks.splice(index, 1);
          patch.banks = banks;
          result = banks;
          break;
        }

        case "add_wallet": {
          const value = cleanSettingString(req.body?.value);
          const wallets = normalizeSettingArray(current.wallets);
          if (!value) return res.status(400).json({success:false,message:"اسم المحفظة مطلوب."});
          if (!wallets.some((item) => item.toLowerCase() === value.toLowerCase())) wallets.push(value);
          patch.wallets = wallets;
          result = wallets;
          break;
        }

        case "delete_wallet": {
          const wallets = normalizeSettingArray(current.wallets);
          const index = normalizeSettingIndex(req.body?.index, wallets.length);
          if (index < 0) return res.status(400).json({success:false,message:"رقم المحفظة غير صالح."});
          wallets.splice(index, 1);
          patch.wallets = wallets;
          result = wallets;
          break;
        }

        case "add_payment_method": {
          const value = cleanSettingString(req.body?.value);
          const methods = normalizeSettingArray(current.paymentMethods);
          if (!value) return res.status(400).json({success:false,message:"طريقة الدفع مطلوبة."});
          if (!methods.some((item) => item.toLowerCase() === value.toLowerCase())) methods.push(value);
          patch.paymentMethods = methods;
          result = methods;
          break;
        }

        case "delete_payment_method": {
          const methods = normalizeSettingArray(current.paymentMethods);
          const index = normalizeSettingIndex(req.body?.index, methods.length);
          if (index < 0) return res.status(400).json({success:false,message:"رقم طريقة الدفع غير صالح."});
          methods.splice(index, 1);
          patch.paymentMethods = methods;
          result = methods;
          break;
        }

        case "add_term": {
          const value = cleanSettingString(req.body?.value);
          const terms = normalizeSettingArray(current.terms);
          if (!value) return res.status(400).json({success:false,message:"نص الشرط مطلوب."});
          if (!terms.some((item) => item.toLowerCase() === value.toLowerCase())) terms.push(value);
          patch.terms = terms;
          result = terms;
          break;
        }

        case "delete_term": {
          const terms = normalizeSettingArray(current.terms);
          const index = normalizeSettingIndex(req.body?.index, terms.length);
          if (index < 0) return res.status(400).json({success:false,message:"رقم الشرط غير صالح."});
          terms.splice(index, 1);
          patch.terms = terms;
          result = terms;
          break;
        }

        case "toggle_terms_enabled":
          patch.termsEnabled = Boolean(req.body?.enabled);
          result = patch.termsEnabled;
          break;

        case "update_issue_messages":
          patch.issueMessages = normalizeIssueMessageMap(
            req.body?.messages,
            current.issueMessages || {}
          );
          result = patch.issueMessages;
          break;

        case "update_status_messages": {
          const allowedStatuses = [
            "new",
            "review",
            "progress",
            "finished",
            "pending_transfer",
            "transferred",
            "completed"
          ];
          const input =
            req.body?.messages &&
            typeof req.body.messages === "object" &&
            !Array.isArray(req.body.messages)
              ? req.body.messages
              : {};
          const currentMessages =
            current.statusMessages &&
            typeof current.statusMessages === "object" &&
            !Array.isArray(current.statusMessages)
              ? current.statusMessages
              : {};
          const nextMessages = { ...currentMessages };
          for (const status of allowedStatuses) {
            if (typeof input[status] === "string") {
              const value = input[status].trim();
              if (value) nextMessages[status] = value.slice(0, 4000);
            }
          }
          patch.statusMessages = nextMessages;
          result = nextMessages;
          break;
        }

        case "toggle_store":
          result =
            typeof req.body?.enabled === "boolean"
              ? req.body.enabled
              : !Boolean(current.storeOpen);
          patch.storeOpen = result;
          break;

        default:
          break;
      }

      if (!Object.keys(patch).length) {
        return res.status(400).json({
          success: false,
          message: "لا توجد تغييرات صالحة للحفظ."
        });
      }

      patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      const settingsAuditRef = db.collection("audit_logs").doc();
      const settingsBatch = db.batch();

      settingsBatch.set(
        settingsRef,
        patch,
        { merge: true }
      );

      settingsBatch.set(
        settingsAuditRef,
        {
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          timeString: new Date().toLocaleString("ar-SA", {
            timeZone: "Asia/Riyadh"
          }),
          user: String(req.admin?.name || req.admin?.email || "مشرف").slice(0, 200),
          userId: String(req.admin?.uid || "").slice(0, 200),
          action: "تعديل إعدادات النظام",
          targetOrder: "الإعدادات",
          details: JSON.stringify({
            action,
            updatedFields: Object.keys(patch)
              .filter((field) => field !== "updatedAt")
              .slice(0, 50)
          }).slice(0, 1200),
          userAgent: String(req.headers["user-agent"] || "").slice(0, 80)
        }
      );

      await settingsBatch.commit();

      return res.json({
        success: true,
        action,
        result,
        updatedFields: Object.keys(patch).filter((field) => field !== "updatedAt")
      });
    } catch (error) {
      console.error("Admin settings error:", error?.message || error);
      return res.status(500).json({
        success: false,
        message: "تعذر تحديث إعدادات النظام."
      });
    }
  }
);

/**
 * ============================================================================
 * Review management
 * ============================================================================
 *
 * Admin-only review moderation. The browser never writes review documents
 * directly; all mutations are validated and mirrored by the server.
 * ============================================================================
 */

router.post(
  "/reviews/status",
  requireAdmin,
  adminMutationRateLimit,
  async (req, res) => {
    try {
      const reviewId =
        String(req.body?.reviewId || "").trim();

      const requestedStatus =
        String(req.body?.status || "").trim().toLowerCase();

      const allowedStatuses =
        new Set([
          "pending",
          "published",
          "archived"
        ]);

      if (!reviewId || !allowedStatuses.has(requestedStatus)) {
        return res.status(400).json({
          success: false,
          message: "بيانات حالة التقييم غير صحيحة."
        });
      }

      const reviewRef =
        db.collection("reviews").doc(reviewId);

      const publicRef =
        db.collection("publicReviews").doc(reviewId);

      const reviewSnap =
        await reviewRef.get();

      if (!reviewSnap.exists) {
        return res.status(404).json({
          success: false,
          message: "التقييم غير موجود."
        });
      }

      const review =
        reviewSnap.data() || {};

      const comment =
        String(review.comment || review.text || "").trim();

      const platform =
        String(review.platform || "").trim();

      const quantity =
        Number(review.quantity);

      const rating =
        Number(review.rating);

      if (
        requestedStatus === "published" &&
        (
          !comment ||
          Array.from(comment).length > 600 ||
          !platform ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isInteger(rating) ||
          rating < 1 ||
          rating > 5
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "التقييم لا يحتوي بيانات صالحة للنشر."
        });
      }

      const reviewAuditRef = db.collection("audit_logs").doc();

      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(reviewRef);

        if (!freshSnap.exists) {
          const error = new Error("REVIEW_NOT_FOUND");
          error.code = "REVIEW_NOT_FOUND";
          throw error;
        }

        const freshReview = freshSnap.data() || {};
        const freshComment = String(
          freshReview.comment ||
          freshReview.text ||
          ""
        ).trim();
        const freshPlatform = String(freshReview.platform || "").trim();
        const freshQuantity = Number(freshReview.quantity);
        const freshRating = Number(freshReview.rating);

        if (
          requestedStatus === "published" &&
          (
            !freshComment ||
            Array.from(freshComment).length > 600 ||
            !freshPlatform ||
            !Number.isFinite(freshQuantity) ||
            freshQuantity <= 0 ||
            !Number.isInteger(freshRating) ||
            freshRating < 1 ||
            freshRating > 5
          )
        ) {
          const error = new Error("INVALID_REVIEW");
          error.code = "INVALID_REVIEW";
          throw error;
        }

        transaction.update(reviewRef, {
          status: requestedStatus,
          updatedAt: new Date(),
          moderatedAt: new Date(),
          moderatedBy:
            req.admin?.email ||
            req.admin?.uid ||
            "Admin"
        });

        if (requestedStatus === "published") {
          transaction.set(publicRef, {
            platform: freshPlatform,
            quantity: freshQuantity,
            rating: freshRating,
            comment: freshComment,
            publishedAt: new Date()
          });
        } else {
          transaction.delete(publicRef);
        }

        transaction.set(reviewAuditRef, {
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          timeString: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
          user: String(req.admin?.name || req.admin?.email || "مشرف").slice(0, 200),
          userId: String(req.admin?.uid || "").slice(0, 200),
          action: "تحديث حالة التقييم",
          targetOrder: reviewId.slice(0, 200),
          details: `تغيير حالة التقييم إلى: ${requestedStatus}`.slice(0, 1000),
          userAgent: String(req.headers["user-agent"] || "").slice(0, 80),
          source: "server"
        });
      });

      return res.json({
        success: true,
        status: requestedStatus
      });
    } catch (error) {
      console.error(
        "Review status error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message: "تعذر تحديث حالة التقييم."
      });
    }
  }
);

router.post(
  "/reviews/delete",
  requireAdmin,
  adminMutationRateLimit,
  async (req, res) => {
    try {
      const reviewId =
        String(req.body?.reviewId || "").trim();

      if (!reviewId) {
        return res.status(400).json({
          success: false,
          message: "معرّف التقييم مطلوب."
        });
      }

      const reviewRef =
        db.collection("reviews").doc(reviewId);

      const publicRef =
        db.collection("publicReviews").doc(reviewId);

      const reviewSnap =
        await reviewRef.get();

      if (!reviewSnap.exists) {
        return res.status(404).json({
          success: false,
          message: "التقييم غير موجود."
        });
      }

      const reviewDeleteAuditRef = db.collection("audit_logs").doc();

      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(reviewRef);

        if (!freshSnap.exists) {
          const error = new Error("REVIEW_NOT_FOUND");
          error.code = "REVIEW_NOT_FOUND";
          throw error;
        }

        transaction.delete(reviewRef);
        transaction.delete(publicRef);
        transaction.set(reviewDeleteAuditRef, {
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          timeString: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
          user: String(req.admin?.name || req.admin?.email || "مشرف").slice(0, 200),
          userId: String(req.admin?.uid || "").slice(0, 200),
          action: "حذف تقييم",
          targetOrder: reviewId.slice(0, 200),
          details: "تم حذف التقييم نهائيًا",
          userAgent: String(req.headers["user-agent"] || "").slice(0, 80),
          source: "server"
        });
      });

      return res.json({
        success: true
      });
    } catch (error) {
      console.error(
        "Review delete error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message: "تعذر حذف التقييم."
      });
    }
  }
);

export default router;
