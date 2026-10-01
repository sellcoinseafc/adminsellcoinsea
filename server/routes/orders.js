/* SAMI_COINS_SCHEMA_V3: canonical order/status/payment schema */
import express from "express";
import admin, { db } from "../services/firebase.js";
import {
  encrypt,
  decrypt,
  isEncryptedValue
} from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  generateOrderNumbers,
  isValidReferenceNumber
} from "../services/orderNumber.js";

const router = express.Router();

const TS =
  admin.firestore.FieldValue.serverTimestamp;

const STATUS_VALUES = new Set([
  "new",
  "review",
  "progress",
  "finished",
  "transferred",
  "completed",
  "archived"
]);

const ALLOWED_STATUS_TRANSITIONS = {
  new: new Set(["new", "review", "progress"]),
  review: new Set(["review", "progress"]),
  progress: new Set(["progress", "finished"]),
  finished: new Set(["finished", "transferred"]),
  transferred: new Set(["transferred", "completed"]),
  completed: new Set(["completed"]),
  archived: new Set(["archived"])
};

const ISSUE_VALUES = new Set([
  "wrong_credentials",
  "wrong_backup_codes",
  "logged_in_platform",
  "market_closed",
  "wrong_platform",
  "other_issue"
]);

const ISSUE_STATES = new Set([
  "needs_customer_action",
  "data_received",
  "resolved"
]);

const PAYOUT_METHODS = new Set([
  "bank",
  "wallet",
  "usd",
  "paypal",
  "western"
]);

const PURGE_DELAY_MS =
  5 * 24 * 60 * 60 * 1000;

const DEFAULT_ISSUE_MESSAGES = {
  wrong_credentials:
    "يرجى إرسال الإيميل والباسورد الصحيح عبر الواتساب",

  wrong_backup_codes:
    "يرجى إرسال أكواد احتياطية جديدة",

  logged_in_platform:
    "يرجى إعلامنا عبر الواتساب",

  market_closed:
    "سوق الانتقالات مغلق في Web App، يرجى التواصل معنا عبر الواتساب",

  wrong_platform:
    "يرجى التواصل معنا عبر الواتساب",

  other_issue:
    "يرجى التواصل معنا عبر الواتساب بشكل عاجل"
};

/* ==========================================================================
   General Helpers
========================================================================== */

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function toNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeQuantity(value) {
  const quantity = Math.floor(
    toNumber(value, 0)
  );

  return quantity > 0
    ? quantity
    : 0;
}

function normalizeStatus(value) {
  const status =
    cleanString(value).toLowerCase();

  /*
   * Legacy compatibility.
   */
  if (status === "pending") {
    return "new";
  }

  return STATUS_VALUES.has(status)
    ? status
    : "new";
}

function normalizeIssue(value) {
  const issue =
    cleanString(value).toLowerCase();

  if (
    !issue ||
    issue === "none" ||
    issue === "no_issue"
  ) {
    return null;
  }

  return ISSUE_VALUES.has(issue)
    ? issue
    : null;
}

function normalizePlatform(value) {
  const platform = cleanString(value);
  const normalized = platform.toUpperCase();

  if (normalized === "PLAYSTATION" || normalized === "PS" || normalized === "PS4" || normalized === "PS5") return "PlayStation";
  if (normalized === "XBOX" || normalized === "XB") return "Xbox";
  if (normalized === "PC") return "PC";

  return "";
}

function normalizePaymentMethodCode(value) {
  const text = cleanString(value).toLowerCase();
  if (["bank", "bank_transfer", "تحويل بنكي"].includes(text)) return "bank";
  if (["wallet", "digital_wallet", "المحافظ الرقمية"].includes(text)) return "wallet";
  if (["usdt", "usd", "dollar", "دولار"].includes(text)) return "usd";
  if (["paypal", "بايبال"].includes(text)) return "paypal";
  if (["western", "western_union", "ويسترن يونيون"].includes(text)) return "western";
  return "";
}

function getConfiguredPaymentCodes(settings, category) {
  const configured = settings?.paymentMethods;

  if (configured && typeof configured === "object" && !Array.isArray(configured)) {
    const values = Array.isArray(configured[category]) ? configured[category] : [];
    return new Set(values.map(normalizePaymentMethodCode).filter(Boolean));
  }

  const values = Array.isArray(configured) ? configured : [];
  const categoryCodes = Array.isArray(settings?.paymentCategories?.[category])
    ? settings.paymentCategories[category]
    : [];

  if (categoryCodes.length) {
    const codes = new Set(categoryCodes.map(normalizePaymentMethodCode).filter(Boolean));
    if (codes.size) return codes;
  }

  const codes = new Set(
    values.map(normalizePaymentMethodCode).filter((code) =>
      category === "local"
        ? code === "bank" || code === "wallet"
        : code === "usd" || code === "paypal" || code === "western"
    )
  );

  if (codes.size) return codes;

  return new Set(
    category === "local"
      ? ["bank", "wallet"]
      : ["usd", "paypal", "western"]
  );
}

function isConfiguredPaymentMethod(settings, payout) {
  const category = payout?.payoutType === "international"
    ? "international"
    : "local";

  return getConfiguredPaymentCodes(settings, category).has(payout?.method);
}

function normalizeBackupCodes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        cleanString(item)
      )
      .filter(Boolean);
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value
      .split(/\r?\n|,/)
      .map((item) =>
        item.trim()
      )
      .filter(Boolean);
  }

  return [];
}

function encryptBackupCodes(codes) {
  const normalized =
    normalizeBackupCodes(codes);

  if (!normalized.length) {
    return "";
  }

  return encrypt(
    JSON.stringify(normalized)
  );
}

