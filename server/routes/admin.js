import express from "express";
import { db } from "../services/firebase.js";
import { decrypt } from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

/**
 * ============================================================================
 * SAMI COINS - ADMIN ROUTES
 * ============================================================================
 *
 * مسؤول عن:
 * - التحقق من وجود الطلب.
 * - فك تشفير البيانات الحساسة للمشرف المصرح له.
 * - توحيد payoutDetails مع البيانات القديمة.
 * - فرض نافذة كشف حساسة لمدة 90 ثانية على الخادم.
 *
 * ملاحظات أمنية:
 * - لا يتم إرسال بيانات Firestore كاملة للواجهة.
 * - لا يتم تسجيل البيانات المفكوكة.
 * - لا يتم تخزين البيانات المفكوكة في Firestore.
 * - requireAdmin هو الحاجز الأساسي قبل الوصول للبيانات الحساسة.
 * ============================================================================
 */

/**
 * مدة كشف البيانات الحساسة.
 */
const DECRYPT_WINDOW_MS = 90_000;

/**
 * ============================================================================
 * 1) نافذة الكشف على الخادم
 * ============================================================================
 *
 * المفتاح:
 *   admin UID + order document ID
 *
 * القيمة:
 *   وقت بداية الكشف.
 *
 * الهدف:
 * - أول عملية فك تشفير تبدأ نافذة 90 ثانية.
 * - إعادة طلب نفس الطلب خلال النافذة لا تمدد الوقت.
 * - بعد انتهاء النافذة يجب بدء عملية كشف جديدة.
 *
 * هذه الذاكرة مؤقتة داخل عملية Node الحالية.
 * عند إعادة تشغيل PM2 يتم تنظيفها تلقائياً، وهذا سلوك آمن.
 */
const decryptWindows = new Map();

function getDecryptWindowKey(uid, orderId) {
  return `${String(uid)}:${String(orderId)}`;
}

function cleanupExpiredDecryptWindows() {
  const now = Date.now();

  for (const [key, startedAt] of decryptWindows.entries()) {
    if (
      !Number.isFinite(startedAt) ||
      now - startedAt >= DECRYPT_WINDOW_MS
    ) {
      decryptWindows.delete(key);
    }
  }
}

function getOrCreateDecryptWindow(uid, orderId) {
  cleanupExpiredDecryptWindows();

  const key = getDecryptWindowKey(uid, orderId);
  const now = Date.now();

  let startedAt = decryptWindows.get(key);

  if (
    !Number.isFinite(startedAt) ||
    now - startedAt >= DECRYPT_WINDOW_MS
  ) {
    startedAt = now;
    decryptWindows.set(key, startedAt);
  }

  const expiresAt = startedAt + DECRYPT_WINDOW_MS;

  return {
    startedAt,
    expiresAt,
    remainingMs: Math.max(0, expiresAt - now)
  };
}

/**
 * ============================================================================
 * 2) فك تشفير آمن
 * ============================================================================
 *
 * إذا كانت القيمة غير موجودة أو لم تعد قابلة للفك:
 * نرجع قيمة فارغة بدون تسريب تفاصيل الخطأ.
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

    return decrypt(value);
  } catch {
    return "";
  }
}

/**
 * ============================================================================
 * 3) البحث عن الطلب
 * ============================================================================
 *
 * الترتيب:
 * 1. Firestore document ID
 * 2. business orderId
 * 3. customer referenceNumber
 *
 * هذا يحافظ على الطلبات القديمة والجديدة.
 */
async function findOrder(identifier) {
  const value = String(identifier || "").trim();

  if (!value) {
    return null;
  }

  /**
   * أولاً: Firestore document ID.
   */
  const directSnap = await db
    .collection("orders")
    .doc(value)
    .get();

  if (directSnap.exists) {
    return {
      id: directSnap.id,
      data: directSnap.data() || {}
    };
  }

  /**
   * ثانياً: business orderId.
   */
  const orderIdSnap = await db
    .collection("orders")
    .where("orderId", "==", value)
    .limit(1)
    .get();

  if (!orderIdSnap.empty) {
    const orderDoc = orderIdSnap.docs[0];

    return {
      id: orderDoc.id,
      data: orderDoc.data() || {}
    };
  }

  /**
   * ثالثاً: referenceNumber.
   */
  const referenceSnap = await db
    .collection("orders")
    .where("referenceNumber", "==", value)
    .limit(1)
    .get();

  if (!referenceSnap.empty) {
    const orderDoc = referenceSnap.docs[0];

    return {
      id: orderDoc.id,
      data: orderDoc.data() || {}
    };
  }

  return null;
}

/**
 * ============================================================================
 * 4) توحيد بيانات الدفع
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
    typeof order.payoutDetails === "object"
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
        payout.payoutType || ""
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

  const legacy =
    order.paymentInfoData &&
    typeof order.paymentInfoData === "object"
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
 * 5) بيانات حساب EA
 * ============================================================================
 *
 * canonical:
 *   accountData.eaEmail
 *   accountData.eaPassword
 *   accountData.backupCodes
 *
 * backupCodes قد تكون:
 * - encrypted JSON array
 * - encrypted string
 */
