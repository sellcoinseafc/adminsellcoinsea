import express from "express";
import { db } from "../services/firebase.js";
import { decrypt } from "../utils/crypto.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

/**
 * Safely decrypt a value.
 *
 * Sensitive values must never cause the entire request to fail.
 * If a value is already empty or cannot be decrypted, return an empty
 * string instead of exposing encryption errors.
 */
const safeDecrypt = (value) => {
  try {
    if (!value) return "";
    return decrypt(value);
  } catch {
    return "";
  }
};

/**
 * Resolve an order using:
 * 1. Firestore document ID
 * 2. Business orderId
 * 3. Customer referenceNumber
 *
 * This keeps old orders working while the new system uses business IDs.
 */
async function findOrder(identifier) {
  const value = String(identifier || "").trim();

  if (!value) return null;

  // First: Firestore document ID.
  const directSnap = await db.collection("orders").doc(value).get();

  if (directSnap.exists) {
    return {
      id: directSnap.id,
      data: directSnap.data() || {}
    };
  }

  // Second: business orderId.
  const orderIdSnap = await db
    .collection("orders")
    .where("orderId", "==", value)
    .limit(1)
    .get();

  if (!orderIdSnap.empty) {
    const doc = orderIdSnap.docs[0];

    return {
      id: doc.id,
      data: doc.data() || {}
    };
  }

  // Third: customer reference number.
  const referenceSnap = await db
    .collection("orders")
    .where("referenceNumber", "==", value)
    .limit(1)
    .get();

  if (!referenceSnap.empty) {
    const doc = referenceSnap.docs[0];

    return {
      id: doc.id,
      data: doc.data() || {}
    };
  }

  return null;
};

/**
 * Normalize the payout/payment structure.
 *
 * New orders:
 *   payoutDetails
 *
 * Legacy orders:
 *   paymentInfoData
 *
 * The canonical method is payoutDetails.method.
 */
function getPayoutDetails(order) {
  const payout =
    order.payoutDetails &&
    typeof order.payoutDetails === "object"
      ? order.payoutDetails
      : null;

  if (payout) {
    return {
      ...payout,
      method:
        payout.method ||
        order.paymentMethodType ||
        order.paymentMethod ||
        "",
      payoutType:
        payout.payoutType ||
        (["bank", "wallet"].includes(
          payout.method ||
            order.paymentMethodType ||
            order.paymentMethod
        )
          ? "local"
          : "international")
    };
  }

  return {
    ...(order.paymentInfoData || {}),
    method:
      order.paymentMethodType ||
      order.paymentMethod ||
      "",
    payoutType:
      order.paymentMethodType === "bank" ||
      order.paymentMethodType === "wallet"
        ? "local"
        : "international"
  };
}

/**
 * Convert the various historical account structures into one
 * normalized encrypted structure.
 */
function getAccountData(order) {
  return order.accountData &&
    typeof order.accountData === "object"
    ? order.accountData
    : {};
}

/**
 * Decrypt the EA account information.
 *
 * New schema:
 *   backupCodes: encrypted JSON/string
 *
 * Legacy schema may contain different representations.
 */
function buildAccountResponse(order) {
  const account = getAccountData(order);

  let backupCodes = safeDecrypt(account.backupCodes);

  // Keep the response predictable for the admin UI.
  if (backupCodes) {
    try {
      const parsed = JSON.parse(backupCodes);

      if (Array.isArray(parsed)) {
        backupCodes = parsed;
      }
    } catch {
      // Keep original decrypted string.
    }
  }

  return {
    eaEmail: safeDecrypt(account.eaEmail),
    eaPassword: safeDecrypt(account.eaPassword),
    backupCodes
  };
}

/**
 * Build decrypted payment information according to the canonical
 * payout schema, while supporting legacy paymentInfoData.
 */
function buildPaymentResponse(order) {
  const payout = getPayoutDetails(order);
  const method = String(payout.method || "").toLowerCase();

  const response = {
    payoutType: payout.payoutType || "",
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
    case "bank":
      response.bankName = payout.bankName || "";
      response.fullName = safeDecrypt(payout.fullName);
      response.iban = safeDecrypt(payout.iban);
      break;

    case "wallet":
      response.walletName =
        payout.walletName ||
        payout.name ||
        "";

      response.walletPhone = safeDecrypt(
        payout.phone || payout.walletPhone
      );
      break;

    case "usdt":
      response.walletAddress = safeDecrypt(
        payout.wallet || payout.walletAddress
      );

      response.network = payout.network || "";
      break;

    case "paypal":
      response.paypalEmail = safeDecrypt(
        payout.email || payout.paypalEmail
      );
      break;

    case "western":
      response.fullNameEnglish = safeDecrypt(
        payout.fullNameEnglish || payout.fullName
      );

      response.country = safeDecrypt(
        payout.country
      );
      break;
  }

  return response;
};

/**
 * Admin API health/test endpoint.
 *
 * This endpoint is intentionally public because it only confirms that
 * the router is mounted. It does not expose admin data.
 */
router.get("/", (_, res) => {
  res.json({
    success: true,
    message: "Admin API Ready"
  });
});

/**
 * Decrypt an order's sensitive information.
 *
 * IMPORTANT:
 * - Requires a valid Firebase admin session.
 * - Never expose this endpoint publicly.
 * - The 90-second expiration is returned to the frontend.
 * - The backend only performs decryption for this authenticated request.
 *
 * The frontend must hide/lock the decrypted information when expiresAt
 * is reached. The backend itself never stores decrypted values.
 */
router.post("/decrypt-order", requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "رقم الطلب مطلوب"
      });
    }

    const found = await findOrder(orderId);

    if (!found) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const order = found.data;

    const account = buildAccountResponse(order);
    const payment = buildPaymentResponse(order);

    /**
     * Only return the fields required by the admin interface.
     * Do not spread the complete Firestore order into the response.
     */
    const response = {
      orderId: order.orderId || found.id,
      referenceNumber: order.referenceNumber || "",

      customerName: order.customerName || "",
      phone: order.phone || "",
      platform: order.platform || "",

      paymentMethod:
        order.payoutDetails?.method ||
        order.paymentMethodType ||
        order.paymentMethod ||
        "",

      payoutType:
        order.payoutDetails?.payoutType ||
        payment.payoutType ||
        "",

      account: account,

      payment: payment,

      /**
       * Frontend display deadline.
       * This is not persisted and is not used as an authorization mechanism.
       */
      expiresAt: Date.now() + 90_000
    };

    return res.json({
      success: true,
      data: response
    });
  } catch (error) {
    /**
     * Never return internal encryption/Firebase errors to the client.
     * Never log decrypted values.
     */
    console.error(
      "Admin decrypt-order error:",
      error?.code || error?.message || "unknown_error"
    );

    return res.status(500).json({
      success: false,
      message: "تعذر فك تشفير بيانات الطلب."
    });
  }
});

export default router;
