/**
 * ============================================================================
 * SAMI COINS - SYSTEM CORE (system.js)
 * ============================================================================
 * نواة النظام - إدارة Firestore والإعدادات والأكواد والتسلسل والمخزون فقط.
 * خالي تماماً من أي تعامل مع DOM أو عناصر الواجهة.
 * ============================================================================
 */
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    onSnapshot,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";

const SETTINGS_DOC_PATH = "system/settings";
const COUNTER_DOC_PATH = "system/counter";

// ============================================================================
// الإعدادات الافتراضية للنظام
// ============================================================================
export const defaultSettings = {
    // بيانات المتجر الأساسية
    storeName: "SAMI COINS",
    storeLogo: "",
    supportWhatsapp: "966570770465",
    supportEmail: "support@samicoins.com",
    siteUrl: "https://samicoins.com",
    // الشريط الإعلاني
    announcementActive: true,
    announcementText: "",
    announcementBgColor: "#00ff87",
    announcementTextColor: "#060913",
    // إعدادات PlayStation / Xbox
    psRate: 200,
    psMin: 100000,
    psMax: 5000000,
    psWithdrawDuration: "3 - 5 أيام عمل",
    psTransferDuration: "24 ساعة",
    psStock: 0,
    // إعدادات PC
    pcRate: 150,
    pcMin: 100000,
    pcMax: 1000000,
    pcWithdrawDuration: "2 - 4 أيام عمل",
    pcTransferDuration: "24 ساعة",
    pcStock: 0,
    // العروض وحالة المتجر
    offers: false,
    offerText: "",
    promoRate: 220,
    promoExpiry: "",
    storeOpen: true,
    banks: [
        "مصرف الراجحي",
        "البنك الأهلي السعودي",
        "بنك الرياض",
        "مصرف الإنماء",
        "بنك البلاد",
        "بنك الجزيرة",
        "البنك الأول (SAB)",
        "البنك العربي الوطني",
        "البنك السعودي الفرنسي",
        "البنك السعودي للاستثمار",
        "STC Bank",
        "D360 Bank"
    ],
    wallets: [
        "STC Pay",
        "Barq",
        "URPay",
        "Mobily Pay",
        "Tiqmo",
        "Alinma Pay"
    ],
    paymentMethods: [
        "تحويل بنكي",
        "المحافظ الرقمية",
        "USDT",
        "PayPal",
        "Western Union"
    ],
    terms: [
        "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
        "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
        "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
    ]
};

// ============================================================================
// 1. نظام المزامنة والاستماع للإعدادات (Realtime Listener)
// ============================================================================
export function subscribeToSettings(callback) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    return onSnapshot(settingsRef, (snap) => {
        if (snap.exists()) {
            callback({ ...defaultSettings, ...snap.data() });
        } else {
            getSettings().then(defaultData => callback(defaultData));
        }
    });
}

