import express from "express";
import { db } from "../services/firebase.js";
import {
  decrypt,
  isEncryptedValue
} from "../utils/crypto.js";

const router = express.Router();

/**
 * ============================================================================
 * SAMI COINS - PUBLIC TRACKING ROUTES
 * ============================================================================
 *
 * مسؤول عن:
 * - عرض الطلب للعميل باستخدام referenceNumber.
 * - عدم كشف Firestore document ID.
 * - عدم كشف ciphertext أو البيانات الحساسة.
 * - إظهار بيانات الدفع بصورة آمنة ومقنّعة.
 * - إظهار بيانات EA بصورة مقنّعة فقط.
 * - إظهار رسالة الإتلاف بعد حذف بيانات EA.
 * - دعم issue مستقل عن status.
 * - قراءة رسائل المشاكل من system/settings.
 *
 * لا يوجد requireAdmin هنا لأن هذه واجهة عامة.
 * ============================================================================
 */

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const LEGACY_STATUS_MAP = {
  pending: "new"
};

const STATUS_MESSAGES = {
  new: "طلب جديد",
  review: "طلب بانتظار المراجعة",
  progress: "جاري سحب الكوينز من حسابك",
  finished: "تم الانتهاء من سحب الكوينز من حسابك",
  transferred: "تم تحويل المبلغ إلى حسابك",
  completed: "مكتمل"
};

const ARABIC_STATUS_MAP = {
  "طلب جديد": "new",
  "طلب بانتظار المراجعة": "review",
  "انتظار المراجعة": "review",
  "جاري سحب الكوينز من حسابك": "progress",
  "تم الانتهاء من سحب الكوينز بحسابك": "finished",
  "تم الانتهاء من سحب الكوينز من حسابك": "finished",
  "تم تحويل المبلغ إلى حسابك": "transferred",
  "مكتمل": "completed"
};

const ISSUE_LABELS = {
  wrong_credentials: "الإيميل أو الباسورد غير صحيح",
  wrong_backup_codes: "الأكواد الاحتياطية غير صحيحة",
  logged_in_platform: "تم تسجيل الدخول عبر المنصة يرجى تسجيل الخروج",
  market_closed: "سوق الانتقالات مغلق",
  wrong_platform: "المنصة غير صحيحة",
  other_issue: "مشاكل أخرى"
};

const DEFAULT_ISSUE_MESSAGES = {
  wrong_credentials: "يرجى إرسال الإيميل والباسورد الصحيح عبر الواتساب",
  wrong_backup_codes: "يرجى إرسال أكواد احتياطية جديدة",
  logged_in_platform: "يرجى إعلامنا عبر الواتساب",
  market_closed: "سوق الانتقالات مغلق في Web App، يرجى التواصل معنا عبر الواتساب",
  wrong_platform: "يرجى التواصل معنا عبر الواتساب",
  other_issue: "يرجى التواصل معنا عبر الواتساب بشكل عاجل"
};

const PURGED_ACCOUNT_MESSAGE =
  "تمت معالجة طلبك بنجاح، وتم حذف بيانات الحساب الحساسة حفاظًا على أمانك.";

const SYSTEM_SETTINGS_DOC = db
  .collection("system")
  .doc("settings");

/**
 * ============================================================================
 * Realtime SSE registry
 * ============================================================================
 *
 * Firestore remains the source of truth.
 * The map only stores active HTTP response streams.
 */
const trackingConnections = new Map();

/**
 * ============================================================================
 * Generic helpers
 * ============================================================================
 */

