import express from "express";
import { db } from "../services/firebase.js";

const router = express.Router();

/* ==========================================
   Helpers
   ========================================== */

const LEGACY_STATUS_MAP = {
  pending: "new"
};

const STATUS_MESSAGES = {
  new: "طلب جديد",
  review: "انتظار المراجعة",
  progress: "جاري سحب الكوينز من حسابك",
  finished: "تم الانتهاء من سحب الكوينز من حسابك",
  transferred: "تم تحويل المبلغ إلى حسابك",
  completed: "مكتمل"
};

const ISSUE_LABELS = {
  wrong_credentials: "بيانات الدخول غير صحيحة",
  wrong_backup_codes: "رموز النسخ الاحتياطية غير صحيحة",
  market_closed: "سوق الانتقالات مغلق",
  no_player: "لا يوجد لاعب مطابق",
  wrong_platform: "المنصة المحددة غير صحيحة",
  other_issue: "توجد مشكلة في الطلب"
};

function normalizeStatus(status) {
  if (!status) {
    return "new";
  }

  const normalized = String(status)
    .trim()
    .toLowerCase();

  return LEGACY_STATUS_MAP[normalized] || normalized;
}

function toISOStringSafe(value) {
  if (!value) {
    return null;
  }

  try {
    if (typeof value.toDate === "function") {
      return value.toDate().toISOString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "string") {
      const date = new Date(value);

      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    return null;
  } catch {
    return null;
  }
}

function formatDate(value) {
  const iso = toISOStringSafe(value);

  if (!iso) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "ar-SA",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).format(new Date(iso));
  } catch {
    return "";
  }
}

function formatTime(value) {
  const iso = toISOStringSafe(value);

  if (!iso) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "ar-SA",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(new Date(iso));
  } catch {
    return "";
  }
}

function maskPhone(phone) {
  if (!phone) {
    return "";
  }

  const value = String(phone).replace(/\s+/g, "");

  if (value.length <= 4) {
    return "****";
  }

  return (
    "*".repeat(
      Math.max(0, value.length - 4)
    ) +
    value.slice(-4)
  );
}

function maskEmail(email) {
  if (!email) {
    return "";
  }

  const value = String(email).trim();
  const atIndex = value.indexOf("@");

  if (atIndex <= 0) {
    return "****";
  }

  const local = value.substring(0, atIndex);
  const domain = value.substring(atIndex);

  if (local.length <= 2) {
    return (
      local.charAt(0) +
      "****" +
      domain
    );
  }

  return (
    local.substring(0, 2) +
    "****" +
    domain
  );
}

function maskPassword() {
  return "••••••••";
}

function maskBackupCodes(codes) {
  if (!codes) {
    return "";
  }

  let list = [];

  if (Array.isArray(codes)) {
    list = codes;
  } else {
    list = String(codes)
      .split(/\r?\n|,|\s+/)
      .filter(Boolean);
  }

  if (!list.length) {
    return "";
  }

  return list
    .slice(0, 3)
    .map(() => "••••••")
    .join("  |  ");
}

function extractLast6(value) {
  if (!value) {
    return "";
  }

  const text = String(value)
    .replace(/\s+/g, "");

  if (text.length < 6) {
    return "";
  }

  return text.slice(-6);
}

function maskWallet(wallet) {
  if (!wallet) {
    return "";
  }

  const value = String(wallet).trim();

  if (value.length <= 10) {
    return "********";
  }

  return (
    value.substring(0, 4) +
    "..." +
    value.substring(value.length - 6)
  );
}

