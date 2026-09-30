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
 * - إنشاء أرقام الطلبات الجديدة Server-Side فقط.
 * - server/services/orderNumber.js هو المصدر الرسمي للترقيم.
 * - لا تستخدم createOrderId() لإنشاء طلب جديد.
 * - المخزون الحقيقي يحسب من الطلبات:
 *
 *     إجمالي الكمية المطلوبة - إجمالي الكمية المسحوبة
 *
 * - PlayStation + Xbox مخزون مشترك.
 * - PC مخزون مستقل.
 *
 * هذا الملف لا يتعامل مباشرة مع DOM.
 * ============================================================================
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    onSnapshot,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

import { db } from "./firebase.js";

/**
 * ============================================================================
 * Firestore paths
 * ============================================================================
 */

const SETTINGS_DOC_PATH =
    "system/settings";

const COUNTER_DOC_PATH =
    "system/counter";

const ORDERS_COLLECTION =
    "orders";

/**
 * ============================================================================
 * Issue messages
 * ============================================================================
 */

export const defaultIssueMessages = {
    wrong_credentials:
        "الإيميل أو الباسورد غير صحيح",

    wrong_backup_codes:
        "الأكواد الاحتياطية غير صحيحة",

    logged_in_platform:
        "تم تسجيل الدخول عبر المنصة يرجى تسجيل الخروج",

    market_closed:
        "سوق الانتقالات مغلق",

    wrong_platform:
        "المنصة غير صحيحة",

    other_issue:
        "مشاكل أخرى"
};

/**
 * ============================================================================
 * Default settings
 * ============================================================================
 */

export const defaultSettings = {
    /**
     * ------------------------------------------------------------------------
     * Store identity
     * ------------------------------------------------------------------------
     */

    storeName:
        "SAMI COINS",

    arabicStoreName:
        "سامي كوينز",

    gameName:
        "FC",

    gameVersion:
        27,

    storeLogo:
        "",

    supportWhatsapp:
        "966570770465",

    supportEmail:
        "support@samicoins.com",

    siteUrl:
        "https://samicoins.com",

    /**
     * ------------------------------------------------------------------------
     * Announcement
     * ------------------------------------------------------------------------
     */

    announcementActive:
        true,

    announcementText:
        "",

    announcementBgColor:
        "#00ff87",

    announcementTextColor:
        "#060913",

    /**
     * ------------------------------------------------------------------------
     * PlayStation / Xbox
     * ------------------------------------------------------------------------
     *
     * PlayStation + Xbox share the same inventory pool.
     */

    psRate:
        200,

    psMin:
        100000,

    psMax:
        5000000,

    psWithdrawDuration:
        "3 - 5 أيام عمل",

    psTransferDuration:
        "24 ساعة",

    /*
     * Legacy/manual value kept only for compatibility.
     *
     * It is NOT the source of truth for inventory.
     */
    psStock:
        0,

    /**
     * ------------------------------------------------------------------------
     * PC
     * ------------------------------------------------------------------------
     */

    pcRate:
        150,

    pcMin:
        100000,

    pcMax:
        1000000,

    pcWithdrawDuration:
        "2 - 4 أيام عمل",

    pcTransferDuration:
        "24 ساعة",

    /*
     * Legacy/manual value kept only for compatibility.
     *
     * It is NOT the source of truth for inventory.
     */
    pcStock:
        0,

    /**
     * ------------------------------------------------------------------------
     * Offers / store state
     * ------------------------------------------------------------------------
     */

    offers:
        false,

    offerText:
        "",

    promoRate:
        220,

    promoExpiry:
        "",

    storeOpen:
        true,

    /**
     * ------------------------------------------------------------------------
     * Banks
     * ------------------------------------------------------------------------
     */

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

    /**
     * ------------------------------------------------------------------------
     * Wallets
     * ------------------------------------------------------------------------
     */

    wallets: [
        "STC Pay",
        "Barq",
        "URPay",
        "Mobily Pay",
        "Tiqmo",
        "Alinma Pay"
    ],

    /**
     * ------------------------------------------------------------------------
     * Payment methods
     * ------------------------------------------------------------------------
     */

    paymentCategories: {
            local: ["bank_transfer", "digital_wallet"],
            international: ["usdt", "paypal", "western_union"]
        },

        paymentMethods: [
        "تحويل بنكي",
        "المحافظ الرقمية",
        "USDT",
        "PayPal",
        "Western Union"
    ],

    paymentCatalogVersion:
        2,

    /**
     * ------------------------------------------------------------------------
     * Terms
     * ------------------------------------------------------------------------
     */

    termsEnabled:
        true,

    terms: [
        "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
        "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
        "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
    ],

    /**
     * ------------------------------------------------------------------------
     * Issue messages
     * ------------------------------------------------------------------------
     */

    issueMessages: {
        ...defaultIssueMessages
    }
};

