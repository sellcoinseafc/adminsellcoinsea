import express from "express";
import admin, { db } from "../services/firebase.js";
import { encrypt } from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";
import { generateOrderNumbers } from "../services/orderNumber.js";

const router = express.Router();

const TS = admin.firestore.FieldValue.serverTimestamp;

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

const PURGE_DELAY_MS = 5 * 24 * 60 * 60 * 1000;

/* =========================================================
   Helpers
========================================================= */

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeQuantity(value) {
  const quantity = Math.floor(toNumber(value, 0));

  return quantity > 0 ? quantity : 0;
}

function normalizeStatus(value) {
  const status = cleanString(value).toLowerCase();

  /*
   * Legacy compatibility:
   * pending was used by older orders as "new".
   */
  if (status === "pending") {
    return "new";
  }

  return STATUS_VALUES.has(status)
    ? status
    : "new";
}

function normalizeIssue(value) {
  const issue = cleanString(value).toLowerCase();

  if (!issue || issue === "none" || issue === "no_issue") {
    return null;
  }

  return ISSUE_VALUES.has(issue)
    ? issue
    : null;
}

function normalizePlatform(value) {
  const platform = cleanString(value);

  if (
    platform === "PlayStation" ||
    platform === "Xbox" ||
    platform === "PC"
  ) {
    return platform;
  }

  return platform;
}

function normalizeBackupCodes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanString(item))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function encryptBackupCodes(codes) {
  const normalized = normalizeBackupCodes(codes);

  if (!normalized.length) {
    return "";
  }

  return encrypt(JSON.stringify(normalized));
}

function normalizeAccountData(body) {
  const account =
    body?.accountData &&
    typeof body.accountData === "object"
      ? body.accountData
      : {};

  return {
    eaEmail: cleanString(
      account.eaEmail ?? body.eaEmail
    ),
    eaPassword: cleanString(
      account.eaPassword ?? body.eaPassword
    ),
    backupCodes: normalizeBackupCodes(
      account.backupCodes ?? body.backupCodes
    )
  };
}

/* =========================================================
   Payout normalization
========================================================= */

/**
 * Canonical payout schema:
 *
 * local bank:
 * {
 *   payoutType: "local",
 *   method: "bank",
 *   bankName,
 *   fullName,
 *   iban
 * }
 *
 * local wallet:
 * {
 *   payoutType: "local",
 *   method: "wallet",
 *   walletName,
 *   phone
 * }
 *
 * international USDT:
 * {
 *   payoutType: "international",
 *   method: "usdt",
 *   wallet
 * }
 *
 * international PayPal:
 * {
 *   payoutType: "international",
 *   method: "paypal",
 *   email
 * }
 *
 * international Western Union:
 * {
 *   payoutType: "international",
 *   method: "western",
 *   fullNameEnglish,
 *   country
 * }
 */

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

function getPayoutMethod(body, payout) {
  return cleanString(
    payout.method ??
    body.paymentMethodType ??
    ""
  ).toLowerCase();
}