function getDrawnCoins(order) {
  const value =
    order.drawnCoins ??
    order.withdrawnQuantity ??
    0;

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function getPaymentMethodCode(order) {
  const payout =
    order.payoutDetails ||
    order.paymentInfoData ||
    {};

  return (
    payout.method ||
    order.paymentMethodType ||
    ""
  )
    .toString()
    .toLowerCase();
}

function getPaymentMethodName(order) {
  if (order.paymentMethodName) {
    return order.paymentMethodName;
  }

  if (order.paymentMethod) {
    return order.paymentMethod;
  }

  const method =
    getPaymentMethodCode(order);

  const labels = {
    bank: "تحويل بنكي",
    wallet: "محفظة إلكترونية",
    usdt: "USDT",
    paypal: "PayPal",
    western: "Western Union"
  };

  return labels[method] || method;
}

/* ==========================================
   Payment DTO
   ========================================== */

function buildPaymentData(order) {
  const method =
    getPaymentMethodCode(order);

  const payout =
    order.payoutDetails ||
    order.paymentInfoData ||
    {};

  const payment = {
    method,
    methodName: getPaymentMethodName(order)
  };

  /*
   * البنك
   */
  if (method === "bank") {
    payment.bankName =
      payout.bankName || "";

    /*
     * لا نرسل IBAN الكامل أبداً.
     */
    payment.ibanLast6 =
      payout.ibanLast6 ||
      extractLast6(payout.iban) ||
      "";
  }

  /*
   * المحفظة
   */
  else if (method === "wallet") {
    payment.walletName =
      payout.walletName ||
      payout.walletType ||
      "";

    payment.phone =
      payout.phone ||
      payout.walletNumber ||
      payout.walletPhone ||
      "";

    payment.phoneMasked =
      maskPhone(payment.phone);

    /*
     * نحذف الرقم الكامل من الـDTO.
     */
    delete payment.phone;
  }

  /*
   * USDT
   */
  else if (method === "usdt") {
    const wallet =
      payout.wallet ||
      payout.usdtWallet ||
      payout.walletAddress ||
      "";

    payment.walletMasked =
      maskWallet(wallet);
  }

  /*
   * PayPal
   */
  else if (method === "paypal") {
    const email =
      payout.email ||
      payout.paypalEmail ||
      "";

    payment.emailMasked =
      maskEmail(email);
  }

  /*
   * Western Union
   */
  else if (method === "western") {
    payment.fullNameEnglish =
      payout.fullNameEnglish ||
      payout.fullName ||
      payout.westernName ||
      "";

    payment.country =
      payout.country ||
      payout.westernCountry ||
      "";
  }

  return payment;
}

/* ==========================================
   Account DTO
   ========================================== */

function buildAccountData(order, sensitivePurged) {
  /*
   * بعد الإتلاف لا نرسل أي بيانات للحساب.
   */
  if (sensitivePurged) {
    return {
      purged: true,
      message:
        "تمت معالجة طلبك بنجاح، وتم حذف بيانات الحساب الحساسة حفاظًا على أمانك."
    };
  }

  /*
   * بيانات الحساب الحساسة لا ينبغي أن تكون
   * موجودة أصلاً في Firestore بصيغة plaintext
   * بعد تطبيق النظام الجديد.
   *
   * إذا كانت هناك قيم masked محفوظة من طبقة
   * سابقة، نستخدمها فقط.
   */
  const account =
    order.accountData || {};

  return {
    purged: false,

    eaEmailMasked:
      order.eaEmailMasked ||
      account.eaEmailMasked ||
      "",

    eaPasswordMasked:
      order.eaPasswordMasked ||
      account.eaPasswordMasked ||
      "",

    backupCodesMasked:
      order.backupCodesMasked ||
      account.backupCodesMasked ||
      ""
  };
}

/* ==========================================
   Issue DTO
   ========================================== */

function buildIssueData(order) {
  /*
   * issue = null يعني لا توجد مشكلة.
   *
   * لا نعرض أي قسم للمشكلة في هذه الحالة.
   */
  if (!order.issue) {
    return {
      issue: null,
      issueMessage: ""
    };
  }

  const issue =
    String(order.issue).trim();

  const configuredMessage =
    order.issueMessage ||
    order.statusIssueMessage ||
    "";

  const defaultMessage =
    ISSUE_LABELS[issue] ||
    "توجد مشكلة في الطلب";

  return {
    issue,
    issueMessage:
      configuredMessage ||
      defaultMessage
  };
}

/* ==========================================
   Public Tracking DTO
   ========================================== */

function buildTrackingOrder(order) {
  const status =
    normalizeStatus(
      order.status ||
      order.orderStatus
    );

  const sensitivePurged =
    Boolean(
      order.sensitivePurged ||
      order.purgedAt
    );

  const createdAt =
    order.createdAt ||
    null;

  const lastUpdate =
    order.lastUpdate ||
    order.updatedAt ||
    null;

  const issueData =
    buildIssueData(order);

  const paymentData =
    buildPaymentData(order);

  const accountData =
    buildAccountData(
      order,
      sensitivePurged
    );

  const quantity =
    Number(
      order.quantity ||
      order.totalQty ||
      0
    );

  const drawnCoins =
    getDrawnCoins(order);

  let progressPercentage =
    Number(
      order.progressPercentage
    );

  if (
    !Number.isFinite(progressPercentage)
  ) {
    progressPercentage = 0;

    const defaultPercentages = {
      new: 15,
      review: 35,
      progress: 65,
      finished: 85,
      transferred: 95,
      completed: 100
    };

    if (
      defaultPercentages[status] !== undefined
    ) {
      progressPercentage =
        defaultPercentages[status];
    }
  }

  /*
   * البيانات التي يسمح للعميل برؤيتها فقط.
   *
   * مهم جداً:
   * لا نستخدم ...order هنا.
   */
  return {
    referenceNumber:
      order.referenceNumber ||
      order.orderId ||
      "",

    customerName:
      order.customerName ||
      "",

    phone:
      maskPhone(order.phone || ""),

    platform:
      order.platform ||
      "",

    quantity,

    totalPrice:
      order.totalPrice ??
      order.total ??
      "",

    status,

    drawnCoins,

    progressPercentage,

    paymentMethod:
      getPaymentMethodName(order),

    paymentMethodName:
      getPaymentMethodName(order),

    paymentMethodType:
      paymentData.method,

    payment: paymentData,

    /*
     * أبقينا paymentInfoData بشكل آمن
     * للتوافق مع tracking.js والطلبات القديمة.
     * لا يحتوي على البيانات الحساسة الكاملة.
     */
    paymentInfoData:
      paymentData,

    /*
     * الحساب لا يحتوي على plaintext.
     */
    accountData,

    sensitivePurged,

    purgedAt:
      toISOStringSafe(
        order.purgedAt
      ),

    completedAt:
      toISOStringSafe(
        order.completedAt
      ),

    purgeDueAt:
      toISOStringSafe(
        order.purgeDueAt
      ),

    orderDate:
      formatDate(createdAt),

    orderTime:
      formatTime(createdAt),

    lastUpdate:
      formatDate(lastUpdate),

    /*
     * هذه الحقول اختيارية ولكن آمنة.
     */
    withdrawDuration:
      order.withdrawDuration ||
      null,

    transferDuration:
      order.transferDuration ||
      null,

    reviewSubmitted:
      Boolean(
        order.reviewSubmitted
      ),

    issue:
      issueData.issue,

    issueMessage:
      issueData.issueMessage
  };
}

/* ==========================================
   GET /api/tracking/:ref
   ========================================== */

router.get("/:ref", async (req, res) => {
  try {
    const ref =
      String(
        req.params.ref || ""
      )
        .trim()
        .toUpperCase();

    if (!ref) {
      return res.status(400).json({
        success: false,
        message: "رقم الطلب مطلوب"
      });
    }

    /*
     * البحث باستخدام referenceNumber
     * وليس Firestore document ID.
     */
    const snapshot =
      await db
        .collection("orders")
        .where(
          "referenceNumber",
          "==",
          ref
        )
        .limit(1)
        .get();

    if (snapshot.empty) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const document =
      snapshot.docs[0];

    const order =
      document.data() || {};

    const publicOrder =
      buildTrackingOrder(order);

    const issueData =
      buildIssueData(order);

    /*
     * رسالة الحالة الأساسية.
     *
     * statusMessage يمكن تخصيصها من system settings
     * لاحقاً، وإذا لم توجد نستخدم الرسالة الافتراضية.
     */
    const status =
      publicOrder.status;

    const statusMessage =
      order.statusMessage ||
      STATUS_MESSAGES[status] ||
      "";

    /*
     * اقتراحات التقييم.
     */
    const reviewSuggestions =
      Array.isArray(
        order.reviewSuggestions
      )
        ? order.reviewSuggestions
        : [];

    return res.json({
      success: true,

      order: publicOrder,

      statusMessage,

      issueMessage:
        issueData.issueMessage,

      reviewSuggestions
    });

  } catch (error) {
    /*
     * لا نسجل بيانات الطلب أو البيانات الحساسة.
     */
    console.error(
      "Tracking API Error:",
      error?.message || error
    );

    return res.status(500).json({
      success: false,
      message:
        "حدث خطأ في الخادم، يرجى المحاولة لاحقاً."
    });
  }
});

export default router;