/**
 * Encrypt only if the value is not already encrypted.
 *
 * Used for compatibility with old orders.
 */
function encryptIfNeeded(value) {
  const normalized =
    cleanString(value);

  if (!normalized) {
    return "";
  }

  if (
    isEncryptedValue(normalized)
  ) {
    try {
      decrypt(normalized);
      return normalized;
    } catch {
      /*
       * Looks structurally similar to ciphertext
       * but cannot actually be decrypted.
       * Treat it as plaintext.
       */
    }
  }

  return encrypt(normalized);
}

/**
 * Safely decrypt without exposing errors.
 */
function safeDecrypt(value) {
  try {
    if (!value) {
      return "";
    }

    return decrypt(
      String(value)
    );
  } catch {
    return "";
  }
}

/* ==========================================================================
   Pricing
========================================================================== */

/**
 * Returns the canonical platform rate.
 *
 * Current business rule:
 * - PlayStation -> psRate
 * - Xbox        -> psRate
 * - PC          -> pcRate
 */
function getPlatformRate(
  platform,
  settings
) {
  const normalized =
    cleanString(
      platform
    ).toUpperCase();

  if (
    normalized === "PC"
  ) {
    return toNumber(
      settings.pcRate,
      0
    );
  }

  if (
    normalized === "XBOX" ||
    normalized === "XB" ||
    normalized === "PLAYSTATION" ||
    normalized === "PS" ||
    normalized === "PS5" ||
    normalized === "PS4"
  ) {
    return toNumber(
      settings.psRate,
      0
    );
  }

  /*
   * Unknown platforms must never inherit a real price.
   * The server should fail closed.
   */
  return 0;
}

/**
 * Determine whether the payout is local or international.
 */
function getPayoutType(
  payout
) {
  const explicit =
    cleanString(
      payout?.payoutType
    ).toLowerCase();

  if (
    explicit === "local" ||
    explicit === "international"
  ) {
    return explicit;
  }

  const method =
    cleanString(
      payout?.method
    ).toLowerCase();

  return (
    method === "bank" ||
    method === "wallet"
  )
    ? "local"
    : "international";
}

/**
 * Server-authoritative price calculation.
 *
 * Base:
 * quantity / 1,000,000 × rate
 *
 * International:
 * SAR / 3.75
 */
function calculateServerPrice(
  quantity,
  platform,
  payout,
  settings
) {
  const numericQuantity =
    normalizeQuantity(
      quantity
    );

  const rate =
    getPlatformRate(
      platform,
      settings
    );

  if (
    numericQuantity <= 0 ||
    rate <= 0
  ) {
    return null;
  }

  const totalSar =
    (
      numericQuantity /
      1000000
    ) * rate;

  const payoutType =
    getPayoutType(
      payout
    );

  const isInternational =
    payoutType ===
    "international";

  const usdSarRate =
    toNumber(settings.usdSarRate, 3.75);

  const totalUsd =
    totalSar /
    usdSarRate;

  return {
    rate,
    quantity:
      numericQuantity,

    payoutType,

    currency:
      isInternational
        ? "USD"
        : "SAR",

    totalSar:
      Number(
        totalSar.toFixed(2)
      ),

    totalUsd:
      Number(
        totalUsd.toFixed(2)
      ),

    displayTotal:
      isInternational
        ? `$${totalUsd.toFixed(2)}`
        : `${totalSar.toFixed(2)} ر.س`
  };
}

/**
 * Compare the customer-provided display amount only as a
 * compatibility/reference value.
 *
 * It is NEVER used as the authoritative price.
 */
function getClientPrice(
  body
) {
  return cleanString(
    body?.totalPrice
  );
}

/* ==========================================================================
   Account
========================================================================== */

function normalizeAccountData(body) {
  const account =
    body?.accountData &&
    typeof body.accountData === "object"
      ? body.accountData
      : {};

  return {
    eaEmail: cleanString(
      account.eaEmail ??
      body.eaEmail
    ),

    eaPassword: cleanString(
      account.eaPassword ??
      body.eaPassword
    ),

    backupCodes:
      normalizeBackupCodes(
        account.backupCodes ??
        body.backupCodes
      )
  };
}

/**
 * Normalize stored account data without decrypting.
 */
function normalizeStoredAccountData(
  account
) {
  if (
    !account ||
    typeof account !== "object"
  ) {
    return {};
  }

  return {
    ...account
  };
}

/* ==========================================================================
   Payout
========================================================================== */

function getIncomingPayout(body) {
  if (
    body?.payoutDetails &&
    typeof body.payoutDetails === "object"
  ) {
    return body.payoutDetails;
  }

  /*
   * Legacy compatibility.
   */
  if (
    body?.paymentInfoData &&
    typeof body.paymentInfoData === "object"
  ) {
    return body.paymentInfoData;
  }

  return {};
}

function getPayoutMethod(
  body,
  payout
) {
  return cleanString(
    payout.method ??
    body.paymentMethodType ??
    ""
  ).toLowerCase();
}