// ============================================================================
// 2. نظام الأكواد اليومية (Daily Codes System)
// ============================================================================
function getMakkahDateKey() {
    const now = new Date();
    const makkahOffsetMs = 3 * 60 * 60 * 1000;
    const makkahTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + makkahOffsetMs);
    const year = makkahTime.getFullYear();
    const month = String(makkahTime.getMonth() + 1).padStart(2, '0');
    const day = String(makkahTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function generate3DigitCode() {
    return String(Math.floor(Math.random() * 900) + 100);
}

export async function getDailyCodes() {
    const todayKey = getMakkahDateKey();
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    const settingsSnap = await getDoc(settingsRef);
    let settingsData = settingsSnap.exists() ? settingsSnap.data() : {};
    let dailyCodesObj = settingsData.dailyCodes || {};
    let historyObj = settingsData.dailyCodesHistory || {};

    if (dailyCodesObj.dateKey === todayKey && Array.isArray(dailyCodesObj.codes) && dailyCodesObj.codes.length === 5) {
        return dailyCodesObj.codes;
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoKey = ninetyDaysAgo.toISOString().split('T')[0];

    const cleanHistory = {};
    for (const [dateKey, codes] of Object.entries(historyObj)) {
        if (dateKey >= ninetyDaysAgoKey) {
            cleanHistory[dateKey] = codes;
        }
    }

    const usedCodesIn90Days = new Set();
    Object.values(cleanHistory).forEach(codesArray => {
        if (Array.isArray(codesArray)) {
            codesArray.forEach(code => usedCodesIn90Days.add(String(code)));
        }
    });

    const newDailyCodes = [];
    let attempts = 0;
    while (newDailyCodes.length < 5 && attempts < 1000) {
        attempts++;
        const candidate = generate3DigitCode();
        if (!usedCodesIn90Days.has(candidate) && !newDailyCodes.includes(candidate)) {
            newDailyCodes.push(candidate);
        }
    }

    while (newDailyCodes.length < 5) {
        const candidate = generate3DigitCode();
        if (!newDailyCodes.includes(candidate)) {
            newDailyCodes.push(candidate);
        }
    }

    cleanHistory[todayKey] = newDailyCodes;
    const newDailyCodesObj = { dateKey: todayKey, codes: newDailyCodes };

    await setDoc(settingsRef, {
        dailyCodes: newDailyCodesObj,
        dailyCodesHistory: cleanHistory
    }, { merge: true });

    return newDailyCodes;
}

// ============================================================================
// 3. نظام رقم الطلب (Order ID Generator)
// ============================================================================
function getRandomSAMILetters() {
    const pool = "SAMICOINS";
    const letter1 = pool.charAt(Math.floor(Math.random() * pool.length));
    const letter2 = pool.charAt(Math.floor(Math.random() * pool.length));
    return `${letter1}${letter2}`;
}

export async function createOrderId(platform) {
    let platCode = "PS";

    const p = String(platform || "").toUpperCase();

    if (p === "XBOX" || p === "XB") platCode = "XB";
    else if (p === "PC") platCode = "PC";

    const todayKey = getMakkahDateKey();
    const dailyCodes = await getDailyCodes();
    const counterRef = doc(db, COUNTER_DOC_PATH);

    const serial = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);

        let lastSerial = 0;
        let dateKey = "";

        if (snap.exists()) {
            lastSerial = snap.data().lastSerial || 0;
            dateKey = snap.data().dateKey || "";
        }

        if (dateKey !== todayKey) {
            lastSerial = 0;
        }

        const next = lastSerial + 1;

        tx.set(counterRef, {
            dateKey: todayKey,
            lastSerial: next,
            updatedAt: serverTimestamp()
        }, { merge: true });

        return next;
    });

    const code = dailyCodes[(serial - 1) % 5];
    const letters = getRandomSAMILetters();

    return `SQ${letters}${code}${platCode}${String(serial).padStart(3, "0")}`;
}

// ============================================================================
// 4. إدارة الإعدادات والأسعار والمخزون الحسابي (Settings, Pricing & Inventory)
// ============================================================================
export async function getSettings() {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
        await setDoc(settingsRef, defaultSettings);
        return defaultSettings;
    }
    return { ...defaultSettings, ...settingsSnap.data() };
}

export async function savePricing(pricingData) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    const payload = {
        storeName: pricingData.storeName || "SAMI COINS",
        storeLogo: pricingData.storeLogo || "",
        supportWhatsapp: pricingData.supportWhatsapp || "",
        supportEmail: pricingData.supportEmail || "",
        siteUrl: pricingData.siteUrl || "",
        // الشريط الإعلاني
        announcementActive: Boolean(pricingData.announcementActive),
        announcementText: pricingData.announcementText || "",
        announcementBgColor: pricingData.announcementBgColor || "#00ff87",
        announcementTextColor: pricingData.announcementTextColor || "#060913",
        // PS / Xbox
        psRate: Number(pricingData.psRate) || 200,
        psMin: Number(pricingData.psMin) || 100000,
        psMax: Number(pricingData.psMax) || 5000000,
        psWithdrawDuration: pricingData.psWithdrawDuration || "3 - 5 أيام عمل",
        psTransferDuration: pricingData.psTransferDuration || "24 ساعة",
        psStock: Number(pricingData.psStock) || 0,
        // PC
        pcRate: Number(pricingData.pcRate) || 150,
        pcMin: Number(pricingData.pcMin) || 100000,
        pcMax: Number(pricingData.pcMax) || 1000000,
        pcWithdrawDuration: pricingData.pcWithdrawDuration || "2 - 4 أيام عمل",
        pcTransferDuration: pricingData.pcTransferDuration || "24 ساعة",
        pcStock: Number(pricingData.pcStock) || 0,
        // العروض وحالة المتجر
        offers: Boolean(pricingData.offers),
        offerText: pricingData.offerText || "",
        promoRate: Number(pricingData.promoRate) || 0,
        promoExpiry: pricingData.promoExpiry || "",
        storeOpen: pricingData.storeOpen ?? true,
        updatedAt: serverTimestamp()
    };
    await setDoc(settingsRef, payload, { merge: true });
    return true;
}

/**
 * دالة خصم المخزون التلقائي من الطلب المسحوب وتسجيل العملية ومنع التكرار
 * PlayStation & Xbox ➔ psStock
 * PC ➔ pcStock
 */
