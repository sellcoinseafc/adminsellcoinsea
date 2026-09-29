import express from "express";
import admin, { db } from "../services/firebase.js";

const router = express.Router();

function randomLetters() {
  const chars = "SAMICOINS";
  return chars[Math.floor(Math.random() * chars.length)] +
         chars[Math.floor(Math.random() * chars.length)];
}

function dailyCode() {
  return String(Math.floor(100 + Math.random() * 900));
}

router.get("/", (req, res) => {
  res.json({ success: true, message: "Orders API Ready" });
});

router.get("/list", async (req, res) => {
  try {
    const snapshot = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .get();
    const orders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const doc = await db.collection("system").doc("settings").get();
    const s = doc.data() || {};
    res.json({
      success: true,
      rates: {
        PlayStation: s.psRate || 0,
        Xbox: s.psRate || 0,
        PC: s.pcRate || 0
      },
      limits: {
        psMin: s.psMin || 0,
        psMax: s.psMax || 0,
        pcMin: s.pcMin || 0,
        pcMax: s.pcMax || 0
      },
      withdrawDays: s.psWithdrawDuration || "",
      transferHours: s.psTransferDuration || "",
      safeMethod: "Comfort Trade",
      paymentMethods: {
        local: ["تحويل بنكي", "المحافظ الرقمية"],
        international: ["USDT", "PayPal", "Western Union"]
      },
      banks: s.banks || [],
      wallets: s.wallets || [],
      termsEnabled: true
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/create", async (req, res) => {
  try {
    const counterRef = db.collection("system").doc("orderCounter");
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      let orderSeq = 100;
      let refSeq = 1;
      if (snap.exists) {
        const data = snap.data();
        orderSeq = data.orderSequence || 100;
        refSeq = data.referenceSequence || 1;
      }
      const orderId = `${randomLetters()}${dailyCode()}${orderSeq}`;
      const referenceNumber = `FC${Math.floor(100 + Math.random() * 900)}-${refSeq}`;
      
      tx.set(
        counterRef,
        {
          orderSequence: orderSeq + 1,
          referenceSequence: refSeq + 1
        },
        { merge: true }
      );

      const orderRef = db.collection("orders").doc(orderId);
      tx.set(orderRef, {
        orderId,
        referenceNumber,

        // بيانات العميل
        customerName: req.body.customerName || "",
        customerEmail: req.body.customerEmail || "",
        phone: req.body.phone || "",
        platform: req.body.platform || "",
        quantity: req.body.quantity || "",
        totalPrice: req.body.totalPrice || "",
        paymentMethod: req.body.paymentMethod || "",
        paymentMethodType: req.body.paymentMethodType || "",
        paymentInfoData: req.body.paymentInfoData || {},

        // حالات التتبع
        orderStatus: "new",
        progressPercentage: 15,
        withdrawnQuantity: 0,
        statusMessage: "تم استلام طلبك بنجاح",

        // المدد
        withdrawDuration: "3-7 أيام",
        transferDuration: "3-5 أيام",

        // الوقت
        lastUpdate: new Date().toLocaleString("ar-SA"),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { orderId, referenceNumber };
    });

    res.json({
      success: true,
      orderId: result.orderId,
      referenceNumber: result.referenceNumber
    });
  } catch (err) {
    console.error("Order Creation Error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

export default router;
