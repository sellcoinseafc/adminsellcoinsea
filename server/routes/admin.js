import express from "express";
import { db } from "../services/firebase.js";
import { decrypt } from "../utils/crypto.js";

const router = express.Router();

const safeDecrypt = (value) => {
  try {
    if (!value) return "";
    return decrypt(value);
  } catch {
    return "";
  }
};

// اختبار
router.get("/", (_, res) => {
  res.json({
    success: true,
    message: "Admin API Ready"
  });
});

// فك تشفير البيانات الحساسة
router.post("/decrypt-order", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "رقم الطلب مطلوب"
      });
    }

    const snap = await db.collection("orders").doc(orderId).get();

    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const order = snap.data();
    const account = order.accountData || {};
    const payment = order.paymentInfoData || {};

    const response = {
      phone: order.phone || "",
      customerName: order.customerName || "",
      paymentMethodType: order.paymentMethodType || "",

      eaEmail: safeDecrypt(account.eaEmail),
      eaPassword: safeDecrypt(account.eaPassword),
      backupCodes: safeDecrypt(account.backupCodes),

      fullName: "",
      iban: "",
      walletPhone: "",
      walletAddress: "",
      paypalEmail: "",
      country: "",

      expiresAt: Date.now() + 90000
    };

    switch (order.paymentMethodType) {
      case "bank":
        response.fullName = safeDecrypt(payment.fullName);
        response.iban = safeDecrypt(payment.iban);
        response.bankName = payment.bankName || "";
        break;

      case "wallet":
        response.walletPhone = safeDecrypt(payment.walletPhone);
        break;

      case "usdt":
        response.walletAddress = safeDecrypt(payment.walletAddress);
        response.network = payment.network || "";
        break;

      case "paypal":
        response.paypalEmail = safeDecrypt(payment.paypalEmail);
        break;

      case "western":
        response.fullName = safeDecrypt(payment.fullName);
        response.country = safeDecrypt(payment.country);
        break;
    }

    res.json({
      success: true,
      data: response
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
