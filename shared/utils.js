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
        const