function getAccountData(order) {
  if (
    order.accountData &&
    typeof order.accountData === "object"
  ) {
    return order.accountData;
  }

  return {};
}

function buildAccountResponse(order) {
  const account = getAccountData(order);

  /**
   * بعد الإتلاف لا نحاول إعادة فك البيانات.
   */
  if (order.sensitivePurged === true) {
    return {
      eaEmail: "",
      eaPassword: "",
      backupCodes: []
    };
  }

  let backupCodes = safeDecrypt(
    account.backupCodes
  );

  if (backupCodes) {
    try {
      const parsed =
        JSON.parse(backupCodes);

      if (Array.isArray(parsed)) {
        backupCodes = parsed;
      }
    } catch {
      /**
       * قد تكون القيمة القديمة string عادية.
       * نحافظ عليها كما هي بعد فك التشفير.
       */
    }
  }

  if (
    typeof backupCodes === "string" &&
    backupCodes.trim() === ""
  ) {
    backupCodes = [];
  }

  return {
    eaEmail: safeDecrypt(
      account.eaEmail
    ),

    eaPassword: safeDecrypt(
      account.eaPassword
    ),

    backupCodes
  };
}

/**
 * ============================================================================
 * 6) بيانات الدفع المفكوكة
 * ============================================================================
 *
 * جميع طرق الدفع الجديدة مشفرة عند الإنشاء.
 *
 * يتم فك البيانات هنا فقط للمشرف المصرح له.
 */
function buildPaymentResponse(order) {
  const payout =
    getPayoutDetails(order);

  const method =
    String(payout.method || "")
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
    case "bank": {
      response.bankName =
        payout.bankName || "";

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

    case "wallet": {
      response.walletName =
        payout.walletName ||
        payout.name ||
        "";

      response.walletPhone =
        safeDecrypt(
          payout.phone ||
          payout.walletPhone
        );

      break;
    }

    case "usdt": {
      response.walletAddress =
        safeDecrypt(
          payout.wallet ||
          payout.walletAddress
        );

      response.network =
        payout.network || "";

      break;
    }

    case "paypal": {
      response.paypalEmail =
        safeDecrypt(
          payout.email ||
          payout.paypalEmail
        );

      break;
    }

    case "western": {
      response.fullNameEnglish =
        safeDecrypt(
          payout.fullNameEnglish ||
          payout.fullName
        );

      response.country =
        safeDecrypt(
          payout.country
        );

      break;
    }
  }

  return response;
}

/**
 * ============================================================================
 * 7) API health
 * ============================================================================
 *
 * لا يعرض أي بيانات إدارية.
 */
router.get("/", (_, res) => {
  res.json({
    success: true,
    message: "Admin API Ready"
  });
});

/**
 * ============================================================================
 * 8) فك تشفير بيانات الطلب
 * ============================================================================
 *
 * Protected:
 *   requireAdmin
 *
 * مدة الكشف:
 *   90 ثانية على الخادم.
 *
 * ملاحظة مهمة:
 * expiresAt ليس مجرد عنصر UI.
 * الخادم يحتفظ بوقت بداية الكشف نفسه.
 */
router.post(
  "/decrypt-order",
  requireAdmin,
  async (req, res) => {
    try {
      const orderIdentifier =
        String(
          req.body?.orderId || ""
        ).trim();

      if (!orderIdentifier) {
        return res.status(400).json({
          success: false,
          message: "رقم الطلب مطلوب"
        });
      }

      const found =
        await findOrder(
          orderIdentifier
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "الطلب غير موجود"
        });
      }

      const order =
        found.data || {};

      /**
       * إذا تم إتلاف بيانات EA فلا يمكن إعادة كشفها.
       */
      if (
        order.sensitivePurged === true
      ) {
        return res.status(410).json({
          success: false,
          message:
            "تم إتلاف البيانات الحساسة لهذا الطلب نهائياً."
        });
      }

      /**
       * نبدأ/نسترجع نافذة الكشف الخاصة بالمشرف والطلب.
       *
       * إعادة الطلب خلال الـ90 ثانية لا تمدد النافذة.
       */
      const decryptWindow =
        getOrCreateDecryptWindow(
          req.admin.uid,
          found.id
        );

      const account =
        buildAccountResponse(order);

      const payment =
        buildPaymentResponse(order);

      /**
       * لا نرسل order كامل.
       */
      const response = {
        orderId:
          order.orderId ||
          found.id,

        referenceNumber:
          order.referenceNumber ||
          "",

        customerName:
          order.customerName ||
          "",

        phone:
          order.phone ||
          "",

        customerEmail:
          order.customerEmail ||
          "",

        platform:
          order.platform ||
          "",

        paymentMethod:
          getPayoutDetails(order)
            .method ||
          order.paymentMethodType ||
          order.paymentMethod ||
          "",

        payoutType:
          getPayoutDetails(order)
            .payoutType ||
          "",

        account,

        payment,

        /**
         * وقت انتهاء الكشف الحقيقي.
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
       * لا نسجل:
       * - Authorization token
       * - البيانات المفكوكة
       * - بيانات الدفع
       * - بيانات EA
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