function normalizeReference(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isValidReference(value) {
  const ref = normalizeReference(value);

  if (!/^[0-9A-HJ-KM-NOPQRSTUVWXYZ]{8}$/.test(ref)) {
    return false;
  }

  if (!/^\d/.test(ref) || !/\d$/.test(ref)) {
    return false;
  }

  const letters =
    ref.match(/[A-HJ-KM-NOPQRSTUVWXYZ]/g) || [];

  return letters.length === 3;
}

function normalizeStatus(status) {
  const raw = String(status || "")
    .trim();

  if (!raw) {
    return "new";
  }

  const normalized =
    raw.toLowerCase();

  if (ARABIC_STATUS_MAP[raw]) {
    return ARABIC_STATUS_MAP[raw];
  }

  return (
    LEGACY_STATUS_MAP[normalized] ||
    normalized
  );
}

function toISOStringSafe(value) {
  if (!value) {
    return null;
  }

  try {
    if (typeof value.toDate === "function") {
      const date = value.toDate();

      return Number.isNaN(date.getTime())
        ? null
        : date.toISOString();
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? null
        : value.toISOString();
    }

    if (typeof value === "string") {
      const date = new Date(value);

      return Number.isNaN(date.getTime())
        ? null
        : date.toISOString();
    }

    if (typeof value === "number") {
      const date = new Date(value);

      return Number.isNaN(date.getTime())
        ? null
        : date.toISOString();
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
        timeZone: "Asia/Riyadh",
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
        timeZone: "Asia/Riyadh",
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * ============================================================================
 * Safe decrypt
 * ============================================================================
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

    if (
      Array.isArray(value) ||
      typeof value === "object"
    ) {
      return value;
    }

    const text = String(value).trim();

    if (!text) {
      return "";
    }

    if (!isEncryptedValue(text)) {
      return text;
    }

    const decrypted = decrypt(text);

    if (
      decrypted === null ||
      decrypted === undefined
    ) {
      return "";
    }

    return decrypted;
  } catch {
    return "";
  }
}

/**
 * ============================================================================
 * Masking helpers
 * ============================================================================
 */

function maskPhone(phone) {
  if (!phone) {
    return "";
  }

  const value = String(phone)
    .replace(/\s+/g, "")
    .trim();

  if (!value) {
    return "";
  }

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

  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex);

  if (local.length <= 2) {
    return (
      local.charAt(0) +
      "****" +
      domain
    );
  }

  return (
    local.slice(0, 2) +
    "****" +
    domain
  );
}

function maskPassword(password) {
  if (!password) {
    return "";
  }

  return "••••••••";
}

function maskBackupCodes(codes) {
  if (
    codes === null ||
    codes === undefined ||
    codes === ""
  ) {
    return "";
  }

  let list = [];

  if (Array.isArray(codes)) {
    list = codes;
  } else {
    const value = String(codes).trim();

    if (!value) {
      return "";
    }

    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        list = parsed;
      } else {
        list = value
          .split(/\r?\n|,|\s+/)
          .filter(Boolean);
      }
    } catch {
      list = value
        .split(/\r?\n|,|\s+/)
        .filter(Boolean);
    }
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
    .replace(/\s+/g, "")
    .trim();

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

  if (!value) {
    return "";
  }

  if (value.length <= 10) {
    return "********";
  }

  return (
    value.slice(0, 4) +
    "..." +
    value.slice(-6)
  );
}

function maskName(name) {
  if (!name) {
    return "";
  }

  const value = String(name)
    .trim()
    .replace(/\s+/g, " ");

  if (!value) {
    return "";
  }

  const parts = value.split(" ");

  return parts
    .map((part) => {
      if (part.length <= 1) {
        return "*";
      }

      if (part.length === 2) {
        return (
          part.charAt(0) +
          "*"
        );
      }

      return (
        part.charAt(0) +
        "*".repeat(
          Math.max(1, part.length - 2)
        ) +
        part.charAt(part.length - 1)
      );
    })
    .join(" ");
}

