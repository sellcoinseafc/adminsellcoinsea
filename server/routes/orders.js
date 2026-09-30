import express from "express";
import admin, { db } from "../services/firebase.js";
import {
  encrypt,
  decrypt,
  isEncryptedValue
} from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";
import { generateOrderNumbers } from "../services/orderNumber.js";

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

const ISSUE_VALUES = new Set([
  "wrong_credentials",
  "wrong_backup_codes",
  "market_closed",
  "no_player",
  "wrong_platform",
  "other_issue"
]);

const PAYOUT_METHODS = new Set([
  "bank",
  "wallet",
  "usdt",
  "paypal",
  "western"
]);

const PURGE_DELAY_MS =
  5 * 24 * 60 * 60 * 1000;

const DEFAULT_ISSUE_MESSAGES = {
  wrong_credentials:
    "بيانات الدخول غير صحيحة، يرجى مراجعة البيانات وإعادة إرسالها.",

  wrong_backup_codes:
    "رموز النسخ الاحتياطية غير صحيحة، يرجى مراجعتها.",

  market_closed:
    "سوق الانتقالات مغلق حاليًا، وسيتم استكمال الطلب عند توفره.",

  no_player:
    "لم يتم العثور على اللاعب المطلوب، يرجى مراجعة بيانات اللاعب.",

  wrong_platform:
    "المنصة المحددة لا تطابق بيانات الطلب، يرجى مراجعتها.",

  other_issue:
    "توجد مشكلة في الطلب، يرجى التواصل مع الدعم."
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
   * Legacy status compatibility.
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
  return cleanString(value);
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
 * Encrypt only if the value is not already one of our encrypted values.
 *
 * This is used for compatibility with older orders.
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
       * Structurally similar but not valid
       * ciphertext. Treat it as plaintext.
       */
    }
  }

  return encrypt(normalized);
}

/**
 * Safely decrypt for compatibility/masking.
 */
