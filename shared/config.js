/**
 * ============================================================================
 * SAMI COINS - SHARED CONFIGURATION
 * ============================================================================
 *
 * هذا الملف يحتوي على الإعدادات والثوابت المشتركة بين صفحات النظام.
 *
 * لا يتم وضع أي أسرار هنا.
 *
 * ممنوع وضع:
 * - ENCRYPTION_KEY
 * - Service Account credentials
 * - Firebase Admin private key
 * - كلمات مرور
 * - بيانات حساسة للعملاء
 *
 * هذه الأشياء تبقى Server-Side فقط.
 * ============================================================================
 */

/**
 * ============================================================================
 * Application
 * ============================================================================
 */

export const APP_CONFIG = Object.freeze({
    name: "SAMI COINS",

    version: "2.6",

    environment:
        typeof window !== "undefined"
            ? "client"
            : "server",

    timeZone: "Asia/Riyadh",

    locale: "ar-SA",

    currency: "SAR"
});


/**
 * ============================================================================
 * API
 * ============================================================================
 *
 * النظام يعمل من نفس الدومين في الوضع الطبيعي.
 *
 * لذلك لا نثبت دومين VPS أو localhost داخل الملفات.
 * هذا يمنع مشاكل الانتقال بين:
 *
 * - Local
 * - Staging
 * - Production
 *
 * ويمكن لاحقًا تحديد API_BASE_URL من إعدادات البيئة إذا احتجنا ذلك.
 */

export const API_CONFIG = Object.freeze({
    baseUrl: "",

    endpoints: Object.freeze({
        orders: "/api/orders",

        tracking: "/api/tracking",

        admin: "/api/admin",

        auth: "/api/auth",

        settings: "/api/settings"
    }),

    timeout: 15000
});


/**
 * ============================================================================
 * Firestore Collections
 * ============================================================================
 *
 * أسماء الـ collections المستخدمة في النظام.
 *
 * لا نضع بيانات حساسة هنا.
 */

export const FIRESTORE_COLLECTIONS = Object.freeze({
    orders: "orders",

    admins: "admins",

    settings: "system",

    orderReferences: "orderReferences",

    reviews: "reviews",

    archive: "archive"
});


/**
 * ============================================================================
 * System Documents
 * ============================================================================
 */

export const SYSTEM_DOCUMENTS = Object.freeze({
    settings: "settings",

    orderNumbering: "orderNumbering"
});


/**
 * ============================================================================
 * Platform Configuration
 * ============================================================================
 *
 * PlayStation + Xbox:
 * مخزون مشترك.
 *
 * PC:
 * مخزون مستقل.
 */

export const PLATFORMS = Object.freeze({
    PLAYSTATION: "playstation",

    XBOX: "xbox",

    PC: "pc"
});


export const INVENTORY_GROUPS = Object.freeze({
    SHARED: "shared",

    PC: "pc"
});


/**
 * ربط المنصات بمجموعات المخزون.
 */

export const PLATFORM_INVENTORY_GROUP = Object.freeze({
    playstation: INVENTORY_GROUPS.SHARED,

    xbox: INVENTORY_GROUPS.SHARED,

    pc: INVENTORY_GROUPS.PC
});


/**
 * ============================================================================
 * Order Statuses
 * ============================================================================
 *
 * الحالات الأساسية المعتمدة للنظام.
 *
 * تغيير الحالة يتم يدويًا من لوحة الإدارة.
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
 * ============================================================================
 * Order Issue Statuses
 * ============================================================================
 */