function normalizePayout(body) {
  const payout =
    getIncomingPayout(body);

  const method =
    getPayoutMethod(
      body,
      payout
    );

  switch (method) {
    case "bank":
      return {
        payoutType: "local",
        method: "bank",

        bankName:
          cleanString(
            payout.bankName ??
            body.bankName
          ),

        fullName:
          cleanString(
            payout.fullName ??
            payout.accountName ??
            body.accountName ??
            body.fullName
          ),

        iban:
          cleanString(
            payout.iban ??
            body.iban
          ),

        recipientName:
          cleanString(
            payout.recipientName ??
            body.recipientName
          )
      };

    case "wallet":
      return {
        payoutType: "local",
        method: "wallet",

        walletName:
          cleanString(
            payout.walletName ??
            payout.walletType ??
            body.walletName ??
            body.walletType
          ),

        phone:
          cleanString(
            payout.phone ??
            payout.walletNumber ??
            body.phoneNumber ??
            body.walletNumber
          )
      };

    case "usdt":
    case "usd":
      return {
        payoutType: "international",
        method: "usd",

        wallet:
          cleanString(
            payout.wallet ??
            payout.walletAddress ??
            body.wallet ??
            body.walletAddress ??
            body.usdtWallet
          ),

        network:
          cleanString(
            payout.network ??
            body.network
          )
      };

    case "paypal":
      return {
        payoutType: "international",
        method: "paypal",

        email:
          cleanString(
            payout.email ??
            payout.paypalEmail ??
            body.paypalEmail
          )
      };

    case "western":
      return {
        payoutType: "international",
        method: "western",

        fullNameEnglish:
          cleanString(
            payout.fullNameEnglish ??
            payout.fullName ??
            body.fullNameEnglish ??
            body.fullName
          ),

        country:
          cleanString(
            payout.country ??
            body.country
          )
      };

    default:
      return {
        payoutType:
          cleanString(
            payout.payoutType ??
            body.payoutType
          ),

        method
      };
  }
}

/**
 * Encrypt sensitive payout fields immediately.
 *
 * Readable metadata:
 * - payoutType
 * - method
 * - bankName
 * - walletName
 * - network
 *
 * Sensitive values:
 * - fullName
 * - IBAN
 * - wallet phone
 * - USDT wallet
 * - PayPal email
 * - Western Union name/country
 */
function encryptPayoutDetails(
  payout
) {
  switch (payout.method) {
    case "bank":
      return {
        payoutType:
          "local",

        method:
          "bank",

        bankName:
          payout.bankName || "",

        fullName:
          payout.fullName
            ? encryptIfNeeded(
                payout.fullName
              )
            : "",

        iban:
          payout.iban
            ? encryptIfNeeded(
                payout.iban
              )
            : "",

        recipientName:
          payout.recipientName
            ? encryptIfNeeded(
                payout.recipientName
              )
            : ""
      };

    case "wallet":
      return {
        payoutType:
          "local",

        method:
          "wallet",

        walletName:
          payout.walletName || "",

        phone:
          payout.phone
            ? encryptIfNeeded(
                payout.phone
              )
            : ""
      };

    case "usdt":
    case "usd":
      return {
        payoutType:
          "international",

        method:
          "usd",

        wallet:
          payout.wallet
            ? encryptIfNeeded(
                payout.wallet
              )
            : "",

        network:
          payout.network || ""
      };

    case "paypal":
      return {
        payoutType:
          "international",

        method:
          "paypal",

        email:
          payout.email
            ? encryptIfNeeded(
                payout.email
              )
            : ""
      };

    case "western":
      return {
        payoutType:
          "international",

        method:
          "western",

        fullNameEnglish:
          payout.fullNameEnglish
            ? encryptIfNeeded(
                payout.fullNameEnglish
              )
            : "",

        country:
          payout.country
            ? encryptIfNeeded(
                payout.country
              )
            : ""
      };

    default:
      return {
        ...payout
      };
  }
}

/* ==========================================================================
   Legacy Payment Compatibility
========================================================================== */

function buildLegacyPaymentInfo(
  payout
) {
  const payment = {};

  switch (
    payout.method
  ) {
    case "bank":
      payment.bankName =
        payout.bankName || "";

      payment.accountName =
        payout.fullName
          ? encryptIfNeeded(
              payout.fullName
            )
          : "";

      payment.iban =
        payout.iban
          ? encryptIfNeeded(
              payout.iban
            )
          : "";

      break;

    case "wallet":
      payment.walletType =
        payout.walletName || "";

      payment.walletNumber =
        payout.phone
          ? encryptIfNeeded(
              payout.phone
            )
          : "";

      break;

    case "usdt":
    case "usd":
      payment.walletAddress =
        payout.wallet
          ? encryptIfNeeded(
              payout.wallet
            )
          : "";

      payment.network =
        payout.network || "";

      break;

    case "paypal":
      payment.paypalEmail =
        payout.email
          ? encryptIfNeeded(
              payout.email
            )
          : "";

      break;

    case "western":
      payment.fullName =
        payout.fullNameEnglish
          ? encryptIfNeeded(
              payout.fullNameEnglish
            )
          : "";

      payment.country =
        payout.country
          ? encryptIfNeeded(
              payout.country
            )
          : "";

      break;
  }

  return payment;
}

/* ==========================================================================
   Legacy Compatibility
========================================================================== */

function getOrderStatus(data) {
  return normalizeStatus(
    data.status ??
    data.orderStatus ??
    "new"
  );
}

function getOrderQuantity(data) {
  return normalizeQuantity(
    data.quantity ??
    data.totalQty ??
    data.withdrawnQuantity ??
    data.drawnCoins ??
    0
  );
}

function getOrderTotal(data) {
  /*
   * Prefer the new server-authoritative display amount.
   */
  if (
    data.displayTotalPrice
  ) {
    return data.displayTotalPrice;
  }

  /*
   * Legacy orders.
   */
  return (
    data.totalPrice ??
    data.total ??
    ""
  );
}

function getBusinessOrderId(
  data,
  docId
) {
  return (
    data.orderId ||
    docId
  );
}

/* ==========================================================================
   Find Order
========================================================================== */