function normalizePayout(body) {
  const payout = getIncomingPayout(body);

  const method = getPayoutMethod(body, payout);

  if (!PAYOUT_METHODS.has(method)) {
    return {
      payoutType: cleanString(
        payout.payoutType ||
        body.payoutType ||
        ""
      ),
      method: method || ""
    };
  }

  switch (method) {
    case "bank":
      return {
        payoutType: "local",
        method: "bank",
        bankName: cleanString(
          payout.bankName ??
          body.bankName
        ),
        fullName: cleanString(
          payout.fullName ??
          payout.accountName ??
          body.accountName ??
          body.fullName
        ),
        iban: cleanString(
          payout.iban ??
          body.iban
        )
      };

    case "wallet":
      return {
        payoutType: "local",
        method: "wallet",
        walletName: cleanString(
          payout.walletName ??
          payout.walletType ??
          body.walletName ??
          body.walletType
        ),
        phone: cleanString(
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
        wallet: cleanString(
          payout.wallet ??
          payout.walletAddress ??
          body.wallet ??
          body.walletAddress ??
          body.usdtWallet
        )
      };

    case "paypal":
      return {
        payoutType: "international",
        method: "paypal",
        email: cleanString(
          payout.email ??
          payout.paypalEmail ??
          body.paypalEmail
        )
      };

    case "western":
      return {
        payoutType: "international",
        method: "western",
        fullNameEnglish: cleanString(
          payout.fullNameEnglish ??
          payout.fullName ??
          body.fullNameEnglish ??
          body.fullName
        ),
        country: cleanString(
          payout.country ??
          body.country
        )
      };

    default:
      return {
        payoutType: "",
        method: ""
      };
  }
}

function encryptPayoutDetails(payout) {
  const method = payout.method;

  switch (method) {
    case "bank":
      return {
        ...payout,
        fullName: payout.fullName
          ? encrypt(payout.fullName)
          : "",
        iban: payout.iban
          ? encrypt(payout.iban)
          : ""
      };

    case "wallet":
      return {
        ...payout,
        phone: payout.phone
          ? encrypt(payout.phone)
          : ""
      };

    case "usdt":
      return {
        ...payout,
        wallet: payout.wallet
          ? encrypt(payout.wallet)
          : ""
      };

    case "paypal":
      return {
        ...payout,
        email: payout.email
          ? encrypt(payout.email)
          : ""
      };

    case "western":
      return {
        ...payout,
        fullNameEnglish: payout.fullNameEnglish
          ? encrypt(payout.fullNameEnglish)
          : "",
        country: payout.country
          ? encrypt(payout.country)
          : ""
      };

    default:
      return payout;
  }
}

/* =========================================================
   Legacy sensitive-data compatibility
========================================================= */

function encryptLegacySensitiveFields(order) {
  const payment = {
    ...(order.paymentInfoData || {})
  };

  const account = {
    ...(order.accountData || {})
  };

  if (account.eaEmail) {
    account.eaEmail = encrypt(account.eaEmail);
  }

  if (account.eaPassword) {
    account.eaPassword = encrypt(account.eaPassword);
  }

  if (account.backupCodes) {
    account.backupCodes = Array.isArray(account.backupCodes)
      ? encrypt(JSON.stringify(account.backupCodes))
      : encrypt(String(account.backupCodes));
  }

  switch (order.paymentMethodType) {
    case "bank":
      if (payment.accountName) {
        payment.accountName = encrypt(payment.accountName);
      }

      if (payment.iban) {
        payment.iban = encrypt(payment.iban);
      }

      break;

    case "wallet":
      if (payment.walletNumber) {
        payment.walletNumber = encrypt(payment.walletNumber);
      }

      if (payment.walletType) {
        payment.walletType = encrypt(payment.walletType);
      }

      break;

    case "usdt":
      if (payment.walletType) {
        payment.walletType = encrypt(payment.walletType);
      }

      if (payment.walletAddress) {
        payment.walletAddress = encrypt(
          payment.walletAddress
        );
      }

      break;

    case "paypal":
      if (payment.paypalEmail) {
        payment.paypalEmail = encrypt(
          payment.paypalEmail
        );
      }

      break;

    case "western":
      if (payment.fullName) {
        payment.fullName = encrypt(payment.fullName);
      }

      if (payment.country) {
        payment.country = encrypt(payment.country);
      }

      break;

    default:
      break;
  }

  return {
    paymentInfoData: payment,
    accountData: account
  };
}

/* =========================================================
   Compatibility helpers
========================================================= */

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

function getPayoutForRead(data) {
  if (
    data.payoutDetails &&
    typeof data.payoutDetails === "object"
  ) {
    return data.payoutDetails;
  }

  return data.paymentInfoData || {};
}

function getBusinessOrderId(data, docId) {
  return data.orderId || docId;
}

function resolveOrderRef(orderId) {
  return db.collection("orders").doc(orderId);
}

/**
 * Finds an order by either:
 * - Firestore document ID
 * - business orderId
 * - referenceNumber
 */
async function findOrder(orderId) {
  const value = cleanString(orderId);

  if (!value) {
    return null;
  }

  const directRef = db
    .collection("orders")
    .doc(value);

  const directSnap = await directRef.get();

  if (directSnap.exists) {
    return {
      ref: directRef,
      snap: directSnap
    };
  }

  const byOrderId = await db
    .collection("orders")
    .where("orderId", "==", value)
    .limit(1)
    .get();

  if (!byOrderId.empty) {
    const snap = byOrderId.docs[0];

    return {
      ref: snap.ref,
      snap
    };
  }

  const byReference = await db
    .collection("orders")
    .where("referenceNumber", "==", value)
    .limit(1)
    .get();

  if (!byReference.empty) {
    const snap = byReference.docs[0];

    return {
      ref: snap.ref,
      snap
    };
  }

  return null;
}

/* =========================================================
   Settings
========================================================= */

router.get("/settings", async (_, res) => {
  try {
    const snap = await db
      .collection("system")
      .doc("settings")
      .get();

    const s = snap.data() || {};

    return res.json({
      success: true,

      rates: {
        PlayStation: s.psRate,
        Xbox: s.psRate,
        PC: s.pcRate
      },

      limits: {
        psMin: s.psMin,
        psMax: s.psMax,
        pcMin: s.pcMin,
        pcMax: s.pcMax
      },

      withdrawDays: s.psWithdrawDuration,
      transferHours: s.psTransferDuration,

      safeMethod:
        s.safeMethod ||
        "سوق الانتقالات (Web App)",

      banks: Array.isArray(s.banks)
        ? s.banks
        : [],

      wallets: Array.isArray(s.wallets)
        ? s.wallets
        : [],

      paymentMethods: Array.isArray(
        s.paymentMethods
      )
        ? s.paymentMethods
        : [],

      termsEnabled:
        s.termsEnabled ?? true,

      terms: Array.isArray(s.terms)
        ? s.terms
        : [],

      storeOpen:
        s.storeOpen ?? true,

      supportWhatsapp:
        s.supportWhatsapp ||
        s.supportWhatsappNumber ||
        ""
    });
  } catch (err) {
    console.error(
      "Orders settings error:",
      err?.message
    );

    return res.status(500).json({
      success: false,
      message: "تعذر تحميل إعدادات الطلبات."
    });
  }
});

/* =========================================================
   Health / API test
========================================================= */

router.get("/", (_, res) => {
  res.json({
    success: true,
    message: "Orders API Ready"
  });
});

/* =========================================================
   Admin order list
========================================================= */

router.get(
  "/list",
  requireAdmin,
  async (_, res) => {
    try {
      const snapshot = await db
        .collection("orders")
        .orderBy("createdAt", "desc")
        .get();

      const orders = snapshot.docs.map((doc) => {
        const d = doc.data();

        const status = getOrderStatus(d);
        const quantity = getOrderQuantity(d);

        const businessOrderId =
          getBusinessOrderId(d, doc.id);

        return {
          id: doc.id,

          /*
           * Business ID.
           */
          orderId: businessOrderId,

          /*
           * Legacy frontend compatibility.
           */
          reference: businessOrderId,

          referenceNumber:
            d.referenceNumber || "",

          customerName:
            d.customerName || "",

          name:
            d.customerName || "",

          phone:
            d.phone || "",

          platform:
            d.platform || "",

          quantity,

          totalQty: quantity,

          totalPrice:
            getOrderTotal(d),

          status,

          issue:
            d.issue || null,

          issueMessage:
            d.issueMessage || "",

          drawnCoins:
            Number(
              d.drawnCoins ??
              d.withdrawnQuantity ??
              0
            ),

          paymentMethod:
            d.paymentMethod ||
            d.payoutDetails?.method ||
            d.paymentMethodType ||
            "",

          paymentMethodType:
            d.paymentMethodType ||
            d.payoutDetails?.method ||
            "",

          /*
           * Canonical payout data.
           *
           * This may contain encrypted values.
           * It is intentionally returned only to the
           * authenticated admin API.
           */
          payoutDetails:
            d.payoutDetails || null,

          /*
           * Legacy compatibility for current admin UI.
           */
          paymentInfoData:
            d.paymentInfoData || {},

          transferData: {
            transferredAt:
              d.transferredAt || null,

            transferredBy:
              d.transferredBy || null,

            transferCompleted:
              d.transferCompleted || false
          },

          completedAt:
            d.completedAt || null,

          purgeDueAt:
            d.purgeDueAt || null,

          purgedAt:
            d.purgedAt || null,

          sensitiveDataPurged:
            d.sensitiveDataPurged === true,

          reviewSubmitted:
            d.reviewSubmitted === true,

          createdAt:
            d.createdAt?.toDate
              ? d.createdAt
                  .toDate()
                  .toISOString()
              : null,

          lastUpdate:
            d.lastUpdate?.toDate
              ? d.lastUpdate
                  .toDate()
                  .toISOString()
              : null
        };
      });

      return res.json({
        success: true,
        orders
      });
    } catch (err) {
      console.error(
        "Orders list error:",
        err?.message
      );

      return res.status(500).json({
        success: false,
        message: "تعذر تحميل الطلبات."
      });
    }
  }
);

/* =========================================================
   Create order
========================================================= */

router.post("/create", async (req, res) => {
  try {
    const body = req.body || {};

    const customerName =
      cleanString(body.customerName);

    const phone =
      cleanString(body.phone);

    const platform =
      normalizePlatform(body.platform);

    const quantity =
      normalizeQuantity(body.quantity);

    if (!customerName) {
      return res.status(400).json({
        success: false,
        message: "اسم العميل مطلوب."
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "رقم الجوال مطلوب."
      });
    }

    if (!platform) {
      return res.status(400).json({
        success: false,
        message: "المنصة مطلوبة."
      });
    }

    if (!quantity) {
      return res.status(400).json({
        success: false,
        message: "كمية الكوينز غير صحيحة."
      });
    }

    /*
     * Read current settings so server-side limits can
     * be enforced.
     */
    const settingsSnap = await db
      .collection("system")
      .doc("settings")
      .get();

    const settings =
      settingsSnap.data() || {};

    const isPc = platform === "PC";

    const minLimit = isPc
      ? toNumber(settings.pcMin, 0)
      : toNumber(settings.psMin, 0);

    const maxLimit = isPc
      ? toNumber(settings.pcMax, 0)
      : toNumber(settings.psMax, 0);

    if (
      minLimit > 0 &&
      quantity < minLimit
    ) {
      return res.status(400).json({
        success: false,
        message: "الكمية أقل من الحد الأدنى المسموح."
      });
    }

    if (
      maxLimit > 0 &&
      quantity > maxLimit
    ) {
      return res.status(400).json({
        success: false,
        message: "الكمية أكبر من الحد الأقصى المسموح."
      });
    }

    /*
     * Store status is respected server-side.
     */
    if (settings.storeOpen === false) {
      return res.status(403).json({
        success: false,
        message: "المتجر مغلق حاليًا."
      });
    }

    const account =
      normalizeAccountData(body);

    if (!account.eaEmail) {
      return res.status(400).json({
        success: false,
        message: "بريد EA مطلوب."
      });
    }

    if (!account.eaPassword) {
      return res.status(400).json({
        success: false,
        message: "كلمة مرور EA مطلوبة."
      });
    }

    if (account.backupCodes.length !== 3) {
      return res.status(400).json({
        success: false,
        message: "يجب إدخال 3 رموز احتياطية."
      });
    }

    const payout =
      normalizePayout(body);

    if (!PAYOUT_METHODS.has(payout.method)) {
      return res.status(400).json({
        success: false,
        message: "طريقة الدفع غير صحيحة."
      });
    }

    /*
     * Validate required payout fields before encryption.
     */
    switch (payout.method) {
      case "bank":
        if (
          !payout.bankName ||
          !payout.fullName ||
          !payout.iban
        ) {
          return res.status(400).json({
            success: false,
            message: "بيانات الحساب البنكي غير مكتملة."
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
            message: "بيانات المحفظة غير مكتملة."
          });
        }
        break;

      case "usdt":
        if (!payout.wallet) {
          return res.status(400).json({
            success: false,
            message: "عنوان محفظة USDT مطلوب."
          });
        }
        break;

      case "paypal":
        if (!payout.email) {
          return res.status(400).json({
            success: false,
            message: "بريد PayPal مطلوب."
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

      default:
        break;
    }

    /*
     * IMPORTANT:
     * Pricing remains compatible with the current frontend
     * until orders/order.js is reviewed.
     *
     * The client value is normalized and stored as-is for now.
     * We will replace this with the exact server-side pricing
     * formula after confirming the existing rate unit.
     */
    const clientTotalPrice =
      cleanString(body.totalPrice);

    /*
     * Generate business identifiers atomically.
     */
    const {
      orderId,
      referenceNumber
    } = await generateOrderNumbers();

    /*
     * Encrypt immediately.
     *
     * EA data is NEVER intentionally written to Firestore
     * in plaintext.
     */
    const encryptedAccountData = {
      eaEmail: encrypt(account.eaEmail),
      eaPassword: encrypt(account.eaPassword),
      backupCodes:
        encryptBackupCodes(account.backupCodes)
    };

    /*
     * Payment data is encrypted immediately as well.
     */
    const encryptedPayout =
      encryptPayoutDetails(payout);

    /*
     * Keep legacy fields for compatibility with existing
     * admin/frontend code while the migration is underway.
     *
     * These fields contain encrypted values.
     */
    const legacyPaymentInfo = {};

    switch (payout.method) {
      case "bank":
        legacyPaymentInfo.bankName =
          payout.bankName;

        legacyPaymentInfo.accountName =
          payout.fullName
            ? encrypt(payout.fullName)
            : "";

        legacyPaymentInfo.iban =
          payout.iban
            ? encrypt(payout.iban)
            : "";

        break;

      case "wallet":
        legacyPaymentInfo.walletType =
          payout.walletName
            ? encrypt(payout.walletName)
            : "";

        legacyPaymentInfo.walletNumber =
          payout.phone
            ? encrypt(payout.phone)
            : "";

        break;

      case "usdt":
        legacyPaymentInfo.walletAddress =
          payout.wallet
            ? encrypt(payout.wallet)
            : "";

        break;

      case "paypal":
        legacyPaymentInfo.paypalEmail =
          payout.email
            ? encrypt(payout.email)
            : "";

        break;

      case "western":
        legacyPaymentInfo.fullName =
          payout.fullNameEnglish
            ? encrypt(
                payout.fullNameEnglish
              )
            : "";

        legacyPaymentInfo.country =
          payout.country
            ? encrypt(payout.country)
            : "";

        break;

      default:
        break;
    }

    const now = new Date();

    const orderData = {
      /*
       * Canonical business identifiers.
       */
      orderId,
      referenceNumber,

      /*
       * Customer.
       */
      customerName,
      phone,
      platform,
      quantity,

      /*
       * Current total is retained for compatibility.
       * Server-side exact calculation will be finalized
       * after confirming the existing rate unit.
       */
      totalPrice: clientTotalPrice,

      /*
       * Canonical payout.
       */
      payoutDetails: encryptedPayout,

      /*
       * Legacy payment fields.
       */
      paymentMethod:
        body.paymentMethod ||
        payout.method,

      paymentMethodType:
        payout.method,

      paymentInfoData:
        legacyPaymentInfo,

      /*
       * Encrypted EA account.
       */
      accountData:
        encryptedAccountData,

      /*
       * Order state.
       */
      drawnCoins: 0,
      status: "new",
      issue: null,
      issueMessage: "",

      /*
       * Encryption metadata.
       */
      encrypted: true,
      encryptedAt:
        admin.firestore.FieldValue.serverTimestamp(),

      /*
       * Lifecycle.
       */
      completedAt: null,
      purgeDueAt: null,
      purgedAt: null,
      sensitiveDataPurged: false,

      /*
       * Transfer.
       */
      transferredAt: null,
      transferredBy: null,
      transferCompleted: false,

      /*
       * Review.
       */
      reviewSubmitted: false,

      /*
       * Timestamps.
       */
      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),

      lastUpdate:
        admin.firestore.FieldValue.serverTimestamp(),

      /*
       * Keep a server-side creation marker.
       */
      createdBy: "customer"
    };

    /*
     * Do not store plaintext sensitive fields anywhere.
     */
    const docRef =
      db.collection("orders").doc();

    await docRef.set(orderData);

    return res.json({
      success: true,

      /*
       * Business order ID.
       */
      orderId,

      /*
       * Tracking reference.
       */
      referenceNumber,

      /*
       * Firestore document ID is returned only for
       * internal compatibility.
       */
      documentId: docRef.id
    });
  } catch (err) {
    console.error(
      "Create order error:",
      err?.message
    );

    return res.status(500).json({
      success: false,
      message: "تعذر إنشاء الطلب."
    });
  }
});

/* =========================================================
   Update status
========================================================= */

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
      } = req.body || {};

      const found =
        await findOrder(orderId);

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "الطلب غير موجود."
        });
      }

      const current =
        found.snap.data() || {};

      const nextStatus =
        normalizeStatus(status);

      const updateData = {
        status: nextStatus,
        lastUpdate: TS()
      };

      /*
       * Issue is independent from status.
       */
      if (
        issue !== undefined
      ) {
        const normalizedIssue =
          normalizeIssue(issue);

        updateData.issue =
          normalizedIssue;

        updateData.issueMessage =
          normalizedIssue
            ? cleanString(issueMessage)
            : "";
      }

      /*
       * If completed, start the 5-day lifecycle.
       *
       * We do NOT purge automatically.
       */
      if (
        nextStatus === "completed" &&
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
       * Transfer information.
       */
      if (
        nextStatus === "transferred"
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
       * Manual issue clearing.
       */
      if (
        issue !== undefined &&
        normalizeIssue(issue) === null
      ) {
        updateData.issue = null;
        updateData.issueMessage = "";
      }

      await found.ref.update(
        updateData
      );

      return res.json({
        success: true
      });
    } catch (err) {
      console.error(
        "Update status error:",
        err?.message
      );

      return res.status(500).json({
        success: false,
        message: "تعذر تحديث حالة الطلب."
      });
    }
  }
);

