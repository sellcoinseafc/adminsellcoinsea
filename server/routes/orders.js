import express from "express";
import admin, { db } from "../services/firebase.js";
import { encrypt } from "../utils/crypto.js";

const router = express.Router();

function randomLetters() {
  const chars = "SAMICOINS";
  return chars[Math.floor(Math.random() * chars.length)] +
         chars[Math.floor(Math.random() * chars.length)];
}

function dailyCode() {
  return String(Math.floor(100 + Math.random() * 900));
}

// اختبار
router.get("/", (req, res) => {
  res.json({ success: true, message: "Orders API Ready" });
});

// ==========================
// قراءة الطلبات (معدل)
// ==========================
router.get("/list", async (req, res) => {
  try {
    const snapshot = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .get();

    const orders = snapshot.docs.map(doc => {
      const d = doc.data();

      return {
        id: doc.id,
        reference: d.orderId || doc.id,
        referenceNumber: d.referenceNumber || "",

        // لوحة التحكم
        name: d.customerName || "",
        customerName: d.customerName || "",

        phone: d.phone || "",
        platform: d.platform || "",

        totalQty: Number(d.quantity || 0),
        quantity: Number(d.quantity || 0),

        totalPrice: d.totalPrice || "",

        status: d.status || d.orderStatus || "new",
        orderStatus: d.orderStatus || d.status || "new",

        drawnCoins: Number(d.drawnCoins || 0),
        withdrawnQuantity: Number(d.withdrawnQuantity || 0),
        progressPercentage: Number(d.progressPercentage || 0),

        paymentMethod: d.paymentMethod || "",
        paymentMethodType: d.paymentMethodType || "",
        paymentInfoData: d.paymentInfoData || {},

        statusMessage: d.statusMessage || "",
        lastUpdate: d.lastUpdate || "",

        createdAt: d.createdAt?.toDate
          ? d.createdAt.toDate().toISOString()
          : null
      };
    });

    res.json({
      success: true,
      orders
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