async function findOrder(
  orderId
) {
  const value =
    cleanString(orderId);

  if (!value) {
    return null;
  }

  /*
   * 1. Firestore document ID.
   */
  const directRef =
    db
      .collection("orders")
      .doc(value);

  const directSnap =
    await directRef.get();

  if (directSnap.exists) {
    return {
      ref: directRef,
      snap: directSnap
    };
  }

  /*
   * 2. Business orderId.
   */
  const byOrderId =
    await db
      .collection("orders")
      .where(
        "orderId",
        "==",
        value
      )
      .limit(1)
      .get();

  if (!byOrderId.empty) {
    const snap =
      byOrderId.docs[0];

    return {
      ref: snap.ref,
      snap
    };
  }

  /*
   * 3. Customer reference.
   */
  const byReference =
    await db
      .collection("orders")
      .where(
        "referenceNumber",
        "==",
        value
      )
      .limit(1)
      .get();

  if (!byReference.empty) {
    const snap =
      byReference.docs[0];

    return {
      ref: snap.ref,
      snap
    };
  }

  return null;
}

/* ==========================================================================
   Issue Messages
========================================================================== */

async function getIssueMessages() {
  try {
    const snap =
      await db
        .collection("system")
        .doc("settings")
        .get();

    const settings =
      snap.data() || {};

    const configured =
      settings.issueMessages &&
      typeof settings.issueMessages === "object"
        ? settings.issueMessages
        : {};

    return {
      ...DEFAULT_ISSUE_MESSAGES,
      ...configured
    };
  } catch {
    return {
      ...DEFAULT_ISSUE_MESSAGES
    };
  }
}

async function getIssueMessage(
  issue
) {
  const normalized =
    normalizeIssue(issue);

  if (!normalized) {
    return "";
  }

  const messages =
    await getIssueMessages();

  return cleanString(
    messages[normalized] ||
    DEFAULT_ISSUE_MESSAGES[
      normalized
    ] ||
    ""
  );
}

/* ==========================================================================
   Masking
========================================================================== */

function maskPhone(
  value
) {
  const text =
    String(value || "");

  if (text.length <= 4) {
    return "••••";
  }

  return (
    "••••" +
    text.slice(-4)
  );
}

function maskEmail(
  value
) {
  const email =
    String(value || "");

  const at =
    email.indexOf("@");

  if (at <= 0) {
    return "••••";
  }

  const local =
    email.slice(0, at);

  const domain =
    email.slice(at);

  if (local.length <= 2) {
    return (
      "••" +
      domain
    );
  }

  return (
    local.slice(0, 2) +
    "••••" +
    domain
  );
}

function maskMiddle(
  value,
  start = 4,
  end = 4
) {
  const text =
    String(value || "");

  if (
    text.length <=
    start + end
  ) {
    return "••••";
  }

  return (
    text.slice(0, start) +
    "••••" +
    text.slice(-end)
  );
}

/* ==========================================================================
   Safe Payment Preview
========================================================================== */

/**
 * Safe preview for the normal admin order list.
 *
 * Full sensitive values are NEVER returned here.
 */
function buildPaymentPreview(
  data
) {
  const payout =
    data.payoutDetails &&
    typeof data.payoutDetails === "object"
      ? data.payoutDetails
      : null;

  const legacy =
    data.paymentInfoData &&
    typeof data.paymentInfoData === "object"
      ? data.paymentInfoData
      : {};

  const method =
    cleanString(
      payout?.method ||
      data.paymentMethodType ||
      data.paymentMethod ||
      ""
    ).toLowerCase();

  const preview = {
    method,

    payoutType:
      payout?.payoutType ||
      (
        method === "bank" ||
        method === "wallet"
          ? "local"
          : "international"
      ),

    bankName:
      payout?.bankName ||
      legacy.bankName ||
      "",

    walletName:
      payout?.walletName ||
      legacy.walletType ||
      "",

    network:
      payout?.network ||
      legacy.network ||
      "",

    ibanLast6:
      "",

    phoneMasked:
      "",

    walletMasked:
      "",

    paypalEmailMasked:
      "",

    westernCountry:
      ""
  };

  if (
    method === "bank"
  ) {
    const iban =
      safeDecrypt(
        payout?.iban ||
        legacy.iban
      );

    if (iban) {
      preview.ibanLast6 =
        iban.slice(-6);
    }
  }

  if (
    method === "wallet"
  ) {
    const phone =
      safeDecrypt(
        payout?.phone ||
        legacy.walletNumber
      );

    if (phone) {
      preview.phoneMasked =
        maskPhone(phone);
    }
  }

  if (
    method === "usdt"
  ) {
    const wallet =
      safeDecrypt(
        payout?.wallet ||
        legacy.walletAddress
      );

    if (wallet) {
      preview.walletMasked =
        maskMiddle(
          wallet,
          6,
          6
        );
    }
  }

  if (
    method === "paypal"
  ) {
    const email =
      safeDecrypt(
        payout?.email ||
        legacy.paypalEmail
      );

    if (email) {
      preview.paypalEmailMasked =
        maskEmail(email);
    }
  }

  if (
    method === "western"
  ) {
    preview.westernCountry =
      safeDecrypt(
        payout?.country ||
        legacy.country
      );
  }

  return preview;
}

/* ==========================================================================
   API Test
========================================================================== */

router.get(
  "/",
  (_, res) => {
    return res.json({
      success: true,
      message:
        "Orders API Ready"
    });
  }
);

/* ==========================================================================
   Admin Orders List
========================================================================== */

