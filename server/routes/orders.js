import express from "express";
import admin, { db } from "../services/firebase.js";
import { encrypt } from "../utils/crypto.js";

const router = express.Router();
const TS = admin.firestore.FieldValue.serverTimestamp;

// ==========================
// أدوات مساعدة
// ==========================
function randomLetters() {
  const chars = "SAMICOINS";
  return (
    chars[Math.floor(Math.random() * chars.length)] +
    chars[Math.floor(Math.random() * chars.length)]
  );
}

function dailyCode() {
  return String(Math.floor(100 + Math.random() * 900));
}

function generateReference() {
  const d = new Date();
  const date =
    String(d.getFullYear()).slice(-2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");

  return `${randomLetters()}${date}${dailyCode()}`;
}

function encryptSensitiveFields(order) {
  const payment = { ...(order.paymentInfoData || {}) };
  const account = { ...(order.accountData || {}) };

  // بيانات EA (حساب اللعبة)
  if (account.eaEmail) account.eaEmail = encrypt(account.eaEmail);
  if (account.eaPassword) account.eaPassword = encrypt(account.eaPassword);
  if (account.backupCodes) account.backupCodes = encrypt(account.backupCodes);

  // وسيلة الدفع بناءً على أسماء الحقول الرسمية
  switch (order.paymentMethodType) {
    case "bank":
      if (payment.accountName) payment.accountName = encrypt(payment.accountName);
      if (payment.iban) payment.iban = encrypt(payment.iban);
      break;

    case "wallet":
      if (payment.walletNumber) payment.walletNumber = encrypt(payment.walletNumber);
      if (payment.walletType) payment.walletType = encrypt(payment.walletType);
      break;

    case "usdt":
      if (payment.walletType) payment.walletType = encrypt(payment.walletType);
      break;

    case "paypal":
      if (payment.paypalEmail) payment.paypalEmail = encrypt(payment.paypalEmail);
      break;

    case "western":
      if (payment.fullName) payment.fullName = encrypt(payment.fullName);
      if (payment.country) payment.country = encrypt(payment.country);
      break;
  }

  return { paymentInfoData: payment, accountData: account };
}

// ==========================
// اختبار
// ==========================
router.get("/", (_, res) => {
  res.json({ success: true, message: "Orders API Ready" });
});

// ==========================
// جلب إعدادات النظام للطلبات (Settings Route)
// ==========================
router.get("/settings", async (_, res) => {
  try {
    const snap = await db.collection("system").doc("settings").get();
    const s = snap.data() || {};

    res.json({
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
      banks: s.banks || [],
      wallets: s.wallets || [],
      paymentMethods: s.paymentMethods || [],
      terms: s.terms || [],
      storeOpen: s.storeOpen
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================
// قراءة الطلبات
// ==========================
router.get("/list", async (_, res) => {
  try {
    const snapshot = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .get();

    const orders = snapshot.docs.map((doc) => {
      const d = doc.data();

      return {
        id: doc.id,
        reference: d.orderId || doc.id,
        referenceNumber: d.referenceNumber || "",
        customerName: d.customerName || "",
        name: d.customerName || "",
        phone: d.phone || "",
        platform: d.platform || "",
        quantity: Number(d.quantity || 0),
        totalQty: Number(d.quantity || 0),
        totalPrice: d.totalPrice || "",
        status: d.status || "new",
        drawnCoins: Number(d.drawnCoins || 0),
        paymentMethod: d.paymentMethod || "",
        paymentMethodType: d.paymentMethodType || "",
        paymentInfoData: d.paymentInfoData || {},
        createdAt: d.createdAt?.toDate
          ? d.createdAt.toDate().toISOString()
          : null
      };
    });

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================
// إنشاء طلب جديد
// ==========================
router.post("/create", async (req, res) => {
  try {
    const body = req.body;

    const referenceNumber = generateReference();

    const docRef = await db.collection("orders").add({
      referenceNumber,
      customerName: body.customerName || "",
      phone: body.phone || "",
      platform: body.platform || "",
      quantity: Number(body.quantity || 0),
      totalPrice: body.totalPrice || "",
      paymentMethod: body.paymentMethod || "",
      paymentMethodType: body.paymentMethodType || "",
      paymentInfoData: body.paymentInfoData || {},
      accountData: body.accountData || {},
      drawnCoins: 0,
      status: "new",
      encrypted: false,
      createdAt: TS(),
      lastUpdate: TS()
    });

    res.json({
      success: true,
      orderId: docRef.id,
      referenceNumber
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================
// تحديث الحالة والتشفير عند الاكتمال
// ==========================
router.post("/update-status", async (req, res) => {
  try {
    const { orderId, status } = req.body;

    const ref = db.collection("orders").doc(orderId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const order = snap.data();
    const updateData = {
      status,
      lastUpdate: TS()
    };

    if (status === "completed" && order.encrypted !== true) {
      const encrypted = encryptSensitiveFields(order);

      updateData.paymentInfoData = encrypted.paymentInfoData;
      updateData.accountData = encrypted.accountData;
      updateData.encrypted = true;
      updateData.encryptedAt = TS();
    }

    await ref.update(updateData);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================
// تحديث الكوينز المسحوبة
// ==========================
router.post("/update-drawn", async (req, res) => {
  try {
    const { orderId, drawnCoins } = req.body;

    const ref = db.collection("orders").doc(orderId);

    await ref.update({
      drawnCoins: Number(drawnCoins || 0),
      lastUpdate: TS()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================
// حذف طلب
// ==========================
router.post("/delete", async (req, res) => {
  try {
    const { orderId } = req.body;

    await db.collection("orders").doc(orderId).delete();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================
// إتلاف البيانات الحساسة
// ==========================
router.post("/purge-sensitive", async (req, res) => {
  try {
    const { orderId } = req.body;

    const ref = db.collection("orders").doc(orderId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const data = snap.data();

    await ref.update({
      accountData: {
        ...data.accountData,
        eaEmail: null,
        eaPassword: null,
        backupCodes: null
      },
      paymentInfoData: {
        ...data.paymentInfoData,
        accountName: null,
        iban: null,
        walletNumber: null,
        walletType: null,
        paypalEmail: null,
        fullName: null,
        country: null
      },
      purgedAt: TS()
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