/**
 * ============================================================================
 * Generic helpers
 * ============================================================================
 */

function cleanString(
    value,
    fallback = ""
) {
    const text =
        String(
            value ?? ""
        ).trim();

    return text || fallback;
}

function normalizeStringArray(
    value
) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) =>
            String(
                item ?? ""
            ).trim()
        )
        .filter(Boolean);
}

function normalizeIssueMessages(
    value
) {
    const normalized = {
        ...defaultIssueMessages
    };

    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return normalized;
    }

    for (
        const [key, message]
        of Object.entries(value)
    ) {
        if (
            !Object.prototype.hasOwnProperty.call(
                defaultIssueMessages,
                key
            )
        ) {
            continue;
        }

        if (
            typeof message !== "string" ||
            !message.trim()
        ) {
            continue;
        }

        normalized[key] =
            message.trim();
    }

    return normalized;
}

/**
 * ============================================================================
 * Platform normalization
 * ============================================================================
 *
 * PlayStation + Xbox = shared inventory.
 * PC = separate inventory.
 */

function normalizePlatform(
    platform
) {
    const value =
        String(
            platform ?? ""
        )
            .trim()
            .toLowerCase();

    if (
        value === "pc"
    ) {
        return "PC";
    }

    if (
        value === "xbox" ||
        value === "xb" ||
        value.includes("xbox")
    ) {
        return "XBOX";
    }

    if (
        value === "playstation" ||
        value === "ps" ||
        value === "ps4" ||
        value === "ps5" ||
        value.includes("playstation")
    ) {
        return "PLAYSTATION";
    }

    return "";
}

/**
 * ============================================================================
 * Quantity normalization
 * ============================================================================
 */

function normalizeQuantity(
    value
) {
    const numeric =
        Number(
            value
        );

    if (
        !Number.isFinite(
            numeric
        ) ||
        numeric < 0
    ) {
        return 0;
    }

    return numeric;
}

/**
 * ============================================================================
 * Withdrawn quantity compatibility
 * ============================================================================
 *
 * New field:
 *   withdrawnQuantity
 *
 * Legacy field:
 *   drawnCoins
 */

function getWithdrawnQuantity(
    order
) {
    if (
        order &&
        Object.prototype.hasOwnProperty.call(
            order,
            "withdrawnQuantity"
        )
    ) {
        return normalizeQuantity(
            order.withdrawnQuantity
        );
    }

    return normalizeQuantity(
        order?.drawnCoins
    );
}

/**
 * ============================================================================
 * Ordered quantity compatibility
 * ============================================================================
 *
 * Supports the common quantity fields already used by the project.
 */

function getOrderedQuantity(
    order
) {
    if (
        order &&
        Object.prototype.hasOwnProperty.call(
            order,
            "quantity"
        )
    ) {
        return normalizeQuantity(
            order.quantity
        );
    }

    if (
        order &&
        Object.prototype.hasOwnProperty.call(
            order,
            "coinQuantity"
        )
    ) {
        return normalizeQuantity(
            order.coinQuantity
        );
    }

    if (
        order &&
        Object.prototype.hasOwnProperty.call(
            order,
            "coins"
        )
    ) {
        return normalizeQuantity(
            order.coins
        );
    }

    if (
        order &&
        Object.prototype.hasOwnProperty.call(
            order,
            "amount"
        )
    ) {
        return normalizeQuantity(
            order.amount
        );
    }

    return 0;
}