router.get(
  "/list",
  requireAdmin,
  async (_, res) => {
    try {
      const snapshot =
        await db
          .collection("orders")
          .orderBy(
            "createdAt",
            "desc"
          )
          .get();

      const orders =
        snapshot.docs.map(
          (doc) => {
            const data =
              doc.data() || {};

            const status =
              getOrderStatus(
                data
              );

            const quantity =
              getOrderQuantity(
                data
              );

            const businessOrderId =
              getBusinessOrderId(
                data,
                doc.id
              );

            return {
              id:
                doc.id,

              orderId:
                businessOrderId,

              /*
               * Kept for frontend compatibility.
               */
              reference:
                businessOrderId,

              referenceNumber:
                data.referenceNumber ||
                "",

              internalReference:
                data.internalReference ||
                "",

              customerName:
                data.customerName ||
                "",

              name:
                data.customerName ||
                "",

              phone:
                data.phone ||
                "",

              platform:
                data.platform ||
                "",

              quantity,

              totalQty:
                quantity,

              totalPrice:
                getOrderTotal(
                  data
                ),

              totalPriceSar:
                data.totalPriceSar ??
                null,

              totalPriceUsd:
                data.totalPriceUsd ??
                null,

              priceCurrency:
                data.priceCurrency ||
                "",

              displayTotalPrice:
                data.displayTotalPrice ||
                getOrderTotal(
                  data
                ),

              status,

              issue:
                normalizeIssue(
                  data.issue
                ),

              issueMessage:
                cleanString(
                  data.issueMessage
                ),

              issueState:
                String(
                  data.issueState ||
                  (data.issue ? "needs_customer_action" : "resolved")
                ),

              withdrawnQuantity:
                Number(
                  data.withdrawnQuantity ??
                  data.drawnCoins ??
                  0
                ),

              drawnCoins:
                Number(
                  data.drawnCoins ??
                  data.withdrawnQuantity ??
                  0
                ),

              paymentMethod:
                data.paymentMethod ||
                data.payoutDetails?.method ||
                data.paymentMethodType ||
                "",

              paymentMethodType:
                data.paymentMethodType ||
                data.payoutDetails?.method ||
                "",

              /*
               * Safe payment preview only.
               */
              paymentPreview:
                buildPaymentPreview(
                  data
                ),

              transferData: {
                transferredAt:
                  data.transferredAt ||
                  null,

                transferredBy:
                  data.transferredBy ||
                  null,

                transferCompleted:
                  data.transferCompleted ===
                  true
              },

              completedAt:
                data.completedAt ||
                null,

              purgeDueAt:
                data.purgeDueAt ||
                null,

              purgedAt:
                data.purgedAt ||
                null,

              sensitivePurged:
                data.sensitivePurged ===
                  true ||
                data.sensitiveDataPurged ===
                  true,

              history:
                Array.isArray(data.history)
                  ? data.history.slice(-50)
                  : [],

              /*
               * Temporary compatibility.
               */
              sensitiveDataPurged:
                data.sensitivePurged ===
                  true ||
                data.sensitiveDataPurged ===
                  true,

              reviewSubmitted:
                data.reviewSubmitted ===
                true,

              createdAt:
                data.createdAt?.toDate
                  ? data.createdAt
                      .toDate()
                      .toISOString()
                  : null,

              lastUpdate:
                data.lastUpdate?.toDate
                  ? data.lastUpdate
                      .toDate()
                      .toISOString()
                  : null
            };
          }
        );

      return res.json({
        success: true,
        orders
      });
    } catch (error) {
      console.error(
        "Orders list error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر تحميل الطلبات."
      });
    }
  }
);

/* ==========================================================================
   Create Order
========================================================================== */

router.post(
  "/create",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const customerName =
        cleanString(
          body.customerName
        );

      const phone =
        cleanString(
          body.phone
        );

      const platform =
        normalizePlatform(
          body.platform
        );

      const quantity =
        normalizeQuantity(
          body.quantity
        );

      if (!customerName) {
        return res.status(400).json({
          success: false,
          message:
            "اسم العميل مطلوب."
        });
      }

      if (!phone) {
        return res.status(400).json({
          success: false,
          message:
            "رقم الجوال مطلوب."
        });
      }

      if (!platform) {
        return res.status(400).json({
          success: false,
          message:
            "المنصة مطلوبة."
        });
      }

      if (!quantity) {
        return res.status(400).json({
          success: false,
          message:
            "كمية الكوينز غير صحيحة."
        });
      }

      /* =====================================================
         Settings
      ===================================================== */

      const settingsSnap =
        await db
          .collection("system")
          .doc("settings")
          .get();

      const settings =
        settingsSnap.data() || {};

      if (
        settings.storeOpen === false
      ) {
        return res.status(403).json({
          success: false,
          message:
            "المتجر مغلق حاليًا."
        });
      }

      const isPc =
        platform
          .toUpperCase() ===
        "PC";

      const minLimit =
        isPc
          ? toNumber(
              settings.pcMin,
              0
            )
          : toNumber(
              settings.psMin,
              0
            );

      const maxLimit =
        isPc
          ? toNumber(
              settings.pcMax,
              0
            )
          : toNumber(
              settings.psMax,
              0
            );

      if (
        minLimit > 0 &&
        quantity < minLimit
      ) {
        return res.status(400).json({
          success: false,
          message:
            "الكمية أقل من الحد الأدنى المسموح."
        });
      }

      if (
        maxLimit > 0 &&
        quantity > maxLimit
      ) {
        return res.status(400).json({
          success: false,
          message:
            "الكمية أكبر من الحد الأقصى المسموح."
        });
      }

      /* =====================================================
         Account
      ===================================================== */

      const account =
        normalizeAccountData(
          body
        );

      if (!account.eaEmail) {
        return res.status(400).json({
          success: false,
          message:
            "بريد EA مطلوب."
        });
      }

      if (!account.eaPassword) {
        return res.status(400).json({
          success: false,
          message:
            "كلمة مرور EA مطلوبة."
        });
      }

      if (
        account.backupCodes.length !==
        3
      ) {
        return res.status(400).json({
          success: false,
          message:
            "يجب إدخال 3 رموز احتياطية."
        });
      }

      /* =====================================================
         Payout
      ===================================================== */

      const payout =
        normalizePayout(
          body
        );

      if (
        !PAYOUT_METHODS.has(
          payout.method
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "طريقة الدفع غير صحيحة."
        });
      }

             if (!isConfiguredPaymentMethod(settings, payout)) {
         return res.status(400).json({
           success: false,
           message:
             "طريقة الدفع غير متاحة حاليًا."
         });
       }

