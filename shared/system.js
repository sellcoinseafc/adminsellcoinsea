/**
 * ============================================================================
 * SAMI COINS - SYSTEM CORE (system.js)
 * ============================================================================
 *
 * نواة النظام - إدارة:
 * - Firestore
 * - الإعدادات
 * - الأسعار
 * - المخزون
 * - البنوك
 * - المحافظ
 * - طرق الدفع
 * - الشروط
 * - رسائل المشاكل
 *
 * مهم جداً:
 * - إنشاء أرقام الطلبات الجديدة أصبح Server-Side فقط.
 * - server/services/orderNumber.js هو المصدر الرسمي للترقيم.
 * - الدوال القديمة الخاصة بالأرقام موجودة فقط للتوافق مع أي كود قديم.
 * - لا تستخدم createOrderId() لإنشاء طلب جديد.
 *
 * هذا الملف خالي من أي تعامل مباشر مع DOM.
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

/**
 * ============================================================================
 * رسائل الحالات والمشاكل الافتراضية
 * ============================================================================
 */

export const defaultIssueMessages = {
    wrong_credentials: "بيانات الدخول غير صحيحة",
    wrong_backup_codes: "رموز النسخ الاحتياطية غير صحيحة",
    market_closed: "سوق الانتقالات مغلق",
    no_player: "لا يوجد لاعب مطابق",
    wrong_platform: "المنصة المحددة غير صحيحة",
    other_issue: "توجد مشكلة في الطلب"
};

/**
 * ============================================================================
 * الإعدادات الافتراضية للنظام
 * ============================================================================
 */

export const defaultSettings = {
    // ------------------------------------------------------------------------
    // بيانات المتجر الأساسية
    // ------------------------------------------------------------------------

    storeName: "SAMI COINS",

    storeLogo: "",

    supportWhatsapp: "966570770465",

    supportEmail: "support@samicoins.com",

    siteUrl: "https://samicoins.com",

    // ------------------------------------------------------------------------
    // الشريط الإعلاني
    // ------------------------------------------------------------------------

    announcementActive: true,

    announcementText: "",

    announcementBgColor: "#00ff87",

    announcementTextColor: "#060913",

    // ------------------------------------------------------------------------
    // PlayStation / Xbox
    // ------------------------------------------------------------------------

    psRate: 200,

    psMin: 100000,

    psMax: 5000000,

    psWithdrawDuration: "3 - 5 أيام عمل",

    psTransferDuration: "24 ساعة",

    psStock: 0,

    // ------------------------------------------------------------------------
    // PC
    // ------------------------------------------------------------------------

    pcRate: 150,

    pcMin: 100000,

    pcMax: 1000000,

    pcWithdrawDuration: "2 - 4 أيام عمل",

    pcTransferDuration: "24 ساعة",

    pcStock: 0,

    // ------------------------------------------------------------------------
    // العروض وحالة المتجر
    // ------------------------------------------------------------------------

    offers: false,

    offerText: "",

    promoRate: 220,

    promoExpiry: "",

    storeOpen: true,

    // ------------------------------------------------------------------------
    // البنوك
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // المحافظ
    // ------------------------------------------------------------------------

    wallets: [
        "STC Pay",
        "Barq",
        "URPay",
        "Mobily Pay",
        "Tiqmo",
        "Alinma Pay"
    ],

    // ------------------------------------------------------------------------
    // طرق الدفع
    // ------------------------------------------------------------------------

    paymentMethods: [
        "تحويل بنكي",
        "المحافظ الرقمية",
        "USDT",
        "PayPal",
        "Western Union"
    ],

    // ------------------------------------------------------------------------
    // الشروط
    // ------------------------------------------------------------------------

    terms: [
        "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
        "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
        "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
    ],

    // ------------------------------------------------------------------------
    // رسائل المشاكل
    // ------------------------------------------------------------------------

    issueMessages: {
        ...defaultIssueMessages
    }
};

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeIssueMessages(value) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return {
            ...defaultIssueMessages
        };
    }

    return {
        ...defaultIssueMessages,
        ...Object.fromEntries(
            Object.entries(value)
                .filter(
                    ([key, message]) =>
                        Object.prototype.hasOwnProperty.call(
                            defaultIssueMessages,
                            key
                        ) &&
                        typeof message === "string" &&
                        message.trim()
                )
                .map(
                    ([key, message]) => [
                        key,
                        message.trim()
                    ]
                )
        )
    };
}