/**
 * ============================================================================
 * Normalize settings
 * ============================================================================
 */

function normalizeSettings(
    data = {}
) {
    const raw =
        data &&
        typeof data === "object" &&
        !Array.isArray(data)
            ? data
            : {};

    return {
        ...defaultSettings,
        ...raw,

        banks:
            Array.isArray(
                raw.banks
            )
                ? normalizeStringArray(
                      raw.banks
                  )
                : [
                      ...defaultSettings.banks
                  ],

        wallets:
            Array.isArray(
                raw.wallets
            )
                ? normalizeStringArray(
                      raw.wallets
                  )
                : [
                      ...defaultSettings.wallets
                  ],

        paymentMethods:
            Array.isArray(
                raw.paymentMethods
            )
                ? normalizeStringArray(
                      raw.paymentMethods
                  )
                : normalizeStringArray(
                      raw.paymentMethods &&
                          typeof raw.paymentMethods ===
                              "object"
                          ? Object.values(
                                raw.paymentMethods
                            )
                          : defaultSettings.paymentMethods
                  ),

        terms:
            Array.isArray(
                raw.terms
            )
                ? normalizeStringArray(
                      raw.terms
                  )
                : [
                      ...defaultSettings.terms
                  ],

        issueMessages:
            normalizeIssueMessages(
                raw.issueMessages
            )
    };
}

/**
 * ============================================================================
 * 1. Settings realtime subscription
 * ============================================================================
 */

export function subscribeToSettings(
    callback
) {
    if (
        typeof callback !==
        "function"
    ) {
        throw new TypeError(
            "subscribeToSettings callback must be a function."
        );
    }

    const settingsRef =
        doc(
            db,
            SETTINGS_DOC_PATH
        );

    return onSnapshot(
        settingsRef,
        (snap) => {
            if (snap.exists()) {
                callback(
                    normalizeSettings(
                        snap.data() || {}
                    )
                );

                return;
            }

            getSettings()
                .then(
                    (settings) =>
                        callback(
                            settings
                        )
                )
                .catch(
                    (error) => {
                        console.error(
                            "Failed to initialize settings:",
                            error?.code ||
                                error?.message ||
                                error
                        );

                        callback(
                            normalizeSettings(
                                defaultSettings
                            )
                        );
                    }
                );
        },
        (error) => {
            console.error(
                "Settings realtime listener error:",
                error?.code ||
                    error?.message ||
                    error
            );

            callback(
                normalizeSettings(
                    defaultSettings
                )
            );
        }
    );
}

/**
 * ============================================================================
 * 2. Riyadh daily date
 * ============================================================================
 *
 * تستخدم فقط للتوافق مع النظام القديم.
 *
 * الترقيم الرسمي الجديد موجود في:
 *   server/services/orderNumber.js
 */

function getRiyadhDateKey() {
    const formatter =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:
                    "Asia/Riyadh",

                year:
                    "numeric",

                month:
                    "2-digit",

                day:
                    "2-digit"
            }
        );

    return formatter.format(
        new Date()
    );
}

/**
 * Legacy alias.
 */

function getMakkahDateKey() {
    return getRiyadhDateKey();
}