/**
 * ============================================================================
 * Account helpers
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

/**
 * ============================================================================
 * Payment helpers
 * ============================================================================
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

    return {
      ...payout,
      method
    };
  }

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
    method
  };
}

function getPaymentMethodCode(order) {
  const payout =
    getPayoutDetails(order);

  return String(
    payout.method ||
    order.paymentMethodType ||
    ""
  )
    .trim()
    .toLowerCase();
}

function getPaymentMethodName(order) {
  if (order.paymentMethodName) {
    return String(
      order.paymentMethodName
    );
  }

  if (order.paymentMethod) {
    return String(
      order.paymentMethod
    );
  }

  const method =
    getPaymentMethodCode(order);

  const labels = {
    bank: "تحويل بنكي",
    bank_transfer: "تحويل بنكي",
    wallet: "محفظة إلكترونية",
    digital_wallet: "محفظة إلكترونية",
    usdt: "USDT",
    paypal: "PayPal",
    western: "Western Union",
    western_union: "Western Union"
  };

  return (
    labels[method] ||
    method
  );
}

function buildPaymentData(order) {
  const method =
    getPaymentMethodCode(order);

  const payment = {
    method,
    methodName:
      getPaymentMethodName(order)
  };

  /*
   * New orders persist a safe preview generated by the server
   * before sensitive payment fields are encrypted.
   *
   * This is the normal public-tracking path and requires no
   * decryption of sensitive payment data.
   */
  const preview =
    order.paymentPreview &&
    typeof order.paymentPreview === "object" &&
    !Array.isArray(order.paymentPreview)
      ? order.paymentPreview
      : null;

  if (preview) {
    return {
      ...payment,
      payoutType:
        String(preview.payoutType || ""),
      bankName:
        String(preview.bankName || ""),
      walletName:
        String(preview.walletName || ""),
      network:
        String(preview.network || ""),
      ibanLast6:
        String(preview.ibanLast6 || ""),
      phoneMasked:
        String(preview.phoneMasked || ""),
      walletMasked:
        String(preview.walletMasked || ""),
      emailMasked:
        String(
          preview.paypalEmailMasked ||
          preview.emailMasked ||
          ""
        ),
      fullNameMasked:
        String(preview.fullNameMasked || ""),
      country:
        String(
          preview.westernCountry ||
          preview.country ||
          ""
        )
    };
  }

  /*
   * Legacy orders may not have paymentPreview.
   * Keep a compatibility fallback for those records.
   */
  const payout =
    getPayoutDetails(order);

  if (
    method === "bank" ||
    method === "bank_transfer"
  ) {
    const iban =
      safeDecrypt(payout.iban);

    return {
      ...payment,
      bankName:
        String(
          safeDecrypt(payout.bankName) || ""
        ),
      ibanLast6:
        extractLast6(iban)
    };
  }

  if (
    method === "wallet" ||
    method === "digital_wallet"
  ) {
    const phone =
      safeDecrypt(
        payout.phone ||
        payout.walletPhone ||
        payout.walletNumber
      );

    return {
      ...payment,
      walletName:
        String(
          safeDecrypt(
            payout.walletName ||
            payout.walletType ||
            payout.name
          ) || ""
        ),
      phoneMasked:
        maskPhone(phone)
    };
  }

  if (method === "usdt") {
    const wallet =
      safeDecrypt(
        payout.wallet ||
        payout.usdtWallet ||
        payout.walletAddress
      );

    return {
      ...payment,
      walletMasked:
        maskWallet(wallet),
      network:
        String(
          safeDecrypt(
            payout.network
          ) || ""
        )
    };
  }

  if (method === "paypal") {
    const email =
      safeDecrypt(
        payout.email ||
        payout.paypalEmail
      );

    return {
      ...payment,
      emailMasked:
        maskEmail(email)
    };
  }

  if (
    method === "western" ||
    method === "western_union"
  ) {
    const fullName =
      safeDecrypt(
        payout.fullNameEnglish ||
        payout.fullName ||
        payout.westernName
      );

    const country =
      safeDecrypt(
        payout.country ||
        payout.westernCountry
      );

    return {
      ...payment,
      fullNameMasked:
        maskName(fullName),
      country:
        String(country || "")
    };
  }

  return payment;
}

/**
 * ============================================================================
 * Issue settings
 * ============================================================================
 */

async function getIssueMessages() {
  try {
    const snapshot =
      await SYSTEM_SETTINGS_DOC.get();

    if (!snapshot.exists) {
      return {
        ...DEFAULT_ISSUE_MESSAGES
      };
    }

    const data =
      snapshot.data() || {};

    const configured =
      data.issueMessages;

    if (
      !configured ||
      typeof configured !== "object" ||
      Array.isArray(configured)
    ) {
      return {
        ...DEFAULT_ISSUE_MESSAGES
      };
    }

    const result = {
      ...DEFAULT_ISSUE_MESSAGES
    };

    for (
      const [key, value]
      of Object.entries(configured)
    ) {
      if (
        !Object.prototype.hasOwnProperty.call(
          DEFAULT_ISSUE_MESSAGES,
          key
        )
      ) {
        continue;
      }

      if (
        typeof value !== "string" ||
        !value.trim()
      ) {
        continue;
      }

      result[key] =
        value.trim();
    }

    return result;
  } catch (error) {
    console.error(
      "Tracking issue settings error:",
      error?.code ||
        error?.message ||
        "unknown_error"
    );

    return {
      ...DEFAULT_ISSUE_MESSAGES
    };
  }
}

