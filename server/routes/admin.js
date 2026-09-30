import express from "express";
import { db } from "../services/firebase.js";
import {
  decrypt,
  isEncryptedValue
} from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";

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

      // Prevent browsers, proxies, and shared caches from storing
      // the decrypted sensitive response.
      res.set({
        "Cache-Control":
          "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0"
      });

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

export default router;
