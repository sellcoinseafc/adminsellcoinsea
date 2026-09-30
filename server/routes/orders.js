import express from "express";
import admin, { db } from "../services/firebase.js";
import { encrypt, decrypt } from "../utils/crypto.js";
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

/* =========================================================
   General Helpers
========================================================= */

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
      .map((item) => cleanString(item))
      .filter(Boolean);
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
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

/* =========================================================
   Payout
========================================================= */

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
  const payout =
    getIncomingPayout(body);

  const method =
    getPayoutMethod(
      body,
      payout
    );

  if (!PAYOUT_METHODS.has(method)) {
    return {
      payoutType:
        cleanString(
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
        payoutType: "",
        method: ""
      };
  }
}

function encryptPayoutDetails(payout) {
  switch (payout.method) {
    case "bank":
      return {
        ...payout,

        fullName:
          payout.fullName
            ? encrypt(payout.fullName)
            : "",

        iban:
          payout.iban
            ? encrypt(payout.iban)
            : ""
      };

    case "wallet":
      return {
        ...payout,

        phone:
          payout.phone
            ? encrypt(payout.phone)
            : ""
      };

    case "usdt":
      return {
        ...payout,

        wallet:
          payout.wallet
            ? encrypt(payout.wallet)
            : ""
      };

    case "paypal":
      return {
        ...payout,

        email:
          payout.email
            ? encrypt(payout.email)
            : ""
      };

    case "western":
      return {
        ...payout,

        fullNameEnglish:
          payout.fullNameEnglish
            ? encrypt(
                payout.fullNameEnglish
              )
            : "",

        country:
          payout.country
            ? encrypt(payout.country)
            : ""
      };

    default:
      return payout;
  }
}

/* =========================================================
   Legacy Encryption
========================================================= */