/**
 * ============================================================================
 * 1. نظام المزامنة والاستماع للإعدادات
 * ============================================================================
 */

export function subscribeToSettings(callback) {
    const settingsRef =
        doc(db, SETTINGS_DOC_PATH);

    return onSnapshot(
        settingsRef,
        (snap) => {
            if (snap.exists()) {
                const data =
                    snap.data() || {};

                callback({
                    ...defaultSettings,
                    ...data,
                    issueMessages:
                        normalizeIssueMessages(
                            data.issueMessages
                        )
                });

                return;
            }

            getSettings()
                .then(
                    (defaultData) =>
                        callback(
                            defaultData
                        )
                )
                .catch((error) => {
                    console.error(
                        "Failed to load default settings:",
                        error
                    );

                    callback({
                        ...defaultSettings,
                        issueMessages:
                            {
                                ...defaultIssueMessages
                            }
                    });
                });
        },
        (error) => {
            console.error(
                "Settings realtime listener error:",
                error
            );

            callback({
                ...defaultSettings,
                issueMessages:
                    {
                        ...defaultIssueMessages
                    }
            });
        }
    );
}

/**
 * ============================================================================
 * 2. نظام التاريخ اليومي
 * ============================================================================
 *
 * يستخدم توقيت الرياض.
 *
 * هذه الدوال محفوظة للتوافق مع الكود القديم.
 * لا تستخدم لإنشاء أرقام الطلبات الجديدة.
 * ============================================================================
 */

function getRiyadhDateKey() {
    const formatter =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone: "Asia/Riyadh",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );

    return formatter.format(
        new Date()
    );
}

/**
 * اسم قديم محفوظ للتوافق.
 */
function getMakkahDateKey() {
    return getRiyadhDateKey();
}

/**
 * ============================================================================
 * 3. نظام الأكواد اليومية - Legacy Compatibility
 * ============================================================================
 *
 * ملاحظة:
 *
 * الترقيم الرسمي الجديد:
 *   server/services/orderNumber.js
 *
 * يقوم بإنشاء:
 *   - 4 أكواد يومية
 *   - توقيت Asia/Riyadh
 *   - حفظها في system/orderNumbering
 *
 * لذلك هذه الدالة ليست مصدر الترقيم الجديد.
 *
 * تم إبقاؤها فقط حتى لا تنكسر أي واجهة قديمة تعتمد عليها.
 * ============================================================================
 */

function generate3DigitCode() {
    return String(
        Math.floor(
            Math.random() * 900
        ) + 100
    );
}