function buildIssueData(
  order,
  issueMessages
) {
  const issue =
    String(
      order.issue || ""
    )
      .trim()
      .toLowerCase();

  if (!issue) {
    return {
      issue: null,
      issueMessage: ""
    };
  }

  const isKnownIssue =
    Object.prototype.hasOwnProperty.call(
      DEFAULT_ISSUE_MESSAGES,
      issue
    );

  if (!isKnownIssue) {
    return {
      issue: "other_issue",
      issueMessage:
        String(
          issueMessages?.other_issue ||
          DEFAULT_ISSUE_MESSAGES.other_issue
        ).trim()
    };
  }

  const orderMessage =
    String(
      order.issueMessage ||
      order.statusIssueMessage ||
      ""
    ).trim();

  const configuredMessage =
    String(
      issueMessages?.[issue] ||
      ""
    ).trim();

  const fallbackMessage =
    ISSUE_LABELS[issue] ||
    DEFAULT_ISSUE_MESSAGES.other_issue;

  return {
    issue,
    issueMessage:
      orderMessage ||
      configuredMessage ||
      fallbackMessage
  };
}

/**
 * ============================================================================
 * Order helpers
 * ============================================================================
 */

function getDrawnCoins(order) {
  const value =
    order.withdrawnQuantity ??
    order.drawnCoins ??
    0;

  const number =
    Number(
      typeof value === "string"
        ? value.replace(/,/g, "")
        : value
    );

  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
}

function getQuantity(order) {
  const value =
    order.orderedQuantity ??
    order.quantity ??
    order.totalQty ??
    order.coinQuantity ??
    order.coins ??
    0;

  const number =
    Number(
      typeof value === "string"
        ? value.replace(/,/g, "")
        : value
    );

  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
}

/**
 * ============================================================================
 * Public Tracking DTO
 * ============================================================================
 */

function buildTrackingOrder(
  order,
  issueMessages
) {
  const status =
    normalizeStatus(
      order.status ||
      order.orderStatus
    );

  const sensitivePurged =
    Boolean(
      order.sensitivePurged === true ||
      order.sensitiveDataPurged === true ||
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
    buildIssueData(
      order,
      issueMessages
    );

  const paymentData =
    buildPaymentData(order);

  const quantity =
    getQuantity(order);

  const drawnCoins =
    getDrawnCoins(order);

  let progressPercentage =
    Number(
      order.progressPercentage
    );

  if (
    status === "progress" ||
    quantity > 0
  ) {
    if (quantity > 0) {
      progressPercentage =
        (drawnCoins / quantity) * 100;
    }
  } else if (
    !Number.isFinite(
      progressPercentage
    )
  ) {
    const defaultPercentages = {
      new: 15,
      review: 35,
      progress: 0,
      finished: 100,
      transferred: 100,
      completed: 100
    };

    progressPercentage =
      defaultPercentages[status] ??
      0;
  }

  progressPercentage =
    Math.max(
      0,
      Math.min(
        100,
        progressPercentage
      )
    );

  const remainingQuantity =
    Math.max(
      0,
      quantity - drawnCoins
    );

  const totalPrice =
    order.displayTotalPrice ??
    order.totalPrice ??
    order.total ??
    "";

  return {
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
      maskPhone(
        order.phone || ""
      ),

    platform:
      String(
        order.platform ||
        ""
      ),

    quantity,

    orderedQuantity:
      quantity,

    totalPrice,

    totalPriceSar:
      order.totalPriceSar ??
      null,

    totalPriceUsd:
      order.totalPriceUsd ??
      null,

    priceCurrency:
      order.priceCurrency ||
      null,

    status,

    statusKey:
      status,

    statusLabel:
      STATUS_MESSAGES[status] ||
      status,

    drawnCoins,

    withdrawnQuantity:
      drawnCoins,

    remainingQuantity,

    progressPercentage,

    paymentMethod:
      getPaymentMethodName(order),

    paymentMethodName:
      getPaymentMethodName(order),

    paymentMethodType:
      paymentData.method,

    payment: paymentData,

    paymentInfoData:
      paymentData,

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

    updatedAt:
      toISOStringSafe(
        lastUpdate
      ),

    withdrawDuration:
      order.withdrawDuration ||
      null,

    transferDuration:
      order.transferDuration ||
      null,

    issue:
      issueData.issue,

    issueMessage:
      issueData.issueMessage,

    issueState:
      order.issue
        ? String(order.issueState || "needs_customer_action")
        : "resolved"
  };
}

/**
 * ============================================================================
 * Tracking snapshot helper
 * ============================================================================
 */

async function getTrackingSnapshot(
  ref
) {
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
    return null;
  }

  const document =
    snapshot.docs[0];

  return {
    id: document.id,
    data:
      document.data() || {}
  };
}