export const ORDER_ISSUES = Object.freeze({
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
 * جميع الحالات الممكنة للطلب.
 */

export const ALL_ORDER_STATUSES = Object.freeze([
    ...Object.values(ORDER_STATUSES),

    ...Object.values(ORDER_ISSUES)
]);


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 *
 * هذه قائمة تعريفية فقط.
 *
 * التشفير الحقيقي لا يتم هنا.
 *
 * التشفير يتم Server-Side قبل حفظ البيانات في Firestore.
 */

export const SENSITIVE_FIELDS = Object.freeze({
    EA: Object.freeze([
        "eaEmail",

        "eaPassword",

        "backupCodes"
    ]),

    BANK_TRANSFER: Object.freeze([
        "bankFullName",

        "bankIban"
    ]),

    DIGITAL_WALLET: Object.freeze([
        "walletMobile"
    ]),

    USDT: Object.freeze([
        "usdtWalletAddress"
    ]),

    PAYPAL: Object.freeze([
        "paypalEmail"
    ]),

    WESTERN_UNION: Object.freeze([
        "westernUnionName",

        "westernUnionCountry"
    ])
});


/**
 * قائمة مسطحة لجميع الحقول الحساسة.
 */

export const ALL_SENSITIVE_FIELDS = Object.freeze([
    ...SENSITIVE_FIELDS.EA,

    ...SENSITIVE_FIELDS.BANK_TRANSFER,

    ...SENSITIVE_FIELDS.DIGITAL_WALLET,

    ...SENSITIVE_FIELDS.USDT,

    ...SENSITIVE_FIELDS.PAYPAL,

    ...SENSITIVE_FIELDS.WESTERN_UNION
]);


/**
 * ============================================================================
 * Reference Number
 * ============================================================================
 *
 * رقم المرجع الخارجي:
 *
 * - 8 أحرف
 * - 5 أرقام
 * - 3 حروف
 * - أول حرف رقم
 * - آخر حرف رقم
 * - I و L مستبعدة
 *
 * التوليد الفعلي يتم Server-Side في:
 *
 * server/services/orderNumber.js
 *
 * هذا الملف يحتوي فقط على مواصفات النظام.
 */

export const REFERENCE_CONFIG = Object.freeze({
    length: 8,

    digitsCount: 5,

    lettersCount: 3,

    firstCharacter: "digit",

    lastCharacter: "digit",

    excludedLetters: Object.freeze([
        "I",

        "L"
    ]),

    pattern:
        "8 characters / 5 digits / 3 letters"
});


/**
 * ============================================================================
 * Withdrawal
 * ============================================================================
 *
 * لا يوجد Timer لسحب الكوينز.
 *
 * الكمية المسحوبة يتم إدخالها يدويًا من لوحة الإدارة.
 */

export const WITHDRAWAL_CONFIG = Object.freeze({
    manual: true,

    realtime: true,

    timerEnabled: false,

    quantityField: "withdrawnQuantity"
});


/**
 * ============================================================================
 * Inventory
 * ============================================================================
 *
 * المخزون لا يعتمد على قيمة ثابتة يتم إنقاصها يدويًا.
 *
 * القاعدة:
 *
 * Shared PS/Xbox =
 * إجمالي الكمية المطلوبة للـ PS/Xbox
 * -
 * إجمالي الكمية المسحوبة
 *
 * PC =
 * إجمالي الكمية المطلوبة للـ PC
 * -
 * إجمالي الكمية المسحوبة
 */

export const INVENTORY_CONFIG = Object.freeze({
    realtime: true,

    sharedPlatforms: Object.freeze([
        PLATFORMS.PLAYSTATION,

        PLATFORMS.XBOX
    ]),

    separatePlatforms: Object.freeze([
        PLATFORMS.PC
    ]),

    calculation: "orderedQuantity - withdrawnQuantity",

    quantityField: "orderedQuantity",

    withdrawnField: "withdrawnQuantity",

    remainingField: "remainingQuantity"
});


/**
 * ============================================================================
 * Tracking
 * ============================================================================
 *
 * صفحة التتبع لا تستخدم polling دوري.
 *
 * التحديثات المهمة تصل عن طريق Firestore realtime listeners.
 */

export const TRACKING_CONFIG = Object.freeze({
    realtime: true,

    pollingEnabled: false,

    refreshInterval: null,

    fields: Object.freeze([
        "status",

        "withdrawnQuantity",

        "remainingQuantity"
    ])
});


/**
 * ============================================================================
 * Sensitive Data Reveal
 * ============================================================================
 *
 * مدة إظهار البيانات الحساسة بعد فك التشفير.
 *
 * القيمة بالمللي ثانية.
 */

export const SECURITY_CONFIG = Object.freeze({
    sensitiveRevealDuration: 90 * 1000,

    noStoreSensitiveResponses: true,

    sensitiveDataServerOnly: true,

    encryptionServerOnly: true
});


/**
 * ============================================================================
 * Destruction / Archive
 * ============================================================================
 *
 * عند وصول الطلب إلى قسم الإتلاف:
 *
 * زر واحد:
 * "إتلاف البيانات الحساسة"
 *
 * وبعد نجاح الإتلاف:
 * ينتقل الطلب تلقائيًا إلى Archive.
 */

export const DESTRUCTION_CONFIG = Object.freeze({
    enabled: true,

    buttonAction: "destroy-sensitive-data",

    autoArchiveAfterDestroy: true,

    destroySensitiveOnly: true,

    irreversible: true
});


/**
 * ============================================================================
 * Realtime Configuration
 * ============================================================================
 */

export const REALTIME_CONFIG = Object.freeze({
    enabled: true,

    tracking: true,

    inventory: true,

    settings: true,

    orders: true,

    polling: false
});


/**
 * ============================================================================
 * Pagination / UI Defaults
 * ============================================================================
 */

export const UI_CONFIG = Object.freeze({
    defaultPageSize: 25,

    maximumPageSize: 100,

    searchDebounce: 300
});


/**
 * ============================================================================
 * Payment Methods
 * ============================================================================
 *
 * أسماء طرق الدفع ليست بيانات حساسة.
 *
 * البيانات الخاصة بالعميل داخل طريقة الدفع هي التي تكون حساسة
 * ويتم تشفيرها Server-Side.
 */

export const PAYMENT_METHODS = Object.freeze({
    BANK_TRANSFER: "bank_transfer",

    DIGITAL_WALLET: "digital_wallet",

    USDT: "usdt",

    PAYPAL: "paypal",

    WESTERN_UNION: "western_union"
});


/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * الحصول على API URL.
 *
 * @param {string} endpoint
 * @returns {string}
 */
export function getApiUrl(endpoint = "") {
    const base =
        API_CONFIG.baseUrl ||
        "";

    const cleanBase =
        base.replace(/\/+$/, "");

    const cleanEndpoint =
        String(endpoint || "")
            .replace(/^\/+/, "");

    if (!cleanEndpoint) {
        return cleanBase || "/";
    }

    return `${cleanBase}/${cleanEndpoint}`;
}


/**
 * التحقق من أن المنصة صحيحة.
 *
 * @param {string} platform
 * @returns {boolean}
 */
export function isValidPlatform(platform) {
    const value =
        String(platform || "")
            .trim()
            .toLowerCase();

    return Object.values(PLATFORMS)
        .includes(value);
}


/**
 * الحصول على مجموعة المخزون الخاصة بالمنصة.
 *
 * @param {string} platform
 * @returns {string|null}
 */
export function getPlatformInventoryGroup(platform) {
    const value =
        String(platform || "")
            .trim()
            .toLowerCase();

    return (
        PLATFORM_INVENTORY_GROUP[value] ||
        null
    );
}


/**
 * التحقق من أن الحالة حالة أساسية أو خطأ معتمد.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isValidOrderStatus(status) {
    return ALL_ORDER_STATUSES.includes(
        String(status || "").trim()
    );
}


/**
 * التحقق من أن الحقل حساس.
 *
 * @param {string} field
 * @returns {boolean}
 */
export function isSensitiveField(field) {
    return ALL_SENSITIVE_FIELDS.includes(
        String(field || "").trim()
    );
}


/**
 * ============================================================================
 * Default Export
 * ============================================================================
 */

export default {
    APP_CONFIG,

    API_CONFIG,

    FIRESTORE_COLLECTIONS,

    SYSTEM_DOCUMENTS,

    PLATFORMS,

    INVENTORY_GROUPS,

    PLATFORM_INVENTORY_GROUP,

    ORDER_STATUSES,

    ORDER_ISSUES,

    ALL_ORDER_STATUSES,

    SENSITIVE_FIELDS,

    ALL_SENSITIVE_FIELDS,

    REFERENCE_CONFIG,

    WITHDRAWAL_CONFIG,

    INVENTORY_CONFIG,

    TRACKING_CONFIG,

    SECURITY_CONFIG,

    DESTRUCTION_CONFIG,

    REALTIME_CONFIG,

    UI_CONFIG,

    PAYMENT_METHODS,

    getApiUrl,

    isValidPlatform,

    getPlatformInventoryGroup,

    isValidOrderStatus,

    isSensitiveField
};