export async function getDailyCodes() {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const settingsSnap =
        await getDoc(
            settingsRef
        );

    const settingsData =
        settingsSnap.exists()
            ? settingsSnap.data()
            : {};

    const dailyCodesObj =
        settingsData.dailyCodes || {};

    const todayKey =
        getRiyadhDateKey();

    /**
     * الحفاظ على النظام القديم
     * إن كان موجوداً.
     *
     * لا نستخدم هذه الأكواد
     * في orderId الجديد.
     */
    if (
        dailyCodesObj.dateKey ===
            todayKey &&
        Array.isArray(
            dailyCodesObj.codes
        ) &&
        dailyCodesObj.codes.length >= 4
    ) {
        return dailyCodesObj.codes;
    }

    const newDailyCodes = [];

    let attempts = 0;

    while (
        newDailyCodes.length < 4 &&
        attempts < 1000
    ) {
        attempts++;

        const candidate =
            generate3DigitCode();

        if (
            !newDailyCodes.includes(
                candidate
            )
        ) {
            newDailyCodes.push(
                candidate
            );
        }
    }

    while (
        newDailyCodes.length < 4
    ) {
        const candidate =
            generate3DigitCode();

        if (
            !newDailyCodes.includes(
                candidate
            )
        ) {
            newDailyCodes.push(
                candidate
            );
        }
    }

    await setDoc(
        settingsRef,
        {
            dailyCodes: {
                dateKey: todayKey,
                codes: newDailyCodes
            },
            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return newDailyCodes;
}

/**
 * ============================================================================
 * 4. نظام رقم الطلب - Legacy Compatibility Only
 * ============================================================================
 *
 * IMPORTANT:
 *
 * لا تستخدم createOrderId() لإنشاء طلب جديد.
 *
 * المصدر الرسمي حالياً:
 *   server/services/orderNumber.js
 *
 * الدالة موجودة فقط للتوافق مع أي كود قديم.
 * ============================================================================
 */

function getRandomSAMILetters() {
    const pool =
        "SAMICOINS";

    const letter1 =
        pool.charAt(
            Math.floor(
                Math.random() *
                    pool.length
            )
        );

    const letter2 =
        pool.charAt(
            Math.floor(
                Math.random() *
                    pool.length
            )
        );

    return `${letter1}${letter2}`;
}

/**
 * Legacy order ID generator.
 *
 * لا تستخدم هذه الدالة للطلبات الجديدة.
 */
export async function createOrderId(
    platform
) {
    console.warn(
        "createOrderId() is a legacy client-side helper. New orders must use server/services/orderNumber.js."
    );

    const dailyCodes =
        await getDailyCodes();

    const todayKey =
        getRiyadhDateKey();

    const counterRef =
        doc(
            db,
            COUNTER_DOC_PATH
        );

    const serial =
        await runTransaction(
            db,
            async (tx) => {
                const snap =
                    await tx.get(
                        counterRef
                    );

                let lastSerial = 0;
                let dateKey = "";

                if (snap.exists()) {
                    const data =
                        snap.data() || {};

                    lastSerial =
                        Number(
                            data.lastSerial ||
                                0
                        );

                    dateKey =
                        data.dateKey ||
                        "";
                }

                if (
                    dateKey !==
                    todayKey
                ) {
                    lastSerial = 0;
                }

                const next =
                    lastSerial + 1;

                tx.set(
                    counterRef,
                    {
                        dateKey:
                            todayKey,

                        lastSerial:
                            next,

                        updatedAt:
                            serverTimestamp()
                    },
                    {
                        merge: true
                    }
                );

                return next;
            }
        );

    const code =
        dailyCodes[
            (serial - 1) %
                dailyCodes.length
        ];

    const letters =
        getRandomSAMILetters();

    const p =
        String(
            platform || ""
        )
            .trim()
            .toUpperCase();

    let platCode = "PS";

    if (
        p === "XBOX" ||
        p === "XB"
    ) {
        platCode = "XB";
    } else if (
        p === "PC"
    ) {
        platCode = "PC";
    }

    return (
        `SQ${letters}` +
        `${code}` +
        `${platCode}` +
        `${String(serial).padStart(3, "0")}`
    );
}

/**
 * ============================================================================
 * 5. إدارة الإعدادات
 * ============================================================================
 */

export async function getSettings() {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const settingsSnap =
        await getDoc(
            settingsRef
        );

    if (
        !settingsSnap.exists()
    ) {
        const initialSettings = {
            ...defaultSettings,
            issueMessages: {
                ...defaultIssueMessages
            }
        };

        await setDoc(
            settingsRef,
            initialSettings,
            {
                merge: true
            }
        );

        return initialSettings;
    }

    const data =
        settingsSnap.data() || {};

    return {
        ...defaultSettings,
        ...data,
        issueMessages:
            normalizeIssueMessages(
                data.issueMessages
            )
    };
}

/**
 * ============================================================================
 * 6. حفظ الأسعار وإعدادات المتجر
 * ============================================================================
 */

export async function savePricing(
    pricingData = {}
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const payload = {
        storeName:
            pricingData.storeName ||
            "SAMI COINS",

        storeLogo:
            pricingData.storeLogo ||
            "",

        supportWhatsapp:
            pricingData.supportWhatsapp ||
            "",

        supportEmail:
            pricingData.supportEmail ||
            "",

        siteUrl:
            pricingData.siteUrl ||
            "",

        // --------------------------------------------------------------------
        // Announcement
        // --------------------------------------------------------------------

        announcementActive:
            Boolean(
                pricingData.announcementActive
            ),

        announcementText:
            pricingData.announcementText ||
            "",

        announcementBgColor:
            pricingData.announcementBgColor ||
            "#00ff87",

        announcementTextColor:
            pricingData.announcementTextColor ||
            "#060913",

        // --------------------------------------------------------------------
        // PlayStation / Xbox
        // --------------------------------------------------------------------

        psRate:
            Number(
                pricingData.psRate
            ) || 200,

        psMin:
            Number(
                pricingData.psMin
            ) || 100000,

        psMax:
            Number(
                pricingData.psMax
            ) || 5000000,

        psWithdrawDuration:
            pricingData.psWithdrawDuration ||
            "3 - 5 أيام عمل",

        psTransferDuration:
            pricingData.psTransferDuration ||
            "24 ساعة",

        psStock:
            Number(
                pricingData.psStock
            ) || 0,

        // --------------------------------------------------------------------
        // PC
        // --------------------------------------------------------------------

        pcRate:
            Number(
                pricingData.pcRate
            ) || 150,

        pcMin:
            Number(
                pricingData.pcMin
            ) || 100000,

        pcMax:
            Number(
                pricingData.pcMax
            ) || 1000000,

        pcWithdrawDuration:
            pricingData.pcWithdrawDuration ||
            "2 - 4 أيام عمل",

        pcTransferDuration:
            pricingData.pcTransferDuration ||
            "24 ساعة",

        pcStock:
            Number(
                pricingData.pcStock
            ) || 0,

        // --------------------------------------------------------------------
        // Store
        // --------------------------------------------------------------------

        offers:
            Boolean(
                pricingData.offers
            ),

        offerText:
            pricingData.offerText ||
            "",

        promoRate:
            Number(
                pricingData.promoRate
            ) || 0,

        promoExpiry:
            pricingData.promoExpiry ||
            "",

        storeOpen:
            pricingData.storeOpen ??
            true,

        // --------------------------------------------------------------------
        // Issue messages
        // --------------------------------------------------------------------

        issueMessages:
            normalizeIssueMessages(
                pricingData.issueMessages
            ),

        updatedAt:
            serverTimestamp()
    };

    await setDoc(
        settingsRef,
        payload,
        {
            merge: true
        }
    );

    return true;
}

/**
 * ============================================================================
 * 7. رسائل المشاكل
 * ============================================================================
 */

export async function getIssueMessages() {
    const settings =
        await getSettings();

    return normalizeIssueMessages(
        settings.issueMessages
    );
}

export async function saveIssueMessages(
    issueMessages
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const normalized =
        normalizeIssueMessages(
            issueMessages
        );

    await setDoc(
        settingsRef,
        {
            issueMessages:
                normalized,

            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return normalized;
}

export async function updateIssueMessage(
    issueCode,
    message
) {
    const settings =
        await getSettings();

    const current =
        normalizeIssueMessages(
            settings.issueMessages
        );

    const code =
        String(
            issueCode || ""
        ).trim();

    if (
        !Object.prototype.hasOwnProperty.call(
            defaultIssueMessages,
            code
        )
    ) {
        throw new Error(
            "Invalid issue code."
        );
    }

    const cleanMessage =
        String(
            message || ""
        ).trim();

    if (!cleanMessage) {
        throw new Error(
            "Issue message cannot be empty."
        );
    }

    current[code] =
        cleanMessage;

    return saveIssueMessages(
        current
    );
}

/**
 * ============================================================================
 * 8. خصم المخزون من الكمية المسحوبة
 * ============================================================================
 *
 * هذه الدالة:
 * - تخصم المخزون.
 * - تمنع الخصم المكرر.
 * - تسجل عملية الخصم.
 *
 * لا تغيّر status.
 *
 * مهم:
 * status أصبح يدار يدوياً من لوحة الإدارة.
 * لا يوجد auto-finish هنا.
 * ============================================================================
 */

export async function processWithdrawnStockDeduction(
    orderId,
    platform,
    withdrawnAmount
) {
    try {
        const orderRef =
            doc(
                db,
                "orders",
                orderId
            );

        const orderSnap =
            await getDoc(
                orderRef
            );

        if (
            !orderSnap.exists()
        ) {
            return false;
        }

        const order =
            orderSnap.data() || {};

        /**
         * منع الخصم المكرر.
         */
        if (
            order.withdrawnDeducted
        ) {
            return false;
        }

        const numericAmount =
            Number(
                withdrawnAmount
            ) || 0;

        if (
            numericAmount <= 0
        ) {
            return false;
        }

        const platUpper =
            String(
                platform ||
                order.platform ||
                ""
            )
                .trim()
                .toUpperCase();

        let stockField =
            "psStock";

        if (
            platUpper === "PC"
        ) {
            stockField =
                "pcStock";
        }

        const settingsRef =
            doc(
                db,
                SETTINGS_DOC_PATH
            );

        await updateDoc(
            settingsRef,
            {
                [stockField]:
                    increment(
                        -numericAmount
                    )
            }
        );

        await updateDoc(
            orderRef,
            {
                withdrawnDeducted:
                    true,

                deductedAmount:
                    numericAmount,

                deductedAt:
                    serverTimestamp()
            }
        );

        return true;
    } catch (error) {
        console.error(
            "Error processing withdrawn stock deduction:",
            error
        );

        throw error;
    }
}

/**
 * ============================================================================
 * 9. البنوك
 * ============================================================================
 */

export async function getBanks() {
    const settings =
        await getSettings();

    return Array.isArray(
        settings.banks
    )
        ? settings.banks
        : [];
}

export async function saveBanks(
    banksArray
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const banks =
        Array.isArray(
            banksArray
        )
            ? banksArray
            : [];

    await setDoc(
        settingsRef,
        {
            banks,
            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return banks;
}

export async function addBank(
    newBank
) {
    const banks =
        await getBanks();

    const value =
        String(
            newBank || ""
        ).trim();

    if (
        value &&
        !banks.includes(value)
    ) {
        banks.push(value);
        await saveBanks(
            banks
        );
    }

    return banks;
}

export async function deleteBank(
    bankIndex
) {
    const banks =
        await getBanks();

    const index =
        Number(
            bankIndex
        );

    if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < banks.length
    ) {
        banks.splice(
            index,
            1
        );

        await saveBanks(
            banks
        );
    }

    return banks;
}

/**
 * ============================================================================
 * 10. المحافظ
 * ============================================================================
 */

export async function getWallets() {
    const settings =
        await getSettings();

    return Array.isArray(
        settings.wallets
    )
        ? settings.wallets
        : [];
}

export async function saveWallets(
    walletsArray
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const wallets =
        Array.isArray(
            walletsArray
        )
            ? walletsArray
            : [];

    await setDoc(
        settingsRef,
        {
            wallets,
            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return wallets;
}

export async function addWallet(
    newWallet
) {
    const wallets =
        await getWallets();

    const value =
        String(
            newWallet || ""
        ).trim();

    if (
        value &&
        !wallets.includes(value)
    ) {
        wallets.push(value);

        await saveWallets(
            wallets
        );
    }

    return wallets;
}

export async function deleteWallet(
    walletIndex
) {
    const wallets =
        await getWallets();

    const index =
        Number(
            walletIndex
        );

    if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < wallets.length
    ) {
        wallets.splice(
            index,
            1
        );

        await saveWallets(
            wallets
        );
    }

    return wallets;
}

/**
 * ============================================================================
 * 11. طرق الدفع
 * ============================================================================
 */

export async function getPaymentMethods() {
    const settings =
        await getSettings();

    /**
     * النظام الجديد يستخدم array.
     * نعيد array فقط للواجهات القديمة.
     */
    if (
        Array.isArray(
            settings.paymentMethods
        )
    ) {
        return settings.paymentMethods;
    }

    /**
     * توافق مع شكل object قديم.
     */
    if (
        settings.paymentMethods &&
        typeof settings.paymentMethods === "object"
    ) {
        return Object.values(
            settings.paymentMethods
        );
    }

    return [];
}

export async function savePaymentMethods(
    methodsArray
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const methods =
        Array.isArray(
            methodsArray
        )
            ? methodsArray
            : [];

    await setDoc(
        settingsRef,
        {
            paymentMethods:
                methods,

            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return methods;
}

export async function addPaymentMethod(
    method
) {
    const methods =
        await getPaymentMethods();

    const value =
        String(
            method || ""
        ).trim();

    if (
        value &&
        !methods.includes(value)
    ) {
        methods.push(value);

        await savePaymentMethods(
            methods
        );
    }

    return methods;
}

export async function deletePaymentMethod(
    methodIndex
) {
    const methods =
        await getPaymentMethods();

    const index =
        Number(
            methodIndex
        );

    if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < methods.length
    ) {
        methods.splice(
            index,
            1
        );

        await savePaymentMethods(
            methods
        );
    }

    return methods;
}

/**
 * ============================================================================
 * 12. الشروط
 * ============================================================================
 */

export async function getTerms() {
    const settings =
        await getSettings();

    return Array.isArray(
        settings.terms
    )
        ? settings.terms
        : [];
}

export async function saveTerms(
    termsArray
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const terms =
        Array.isArray(
            termsArray
        )
            ? termsArray
            : [];

    await setDoc(
        settingsRef,
        {
            terms,
            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return terms;
}

export async function addTerm(
    termText
) {
    const terms =
        await getTerms();

    const value =
        String(
            termText || ""
        ).trim();

    if (value) {
        terms.push(value);

        await saveTerms(
            terms
        );
    }

    return terms;
}

export async function deleteTerm(
    index
) {
    const terms =
        await getTerms();

    const numericIndex =
        Number(index);

    if (
        Number.isInteger(
            numericIndex
        ) &&
        numericIndex >= 0 &&
        numericIndex < terms.length
    ) {
        terms.splice(
            numericIndex,
            1
        );

        await saveTerms(
            terms
        );
    }

    return terms;
}

/**
 * ============================================================================
 * 13. حالة المتجر
 * ============================================================================
 */

export async function toggleStore(
    overrideStatus = null
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    if (
        typeof overrideStatus ===
        "boolean"
    ) {
        await setDoc(
            settingsRef,
            {
                storeOpen:
                    overrideStatus,

                updatedAt:
                    serverTimestamp()
            },
            {
                merge: true
            }
        );

        return overrideStatus;
    }

    const currentSettings =
        await getSettings();

    const newStatus =
        !Boolean(
            currentSettings.storeOpen
        );

    await setDoc(
        settingsRef,
        {
            storeOpen:
                newStatus,

            updatedAt:
                serverTimestamp()
        },
        {
            merge: true
        }
    );

    return newStatus;
}

/**
 * ============================================================================
 * 14. تحديث المخزون يدوياً
 * ============================================================================
 */

export async function updateStock(
    newPs,
    newPc,
    adminName,
    reason
) {
    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    const psStock =
        Number(newPs);

    const pcStock =
        Number(newPc);

    await updateDoc(
        settingsRef,
        {
            psStock:
                Number.isFinite(
                    psStock
                )
                    ? psStock
                    : 0,

            pcStock:
                Number.isFinite(
                    pcStock
                )
                    ? pcStock
                    : 0,

            lastStockUpdate:
                new Date().toLocaleString(
                    "ar-SA",
                    {
                        timeZone:
                            "Asia/Riyadh"
                    }
                ),

            lastStockUpdateBy:
                adminName ||
                "",

            lastStockUpdateReason:
                reason ||
                "",

            updatedAt:
                serverTimestamp()
        }
    );

    return true;
}