/* =========================================================
   Update drawn coins
========================================================= */

router.post(
  "/update-drawn",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        orderId,
        drawnCoins
      } = req.body || {};

      const found =
        await findOrder(orderId);

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "الطلب غير موجود."
        });
      }

      const quantity =
        getOrderQuantity(
          found.snap.data() || {}
        );

      const value = Math.max(
        0,
        Math.floor(
          toNumber(drawnCoins, 0)
        )
      );

      if (quantity > 0 && value > quantity) {
        return res.status(400).json({
          success: false,
          message:
            "الكمية المسحوبة لا يمكن أن تتجاوز كمية الطلب."
        });
      }

      /*
       * IMPORTANT:
       * No automatic status change.
       *
       * Statuses are manually controlled by admin.
       */
      await found.ref.update({
        drawnCoins: value,
        lastUpdate: TS()
      });

      return res.json({
        success: true,
        drawnCoins: value
      });
    } catch (err) {
      console.error(
        "Update drawn error:",
        err?.message
      );

      return res.status(500).json({
        success: false,
        message:
          "تعذر تحديث الكمية المسحوبة."
      });
    }
  }
);

/* =========================================================
   Delete order
========================================================= */

router.post(
  "/delete",
  requireAdmin,
  async (req, res) => {
    try {
      const { orderId } =
        req.body || {};

      const found =
        await findOrder(orderId);

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "الطلب غير موجود."
        });
      }

      await found.ref.delete();

      return res.json({
        success: true
      });
    } catch (err) {
      console.error(
        "Delete order error:",
        err?.message
      );

      return res.status(500).json({
        success: false,
        message: "تعذر حذف الطلب."
      });
    }
  }
);