switch (
        payout.method
      ) {
        case "bank":
          if (
            !payout.bankName ||
            !payout.fullName ||
            !payout.iban ||
            !payout.recipientName
          ) {
            return res.status(400).json({
              success: false,
              message:
                "بيانات الحساب البنكي غير مكتملة."
            });
          }

          if (
            Array.isArray(settings.banks) &&
            settings.banks.length &&
            !settings.banks.includes(payout.bankName)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "البنك المحدد غير متاح حاليًا."
            });
          }

          break;

        case "wallet":
          if (
            !payout.walletName ||
            !payout.phone
          ) {
            return res.status(400).json({
              success: false,
              message:
                "بيانات المحفظة غير مكتملة."
            });
          }

          if (
            Array.isArray(settings.wallets) &&
            settings.wallets.length &&
            !settings.wallets.includes(payout.walletName)
          ) {
            return res.status(400).json({
              success: false,
              message:
                "المحفظة المحددة غير متاحة حاليًا."
            });
          }

          break;

        case "usd":
          if (!payout.wallet) {
            return res.status(400).json({
              success: false,
              message:
                "تفاصيل استلام USD مطلوبة."
            });
          }
          break;

        case "paypal":
          if (!payout.email) {
            return res.status(400).json({
              success: false,
              message:
                "بريد PayPal مطلوب."
            });
          }
          break;

        case "western":
          if (
            !payout.fullNameEnglish ||
            !payout.country
          ) {
            return res.status(400).json({
              success: false,
              message:
                "بيانات Western Union غير مكتملة."
            });
          }
          break;
      }

      /* =====================================================
         SERVER-AUTHORITATIVE PRICE
      ===================================================== */

      const price =
        calculateServerPrice(
          quantity,
          platform,
          payout,
          settings
        );

      if (!price) {
        return res.status(400).json({
          success: false,
          message:
            "تعذر حساب قيمة الطلب من إعدادات الأسعار الحالية."
        });
      }

      /*
       * Client price is retained only for diagnostics/
       * compatibility. It is NOT authoritative.
       */
      const clientTotalPrice =
        getClientPrice(
          body
        );

      /* =====================================================
         Business Numbering
      ===================================================== */

      const {
        orderId,
        referenceNumber,
        internalReference,
        dailyCode,
        serial
      } =
        await generateOrderNumbers();

      /*
       * The order-number service is the single authority for the
       * customer-facing reference. Validate its result here as a
       * defensive boundary before allowing the order to be written.
       *
       * Expected format:
       * - 8 characters
       * - 5 digits + 3 letters
       * - first and last character are digits
       * - letters come from the approved alphabet
       * - no repeated letter inside the same reference
       */
      if (!isValidReferenceNumber(referenceNumber)) {
        console.error(
          "Invalid generated order reference:",
          referenceNumber
        );

        return res.status(500).json({
          success: false,
          message:
            "تعذر إنشاء رقم الطلب بشكل آمن."
        });
      }

      if (
        !cleanString(orderId) ||
        !Number.isSafeInteger(Number(serial)) ||
        Number(serial) <= 0
      ) {
        console.error(
          "Invalid order numbering payload:",
          { orderId, referenceNumber, serial }
        );

        return res.status(500).json({
          success: false,
          message:
            "تعذر إنشاء بيانات الطلب بشكل آمن."
        });
      }

      /* =====================================================
         Encryption
      ===================================================== */

      const encryptedAccountData = {
        eaEmail:
          encrypt(
            account.eaEmail
          ),

        eaPassword:
          encrypt(
            account.eaPassword
          ),

        backupCodes:
          encryptBackupCodes(
            account.backupCodes
          )
      };

      const encryptedPayout =
        encryptPayoutDetails(
          payout
        );

      const legacyPaymentInfo =
        buildLegacyPaymentInfo(
          payout
        );

      /* =====================================================
         Canonical Order
      ===================================================== */

      const orderData = {
        /*
         * Business identifiers.
         */
        orderId,

        referenceNumber,

        internalReference,

        dailyCode,

        serial,

        /*
         * Customer.
         */
        customerName,

        phone,

        platform,

        quantity,

        /*
         * Server-authoritative pricing.
         */
        rate:
          price.rate,

        totalPriceSar:
          price.totalSar,

        totalPriceUsd:
          price.totalUsd,

        priceCurrency:
          price.currency,

        displayTotalPrice:
          price.displayTotal,

        /*
         * Legacy field preserved.
         *
         * It is set to the server-calculated display amount,
         * never the client-provided amount.
         */
        totalPrice:
          price.displayTotal,

        /*
         * Optional diagnostic compatibility field.
         * This is not used for financial authority.
         */
        clientSubmittedTotalPrice:
          clientTotalPrice,

        /*
         * Payment.
         */
        payoutDetails:
          encryptedPayout,

        paymentMethod:
          body.paymentMethod ||
          payout.method,

        paymentMethodType:
          payout.method,

        paymentInfoData:
          legacyPaymentInfo,

        /*
         * Safe public tracking preview.
         * Contains only masked/non-sensitive payment metadata.
         * It is generated before encryption and never contains
         * full IBANs, wallet addresses, payment emails, or phone numbers.
         */
        paymentPreview:
          buildPaymentPreview({
            payoutDetails:
              payout,
            paymentMethod:
              payout.method,
            paymentMethodType:
              payout.method
          }),

        /*
         * EA account.
         */
        accountData:
          encryptedAccountData,

        /*
         * Order lifecycle.
         */
        withdrawnQuantity:
          0,

        drawnCoins:
          0,

        status:
          "new",

        issue:
          null,

        issueMessage:
          "",

        /*
         * Encryption state.
         */
        encrypted:
          true,

        encryptedAt:
          TS(),

        /*
         * Sensitive-data lifecycle.
         */
        completedAt:
          null,

        purgeDueAt:
          null,

        purgedAt:
          null,

        sensitivePurged:
          false,

        sensitiveDataPurged:
          false,

        /*
         * Transfer.
         */
        transferredAt:
          null,

        transferredBy:
          null,

        transferCompleted:
          false,

        /*
         * Review.
         */
        reviewSubmitted:
          false,

        /*
         * Timestamps.
         */
        createdAt:
          TS(),

        lastUpdate:
          TS(),

        createdBy:
          "customer",

        history: [
          {
            type: "created",
            status: "new",
            actor: "customer",
            at: new Date()
          }
        ]
      };

      /*
       * Firestore document ID is intentionally
       * different from business orderId.
       */
      const documentRef =
        db
          .collection("orders")
          .doc();

      await documentRef.set(
        orderData
      );

      return res.json({
        success: true,

        orderId,

        referenceNumber,

        internalReference,

        documentId:
          documentRef.id,

        /*
         * Return the server-authoritative
         * calculated amount so the frontend can
         * display exactly what was stored.
         */
        pricing: {
          rate:
            price.rate,

          totalSar:
            price.totalSar,

          totalUsd:
            price.totalUsd,

          currency:
            price.currency,

          displayTotal:
            price.displayTotal
        }
      });
    } catch (error) {
      console.error(
        "Create order error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر إنشاء الطلب."
      });
    }
  }
);