/**
 * ============================================================================
 * 3. Legacy daily codes
 * ============================================================================
 *
 * WARNING:
 *
 * هذه ليست مصدر الترقيم الجديد.
 *
 * المصدر الرسمي:
 *   server/services/orderNumber.js
 *
 * أبقيناها فقط حتى لا ينكسر أي كود قديم يعتمد عليها.
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
            ? settingsSnap.data() || {}
            : {};

    const dailyCodesObj =
        settingsData.dailyCodes &&
        typeof settingsData.dailyCodes ===
            "object"
            ? settingsData.dailyCodes
            : {};

    const todayKey =
        getRiyadhDateKey();

    if (
        dailyCodesObj.dateKey ===
            todayKey &&
        Array.isArray(
            dailyCodesObj.codes
        ) &&
        dailyCodesObj.codes.length >=
            4
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
                dateKey:
                    todayKey,

                codes:
                    newDailyCodes
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
 * 4. Legacy client-side order ID
 * ============================================================================
 *
 * DO NOT USE FOR NEW ORDERS.
 *
 * الطلبات الجديدة يجب أن تستخدم:
 *
 *   server/services/orderNumber.js
 *
 * الموجود هنا فقط لمنع كسر أي كود قديم.
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
 * Legacy only.
 */

export async function createOrderId(
    platform
) {
    console.warn(
        "createOrderId() is legacy only. New orders must use server/services/orderNumber.js."
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

                let lastSerial =
                    0;

                let dateKey =
                    "";

                if (
                    snap.exists()
                ) {
                    const data =
                        snap.data() ||
                        {};

                    lastSerial =
                        Number(
                            data.lastSerial ||
                                0
                        );

                    dateKey =
                        String(
                            data.dateKey ||
                                ""
                        );
                }

                if (
                    dateKey !==
                    todayKey
                ) {
                    lastSerial =
                        0;
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

    const platformCode =
        String(
            platform || ""
        )
            .trim()
            .toUpperCase();

    let platCode =
        "PS";

    if (
        platformCode ===
            "XBOX" ||
        platformCode ===
            "XB"
    ) {
        platCode =
            "XB";
    } else if (
        platformCode ===
        "PC"
    ) {
        platCode =
            "PC";
    }

    return (
        `SQ${letters}` +
        `${code}` +
        `${platCode}` +
        `${String(
            serial
        ).padStart(3, "0")}`
    );
}

/**
 * ============================================================================
 * 5. Get settings
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
        const initialSettings =
            normalizeSettings(
                defaultSettings
            );

        await setDoc(
            settingsRef,
            initialSettings,
            {
                merge: true
            }
        );

        return initialSettings;
    }

    const rawSettings =
        settingsSnap.data() || {};

    /**
     * ------------------------------------------------------------------------
     * Payment catalog migration
     * ------------------------------------------------------------------------
     */

    if (
        Number(
            rawSettings.paymentCatalogVersion
        ) !== 2
    ) {
        const migratedSettings = {
            ...rawSettings,

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

            paymentCatalogVersion:
                2,

            termsEnabled:
                typeof rawSettings.termsEnabled ===
                "boolean"
                    ? rawSettings.termsEnabled
                    : true,

            updatedAt:
                serverTimestamp()
        };

        await setDoc(
            settingsRef,
            migratedSettings,
            {
                merge: true
            }
        );

        return normalizeSettings(
            migratedSettings
        );
    }

    return normalizeSettings(
        rawSettings
    );
}

/**
 * ============================================================================
 * 6. Inventory calculation
 * ============================================================================
 *
 * SOURCE OF TRUTH:
 *
 *     inventory =
 *         total ordered quantity
 *         -
 *         total withdrawn quantity
 *
 * Platform groups:
 *
 *     PLAYSTATION + XBOX => shared inventory
 *     PC                => separate inventory
 *
 * No manual stock deduction is performed here.
 */

export async function calculateInventory() {
    const ordersSnapshot =
        await getDocs(
            collection(
                db,
                ORDERS_COLLECTION
            )
        );

    let orderedShared =
        0;

    let withdrawnShared =
        0;

    let orderedPc =
        0;

    let withdrawnPc =
        0;

    ordersSnapshot.forEach(
        (orderDoc) => {
            const order =
                orderDoc.data() ||
                {};

            const platform =
                normalizePlatform(
                    order.platform
                );

            const ordered =
                getOrderedQuantity(
                    order
                );

            const withdrawn =
                Math.min(
                    getWithdrawnQuantity(
                        order
                    ),
                    ordered
                );

            if (
                platform === "PC"
            ) {
                orderedPc +=
                    ordered;

                withdrawnPc +=
                    withdrawn;

                return;
            }

            if (
                platform ===
                    "PLAYSTATION" ||
                platform ===
                    "XBOX"
            ) {
                orderedShared +=
                    ordered;

                withdrawnShared +=
                    withdrawn;
            }
        }
    );

    const sharedRemaining =
        Math.max(
            0,
            orderedShared -
                withdrawnShared
        );

    const pcRemaining =
        Math.max(
            0,
            orderedPc -
                withdrawnPc
        );

    return {
        shared: {
            ordered:
                orderedShared,

            withdrawn:
                withdrawnShared,

            remaining:
                sharedRemaining
        },

        playstation: {
            ordered:
                orderedShared,

            withdrawn:
                withdrawnShared,

            remaining:
                sharedRemaining
        },

        xbox: {
            ordered:
                orderedShared,

            withdrawn:
                withdrawnShared,

            remaining:
                sharedRemaining
        },

        pc: {
            ordered:
                orderedPc,

            withdrawn:
                withdrawnPc,

            remaining:
                pcRemaining
        },

        total: {
            ordered:
                orderedShared +
                orderedPc,

            withdrawn:
                withdrawnShared +
                withdrawnPc,

            remaining:
                sharedRemaining +
                pcRemaining
        }
    };
}

/**
 * ============================================================================
 * Inventory realtime subscription
 * ============================================================================
 *
 * Orders are the source of truth, therefore inventory is recalculated
 * whenever an order is added, changed, or removed.
 */

export function subscribeToInventory(
    callback
) {
    if (
        typeof callback !==
        "function"
    ) {
        throw new TypeError(
            "subscribeToInventory callback must be a function."
        );
    }

    const ordersRef =
        collection(
            db,
            ORDERS_COLLECTION
        );

    return onSnapshot(
        ordersRef,
        (snapshot) => {
            let orderedShared =
                0;

            let withdrawnShared =
                0;

            let orderedPc =
                0;

            let withdrawnPc =
                0;

            snapshot.forEach(
                (orderDoc) => {
                    const order =
                        orderDoc.data() ||
                        {};

                    const platform =
                        normalizePlatform(
                            order.platform
                        );

                    const ordered =
                        getOrderedQuantity(
                            order
                        );

                    const withdrawn =
                        Math.min(
                            getWithdrawnQuantity(
                                order
                            ),
                            ordered
                        );

                    if (
                        platform === "PC"
                    ) {
                        orderedPc +=
                            ordered;

                        withdrawnPc +=
                            withdrawn;

                        return;
                    }

                    if (
                        platform ===
                            "PLAYSTATION" ||
                        platform ===
                            "XBOX"
                    ) {
                        orderedShared +=
                            ordered;

                        withdrawnShared +=
                            withdrawn;
                    }
                }
            );

            const sharedRemaining =
                Math.max(
                    0,
                    orderedShared -
                        withdrawnShared
                );

            const pcRemaining =
                Math.max(
                    0,
                    orderedPc -
                        withdrawnPc
                );

            callback({
                shared: {
                    ordered:
                        orderedShared,

                    withdrawn:
                        withdrawnShared,

                    remaining:
                        sharedRemaining
                },

                playstation: {
                    ordered:
                        orderedShared,

                    withdrawn:
                        withdrawnShared,

                    remaining:
                        sharedRemaining
                },

                xbox: {
                    ordered:
                        orderedShared,

                    withdrawn:
                        withdrawnShared,

                    remaining:
                        sharedRemaining
                },

                pc: {
                    ordered:
                        orderedPc,

                    withdrawn:
                        withdrawnPc,

                    remaining:
                        pcRemaining
                },

                total: {
                    ordered:
                        orderedShared +
                        orderedPc,

                    withdrawn:
                        withdrawnShared +
                        withdrawnPc,

                    remaining:
                        sharedRemaining +
                        pcRemaining
                }
            });
        },
        (error) => {
            console.error(
                "Inventory realtime listener error:",
                error?.code ||
                    error?.message ||
                    error
            );

            callback({
                shared: {
                    ordered: 0,
                    withdrawn: 0,
                    remaining: 0
                },

                playstation: {
                    ordered: 0,
                    withdrawn: 0,
                    remaining: 0
                },

                xbox: {
                    ordered: 0,
                    withdrawn: 0,
                    remaining: 0
                },

                pc: {
                    ordered: 0,
                    withdrawn: 0,
                    remaining: 0
                },

                total: {
                    ordered: 0,
                    withdrawn: 0,
                    remaining: 0
                }
            });
        }
    );
}

/**
 * ============================================================================
 * 7. Save pricing / general store settings
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

    const current =
        await getSettings();

    const payload = {
        storeName:
            cleanString(
                pricingData.storeName,
                current.storeName
            ),

        arabicStoreName:
            cleanString(
                pricingData.arabicStoreName,
                current.arabicStoreName
            ),

        gameName:
            cleanString(
                pricingData.gameName,
                current.gameName
            ),

        gameVersion:
            Number.isInteger(
                Number(pricingData.gameVersion)
            ) && Number(pricingData.gameVersion) > 0
                ? Number(pricingData.gameVersion)
                : current.gameVersion,

        usdSarRate:
            Number.isFinite(Number(pricingData.usdSarRate)) &&
            Number(pricingData.usdSarRate) > 0
                ? Number(pricingData.usdSarRate)
                : current.usdSarRate,

        paymentCategories:
            pricingData.paymentCategories &&
            typeof pricingData.paymentCategories === "object"
                ? pricingData.paymentCategories
                : current.paymentCategories,

        storeLogo:
            cleanString(
                pricingData.storeLogo,
                current.storeLogo
            ),

        supportWhatsapp:
            cleanString(
                pricingData.supportWhatsapp,
                current.supportWhatsapp
            ),

        supportEmail:
            cleanString(
                pricingData.supportEmail,
                current.supportEmail
            ),

        siteUrl:
            cleanString(
                pricingData.siteUrl,
                current.siteUrl
            ),

        announcementActive:
            Boolean(
                pricingData.announcementActive
            ),

        announcementText:
            cleanString(
                pricingData.announcementText,
                ""
            ),

        announcementBgColor:
            cleanString(
                pricingData.announcementBgColor,
                "#00ff87"
            ),

        announcementTextColor:
            cleanString(
                pricingData.announcementTextColor,
                "#060913"
            ),

        psRate:
            Number.isFinite(
                Number(
                    pricingData.psRate
                )
            )
                ? Number(
                      pricingData.psRate
                  )
                : current.psRate,

        psMin:
            Number.isFinite(
                Number(
                    pricingData.psMin
                )
            )
                ? Number(
                      pricingData.psMin
                  )
                : current.psMin,

        psMax:
            Number.isFinite(
                Number(
                    pricingData.psMax
                )
            )
                ? Number(
                      pricingData.psMax
                  )
                : current.psMax,

        psWithdrawDuration:
            cleanString(
                pricingData.psWithdrawDuration,
                current.psWithdrawDuration
            ),

        psTransferDuration:
            cleanString(
                pricingData.psTransferDuration,
                current.psTransferDuration
            ),

        /*
         * Legacy field only.
         * Real inventory comes from orders.
         */
        psStock:
            Number.isFinite(
                Number(
                    pricingData.psStock
                )
            )
                ? Number(
                      pricingData.psStock
                  )
                : current.psStock,

        pcRate:
            Number.isFinite(
                Number(
                    pricingData.pcRate
                )
            )
                ? Number(
                      pricingData.pcRate
                  )
                : current.pcRate,

        pcMin:
            Number.isFinite(
                Number(
                    pricingData.pcMin
                )
            )
                ? Number(
                      pricingData.pcMin
                  )
                : current.pcMin,

        pcMax:
            Number.isFinite(
                Number(
                    pricingData.pcMax
                )
            )
                ? Number(
                      pricingData.pcMax
                  )
                : current.pcMax,

        pcWithdrawDuration:
            cleanString(
                pricingData.pcWithdrawDuration,
                current.pcWithdrawDuration
            ),

        pcTransferDuration:
            cleanString(
                pricingData.pcTransferDuration,
                current.pcTransferDuration
            ),

        /*
         * Legacy field only.
         * Real inventory comes from orders.
         */
        pcStock:
            Number.isFinite(
                Number(
                    pricingData.pcStock
                )
            )
                ? Number(
                      pricingData.pcStock
                  )
                : current.pcStock,

        offers:
            Boolean(
                pricingData.offers
            ),

        offerText:
            cleanString(
                pricingData.offerText,
                ""
            ),

        promoRate:
            Number.isFinite(
                Number(
                    pricingData.promoRate
                )
            )
                ? Number(
                      pricingData.promoRate
                  )
                : current.promoRate,

        promoExpiry:
            cleanString(
                pricingData.promoExpiry,
                ""
            ),

        storeOpen:
            typeof pricingData.storeOpen ===
            "boolean"
                ? pricingData.storeOpen
                : Boolean(
                      current.storeOpen
                  ),

        issueMessages:
            normalizeIssueMessages(
                pricingData.issueMessages ??
                    current.issueMessages
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
 * 8. Issue messages
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
    const code =
        cleanString(
            issueCode
        );

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
        cleanString(
            message
        );

    if (!cleanMessage) {
        throw new Error(
            "Issue message cannot be empty."
        );
    }

    const current =
        await getIssueMessages();

    current[code] =
        cleanMessage;

    return saveIssueMessages(
        current
    );
}

/**
 * ============================================================================
 * 9. Withdrawn quantity update
 * ============================================================================
 *
 * IMPORTANT:
 *
 * This function does NOT directly deduct psStock/pcStock.
 *
 * Inventory is calculated from:
 *
 *     ordered quantity - withdrawn quantity
 *
 * Therefore changing withdrawnQuantity automatically changes
 * the calculated inventory and any realtime inventory listener.
 *
 * Status changes remain manual and are NOT changed here.
 */

export async function updateWithdrawnQuantity(
    orderId,
    withdrawnAmount
) {
    const cleanOrderId =
        cleanString(
            orderId
        );

    if (!cleanOrderId) {
        throw new Error(
            "Order ID is required."
        );
    }

    const numericAmount =
        Number(
            withdrawnAmount
        );

    if (
        !Number.isFinite(
            numericAmount
        ) ||
        numericAmount < 0
    ) {
        throw new Error(
            "Withdrawn quantity must be a valid non-negative number."
        );
    }

    const orderRef =
        doc(
            db,
            ORDERS_COLLECTION,
            cleanOrderId
        );

    const orderSnap =
        await getDoc(
            orderRef
        );

    if (
        !orderSnap.exists()
    ) {
        throw new Error(
            "Order not found."
        );
    }

    const order =
        orderSnap.data() ||
        {};

    const orderedQuantity =
        getOrderedQuantity(
            order
        );

    if (
        numericAmount >
        orderedQuantity
    ) {
        throw new Error(
            "Withdrawn quantity cannot exceed ordered quantity."
        );
    }

    await updateDoc(
        orderRef,
        {
            withdrawnQuantity:
                numericAmount,

            /*
             * Legacy compatibility.
             *
             * Existing UI/code that still reads drawnCoins
             * will continue to receive the current value.
             */
            drawnCoins:
                numericAmount,

            remainingQuantity:
                Math.max(
                    0,
                    orderedQuantity -
                        numericAmount
                ),

            updatedAt:
                serverTimestamp(),

            withdrawnUpdatedAt:
                serverTimestamp()
        }
    );

    return {
        withdrawnQuantity:
            numericAmount,

        remainingQuantity:
            Math.max(
                0,
                orderedQuantity -
                    numericAmount
            )
    };
}

/**
 * ============================================================================
 * 10. Legacy withdrawn stock deduction
 * ============================================================================
 *
 * Kept for compatibility with old callers.
 *
 * IMPORTANT:
 * It no longer subtracts a fixed amount from settings.psStock/pcStock.
 * It updates the order's withdrawn quantity instead.
 */

export async function processWithdrawnStockDeduction(
    orderId,
    platform,
    withdrawnAmount
) {
    try {
        const cleanOrderId =
            cleanString(
                orderId
            );

        if (!cleanOrderId) {
            return false;
        }

        await updateWithdrawnQuantity(
            cleanOrderId,
            withdrawnAmount
        );

        return true;
    } catch (error) {
        console.error(
            "Error processing withdrawn quantity:",
            error?.code ||
                error?.message ||
                error
        );

        throw error;
    }
}

/**
 * ============================================================================
 * 11. Banks
 * ============================================================================
 */

export async function getBanks() {
    const settings =
        await getSettings();

    return Array.isArray(
        settings.banks
    )
        ? [
              ...settings.banks
          ]
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
        normalizeStringArray(
            banksArray
        );

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
        cleanString(
            newBank
        );

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
 * 12. Wallets
 * ============================================================================
 */

export async function getWallets() {
    const settings =
        await getSettings();

    return Array.isArray(
        settings.wallets
    )
        ? [
              ...settings.wallets
          ]
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
        normalizeStringArray(
            walletsArray
        );

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
        cleanString(
            newWallet
        );

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
 * 13. Payment methods
 * ============================================================================
 */

export async function getPaymentMethods() {
    const settings =
        await getSettings();

    if (
        Array.isArray(
            settings.paymentMethods
        )
    ) {
        return [
            ...settings.paymentMethods
        ];
    }

    if (
        settings.paymentMethods &&
        typeof settings.paymentMethods ===
            "object"
    ) {
        return normalizeStringArray(
            Object.values(
                settings.paymentMethods
            )
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
        normalizeStringArray(
            methodsArray
        );

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
        cleanString(
            method
        );

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
 * 14. Terms
 * ============================================================================
 */

export async function getTerms() {
    const settings =
        await getSettings();

    return Array.isArray(
        settings.terms
    )
        ? [
              ...settings.terms
          ]
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
        normalizeStringArray(
            termsArray
        );

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
        cleanString(
            termText
        );

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
 * 15. Store state
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
 * 16. Manual stock compatibility
 * ============================================================================
 *
 * Deprecated:
 * inventory is now calculated from orders.
 *
 * Kept only so old UI code does not crash if it still calls updateStock().
 *
 * The values are stored as legacy settings values but are NOT used by
 * calculateInventory() or subscribeToInventory().
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

    const parsedPs =
        Number(newPs);

    const parsedPc =
        Number(newPc);

    const psStock =
        Number.isFinite(
            parsedPs
        )
            ? Math.max(
                  0,
                  parsedPs
              )
            : 0;

    const pcStock =
        Number.isFinite(
            parsedPc
        )
            ? Math.max(
                  0,
                  parsedPc
              )
            : 0;

    await updateDoc(
        settingsRef,
        {
            /*
             * Legacy compatibility only.
             */
            psStock,

            pcStock,

            lastStockUpdate:
                new Date().toLocaleString(
                    "ar-SA",
                    {
                        timeZone:
                            "Asia/Riyadh"
                    }
                ),

            lastStockUpdateBy:
                cleanString(
                    adminName
                ),

            lastStockUpdateReason:
                cleanString(
                    reason
                ),

            updatedAt:
                serverTimestamp()
        }
    );

    return true;
}

/**
 * ============================================================================
 * Legacy export
 * ============================================================================
 */

export {
    normalizeIssueMessages
};