/* =========================================================
   Purge EA sensitive data
========================================================= */

/**
 * Manual destruction only.
 *
 * Requirements:
 * - Admin authenticated.
 * - Order must be completed.
 * - purgeDueAt must have passed.
 * - sensitiveDataPurged must not already be true.
 * - Only EA data is destroyed.
 * - Payment data remains encrypted and intact.
 */
router.post(
  "/purge-sensitive",
  requireAdmin,
  async (req, res) => {
    try {
      const {
        orderId,
        confirm
      } = req.body || {};

      if (confirm !== true) {
        return res.status(400).json({
          success: false,
          message:
            "يجب تأكيد إتلاف البيانات."
        });
      }

      const found =
        await findOrder(orderId);

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "الطلب غير موجود."
        });
      }

      const data =
        found.snap.data() || {};

      const status =
        getOrderStatus(data);

      if (status !== "completed") {
        return res.status(400).json({
          success: false,
          message:
            "لا يمكن إتلاف بيانات الحساب قبل اكتمال الطلب."
        });
      }

      if (
        data.sensitiveDataPurged === true
      ) {
        return res.status(400).json({
          success: false,
          message:
            "تم إتلاف بيانات الحساب مسبقًا."
        });
      }

      let purgeDueAt = null;

      if (
        data.purgeDueAt?.toDate
      ) {
        purgeDueAt =
          data.purgeDueAt.toDate();
      } else if (
        data.purgeDueAt
      ) {
        purgeDueAt =
          new Date(data.purgeDueAt);
      }

      /*
       * Legacy completed orders that do not have
       * purgeDueAt cannot be destroyed blindly.
       */
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
       * ONLY EA sensitive data is destroyed.
       *
       * Payment data remains untouched.
       */
      const existingAccount =
        data.accountData || {};

      await found.ref.update({
        accountData: {
          ...existingAccount,

          eaEmail: null,
          eaPassword: null,
          backupCodes: null
        },

        sensitiveDataPurged:
          true,

        purgedAt: TS(),

        purgedBy:
          req.admin?.email ||
          req.admin?.uid ||
          "Admin",

        lastUpdate: TS()
      });

      return res.json({
        success: true
      });
    } catch (err) {
      console.error(
        "Purge sensitive error:",
        err?.message
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