/**
 * ============================================================================
 * SSE helpers
 * ============================================================================
 */

function addTrackingConnection(
  ref,
  response
) {
  let connections =
    trackingConnections.get(ref);

  if (!connections) {
    connections = new Set();

    trackingConnections.set(
      ref,
      connections
    );
  }

  connections.add(response);
}

function removeTrackingConnection(
  ref,
  response
) {
  const connections =
    trackingConnections.get(ref);

  if (!connections) {
    return;
  }

  connections.delete(response);

  if (connections.size === 0) {
    trackingConnections.delete(ref);
  }
}

function writeSseEvent(
  response,
  eventName,
  payload
) {
  if (
    response.writableEnded ||
    response.destroyed
  ) {
    return false;
  }

  try {
    response.write(
      `event: ${eventName}\n`
    );

    response.write(
      `data: ${JSON.stringify(payload)}\n\n`
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * ============================================================================
 * GET /api/tracking/:ref
 * ============================================================================
 */

router.get(
  "/:ref",
  async (req, res) => {
    try {
      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");

      const ref =
        normalizeReference(
          req.params.ref
        );

      if (
        !isValidReference(ref)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "رقم الطلب غير صحيح"
        });
      }

      const found =
        await getTrackingSnapshot(
          ref
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

      const issueMessages =
        await getIssueMessages();

      const publicOrder =
        buildTrackingOrder(
          order,
          issueMessages
        );

      const issueData =
        buildIssueData(
          order,
          issueMessages
        );

      const status =
        publicOrder.status;

      const configuredStatusMessages =
        order.statusMessages &&
        typeof order.statusMessages === "object" &&
        !Array.isArray(order.statusMessages)
          ? order.statusMessages
          : null;

      const statusMessage =
        String(
          order.statusMessage ||
          configuredStatusMessages?.[status] ||
          STATUS_MESSAGES[status] ||
          ""
        ).trim();

      return res.json({
        success: true,

        order: publicOrder,

        statusMessage,

        issue:
          issueData.issue,

        issueMessage:
          issueData.issueMessage
      });
    } catch (error) {
      console.error(
        "Tracking API Error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message:
          "حدث خطأ في الخادم، يرجى المحاولة لاحقاً."
      });
    }
  }
);

/**
 * ============================================================================
 * GET /api/tracking/:ref/events
 * ============================================================================
 *
 * Realtime tracking.
 *
 * لا يوجد polling.
 * لا يوجد refresh دوري.
 *
 * Firestore onSnapshot يدفع التغيير إلى SSE.
 */
router.get(
  "/:ref/events",
  async (req, res) => {
    const ref =
      normalizeReference(
        req.params.ref
      );

    if (
      !isValidReference(ref)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "رقم الطلب غير صحيح"
      });
    }

    let initialSnapshot;

    try {
      initialSnapshot =
        await getTrackingSnapshot(
          ref
        );
    } catch (error) {
      console.error(
        "Tracking SSE lookup error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر فتح اتصال التتبع."
      });
    }

    if (!initialSnapshot) {
      return res.status(404).json({
        success: false,
        message:
          "الطلب غير موجود"
      });
    }

    res.status(200);

    res.set(
      "Content-Type",
      "text/event-stream; charset=utf-8"
    );

    res.set(
      "Cache-Control",
      "no-cache, no-store, must-revalidate"
    );

    res.set(
      "Connection",
      "keep-alive"
    );

    res.set(
      "X-Accel-Buffering",
      "no"
    );

    if (
      typeof res.flushHeaders ===
      "function"
    ) {
      res.flushHeaders();
    }

    let closed = false;
    let unsubscribe = null;

    /**
     * Heartbeat transport فقط.
     * لا يوجد استعلام Firestore هنا.
     */
    const heartbeat =
      setInterval(
        () => {
          if (
            closed ||
            res.writableEnded ||
            res.destroyed
          ) {
            return;
          }

          try {
            res.write(
              ": heartbeat\n\n"
            );
          } catch {
            cleanup();
          }
        },
        25000
      );

    function cleanup() {
      if (closed) {
        return;
      }

      closed = true;

      clearInterval(
        heartbeat
      );

      if (
        typeof unsubscribe ===
        "function"
      ) {
        try {
          unsubscribe();
        } catch {
          // Listener already closed.
        }

        unsubscribe = null;
      }

      removeTrackingConnection(
        ref,
        res
      );

      if (
        !res.writableEnded
      ) {
        try {
          res.end();
        } catch {
          // Connection already closed.
        }
      }
    }

    addTrackingConnection(
      ref,
      res
    );

    try {
      const issueMessages =
        await getIssueMessages();

      const initialOrder =
        buildTrackingOrder(
          initialSnapshot.data,
          issueMessages
        );

      const initialIssue =
        buildIssueData(
          initialSnapshot.data,
          issueMessages
        );

      const initialStatus =
        initialOrder.status;

      const configuredStatusMessages =
        initialSnapshot.data.statusMessages &&
        typeof initialSnapshot.data.statusMessages === "object" &&
        !Array.isArray(
          initialSnapshot.data.statusMessages
        )
          ? initialSnapshot.data.statusMessages
          : null;

      const initialStatusMessage =
        String(
          initialSnapshot.data.statusMessage ||
          configuredStatusMessages?.[
            initialStatus
          ] ||
          STATUS_MESSAGES[initialStatus] ||
          ""
        ).trim();

      writeSseEvent(
        res,
        "order-update",
        {
          success: true,

          order:
            initialOrder,

          statusMessage:
            initialStatusMessage,

          issue:
            initialIssue.issue,

          issueMessage:
            initialIssue.issueMessage
        }
      );

      /**
       * Firestore realtime listener.
       *
       * هذا هو مصدر التغيير.
       * لا يوجد polling.
       */
      unsubscribe =
        db
          .collection("orders")
          .where(
            "referenceNumber",
            "==",
            ref
          )
          .limit(1)
          .onSnapshot(
            async (snapshot) => {
              if (
                closed ||
                res.writableEnded ||
                res.destroyed
              ) {
                return;
              }

              if (
                snapshot.empty
              ) {
                return;
              }

              try {
                const document =
                  snapshot.docs[0];

                const order =
                  document.data() || {};

                const issueMessages =
                  await getIssueMessages();

                const publicOrder =
                  buildTrackingOrder(
                    order,
                    issueMessages
                  );

                const issueData =
                  buildIssueData(
                    order,
                    issueMessages
                  );

                const status =
                  publicOrder.status;

                const configuredStatusMessages =
                  order.statusMessages &&
                  typeof order.statusMessages === "object" &&
                  !Array.isArray(
                    order.statusMessages
                  )
                    ? order.statusMessages
                    : null;

                const statusMessage =
                  String(
                    order.statusMessage ||
                    configuredStatusMessages?.[
                      status
                    ] ||
                    STATUS_MESSAGES[status] ||
                    ""
                  ).trim();

                const ok =
                  writeSseEvent(
                    res,
                    "order-update",
                    {
                      success: true,

                      order:
                        publicOrder,

                      statusMessage,

                      issue:
                        issueData.issue,

                      issueMessage:
                        issueData.issueMessage
                    }
                  );

                if (!ok) {
                  cleanup();
                }
              } catch (error) {
                console.error(
                  "Tracking SSE update error:",
                  error?.code ||
                    error?.message ||
                    "unknown_error"
                );
              }
            },
            (error) => {
              console.error(
                "Tracking Firestore listener error:",
                error?.code ||
                  error?.message ||
                  "unknown_error"
              );

              if (
                closed ||
                res.writableEnded
              ) {
                return;
              }

              writeSseEvent(
                res,
                "error",
                {
                  success: false,
                  message:
                    "تعذر تحديث بيانات التتبع."
                }
              );

              cleanup();
            }
          );
    } catch (error) {
      console.error(
        "Tracking SSE listener setup error:",
        error?.code ||
          error?.message ||
          "unknown_error"
      );

      cleanup();
    }

    req.on(
      "close",
      cleanup
    );

    res.on(
      "close",
      cleanup
    );
  }
);

export default router;