/* ==========================================================================
   Update Status
========================================================================== */

router.post(
  "/update-status",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        orderId,
        status,
        transferredAt,
        transferredBy,
        transferData,
        issue,
        issueMessage,
        issueState
      } =
        req.body || {};

      const found =
        await findOrder(
          orderId
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message:
            "الطلب غير موجود."
        });
      }

      const current =
        found.snap.data() || {};

      const nextStatus =
        normalizeStatus(
          status
        );

      const updateData = {
        status:
          nextStatus,

        lastUpdate:
          TS()
      };

      /*
       * Issue is independent from status.
       */
      if (
        issue !== undefined
      ) {
        const normalizedIssue =
          normalizeIssue(
            issue
          );

        updateData.issue =
          normalizedIssue;

        updateData.issueState =
          normalizedIssue
            ? (
                ISSUE_STATES.has(String(issueState || "").trim().toLowerCase())
                  ? String(issueState).trim().toLowerCase()
                  : String(current.issueState || "needs_customer_action")
              )
            : "resolved";

        updateData.issueMessage =
          normalizedIssue
            ? cleanString(
                issueMessage
              ) ||
              await getIssueMessage(
                normalizedIssue
              )
            : "";
      }

      if (
        updateData.issue &&
        !updateData.issueMessage
      ) {
        updateData.issueMessage =
          await getIssueMessage(
            updateData.issue
          );
      }

      /*
       * completedAt is created only when the order
       * first enters completed.
       *
       * No automatic purge.
       */
      if (
        nextStatus ===
          "completed" &&
        !current.completedAt
      ) {
        const completedAt =
          new Date();

        const purgeDueAt =
          new Date(
            completedAt.getTime() +
            PURGE_DELAY_MS
          );

        updateData.completedAt =
          completedAt;

        updateData.purgeDueAt =
          purgeDueAt;
      }

      /*
       * Manual transfer status.
       */
      if (
        nextStatus ===
        "transferred"
      ) {
        updateData.transferredAt =
          transferredAt ||
          transferData?.transferredAt ||
          new Date().toISOString();

        updateData.transferredBy =
          transferredBy ||
          transferData?.transferredBy ||
          req.admin?.email ||
          req.admin?.name ||
          "Admin";

        updateData.transferCompleted =
          true;
      }

      /*
       * Clearing issue.
       */
      if (
        issue !== undefined &&
        normalizeIssue(issue) ===
          null
      ) {
        updateData.issue =
          null;

        updateData.issueMessage =
          "";
      }

      const previousStatus =
        normalizeStatus(current.status);

      const allowedNextStatuses =
        ALLOWED_STATUS_TRANSITIONS[previousStatus] ||
        new Set([previousStatus]);

      if (!allowedNextStatuses.has(nextStatus)) {
        return res.status(400).json({
          success: false,
          message:
            "انتقال حالة الطلب غير مسموح من الحالة الحالية."
        });
      }

      updateData.history = admin.firestore.FieldValue.arrayUnion({
        type: "status_change",
        from: previousStatus,
        to: nextStatus,
        issue: updateData.issue ?? normalizeIssue(current.issue),
        actor: req.admin?.email || req.admin?.name || req.admin?.uid || "admin",
        at: new Date()
      });

      await found.ref.update(
        updateData
      );

      return res.json({
        success: true,

        status:
          nextStatus,

        issue:
          updateData.issue !==
          undefined
            ? updateData.issue
            : normalizeIssue(
                current.issue
              )
      });
    } catch (error) {
      console.error(
        "Update status error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر تحديث حالة الطلب."
      });
    }
  }
);

