/**
 * ============================================================================
 * SAMI COINS - SHARED UTILITIES (utils.js)
 * ============================================================================
 *
 * أدوات عامة مشتركة بين:
 * - Admin
 * - Orders
 * - Tracking
 * - Shared system
 *
 * هذا الملف لا يحتوي على:
 * - Firestore operations
 * - Authentication
 * - Encryption / Decryption
 * - DOM-specific logic
 * - Order creation logic
 *
 * الهدف:
 * توفير وظائف صغيرة وآمنة ومتكررة يحتاجها أكثر من جزء في النظام.
 * ============================================================================
 */

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

export const DEFAULT_LOCALE = "ar-SA";

export const DEFAULT_TIME_ZONE = "Asia/Riyadh";

/**
 * ============================================================================
 * Basic value helpers
 * ============================================================================
 */

/**
 * تحويل أي قيمة إلى نص آمن.
 *
 * @param {*} value
 * @returns {string}
 */
export function toSafeString(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

/**
 * التحقق من أن القيمة ليست فارغة.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function hasValue(value) {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === "string") {
        return value.trim().length > 0;
    }

    return true;
}

/**
 * إرجاع القيمة الأولى الموجودة من مجموعة قيم.
 *
 * @param  {...any} values
 * @returns {*}
 */
export function firstDefined(...values) {
    return values.find(
        (value) => value !== undefined && value !== null
    );
}

/**
 * ============================================================================
 * Number helpers
 * ============================================================================
 */

/**
 * تحويل القيمة إلى رقم.
 *
 * يتعامل مع:
 * - الفواصل
 * - النصوص الرقمية
 * - القيم الفارغة
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
export function toNumber(value, fallback = 0) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : fallback;
    }

    if (typeof value === "string") {
        const normalized = value
            .replace(/,/g, "")
            .replace(/\s/g, "")
            .trim();

        if (!normalized) {
            return fallback;
        }

        const number = Number(normalized);

        return Number.isFinite(number) ? number : fallback;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
}

/**
 * التأكد من أن الرقم غير سالب.
 *
 * @param {*} value
 * @returns {number}
 */
export function toNonNegativeNumber(value) {
    return Math.max(0, toNumber(value, 0));
}

/**
 * تقريب رقم إلى عدد محدد من المنازل.
 *
 * @param {*} value
 * @param {number} decimals
 * @returns {number}
 */
export function roundNumber(value, decimals = 2) {
    const number = toNumber(value, 0);

    const factor = 10 ** decimals;

    return Math.round((number + Number.EPSILON) * factor) / factor;
}

/**
 * منع رقم من تجاوز حد معين.
 *
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    const number = toNumber(value, min);

    return Math.min(Math.max(number, min), max);
}

/**
 * ============================================================================
 * Coin / Quantity helpers
 * ============================================================================
 */

/**
 * تحويل كمية الكوينز إلى رقم موحد.
 *
 * أمثلة:
 * 500000
 * "500000"
 * "500,000"
 *
 * @param {*} value
 * @returns {number}
 */
export function normalizeQuantity(value) {
    return Math.max(0, Math.floor(toNumber(value, 0)));
}

/**
 * تنسيق كمية الكوينز للعرض.
 *
 * @param {*} value
 * @returns {string}
 */
export function formatQuantity(value) {
    const quantity = normalizeQuantity(value);

    return new Intl.NumberFormat(DEFAULT_LOCALE).format(quantity);
}

/**
 * حساب المتبقي من الكمية.
 *
 * @param {*} orderedQuantity
 * @param {*} withdrawnQuantity
 * @returns {number}
 */
export function calculateRemainingQuantity(
    orderedQuantity,
    withdrawnQuantity
) {
    const ordered = normalizeQuantity(orderedQuantity);
    const withdrawn = normalizeQuantity(withdrawnQuantity);

    return Math.max(0, ordered - withdrawn);
}

/**
 * حساب نسبة السحب.
 *
 * لا يسمح بأن تتجاوز النسبة 100%.
 *
 * @param {*} orderedQuantity
 * @param {*} withdrawnQuantity
 * @returns {number}
 */
export function calculateWithdrawnPercentage(
    orderedQuantity,
    withdrawnQuantity
) {
    const ordered = normalizeQuantity(orderedQuantity);
    const withdrawn = normalizeQuantity(withdrawnQuantity);

    if (ordered <= 0) {
        return 0;
    }

    return clamp((withdrawn / ordered) * 100, 0, 100);
}

/**
 * ============================================================================
 * Platform helpers
 * ============================================================================
 */

/**
 * توحيد اسم المنصة.
 *
 * PS + PlayStation + Playstation
 * تصبح:
 * "playstation"
 *
 * Xbox
 * تصبح:
 * "xbox"
 *
 * PC
 * تصبح:
 * "pc"
 *
 * @param {*} platform
 * @returns {string}
 */
export function normalizePlatform(platform) {
    const value = toSafeString(platform).toLowerCase();

    if (
        value === "ps" ||
        value === "ps4" ||
        value === "ps5" ||
        value === "playstation" ||
        value === "play station"
    ) {
        return "playstation";
    }

    if (
        value === "xbox" ||
        value === "xboxone" ||
        value === "xbox one" ||
        value === "series x" ||
        value === "series s"
    ) {
        return "xbox";
    }

    if (
        value === "pc" ||
        value === "computer"
    ) {
        return "pc";
    }

    return value;
}

/**
 * تحديد مجموعة المخزون.
 *
 * PlayStation + Xbox = مخزون مشترك
 * PC = مخزون مستقل
 *
 * @param {*} platform
 * @returns {"shared"|"pc"|null}
 */
export function getInventoryGroup(platform) {
    const normalized = normalizePlatform(platform);

    if (
        normalized === "playstation" ||
        normalized === "xbox"
    ) {
        return "shared";
    }

    if (normalized === "pc") {
        return "pc";
    }

    return null;
}

/**
 * ============================================================================
 * Order status helpers
 * ============================================================================
 */

/**
 * الحالات الأساسية للطلبات.
 */
export const ORDER_STATUSES = Object.freeze({
    NEW: "طلب جديد",

    PENDING_REVIEW:
        "طلب بانتظار المراجعة",

    WITHDRAWING:
        "جاري سحب الكوينز من حسابك",

    WITHDRAWN:
        "تم الانتهاء من سحب الكوينز بحسابك",

    TRANSFERRED:
        "تم تحويل المبلغ إلى حسابك",

    COMPLETED:
        "مكتمل"
});

/**
 * حالات المشاكل.
 */
export const ORDER_ISSUE_STATUSES = Object.freeze({
    WRONG_CREDENTIALS:
        "بيانات الدخول غير صحيحة",

    WRONG_BACKUP_CODES:
        "رموز النسخ الاحتياطية غير صحيحة",

    WEB_APP_ISSUE:
        "توجد مشكلة في Web App",

    WRONG_PLATFORM:
        "المنصة المحددة غير صحيحة"
});

/**
 * التحقق من وجود حالة طلب.
 *
 * @param {*} status
 * @returns {boolean}
 */
export function isKnownOrderStatus(status) {
    const value = toSafeString(status);

    return (
        Object.values(ORDER_STATUSES).includes(value) ||
        Object.values(ORDER_ISSUE_STATUSES).includes(value)
    );
}

/**
 * ============================================================================
 * Date / Time helpers
 * ============================================================================
 */

/**
 * تحويل قيمة التاريخ إلى Date.
 *
 * يدعم:
 * - Date
 * - timestamp milliseconds
 * - Firestore Timestamp
 * - ISO string
 *
 * @param {*} value
 * @returns {Date|null}
 */
export function toDate(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? null
            : value;
    }

    if (
        typeof value === "object" &&
        typeof value.toDate === "function"
    ) {
        const date = value.toDate();

        return date instanceof Date &&
            !Number.isNaN(date.getTime())
            ? date
            : null;
    }

    if (
        typeof value === "object" &&
        typeof value.seconds === "number"
    ) {
        const date = new Date(
            value.seconds * 1000 +
            Math.floor((value.nanoseconds || 0) / 1e6)
        );

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    if (
        typeof value === "number" ||
        typeof value === "string"
    ) {
        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    return null;
}

/**
 * تنسيق التاريخ والوقت للمستخدم.
 *
 * @param {*} value
 * @param {object} options
 * @returns {string}
 */
export function formatDateTime(
    value,
    options = {}
) {
    const date = toDate(value);

    if (!date) {
        return "-";
    }

    return new Intl.DateTimeFormat(
        options.locale || DEFAULT_LOCALE,
        {
            timeZone:
                options.timeZone || DEFAULT_TIME_ZONE,

            dateStyle:
                options.dateStyle || "medium",

            timeStyle:
                options.timeStyle || "short"
        }
    ).format(date);
}

/**
 * تنسيق التاريخ فقط.
 *
 * @param {*} value
 * @returns {string}
 */
export function formatDate(value) {
    const date = toDate(value);

    if (!date) {
        return "-";
    }

    return new Intl.DateTimeFormat(
        DEFAULT_LOCALE,
        {
            timeZone: DEFAULT_TIME_ZONE,
            dateStyle: "medium"
        }
    ).format(date);
}

/**
 * ============================================================================
 * Object helpers
 * ============================================================================
 */

/**
 * إزالة القيم undefined من object.
 *
 * لا تحذف null لأنها قد تكون قيمة مقصودة.
 *
 * @param {object} object
 * @returns {object}
 */
export function removeUndefined(object) {
    if (!object || typeof object !== "object") {
        return {};
    }

    return Object.fromEntries(
        Object.entries(object).filter(
            ([, value]) => value !== undefined
        )
    );
}

/**
 * إنشاء نسخة بسيطة من object.
 *
 * مفيدة لمنع التعديل المباشر على البيانات الأصلية.
 *
 * @param {*} value
 * @returns {*}
 */
export function cloneValue(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (
        typeof structuredClone === "function"
    ) {
        try {
            return structuredClone(value);
        } catch {
            // fallback below
        }
    }

    if (typeof value === "object") {
        try {
            return JSON.parse(
                JSON.stringify(value)
            );
        } catch {
            return value;
        }
    }

    return value;
}

/**
 * ============================================================================
 * ID / Reference helpers
 * ============================================================================
 */

/**
 * تنظيف رقم المرجع قبل استخدامه في البحث.
 *
 * @param {*} value
 * @returns {string}
 */
export function normalizeReference(value) {
    return toSafeString(value)
        .toUpperCase()
        .replace(/\s+/g, "");
}

/**
 * التحقق من صيغة رقم الطلب الخارجي.
 *
 * الصيغة:
 * - 8 أحرف
 * - 5 أرقام
 * - 3 حروف إنجليزية
 * - أول وآخر حرف أرقام
 * - I و L غير مسموحين
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isValidReference(value) {
    const reference = normalizeReference(value);

    if (!/^[0-9A-HJ-KM-NOPQRSTUVWXYZ]{8}$/.test(reference)) {
        return false;
    }

    const letters = reference.match(/[A-HJ-KM-NOPQRSTUVWXYZ]/g) || [];

    if (letters.length !== 3) {
        return false;
    }

    if (!/^\d/.test(reference)) {
        return false;
    }

    if (!/\d$/.test(reference)) {
        return false;
    }

    return true;
}

/**
 * ============================================================================
 * Security / sensitive data helpers
 * ============================================================================
 */

/**
 * الحقول الحساسة المعتمدة في النظام.
 *
 * مهم:
 * هذا مجرد تعريف للحقول المستخدمة في الواجهة.
 * لا يقوم بالتشفير.
 *
 * التشفير الفعلي يتم Server-Side.
 */
export const SENSITIVE_FIELDS = Object.freeze([
    "eaEmail",
    "eaPassword",
    "backupCodes",

    "bankFullName",
    "bankIban",

    "walletMobile",

    "usdtWalletAddress",

    "paypalEmail",

    "westernUnionName",
    "westernUnionCountry"
]);

/**
 * التحقق من أن الحقل حساس.
 *
 * @param {*} field
 * @returns {boolean}
 */
export function isSensitiveField(field) {
    return SENSITIVE_FIELDS.includes(
        toSafeString(field)
    );
}

/**
 * ============================================================================
 * Error helpers
 * ============================================================================
 */

/**
 * استخراج رسالة خطأ آمنة للعرض للمستخدم.
 *
 * لا تعرض stack trace أو تفاصيل داخلية.
 *
 * @param {*} error
 * @param {string} fallback
 * @returns {string}
 */
export function getSafeErrorMessage(
    error,
    fallback = "حدث خطأ غير متوقع"
) {
    if (!error) {
        return fallback;
    }

    if (
        typeof error === "object" &&
        typeof error.userMessage === "string" &&
        error.userMessage.trim()
    ) {
        return error.userMessage.trim();
    }

    if (
        typeof error === "object" &&
        typeof error.message === "string"
    ) {
        const message = error.message.trim();

        if (message) {
            return message;
        }
    }

    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }

    return fallback;
}

/**
 * ============================================================================
 * Async helpers
 * ============================================================================
 */

/**
 * تأخير التنفيذ لمدة محددة.
 *
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
export function sleep(milliseconds) {
    const duration = Math.max(
        0,
        toNumber(milliseconds, 0)
    );

    return new Promise((resolve) => {
        setTimeout(resolve, duration);
    });
}

/**
 * تنفيذ Promise مع مهلة زمنية.
 *
 * @param {Promise} promise
 * @param {number} timeout
 * @returns {Promise}
 */
export function withTimeout(
    promise,
    timeout = 10000
) {
    const duration = Math.max(
        1,
        toNumber(timeout, 10000)
    );

    return Promise.race([
        promise,

        new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error(
                    "انتهت مهلة العملية"
                );

                error.code = "TIMEOUT";

                reject(error);
            }, duration);
        })
    ]);
}

/**
 * ============================================================================
 * Export default
 * ============================================================================
 */

export default {
    DEFAULT_LOCALE,
    DEFAULT_TIME_ZONE,

    toSafeString,
    hasValue,
    firstDefined,

    toNumber,
    toNonNegativeNumber,
    roundNumber,
    clamp,

    normalizeQuantity,
    formatQuantity,
    calculateRemainingQuantity,
    calculateWithdrawnPercentage,

    normalizePlatform,
    getInventoryGroup,

    ORDER_STATUSES,
    ORDER_ISSUE_STATUSES,
    isKnownOrderStatus,

    toDate,
    formatDateTime,
    formatDate,

    removeUndefined,
    cloneValue,

    normalizeReference,
    isValidReference,

    SENSITIVE_FIELDS,
    isSensitiveField,

    getSafeErrorMessage,

    sleep,
    withTimeout
};