function encryptLegacySensitiveFields(order) {
  const payment = {
    ...(order.paymentInfoData || {})
  };

  const account = {
    ...(order.accountData || {})
  };

  if (account.eaEmail) {
    account.eaEmail =
      encrypt(account.eaEmail);
  }

  if (account.eaPassword) {
    account.eaPassword =
      encrypt(account.eaPassword);
  }

  if (account.backupCodes) {
    account.backupCodes =
      Array.isArray(
        account.backupCodes
      )
        ? encrypt(
            JSON.stringify(
              account.backupCodes
            )
          )
        : encrypt(
            String(
              account.backupCodes
            )
          );
  }

  switch (
    order.paymentMethodType
  ) {
    case "bank":
      if (payment.accountName) {
        payment.accountName =
          encrypt(
            payment.accountName
          );
      }

      if (payment.iban) {
        payment.iban =
          encrypt(
            payment.iban
          );
      }

      break;

    case "wallet":
      if (payment.walletNumber) {
        payment.walletNumber =
          encrypt(
            payment.walletNumber
          );
      }

      /*
       * walletType may be a public wallet name,
       * so do not blindly encrypt it.
       */
      break;

    case "usdt":
      if (payment.walletAddress) {
        payment.walletAddress =
          encrypt(
            payment.walletAddress
          );
      }

      break;

    case "paypal":
      if (payment.paypalEmail) {
        payment.paypalEmail =
          encrypt(
            payment.paypalEmail
          );
      }

      break;

    case "western":
      if (payment.fullName) {
        payment.fullName =
          encrypt(
            payment.fullName
          );
      }

      if (payment.country) {
        payment.country =
          encrypt(
            payment.country
          );
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
   Compatibility
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

function getBusinessOrderId(
  data,
  docId
) {
  return data.orderId || docId;
}

/* =========================================================
   Find Order
========================================================= */

async function findOrder(orderId) {
  const value =
    cleanString(orderId);

  if (!value) {
    return null;
  }

  /*
   * First: Firestore document ID.
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
   * Second: business orderId.
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
   * Third: customer reference.
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

/* =========================================================
   Settings
========================================================= */

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

/* =========================================================
   API Test
========================================================= */

router.get("/", (_, res) => {
  return res.json({
    success: true,
    message: "Orders API Ready"
  });
});

/* =========================================================
   Admin Orders List
========================================================= */

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
              id: doc.id,

              orderId:
                businessOrderId,

              /*
               * Compatibility with current admin.js.
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
                data.issue ||
                null,

              issueMessage:
                data.issueMessage ||
                "",

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

              payoutDetails:
                data.payoutDetails ||
                null,

              paymentInfoData:
                data.paymentInfoData ||
                {},

              transferData: {
                transferredAt:
                  data.transferredAt ||
                  null,

                transferredBy:
                  data.transferredBy ||
                  null,

                transferCompleted:
                  data.transferCompleted ||
                  false
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

              sensitiveDataPurged:
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

/* =========================================================
   Create Order
========================================================= */

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
        platform === "PC";

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

        default:
          break;
      }

      /*
       * IMPORTANT:
       * لا نعتمد على totalPrice في تحديد
       * صلاحية الطلب.
       *
       * الحساب النهائي للسعر سنوحده لاحقًا
       * مع صيغة النظام الحالية في settings.
       *
       * نحتفظ بقيمة الواجهة مؤقتًا للتوافق.
       */
      const clientTotalPrice =
        cleanString(
          body.totalPrice
        );

      /*
       * Server-side order numbers.
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
       * Legacy payment fields.
       *
       * These remain encrypted.
       */
      const legacyPaymentInfo = {};

      switch (
        payout.method
      ) {
        case "bank":
          legacyPaymentInfo.bankName =
            payout.bankName;

          legacyPaymentInfo.accountName =
            payout.fullName
              ? encrypt(
                  payout.fullName
                )
              : "";

          legacyPaymentInfo.iban =
            payout.iban
              ? encrypt(
                  payout.iban
                )
              : "";

          break;

        case "wallet":
          /*
           * walletName is not inherently secret.
           */
          legacyPaymentInfo.walletType =
            payout.walletName;

          legacyPaymentInfo.walletNumber =
            payout.phone
              ? encrypt(
                  payout.phone
                )
              : "";

          break;

        case "usdt":
          legacyPaymentInfo.walletAddress =
            payout.wallet
              ? encrypt(
                  payout.wallet
                )
              : "";

          break;

        case "paypal":
          legacyPaymentInfo.paypalEmail =
            payout.email
              ? encrypt(
                  payout.email
                )
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
              ? encrypt(
                  payout.country
                )
              : "";

          break;

        default:
          break;
      }

      /*
       * Canonical order.
       */
      const orderData = {
        /*
         * Business IDs.
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
         * Compatibility total.
         */
        totalPrice:
          clientTotalPrice,

        /*
         * Canonical encrypted payout.
         */
        payoutDetails:
          encryptedPayout,

        /*
         * Legacy fields.
         */
        paymentMethod:
          body.paymentMethod ||
          payout.method,

        paymentMethodType:
          payout.method,

        paymentInfoData:
          legacyPaymentInfo,

        /*
         * Encrypted EA data.
         */
        accountData:
          encryptedAccountData,

        /*
         * Initial state.
         */
        drawnCoins: 0,

        status: "new",

        issue: null,

        issueMessage: "",

        /*
         * Encryption.
         */
        encrypted: true,

        encryptedAt:
          TS(),

        /*
         * Completion lifecycle.
         */
        completedAt: null,

        purgeDueAt: null,

        purgedAt: null,

        sensitiveDataPurged:
          false,

        /*
         * Transfer.
         */
        transferredAt: null,

        transferredBy: null,

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
          "customer"
      };

      /*
       * IMPORTANT:
       * Firestore document ID is NOT the business Order ID.
       */
      const documentRef =
        db.collection("orders").doc();

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

/* =========================================================
   Update Status
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
              )
            : "";
      }

      /*
       * completed starts the 5-day countdown.
       *
       * No automatic purge.
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
       * If an order is moved away from completed
       * before the lifecycle is finalized, we do not
       * delete the timestamps. This preserves the audit
       * history.
       */

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
       * Explicitly clear issue.
       */
      if (
        issue !== undefined &&
        normalizeIssue(issue) === null
      ) {
        updateData.issue = null;

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
          updateData.issue !== undefined
            ? updateData.issue
            : current.issue || null
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

/* =========================================================
   Update Drawn Coins
========================================================= */

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
       * Updating drawnCoins NEVER changes status
       * automatically.
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

/* =========================================================
   Delete Order
========================================================= */

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

/* =========================================================
   Purge Sensitive EA Data
========================================================= */

/*
 * الإتلاف يدوي فقط.
 *
 * الشروط:
 * 1. الأدمن authenticated.
 * 2. الطلب completed.
 * 3. مرّت 5 أيام على completedAt.
 * 4. تأكيد ثانٍ confirm === true.
 * 5. لم يتم الإتلاف مسبقاً.
 *
 * يتم حذف:
 * - EA Email
 * - EA Password
 * - Backup Codes
 *
 * ولا يتم حذف:
 * - بيانات الدفع
 * - رقم الطلب
 * - المرجع
 * - بيانات العميل
 * - سجل الطلب
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
        status !== "completed"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "لا يمكن إتلاف بيانات الحساب قبل اكتمال الطلب."
        });
      }

      if (
        data.sensitiveDataPurged ===
        true
      ) {
        return res.status(400).json({
          success: false,
          message:
            "تم إتلاف بيانات الحساب مسبقًا."
        });
      }

      /*
       * Prefer completedAt to calculate the due date
       * for compatibility with older completed orders
       * that may not have purgeDueAt.
       */
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
       * Only EA sensitive data is destroyed.
       *
       * Payment remains encrypted and untouched.
       */
      const account =
        data.accountData || {};

      await found.ref.update({
        accountData: {
          ...account,

          eaEmail:
            null,

          eaPassword:
            null,

          backupCodes:
            null
        },

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