/* ==========================================================================
   Update Drawn Coins
========================================================================== */

router.post(
  "/update-drawn",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        orderId,
        drawnCoins,
        withdrawnQuantity
      } =
        req.body || {};

      const found =
        await findOrder(
          orderId
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message:
            "الطلب غير موجود."
        });
      }

      const order =
        found.snap.data() || {};

      const quantity =
        getOrderQuantity(
          order
        );

      const value =
        Math.max(
          0,
          Math.floor(
            toNumber(
              withdrawnQuantity ??
                drawnCoins,
              0
            )
          )
        );

      if (
        quantity > 0 &&
        value > quantity
      ) {
        return res.status(400).json({
          success: false,
          message:
            "الكمية المسحوبة لا يمكن أن تتجاوز كمية الطلب."
        });
      }

      /*
       * IMPORTANT:
       * This endpoint NEVER changes status.
       */
      await found.ref.update({
        withdrawnQuantity:
          value,

        drawnCoins:
          value,

        remainingQuantity:
          Math.max(0, quantity - value),

        lastUpdate:
          TS(),

        withdrawnUpdatedAt:
          TS(),

        history:
          admin.firestore.FieldValue.arrayUnion({
            type: "withdrawn_quantity",
            value,
            actor: "admin",
            at: new Date()
          })
      });

      return res.json({
        success: true,

        withdrawnQuantity:
          value,

        drawnCoins:
          value,

        remainingQuantity:
          Math.max(0, quantity - value)
      });
    } catch (error) {
      console.error(
        "Update drawn error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر تحديث الكمية المسحوبة."
      });
    }
  }
);

/* ==========================================================================
   Delete Order
========================================================================== */

router.post(
  "/delete",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        orderId
      } =
        req.body || {};

      const found =
        await findOrder(
          orderId
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message:
            "الطلب غير موجود."
        });
      }

      await found.ref.delete();

      return res.json({
        success: true
      });
    } catch (error) {
      console.error(
        "Delete order error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر حذف الطلب."
      });
    }
  }
);

/* ==========================================================================
   Purge Sensitive EA Data
========================================================================== */

/**
 * Manual destruction only.
 *
 * Conditions:
 * 1. authenticated admin
 * 2. status = completed
 * 3. five days elapsed since completedAt
 * 4. confirm === true
 * 5. not already purged
 *
 * Destroy:
 * - EA email
 * - EA password
 * - backup codes
 *
 * Preserve:
 * - payment data
 * - order ID
 * - reference
 * - customer data
 * - order history
 */
router.post(
  "/purge-sensitive",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        orderId,
        confirm
      } =
        req.body || {};

      if (
        confirm !== true
      ) {
        return res.status(400).json({
          success: false,
          message:
            "يجب تأكيد إتلاف البيانات."
        });
      }

      const found =
        await findOrder(
          orderId
        );

      if (!found) {
        return res.status(404).json({
          success: false,
          message:
            "الطلب غير موجود."
        });
      }

      const data =
        found.snap.data() || {};

      const status =
        getOrderStatus(
          data
        );

      if (
        status !==
        "completed"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "لا يمكن إتلاف بيانات الحساب قبل اكتمال الطلب."
        });
      }

      const alreadyPurged =
        data.sensitivePurged ===
          true ||
        data.sensitiveDataPurged ===
          true;

      if (
        alreadyPurged
      ) {
        return res.status(400).json({
          success: false,
          message:
            "تم إتلاف بيانات الحساب مسبقًا."
        });
      }

      /*
       * Resolve purgeDueAt.
       *
       * Older completed orders may not have purgeDueAt.
       */
      let purgeDueAt =
        null;

      if (
        data.purgeDueAt?.toDate
      ) {
        purgeDueAt =
          data.purgeDueAt.toDate();
      } else if (
        data.purgeDueAt
      ) {
        purgeDueAt =
          new Date(
            data.purgeDueAt
          );
      } else if (
        data.completedAt?.toDate
      ) {
        purgeDueAt =
          new Date(
            data.completedAt
              .toDate()
              .getTime() +
            PURGE_DELAY_MS
          );
      } else if (
        data.completedAt
      ) {
        const completedAt =
          new Date(
            data.completedAt
          );

        if (
          !Number.isNaN(
            completedAt.getTime()
          )
        ) {
          purgeDueAt =
            new Date(
              completedAt.getTime() +
              PURGE_DELAY_MS
            );
        }
      }

      if (
        !purgeDueAt ||
        Number.isNaN(
          purgeDueAt.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "موعد الإتلاف غير محدد لهذا الطلب."
        });
      }

      if (
        Date.now() <
        purgeDueAt.getTime()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "لم يحِن موعد إتلاف بيانات الحساب بعد."
        });
      }

      /*
       * Permanently remove EA-sensitive fields.
       *
       * Payment data remains untouched.
       */
      const account =
        normalizeStoredAccountData(
          data.accountData
        );

      delete account.eaEmail;
      delete account.eaPassword;
      delete account.backupCodes;

      await found.ref.update({
        accountData:
          account,

        sensitivePurged:
          true,

        sensitiveDataPurged:
          true,

        purgedAt:
          TS(),

        purgedBy:
          req.admin?.email ||
          req.admin?.uid ||
          "Admin",

        lastUpdate:
          TS()
      });

      return res.json({
        success: true,

        message:
          "تم إتلاف بيانات الحساب الحساسة بنجاح."
      });
    } catch (error) {
      console.error(
        "Purge sensitive error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر إتلاف بيانات الحساب."
      });
    }
  }
);

export default router;