export async function processWithdrawnStockDeduction(orderId, platform, withdrawnAmount) {
    try {
        const orderRef = doc(db, "orders", orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) return false;

        const order = orderSnap.data();

        // منع الخصم المكرر
        if (order.withdrawnDeducted) {
            return false;
        }

        const numericAmount = Number(withdrawnAmount) || 0;
        if (numericAmount <= 0) return false;

        // تحديد الحقل المخصص للخصم بناءً على المنصة
        const platUpper = String(platform || "").toUpperCase();
        let stockField = "psStock"; // الافتراضي لـ PlayStation و Xbox
        if (platUpper === "PC") {
            stockField = "pcStock";
        }

        // 1. خصم الكمية من المخزون الإجمالي
        const settingsRef = doc(db, SETTINGS_DOC_PATH);
        await updateDoc(settingsRef, {
            [stockField]: increment(-numericAmount)
        });

        // 2. تحديث بيانات الطلب لضمان عدم الخصم مرة أخرى وحفظ السجل للوحة التحكم
        await updateDoc(orderRef, {
            withdrawnDeducted: true,
            deductedAmount: numericAmount,
            deductedAt: serverTimestamp()
        });

        return true;
    } catch (error) {
        console.error("Error processing withdrawn stock deduction:", error);
        throw error;
    }
}

// ============================================================================
// 5. إدارة البنوك والمحافظ وطرق الدفع والشروط
// ============================================================================
export async function getBanks() {
    const settings = await getSettings();
    return settings.banks || [];
}

export async function saveBanks(banksArray) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    await setDoc(settingsRef, {
        banks: banksArray,
        updatedAt: serverTimestamp()
    }, { merge: true });
    return banksArray;
}

export async function addBank(newBank) {
    const banks = await getBanks();
    if (newBank && !banks.includes(newBank)) {
        banks.push(newBank);
        await saveBanks(banks);
    }
    return banks;
}

export async function deleteBank(bankIndex) {
    const banks = await getBanks();
    if (bankIndex >= 0 && bankIndex < banks.length) {
        banks.splice(bankIndex, 1);
        await saveBanks(banks);
    }
    return banks;
}

export async function getWallets() {
    const settings = await getSettings();
    return settings.wallets || [];
}

export async function saveWallets(walletsArray) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    await setDoc(settingsRef, {
        wallets: walletsArray,
        updatedAt: serverTimestamp()
    }, { merge: true });
    return walletsArray;
}

export async function addWallet(newWallet) {
    const wallets = await getWallets();
    if (newWallet && !wallets.includes(newWallet)) {
        wallets.push(newWallet);
        await saveWallets(wallets);
    }
    return wallets;
}

export async function deleteWallet(walletIndex) {
    const wallets = await getWallets();
    if (walletIndex >= 0 && walletIndex < wallets.length) {
        wallets.splice(walletIndex, 1);
        await saveWallets(wallets);
    }
    return wallets;
}

export async function getPaymentMethods() {
    const settings = await getSettings();
    return settings.paymentMethods || [];
}

export async function savePaymentMethods(methodsArray) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    await setDoc(settingsRef, {
        paymentMethods: methodsArray,
        updatedAt: serverTimestamp()
    }, { merge: true });
    return methodsArray;
}

export async function addPaymentMethod(method) {
    const methods = await getPaymentMethods();
    if (method && !methods.includes(method)) {
        methods.push(method);
        await savePaymentMethods(methods);
    }
    return methods;
}

export async function deletePaymentMethod(methodIndex) {
    const methods = await getPaymentMethods();
    if (methodIndex >= 0 && methodIndex < methods.length) {
        methods.splice(methodIndex, 1);
        await savePaymentMethods(methods);
    }
    return methods;
}

export async function getTerms() {
    const settings = await getSettings();
    return settings.terms || [];
}

export async function saveTerms(termsArray) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    await setDoc(settingsRef, {
        terms: termsArray,
        updatedAt: serverTimestamp()
    }, { merge: true });
    return termsArray;
}

export async function addTerm(termText) {
    const terms = await getTerms();
    if (termText) {
        terms.push(termText);
        await saveTerms(terms);
    }
    return terms;
}

export async function deleteTerm(index) {
    const terms = await getTerms();
    if (index >= 0 && index < terms.length) {
        terms.splice(index, 1);
        await saveTerms(terms);
    }
    return terms;
}

export async function toggleStore(overrideStatus = null) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    if (typeof overrideStatus === 'boolean') {
        await setDoc(settingsRef, { storeOpen: overrideStatus, updatedAt: serverTimestamp() }, { merge: true });
        return overrideStatus;
    }
    const currentSettings = await getSettings();
    const newStatus = !currentSettings.storeOpen;
    await setDoc(settingsRef, { storeOpen: newStatus, updatedAt: serverTimestamp() }, { merge: true });
    return newStatus;
}

export async function updateStock(newPs, newPc, adminName, reason) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);

    await updateDoc(settingsRef, {
        psStock: Number(newPs),
        pcStock: Number(newPc),
        lastStockUpdate: new Date().toLocaleString("ar-SA"),
        updatedAt: serverTimestamp()
    });

    return true;
}
