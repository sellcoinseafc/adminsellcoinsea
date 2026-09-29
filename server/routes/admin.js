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

// اختبار لوحة التحكم
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Admin API Ready"
  });
});

// فك تشفير بيانات الطلب
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
    const payment = order.paymentInfoData || {};

    res.json({
      success: true,
      data: {
        phone: safeDecrypt(order.phone),
        customerEmail: safeDecrypt(order.customerEmail),

        eaEmail: safeDecrypt(order.eaEmail),
        eaPassword: safeDecrypt(order.eaPassword),
        backupCodes: safeDecrypt(order.backupCodes),

        bankName: payment.bankName || "",
        iban: safeDecrypt(payment.iban),
        accountName: safeDecrypt(payment.accountName),
        walletNumber: safeDecrypt(payment.walletNumber),
        usdtWallet: safeDecrypt(payment.usdtWallet),
        paypalEmail: safeDecrypt(payment.paypalEmail),
        westernName: safeDecrypt(payment.westernName),

        expiresAt: Date.now() + 90000
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
