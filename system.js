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
    onSnapshot,
    runTransaction, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "./firebase.js";

const SETTINGS_DOC_PATH = "system/settings";
const COUNTER_DOC_PATH = "system/counter";

// ============================================================================
// 1. نظام المزامنة والاستماع للإعدادات (Realtime Listener)
// ============================================================================

export function subscribeToSettings(callback) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    return onSnapshot(settingsRef, (snap) => {
        if (snap.exists()) {
            callback(snap.data());
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
    if (platform === "Xbox" || platform === "XB") platCode = "XB";
    else if (platform === "PC") platCode = "PC";
    else if (platform === "PlayStation" || platform === "PS") platCode = "PS";

    const dailyCodes = await getDailyCodes();
    const counterRef = doc(db, COUNTER_DOC_PATH);

    const nextSerial = await runTransaction(db, async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        let currentSerial = 0;

        if (counterSnap.exists()) {
            currentSerial = counterSnap.data().lastSerial || 0;
        }

        const updatedSerial = currentSerial + 1;

        transaction.set(counterRef, {
            lastSerial: updatedSerial,
            updatedAt: serverTimestamp()
        }, { merge: true });

        return updatedSerial;
    });

    const codeIndex = (nextSerial - 1) % 5;
    const selectedDailyCode = dailyCodes[codeIndex];
    const randomLetters = getRandomSAMILetters();

    return `SQ${randomLetters}${selectedDailyCode}${platCode}${nextSerial}`;
}

// ============================================================================
// 4. إدارة الإعدادات والأسعار والمخزون الحسابي (Settings, Pricing & Inventory)
// ============================================================================

export async function getSettings() {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    const settingsSnap = await getDoc(settingsRef);

    const defaultSettings = {
        storeName: "SAMICOINS",
        supportWhatsapp: "966500000000",
        
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

        // العروض والتحويلات العامة
        offers: false,
        offerText: "",
        promoRate: 220,
        promoExpiry: "",
        storeOpen: true,

        // بيانات السجلات والتحديث
        lastStockUpdate: null,
        stockLogs: [],

        banks: [
            "مصرف الراجحي",
            "البنك الأهلي السعودي (SNB)",
            "بنك الرياض",
            "مصرف الإنماء",
            "بنك البلاد",
            "بنك STC"
        ],
        wallets: [
            "STC Pay",
            "URPay",
            "برق (Barq)",
            "Mobily Pay"
        ],
        paymentMethods: [
            "تحويل بنكي",
            "المحافظ الرقمية",
            "USDT",
            "Western Union"
        ],
        terms: [
            "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
            "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
            "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
        ]
    };

    if (!settingsSnap.exists()) {
        await setDoc(settingsRef, defaultSettings);
        return defaultSettings;
    }

    return { ...defaultSettings, ...settingsSnap.data() };
}

export async function savePricing(pricingData) {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    const payload = {
        storeName: pricingData.storeName || "SAMICOINS",
        supportWhatsapp: pricingData.supportWhatsapp || "",

        // PS / Xbox
        psRate: Number(pricingData.psRate) || 200,
        psMin: Number(pricingData.psMin) || 100000,
        psMax: Number(pricingData.psMax) || 5000000,
        psWithdrawDuration: pricingData.psWithdrawDuration || "3 - 5 أيام عمل",
        psTransferDuration: pricingData.psTransferDuration || "24 ساعة",

        // PC
        pcRate: Number(pricingData.pcRate) || 150,
        pcMin: Number(pricingData.pcMin) || 100000,
        pcMax: Number(pricingData.pcMax) || 1000000,
        pcWithdrawDuration: pricingData.pcWithdrawDuration || "2 - 4 أيام عمل",
        pcTransferDuration: pricingData.pcTransferDuration || "24 ساعة",

        // العروض
        offers: Boolean(pricingData.offers),
        offerText: pricingData.offerText || "",
        promoRate: Number(pricingData.promoRate) || 0,
        promoExpiry: pricingData.promoExpiry || "",

        updatedAt: serverTimestamp()
    };

    await setDoc(settingsRef, payload, { merge: true });
    return true;
}

/**
 * تحديث المخزون اليدوي وتسجيل العملية في سجل التغييرات
 */
export async function updateStock(psStock, pcStock, adminName = "مشرف", reason = "تحديث يدوي") {
    const settingsRef = doc(db, SETTINGS_DOC_PATH);
    const currentSettings = await getSettings();

    const newLogs = currentSettings.stockLogs || [];
    newLogs.unshift({
        timestamp: new Date().toLocaleString("ar-SA"),
        admin: adminName,
        oldPs: currentSettings.psStock || 0,
        newPs: psStock,
        oldPc: currentSettings.pcStock || 0,
        newPc: pcStock,
        reason: reason
    });

    // الاحتفاظ بأخر 50 سجل فقط
    if (newLogs.length > 50) newLogs.pop();

    await setDoc(settingsRef, {
        psStock: Number(psStock) || 0,
        pcStock: Number(pcStock) || 0,
        lastStockUpdate: new Date().toLocaleString("ar-SA"),
        stockLogs: newLogs,
        updatedAt: serverTimestamp()
    }, { merge: true });

    return true;
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
