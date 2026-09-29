import express from "express";
import { db } from "../services/firebase.js";
import { decrypt } from "../utils/crypto.js";

const router = express.Router();

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

    const doc = await db.collection("orders").doc(orderId).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const order = doc.data();
    const payment = order.paymentInfoData || {};

    const decrypted = {
      customerEmail: decrypt(order.customerEmail),
      phone: decrypt(order.phone),
      eaEmail: decrypt(order.eaEmail),
      eaPassword: decrypt(order.eaPassword),
      backupCodes: decrypt(order.backupCodes),

      paymentInfoData: {
        bankName: payment.bankName || "",
        iban: decrypt(payment.iban),
        accountName: decrypt(payment.accountName),
        walletNumber: decrypt(payment.walletNumber),
        usdtWallet: decrypt(payment.usdtWallet),
        paypalEmail: decrypt(payment.paypalEmail),
        westernName: decrypt(payment.westernName)
      },

      expiresAt: Date.now() + (90 * 1000)
    };

    res.json({
      success: true,
      data: decrypted
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