function safeDecrypt(value) {
  try {
    if (!value) return "";

    return decrypt(
      String(value)
    );
  } catch {
    return "";
  }
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
 * Normalize an old/new encrypted account object.
 *
 * This function does NOT expose plaintext.
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
      return {
        payoutType: "international",
        method: "usdt",

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
 * Encrypt only sensitive payout fields.
 *
 * Public/display metadata such as:
 * - method
 * - payoutType
 * - bankName
 * - walletName
 * - network
 *
 * can remain readable.
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
      return {
        payoutType:
          "international",

        method:
          "usdt",

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
   Legacy Compatibility
========================================================================== */

function buildLegacyPaymentInfo(
  payout
) {
  const payment = {};

  switch (payout.method) {
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
   Compatibility
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
    db.collection("orders")
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
   Safe Payment Preview
========================================================================== */

/**
 * These previews are safe for the normal admin order list.
 *
 * Full sensitive values are ONLY returned by:
 * /api/admin/decrypt-order
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

    ibanLast6: "",
    phoneMasked: "",
    walletMasked: "",
    paypalEmailMasked: "",
    westernCountry: ""
  };

  if (method === "bank") {
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

  if (method === "wallet") {
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

  if (method === "usdt") {
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

  if (method === "paypal") {
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

  if (method === "western") {
    preview.westernCountry =
      safeDecrypt(
        payout?.country ||
        legacy.country
      );
  }

  return preview;
}

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
   Settings
========================================================================== */

router.get(
  "/settings",
  async (_, res) => {
    try {
      const snap =
        await db
          .collection("system")
          .doc("settings")
          .get();

      const settings =
        snap.data() || {};

      return res.json({
        success: true,

        rates: {
          PlayStation:
            settings.psRate,

          Xbox:
            settings.psRate,

          PC:
            settings.pcRate
        },

        limits: {
          psMin:
            settings.psMin,

          psMax:
            settings.psMax,

          pcMin:
            settings.pcMin,

          pcMax:
            settings.pcMax
        },

        withdrawDays:
          settings.psWithdrawDuration,

        transferHours:
          settings.psTransferDuration,

        safeMethod:
          settings.safeMethod ||
          "سوق الانتقالات (Web App)",

        banks:
          Array.isArray(
            settings.banks
          )
            ? settings.banks
            : [],

        wallets:
          Array.isArray(
            settings.wallets
          )
            ? settings.wallets
            : [],

        paymentMethods:
          Array.isArray(
            settings.paymentMethods
          )
            ? settings.paymentMethods
            : [],

        termsEnabled:
          settings.termsEnabled ??
          true,

        terms:
          Array.isArray(
            settings.terms
          )
            ? settings.terms
            : [],

        issueMessages:
          settings.issueMessages &&
          typeof settings.issueMessages === "object"
            ? {
                ...DEFAULT_ISSUE_MESSAGES,
                ...settings.issueMessages
              }
            : {
                ...DEFAULT_ISSUE_MESSAGES
              },

        storeOpen:
          settings.storeOpen ??
          true,

        supportWhatsapp:
          settings.supportWhatsapp ||
          settings.supportWhatsappNumber ||
          ""
      });
    } catch (error) {
      console.error(
        "Orders settings error:",
        error?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر تحميل إعدادات الطلبات."
      });
    }
  }
);

/* ==========================================================================
   API Test
========================================================================== */

router.get(
  "/",
  (_, res) => {
    return res.json({
      success: true,
      message: "Orders API Ready"
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

              status,

              issue:
                normalizeIssue(
                  data.issue
                ),

              issueMessage:
                cleanString(
                  data.issueMessage
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
               *
               * DO NOT return payoutDetails or
               * paymentInfoData because they contain
               * encrypted sensitive fields.
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

              /*
               * Canonical lifecycle flag.
               */
              sensitivePurged:
                data.sensitivePurged ===
                true ||
                data.sensitiveDataPurged ===
                true,

              /*
               * Keep old property name temporarily
               * for compatibility.
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

      /*
       * Server-side limits.
       */
      const settingsSnap =
        await db
          .collection("system")
          .doc("settings")
          .get();

      const settings =
        settingsSnap.data() || {};

      const isPc =
        platform.toUpperCase() ===
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

      if (
        settings.storeOpen === false
      ) {
        return res.status(403).json({
          success: false,
          message:
            "المتجر مغلق حاليًا."
        });
      }

      /*
       * EA account.
       */
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

      /*
       * Payout.
       */
      const payout =
        normalizePayout(body);

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

      switch (
        payout.method
      ) {
        case "bank":
          if (
            !payout.bankName ||
            !payout.fullName ||
            !payout.iban
          ) {
            return res.status(400).json({
              success: false,
              message:
                "بيانات الحساب البنكي غير مكتملة."
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
          break;

        case "usdt":
          if (!payout.wallet) {
            return res.status(400).json({
              success: false,
              message:
                "عنوان محفظة USDT مطلوب."
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

      /*
       * IMPORTANT:
       * Keep the client price for compatibility.
       *
       * A later pricing hardening step should calculate
       * the authoritative amount exclusively on the server.
       */
      const clientTotalPrice =
        cleanString(
          body.totalPrice
        );

      /*
       * Server-side business numbering.
       */
      const {
        orderId,
        referenceNumber
      } =
        await generateOrderNumbers();

      /*
       * Encrypt EA immediately.
       */
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

      /*
       * Encrypt payout immediately.
       */
      const encryptedPayout =
        encryptPayoutDetails(
          payout
        );

      /*
       * Keep legacy payment structure encrypted.
       */
      const legacyPaymentInfo =
        buildLegacyPaymentInfo(
          payout
        );

      /*
       * Canonical order.
       *
       * Firestore document ID is intentionally
       * different from business orderId.
       */
      const orderData = {
        orderId,

        referenceNumber,

        customerName,

        phone,

        platform,

        quantity,

        totalPrice:
          clientTotalPrice,

        payoutDetails:
          encryptedPayout,

        paymentMethod:
          body.paymentMethod ||
          payout.method,

        paymentMethodType:
          payout.method,

        paymentInfoData:
          legacyPaymentInfo,

        accountData:
          encryptedAccountData,

        drawnCoins: 0,

        status:
          "new",

        issue:
          null,

        issueMessage:
          "",

        encrypted:
          true,

        encryptedAt:
          TS(),

        completedAt:
          null,

        purgeDueAt:
          null,

        purgedAt:
          null,

        sensitivePurged:
          false,

        /*
         * Temporary compatibility flag.
         */
        sensitiveDataPurged:
          false,

        transferredAt:
          null,

        transferredBy:
          null,

        transferCompleted:
          false,

        reviewSubmitted:
          false,

        createdAt:
          TS(),

        lastUpdate:
          TS(),

        createdBy:
          "customer"
      };

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

        documentId:
          documentRef.id
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
        issueMessage
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

      /*
       * If issue is selected without a custom message,
       * use the current system settings message.
       */
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
       * Completed starts the 5-day lifecycle.
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
       * Transfer is still a manual status change.
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
       * Clearing the issue.
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
        drawnCoins
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
        drawnCoins:
          value,

        lastUpdate:
          TS()
      });

      return res.json({
        success: true,

        drawnCoins:
          value
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

      if (confirm !== true) {
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

      if (alreadyPurged) {
        return res.status(400).json({
          success: false,
          message:
            "تم إتلاف بيانات الحساب مسبقًا."
        });
      }

      /*
       * Resolve purgeDueAt.
       *
       * Older completed orders may not have purgeDueAt,
       * so derive it from completedAt.
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
       * Preserve the account object shape but
       * permanently remove the sensitive values.
       */
      const account =
        normalizeStoredAccountData(
          data.accountData
        );

      delete account.eaEmail;
      delete account.eaPassword;
      delete account.backupCodes;

      /*
       * Payment data remains untouched.
       */
      await found.ref.update({
        accountData:
          account,

        sensitivePurged:
          true,

        /*
         * Keep compatibility flag synchronized.
         */
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
