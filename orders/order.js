import { subscribeToPublicSettings } from "../shared/publicSettings.js?v=20261001";

// ==========================================================================
// SAMI COINS — ORDERS FRONTEND
// HTML/CSS V2.8 COMPATIBLE JAVASCRIPT
// ==========================================================================

"use strict";

// ==========================================================================
// 0. إعدادات التطبيق
// ==========================================================================

let storeSettings = {
    rates: {},
    limits: {},
    paymentMethods: {},
    banks: [],
    wallets: [],
    withdrawDays: "",
    transferHours: "",
    pcWithdrawDays: "",
    pcTransferHours: "",
    safeMethod: settings.safeMethod || storeSettings.safeMethod || "آمنة 99%",
    paymentCategories: {},
    termsEn: [],
    termsEnabled: true,
    terms: [],
    storeOpen: true,
    supportWhatsapp: ""
};

let selectedPlatform = null;
let currentPaymentCategory = null;
let selectedPaymentMethod = "";
let currentRate = 0;
let minLimit = 0;
let maxLimit = 0;
let currentQty = 0;

let generatedOrderId = "";
let generatedReferenceNumber = "";
let generatedDocumentId = "";
let generatedInternalReference = "";
let unsubscribeSettingsRealtime = null;
let settingsLoaded = false;

let isEditingAll = false;
let currentLanguage = "ar";


// ==========================================================================
// 1. أدوات DOM
// ==========================================================================

function $(id) {
    return document.getElementById(id);
}

function showElement(id) {
    $(id)?.classList.remove("hidden");
}

function hideElement(id) {
    $(id)?.classList.add("hidden");
}

function setText(id, value) {
    const el = $(id);
    if (el) {
        el.textContent = value ?? "";
    }
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ==========================================================================
// 2. اللغة
// ==========================================================================

const translations = {
    ar: {
        brandSubtitle: "SAMI COINS",
        trackOrder: "استعلام عن الطلب",
        storeClosedBadge: "البيع مغلق حاليًا",
        storeName: "samicoins",
        storeClosedTitle: "نعتذر، لا نستقبل طلبات البيع حاليًا",
        storeClosedText:
            "المتجر مغلق في الوقت الحالي. يمكنك التواصل مع الدعم الفني للاستفسار عن موعد عودة استقبال طلبات البيع.",
        contactWhatsapp: "تواصل معنا عبر واتساب",
        retry: "إعادة المحاولة",

        introTitle:
            "اشتري كوينزك بسعر منافس وبطريقة سريعة وآمنة تضمن لك تجربة بيع مريحة",
        introText:
            "اختر منصتك وكمية الكوينز لعرض المبلغ المستحق لك.",

        trustSecure: "آمن",
        trustFast: "سريع",
        trustSupport: "دعم",

        orderProgressKicker: "خطوات بيع الكوينز",
        step1Title: "اختر المنصة والكمية",
        step2Title: "أدخل بياناتك",
        step3Title: "راجع طلبك",
        step4Title: "تم إنشاء الطلب",

        progressStep1: "المنصة والكمية",
        progressStep2: "البيانات",
        progressStep3: "المراجعة",
        progressStep4: "تم الطلب",

        stepOne: "الخطوة الأولى",
        choosePlatform: "اختر المنصة",
        playstation: "PlayStation",
        xbox: "Xbox",
        pc: "PC",
        pricePerMillion: "سعر المليون",
        choosePlatformPrompt: "اختر المنصة للبدء",
        choosePlatformPromptText:
            "بعدها ستظهر لك تفاصيل السعر والكمية وطرق الدفع.",

        millionPrice: "سعر المليون",
        selectedPlatform: "حسب المنصة المختارة",
        sar: "ر.س",

        withdrawDuration: "مدة السحب",
        transferDuration: "مدة التحويل",
        safeMethod: "طريقة النقل",

        coinQuantity: "كمية الكوينز",
        enterQuantity: "أدخل الكمية",
        quantity: "الكمية",
        coins: "كوينز",
        quantityQuickSelect: "اختيار سريع للكمية",
        minimum: "الحد الأدنى",
        maximum: "الحد الأقصى",

        totalDue: "إجمالي المبلغ المستحق",
        totalCalculation: "يتم احتسابه حسب الكمية والمنصة",

        receiveMoney: "استلام المبلغ",
        choosePayment: "اختر طريقة الدفع",
        localPayment: "دفع محلي",
        internationalPayment: "دفع دولي",
        paymentHint: "اختر نوع الدفع لعرض طرق الاستلام المتاحة.",

        startSelling: "ابدأ ببيع كوينز الآن",
        secureData: "بياناتك محمية ويتم التعامل معها بسرية وأمان.",

        stepTwo: "الصفحة الثانية",
        customerDetails: "بيانات العميل والتواصل",
        customerName: "اسم العميل",
        whatsappNumber: "رقم التواصل واتساب",
        accountData: "بيانات الحساب",
        eaAccount: "حساب EA",
        eaEmail: "البريد الإلكتروني لحساب EA",
        eaPassword: "كلمة مرور حساب EA",
        encryptedData: "يتم تشفير بيانات الحساب لحمايتها.",
        security: "الحماية",
        backupCodes: "الأكواد الاحتياطية",
        howToGetCodes: "طريقة الاستخراج؟",
        backupCodesNote:
            "أدخل 3 أكواد احتياطية مختلفة من حساب EA الخاص بك.",
        receivingData: "بيانات الاستلام",
        paymentDetails: "تفاصيل الدفع",

        termsTitle: "الشروط والأحكام",
        declarationsTitle: "الإقرارات",
        termsSubtitle: "يرجى قراءة الشروط قبل اعتماد الطلب.",
        termsAgreement: "لقد قرأت الشروط والأحكام وأوافق عليها",
        termsLink: "الشروط والأحكام",
        declarationsTitle: "الإقرارات وانسحاب الشروط والأحكام",

        previous: "السابق",
        reviewOrder: "مراجعة الطلب",

        finalStep: "الخطوة الأخيرة",
        reviewAndConfirm: "مراجعة الطلب والاعتماد",
        reviewDescription: "راجع جميع البيانات قبل إنشاء الطلب.",
        orderDetails: "تفاصيل الطلب",
        edit: "تعديل",
        platform: "المنصة",
        totalAmount: "إجمالي المبلغ",
        changePlatform: "تغيير المنصة",
        psShort: "PS",
        editCoinQuantity: "تعديل كمية الكوينز",

        eaDataAndCodes: "بيانات حساب EA والأكواد",
        email: "البريد الإلكتروني",
        password: "كلمة المرور",
        customerInformation: "معلومات العميل",
        transferAndPayout: "معلومات التحويل والاستلام",
        saveChanges: "حفظ التعديلات",
        back: "الرجوع",
        createOrder: "إنشاء الطلب",
        finalSecurityNote:
            "عند إنشاء الطلب سيتم تأمين بياناتك ومعالجتها وفقًا لنظام الحماية المعتمد.",

        orderCreated: "تم إنشاء الطلب",
        successTitle: "تم استلام طلبك بنجاح",
        successText: "احتفظ برقم الطلب لمتابعة حالة طلبك.",
        referenceCopyHint: "اضغط على رقم الطلب لنسخه",
        invoiceDetails: "الفاتورة وتفاصيل الطلب",
        requestedQuantity: "الكمية المطلوبة",
        trackYourOrder: "تتبع حالة طلبك",
        sendViaWhatsapp: "إرسال تفاصيل الطلب عبر الواتساب",
        newOrder: "إنشاء طلب جديد",
        successSupportNote:
            "في حال وجود أي استفسار، يمكنك التواصل مع الدعم الفني.",

        footerBrandText: "بيع الكوينز بسهولة وأمان",
        support: "دعم فني",
        privacy: "الخصوصية",
        terms: "الشروط والأحكام",
        orderInquiry: "استعلام عن الطلب",
        allRightsReserved: "جميع الحقوق محفوظة"
    },

    en: {
        brandSubtitle: "SAMI COINS",
        trackOrder: "Track Order",
        storeClosedBadge: "Selling is currently closed",
        storeName: "samicoins",
        storeClosedTitle: "Sorry, we are not accepting selling orders now",
        storeClosedText:
            "The store is currently closed. Contact support to ask when selling orders will reopen.",
        contactWhatsapp: "Contact us via WhatsApp",
        retry: "Retry",

        introTitle:
            "Sell your coins at a competitive price with a fast and secure process.",
        introText:
            "Choose your platform and coin quantity to see your payout.",

        trustSecure: "Secure",
        trustFast: "Fast",
        trustSupport: "Support",

        orderProgressKicker: "Coin Selling Steps",
        step1Title: "Choose Platform & Quantity",
        step2Title: "Enter Your Details",
        step3Title: "Review Your Order",
        step4Title: "Order Created",

        progressStep1: "Platform & Quantity",
        progressStep2: "Details",
        progressStep3: "Review",
        progressStep4: "Completed",

        stepOne: "Step One",
        choosePlatform: "Choose Platform",
        playstation: "PlayStation",
        xbox: "Xbox",
        pc: "PC",
        pricePerMillion: "Price per Million",
        choosePlatformPrompt: "Choose a platform to start",
        choosePlatformPromptText:
            "Price, quantity and payment options will appear after selection.",

        millionPrice: "Price per Million",
        selectedPlatform: "Based on selected platform",
        sar: "SAR",

        withdrawDuration: "Withdrawal Time",
        transferDuration: "Transfer Time",
        safeMethod: "Transfer Method",

        coinQuantity: "Coin Quantity",
        enterQuantity: "Enter Quantity",
        quantity: "Quantity",
        coins: "Coins",
        quantityQuickSelect: "Quick Quantity Selection",
        minimum: "Minimum",
        maximum: "Maximum",

        totalDue: "Total Amount Due",
        totalCalculation: "Calculated according to quantity and platform",

        receiveMoney: "Receive Payment",
        choosePayment: "Choose Payment Method",
        localPayment: "Local Payment",
        internationalPayment: "International Payment",
        paymentHint: "Choose a payment category to see available methods.",

        startSelling: "Start Selling Coins",
        secureData: "Your data is protected and handled securely.",

        stepTwo: "Step Two",
        customerDetails: "Customer & Contact Details",
        customerName: "Customer Name",
        whatsappNumber: "WhatsApp Number",
        accountData: "Account Details",
        eaAccount: "EA Account",
        eaEmail: "EA Account Email",
        eaPassword: "EA Account Password",
        encryptedData: "Account data is encrypted for protection.",
        security: "Security",
        backupCodes: "Backup Codes",
        howToGetCodes: "How to get them?",
        backupCodesNote:
            "Enter 3 different backup codes from your EA account.",
        receivingData: "Payment Details",
        paymentDetails: "Payment Information",

        termsTitle: "Terms & Conditions",
        declarationsTitle: "Declarations & Terms & Conditions",
        termsSubtitle: "Please read the terms before submitting your order.",
        termsAgreement: "I have read and agree to the Terms & Conditions",
        termsLink: "Terms & Conditions",

        previous: "Previous",
        reviewOrder: "Review Order",

        finalStep: "Final Step",
        reviewAndConfirm: "Review & Confirm",
        reviewDescription: "Review all information before creating the order.",
        orderDetails: "Order Details",
        edit: "Edit",
        platform: "Platform",
        totalAmount: "Total Amount",
        changePlatform: "Change Platform",
        psShort: "PS",
        editCoinQuantity: "Edit Coin Quantity",

        eaDataAndCodes: "EA Account & Backup Codes",
        email: "Email",
        password: "Password",
        customerInformation: "Customer Information",
        transferAndPayout: "Payment & Receiving Information",
        saveChanges: "Save Changes",
        back: "Back",
        createOrder: "Create Order",
        finalSecurityNote:
            "When the order is created, your data will be secured and processed according to our protection system.",

        orderCreated: "Order Created",
        successTitle: "Your order was received successfully",
        successText: "Keep your order number to track your order.",
        referenceCopyHint: "Tap the order number to copy it",
        invoiceDetails: "Invoice & Order Details",
        requestedQuantity: "Requested Quantity",
        trackYourOrder: "Track Your Order",
        sendViaWhatsapp: "Send Order Details via WhatsApp",
        newOrder: "Create New Order",
        successSupportNote:
            "If you have any questions, contact technical support.",

        footerBrandText: "Sell coins easily and securely",
        support: "Support",
        privacy: "Privacy",
        terms: "Terms",
        orderInquiry: "Order Inquiry",
        allRightsReserved: "All rights reserved"
    }
};


// ==========================================================================
// 3. اللغة
// ==========================================================================

function applyLanguage() {
    const dictionary = translations[currentLanguage] || translations.ar;

    document.documentElement.lang =
        currentLanguage === "ar" ? "ar" : "en";

    document.documentElement.dir =
        currentLanguage === "ar" ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.dataset.i18n;

        if (dictionary[key] !== undefined) {
            el.textContent = dictionary[key];
        }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.dataset.i18nPlaceholder;

        if (dictionary[key] !== undefined) {
            el.placeholder = dictionary[key];
        }
    });

    const label = $("languageToggleLabel");

    if (label) {
        label.textContent =
            currentLanguage === "ar"
                ? "EN"
                : "AR";
    }

    const languageButton = $("languageToggleBtn");

    if (languageButton) {
        languageButton.title =
            currentLanguage === "ar"
                ? "English"
                : "العربية";
    }

    updateProgressUI(getCurrentStepNumber());
    renderInlineTerms();
}

function toggleLanguage() {
    currentLanguage =
        currentLanguage === "ar"
            ? "en"
            : "ar";

    localStorage.setItem(
        "samiCoinsLanguage",
        currentLanguage
    );

    applyLanguage();
}


// ==========================================================================
// 4. الثيم
// ==========================================================================

function applyTheme(theme) {
    const selectedTheme =
        theme === "light"
            ? "light"
            : "dark";

    document.documentElement.dataset.theme =
        selectedTheme;

    localStorage.setItem(
        "samiCoinsTheme",
        selectedTheme
    );

    const icon = $("themeToggleIcon");

    if (icon) {
        icon.className =
            selectedTheme === "dark"
                ? "fa-solid fa-moon"
                : "fa-solid fa-sun";
    }

    const meta = $("themeColorMeta");

    if (meta) {
        meta.setAttribute(
            "content",
            selectedTheme === "dark"
                ? "#05080f"
                : "#f5f7fb"
        );
    }
}

function toggleTheme() {
    const current =
        document.documentElement.dataset.theme === "light"
            ? "light"
            : "dark";

    applyTheme(
        current === "dark"
            ? "light"
            : "dark"
    );
}


// ==========================================================================
// 5. أرقام عربية
// ==========================================================================

function convertArabicNumbersToEnglish(inputElement) {
    if (!inputElement) return;

    inputElement.value =
        String(inputElement.value || "")
            .replace(/[٠-٩]/g, (digit) =>
                String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))
            )
            .replace(/[^0-9]/g, "");
}


// ==========================================================================
// 6. الدفع
// ==========================================================================

function normalizePaymentMethodCode(method) {
    const value =
        String(method || "")
            .trim()
            .toLowerCase();

    if (
        value.includes("بنك") ||
        value.includes("تحويل") ||
        value.includes("bank")
    ) {
        return "bank";
    }

    if (
        value.includes("محفظ") ||
        value.includes("wallet")
    ) {
        return "wallet";
    }

    if (value.includes("usdt") || value === "usd" || value.includes("usd")) {
        return "usd";
    }

    if (value.includes("paypal")) {
        return "paypal";
    }

    if (
        value.includes("western") ||
        value.includes("ويسترن")
    ) {
        return "western";
    }

    return "";
}

function getPaymentMethodsForCategory(category) {
    const paymentMethods = storeSettings.paymentMethods || {};
    const configuredCategories = storeSettings.paymentCategories || {};
    const categoryCodes = Array.isArray(configuredCategories[category])
        ? configuredCategories[category]
        : [];
    let methods = [];

    if (paymentMethods && typeof paymentMethods === "object" && !Array.isArray(paymentMethods)) {
        methods = Array.isArray(paymentMethods[category])
            ? paymentMethods[category]
            : [];
    } else if (Array.isArray(paymentMethods) && paymentMethods.length) {
        methods = paymentMethods.filter((method) => {
            const code = normalizePaymentMethodCode(method);
            if (!code) return false;
            if (categoryCodes.length) {
                return categoryCodes.some((configuredCode) => {
                    const normalized = String(configuredCode || "").toLowerCase();
                    return (
                        (normalized === "bank_transfer" && code === "bank") ||
                        (normalized === "digital_wallet" && code === "wallet") ||
                        (normalized === "usdt" && code === "usd") ||
                        (normalized === "usd" && code === "usd") ||
                        (normalized === "paypal" && code === "paypal") ||
                        (normalized === "western_union" && code === "western")
                    );
                });
            }
            return category === "local"
                ? code === "bank" || code === "wallet"
                : code === "usd" || code === "paypal" || code === "western";
        });
    }

    if (methods.length) return methods;

    return category === "local"
        ? ["تحويل بنكي", "المحافظ الرقمية"]
        : ["USD", "PayPal", "Western Union"];
}

function getSelectedPaymentCode() {
    return normalizePaymentMethodCode(
        selectedPaymentMethod
    );
}

function getSupportWhatsappNumber() {
    return String(
        storeSettings.supportWhatsapp ||
        storeSettings.supportWhatsappNumber ||
        ""
    ).replace(/[^\d]/g, "");
}


// ==========================================================================
function localizeSettingText(value) {
    const text = String(value ?? "").trim();
    if (!text) return "--";
    if (currentLanguage === "en") {
        return text
            .replace(/أيام عمل/g, "business days")
            .replace(/أيام/g, "days")
            .replace(/ساعة/g, "hours")
            .replace(/سوق الانتقالات \(Web App\)/g, "Transfer Market (Web App)");
    }
    return text;
}

function getCurrentPlatformDurations() {
    if (selectedPlatform === "PC") {
        return {
            withdraw: storeSettings.pcWithdrawDays || storeSettings.withdrawDays || "--",
            transfer: storeSettings.pcTransferHours || storeSettings.transferHours || "--"
        };
    }
    return {
        withdraw: storeSettings.withdrawDays || "--",
        transfer: storeSettings.transferHours || "--"
    };
}


// ==========================================================================
// 7. الإعدادات
// ==========================================================================

function loadSettings() {
    // Public order-page settings are read directly from Firestore in realtime.
    // The orders API is reserved for order creation and sensitive server work.
    startSettingsRealtime();
}


// ==========================================================================
// 8. الإعدادات اللحظية
// ==========================================================================

function startSettingsRealtime() {
    if (typeof unsubscribeSettingsRealtime === "function") {
        unsubscribeSettingsRealtime();
    }

    try {
        unsubscribeSettingsRealtime = subscribeToPublicSettings((settings) => {
            storeSettings = {
                ...storeSettings,
                storeName: "samicoins",
                arabicStoreName: "samicoins",
                gameName: settings.gameName || "FC",
                gameVersion: Number(settings.gameVersion || 27),
                rates: {
                    ...storeSettings.rates,
                    PlayStation: Number(settings.psRate ?? storeSettings.rates.PlayStation ?? 0),
                    Xbox: Number(settings.psRate ?? storeSettings.rates.Xbox ?? 0),
                    PC: Number(settings.pcRate ?? storeSettings.rates.PC ?? 0)
                },
                limits: {
                    ...storeSettings.limits,
                    psMin: Number(settings.psMin ?? storeSettings.limits.psMin ?? 0),
                    psMax: Number(settings.psMax ?? storeSettings.limits.psMax ?? 0),
                    pcMin: Number(settings.pcMin ?? storeSettings.limits.pcMin ?? 0),
                    pcMax: Number(settings.pcMax ?? storeSettings.limits.pcMax ?? 0)
                },
                banks: Array.isArray(settings.banks) ? settings.banks : storeSettings.banks,
                wallets: Array.isArray(settings.wallets) ? settings.wallets : storeSettings.wallets,
                terms: Array.isArray(settings.terms) ? settings.terms : storeSettings.terms,
                termsEn: Array.isArray(settings.termsEn) ? settings.termsEn : storeSettings.termsEn,
                termsEnabled: settings.termsEnabled !== false,
                storeOpen: settings.storeOpen !== false,
                withdrawDays: settings.psWithdrawDuration || storeSettings.withdrawDays,
                transferHours: settings.psTransferDuration || storeSettings.transferHours,
                pcWithdrawDays: settings.pcWithdrawDuration || storeSettings.pcWithdrawDays,
                pcTransferHours: settings.pcTransferDuration || storeSettings.pcTransferHours,
                safeMethod: "آمنة 100%",
                paymentCategories: settings.paymentCategories || storeSettings.paymentCategories,
                paymentMethods: settings.paymentMethods || storeSettings.paymentMethods,
                supportWhatsapp: settings.supportWhatsapp || storeSettings.supportWhatsapp
            };

            settingsLoaded = true;
            applySettingsToUI();

            if (!currentPaymentCategory) {
                switchPaymentCategory("local");
            }
        }, (error) => {
            settingsLoaded = false;
            showStoreClosedState(false);

            showToast(
                currentLanguage === "ar"
                    ? "تعذر الاتصال بقاعدة بيانات إعدادات المتجر. حاول تحديث الصفحة."
                    : "Unable to connect to Firestore store settings. Please refresh the page."
            );

            console.error(
                "Orders settings realtime error:",
                error?.code ||
                    error?.message ||
                    error
            );
        });
    } catch (error) {
        console.error("Realtime settings initialization failed:", error);
        settingsLoaded = false;
        showStoreClosedState(false);

        showToast(
            currentLanguage === "ar"
                ? "تعذر تهيئة إعدادات المتجر."
                : "Unable to initialize store settings."
        );
    }
}


// ==========================================================================
// 8. حالة المتجر
// ==========================================================================

function showStoreClosedState(isClosed) {
    const closedScreen =
        $("storeClosedScreen");

    const orderApplication =
        $("orderApplication");

    if (isClosed) {
        closedScreen?.classList.remove("hidden");
        orderApplication?.classList.add("hidden");
    } else {
        closedScreen?.classList.add("hidden");
        orderApplication?.classList.remove("hidden");
    }
}

function contactClosedStoreWhatsapp() {
    const number =
        getSupportWhatsappNumber();

    if (!number) {
        showToast(
            currentLanguage === "ar"
                ? "رقم الدعم غير متوفر حاليًا."
                : "Support number is currently unavailable."
        );
        return;
    }

    window.open(
        `https://wa.me/${number}`,
        "_blank",
        "noopener,noreferrer"
    );
}


// ==========================================================================
// 9. تطبيق الإعدادات على HTML
// ==========================================================================

function applySettingsToUI() {

    const gameName =
        storeSettings.gameName || "FC";

    const gameVersion =
        Number(storeSettings.gameVersion || 27);

    setText(
        "gameVersionBadge",
        `${gameName} ${gameVersion}`
    );

    // الأسعار
    const rates =
        storeSettings.rates || {};

    if (rates.PlayStation !== undefined) {
        setText(
            "psSubPrice",
            `${rates.PlayStation} ${currentLanguage === "ar" ? "ر.س" : "SAR"}`
        );
    }

    if (rates.Xbox !== undefined) {
        setText(
            "xboxSubPrice",
            `${rates.Xbox} ${currentLanguage === "ar" ? "ر.س" : "SAR"}`
        );
    }

    if (rates.PC !== undefined) {
        setText(
            "pcSubPrice",
            `${rates.PC} ${currentLanguage === "ar" ? "ر.س" : "SAR"}`
        );
    }

    // المدد حسب المنصة
    const durations = getCurrentPlatformDurations();
    setText("withdrawText", localizeSettingText(durations.withdraw));
    setText("transferText", localizeSettingText(durations.transfer));

    setText(
        "safeMethodText",
        localizeSettingText(storeSettings.safeMethod)
    );

    setText(
        "revWithdrawText",
        localizeSettingText(durations.withdraw)
    );

    setText(
        "revTransferText",
        localizeSettingText(durations.transfer)
    );

    setText(
        "revSafeMethodText",
        storeSettings.safeMethod || "--"
    );

    setText(
        "successWithdrawText",
        localizeSettingText(durations.withdraw)
    );

    setText(
        "successTransferText",
        localizeSettingText(durations.transfer)
    );

    setText(
        "successSafeMethodText",
        storeSettings.safeMethod || "--"
    );

    // الشروط
    const termsContainer =
        $("termsContainer");

    if (termsContainer) {
        termsContainer.style.display =
            storeSettings.termsEnabled === false
                ? "none"
                : "";
    }

    // المتجر
    showStoreClosedState(
        storeSettings.storeOpen === false
    );

    // إعادة اختيار المنصة إن كانت موجودة
    if (selectedPlatform) {
        selectPlatform(
            selectedPlatform,
            true
        );
    }
}


// ==========================================================================
// 10. اختيار المنصة
// ==========================================================================

function selectPlatform(
    platform,
    silent = false
) {
    if (!settingsLoaded) {
        showToast(
            currentLanguage === "ar"
                ? "جاري تحميل إعدادات المتجر، حاول بعد لحظات."
                : "Store settings are still loading. Please try again in a moment."
        );
        return;
    }

    const validPlatforms = [
        "PlayStation",
        "Xbox",
        "PC"
    ];

    if (!validPlatforms.includes(platform)) {
        return;
    }

    selectedPlatform =
        platform;

    document
        .querySelectorAll(".platform-btn")
        .forEach((button) => {
            button.classList.remove("active");
        });

    const classMap = {
        PlayStation: ".ps-btn",
        Xbox: ".xbox-btn",
        PC: ".pc-btn"
    };

    document
        .querySelectorAll(
            classMap[platform]
        )
        .forEach((button) => {
            button.classList.add("active");
        });

    const rates =
        storeSettings.rates || {};

    const limits =
        storeSettings.limits || {};

    if (platform === "PC") {

        currentRate =
            Number(rates.PC ?? 0);

        minLimit =
            Number(limits.pcMin ?? 0);

        maxLimit =
            Number(limits.pcMax ?? 0);

    } else {

        currentRate =
            Number(
                platform === "Xbox"
                    ? rates.Xbox ?? 0
                    : rates.PlayStation ?? 0
            );

        minLimit =
            Number(limits.psMin ?? 0);

        maxLimit =
            Number(limits.psMax ?? 0);
    }

    hideElement("platformPromptBox");
    showElement("singlePlatformRateCard");
    showElement("durationInfoCardsStep1");
    showElement("qtyCardContainer");
    showElement("totalAmountBoxCard");

    setText(
        "minLimitText",
        minLimit.toLocaleString("en-US")
    );

    setText(
        "maxLimitText",
        maxLimit.toLocaleString("en-US")
    );

    const range =
        $("qtyRange");

    if (range) {
        range.min = "0";
        range.max =
            String(maxLimit || 5000000);
        range.step = "100000";

        if (
            currentQty >
            Number(range.max)
        ) {
            currentQty =
                Number(range.max);
        }

        range.value =
            String(currentQty);
    }

    const qtyInput =
        $("quantityInput");

    if (qtyInput) {
        qtyInput.value =
            currentQty > 0
                ? currentQty.toLocaleString("en-US")
                : "";
    }

    updateRateCardsUI();
    calculateTotal();

    if (!silent) {
        updateProgressUI(
            getCurrentStepNumber()
        );
    }
}


// ==========================================================================
// 11. عرض سعر المنصة
// ==========================================================================

function updateRateCardsUI() {
    if (!selectedPlatform) return;

    setText(
        "displaySelectedRate",
        Number(currentRate || 0).toLocaleString("en-US")
    );

    const icon =
        $("selectedPlatformIcon");

    if (!icon) return;

    if (selectedPlatform === "PlayStation") {
        icon.className =
            "fa-brands fa-playstation";
    }

    if (selectedPlatform === "Xbox") {
        icon.className =
            "fa-brands fa-xbox";
    }

    if (selectedPlatform === "PC") {
        icon.className =
            "fa-solid fa-desktop";
    }
}


// ==========================================================================
// 12. فئة الدفع
// ==========================================================================

function switchPaymentCategory(category) {
    if (!settingsLoaded) {
        showToast(
            currentLanguage === "ar"
                ? "إعدادات المتجر غير جاهزة بعد."
                : "Store settings are not ready yet."
        );
        return;
    }

    if (
        category !== "local" &&
        category !== "international"
    ) {
        return;
    }

    currentPaymentCategory =
        category;

    $("tabLocal")?.classList.toggle(
        "active",
        category === "local"
    );

    $("tabIntl")?.classList.toggle(
        "active",
        category === "international"
    );

    const methods =
        getPaymentMethodsForCategory(
            category
        );

    selectedPaymentMethod =
        methods.length > 0
            ? methods[0]
            : "";

    showElement(
        "dynamicPaymentMethodsGrid"
    );

    updateDynamicUI();

    if (selectedPaymentMethod) {
        selectPaymentMethod(
            selectedPaymentMethod
        );
    } else {
        renderStep2PaymentFields();
    }

    calculateTotal();
}


// ==========================================================================
// 13. بناء طرق الدفع
// ==========================================================================

function updateDynamicUI() {

    const container =
        $("dynamicPaymentMethodsGrid");

    if (!container) return;

    container.innerHTML = "";

    if (!currentPaymentCategory) {
        hideElement(
            "dynamicPaymentMethodsGrid"
        );
        return;
    }

    const methods =
        getPaymentMethodsForCategory(
            currentPaymentCategory
        );

    if (!methods.length) {
        container.innerHTML = `
            <div class="payment-category-hint">
                <i class="fa-solid fa-circle-info"></i>
                <span>
                    ${
                        currentLanguage === "ar"
                            ? "لا توجد طرق دفع متاحة حاليًا."
                            : "No payment methods are currently available."
                    }
                </span>
            </div>
        `;
        return;
    }

    methods.forEach((method) => {

        const button =
            document.createElement("button");

        button.type = "button";

        button.className =
            "pay-btn-compact" +
            (
                selectedPaymentMethod === method
                    ? " active"
                    : ""
            );

        button.addEventListener(
            "click",
            () =>
                selectPaymentMethod(method)
        );

        const code =
            normalizePaymentMethodCode(
                method
            );

        let icon =
            "fa-solid fa-wallet";

        if (code === "bank") {
            icon =
                "fa-solid fa-building-columns";
        }

        if (code === "wallet") {
            icon =
                "fa-solid fa-mobile-screen-button";
        }

        if (code === "usd") {
            icon =
                "fa-solid fa-coins";
        }

        if (code === "paypal") {
            icon =
                "fa-brands fa-paypal";
        }

        if (code === "western") {
            icon =
                "fa-solid fa-globe";
        }

        button.innerHTML = `
            <i class="${icon}"></i>
            ${escapeHtml(method)}
        `;

        container.appendChild(button);
    });
}


// ==========================================================================
// 14. اختيار طريقة الدفع
// ==========================================================================

function selectPaymentMethod(method) {

    selectedPaymentMethod =
        method;

    updateDynamicUI();

    renderStep2PaymentFields();
    showElement("payoutCardContainer");
    const note = $("selectedPaymentNote");
    if (note) note.textContent = selectedPaymentMethod || "--";

    calculateTotal();
}


// ==========================================================================
// 15. الكمية
// ==========================================================================

function clampQuantity(value) {

    let quantity =
        Number(value) || 0;

    if (quantity < 0) {
        quantity = 0;
    }

    if (
        maxLimit > 0 &&
        quantity > maxLimit
    ) {
        quantity = maxLimit;
    }

    return quantity;
}

function syncQuantityUI() {

    currentQty =
        clampQuantity(currentQty);

    const input =
        $("quantityInput");

    if (input) {
        input.value =
            currentQty > 0
                ? currentQty.toLocaleString("en-US")
                : "";
    }

    const range =
        $("qtyRange");

    if (range) {
        range.value =
            String(currentQty);
    }

    const inline =
        $("inlineQtyInput");

    if (inline) {
        inline.value =
            currentQty > 0
                ? currentQty.toLocaleString("en-US")
                : "";
    }
}

function adjustQty(amount) {

    if (!selectedPlatform) {
        selectPlatform("PlayStation");
    }

    currentQty =
        clampQuantity(
            currentQty +
            Number(amount || 0)
        );

    syncQuantityUI();
    calculateTotal();
}

function formatAndCalculate(input) {

    if (!selectedPlatform) {
        selectPlatform("PlayStation");
    }

    const raw =
        String(input?.value || "")
            .replace(/[٠-٩]/g, (d) =>
                String("٠١٢٣٤٥٦٧٨٩".indexOf(d))
            )
            .replace(/[^0-9]/g, "");

    currentQty =
        clampQuantity(
            raw === ""
                ? 0
                : parseInt(raw, 10)
        );

    syncQuantityUI();
    calculateTotal();
}

function sliderChanged(slider) {

    if (!selectedPlatform) {
        selectPlatform("PlayStation");
    }

    currentQty =
        clampQuantity(
            parseInt(
                slider?.value || "0",
                10
            )
        );

    syncQuantityUI();
    calculateTotal();
}


// ==========================================================================
// 16. الحساب
// ==========================================================================

function calculateTotal() {

    if (!selectedPlatform) {
        return;
    }

    const totalEl =
        $("totalAmountText");

    if (!totalEl) return;

    const millions =
        currentQty / 1000000;

    const totalSar =
        millions *
        Number(currentRate || 0);

    if (
        currentPaymentCategory ===
        "international"
    ) {

        const totalUsd =
            totalSar / 3.75;

        totalEl.textContent =
            `USDT ${totalUsd.toFixed(2)}`;

    } else {

        totalEl.textContent =
            `${totalSar.toFixed(2)} ${currentLanguage === "ar" ? "ر.س" : "SAR"}`;
    }

    const reviewTotal =
        $("revTotal");

    if (reviewTotal) {
        reviewTotal.textContent =
            totalEl.textContent;
    }
}


// ==========================================================================
// 17. حقول الدفع
// ==========================================================================

function renderStep2PaymentFields() {

    const container =
        $("step2PaymentFieldsContainer");

    if (!container) return;

    const method =
        getSelectedPaymentCode();

    if (!method) {
        container.innerHTML = "";
        return;
    }

    if (method === "bank") {

        const banks =
            Array.isArray(storeSettings.banks)
                ? storeSettings.banks
                : [];

        const options =
            banks.length
                ? banks.map(
                    (bank) =>
                        `<option value="${escapeHtml(bank)}">${escapeHtml(bank)}</option>`
                ).join("")
                : `
                    <option value="">
                        ${
                            currentLanguage === "ar"
                                ? "اختر البنك"
                                : "Select bank"
                        }
                    </option>
                `;

        container.innerHTML = `
            <label class="field-label">
                ${
                    currentLanguage === "ar"
                        ? "اسم البنك المحول إليه"
                        : "Bank Name"
                }
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <select id="bankNameSelect" required>
                    ${options}
                </select>
            </div>

            <label class="field-label">
                ${
                    currentLanguage === "ar"
                        ? "الاسم الكامل للحساب البنكي"
                        : "Full Account Name"
                }
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="accountName"
                    required
                    placeholder="${
                        currentLanguage === "ar"
                            ? "الاسم كما في الحساب البنكي"
                            : "Name as shown on bank account"
                    }"
                >
            </div>

            <label class="field-label">
                IBAN
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="iban"
                    required
                    placeholder="SA0000000000000000000000"
                    autocomplete="off"
                >
            </div>
        `;

        return;
    }

    if (method === "wallet") {

        const wallets =
            Array.isArray(storeSettings.wallets)
                ? storeSettings.wallets
                : [];

        const options =
            wallets.map(
                (wallet) =>
                    `<option value="${escapeHtml(wallet)}">${escapeHtml(wallet)}</option>`
            ).join("");

        container.innerHTML = `
            <label class="field-label">
                ${
                    currentLanguage === "ar"
                        ? "اسم المحفظة الرقمية"
                        : "Digital Wallet"
                }
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <select id="walletTypeSelect" required>
                    ${options}
                </select>
            </div>

            <label class="field-label">
                ${
                    currentLanguage === "ar"
                        ? "رقم الجوال المرتبط بالمحفظة"
                        : "Wallet Phone Number"
                }
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="tel"
                    id="walletNumber"
                    placeholder="9665xxxxxxxx"
                    inputmode="numeric"
                    oninput="convertArabicNumbersToEnglish(this)"
                    required
                >
            </div>
        `;

        return;
    }

    if (method === "usd") {

        container.innerHTML = `
            <label class="field-label">
                USDT (TRC20)
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="usdDetails"
                    placeholder="${
                        currentLanguage === "ar"
                            ? "عنوان محفظة USDT على شبكة TRC20"
                            : "USDT wallet address on TRC20"
                    }"
                    autocomplete="off"
                    required
                >
            </div>
        `;

        return;
    }

    if (method === "paypal") {

        container.innerHTML = `
            <label class="field-label">
                PayPal
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="email"
                    id="paypalEmail"
                    placeholder="example@domain.com"
                    required
                >
            </div>
        `;

        return;
    }

    if (method === "western") {

        container.innerHTML = `
            <label class="field-label">
                ${
                    currentLanguage === "ar"
                        ? "الاسم الكامل بالإنجليزية"
                        : "Full Name in English"
                }
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="wuName"
                    placeholder="Full Name in English"
                    required
                >
            </div>

            <label class="field-label">
                ${
                    currentLanguage === "ar"
                        ? "الدولة"
                        : "Country"
                }
                <span class="required-star">*</span>
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="wuCountry"
                    placeholder="${
                        currentLanguage === "ar"
                            ? "مثال: Saudi Arabia"
                            : "Example: Saudi Arabia"
                    }"
                    required
                >
            </div>
        `;

        return;
    }

    container.innerHTML = "";
}


// ==========================================================================
// 18. بيانات الدفع
// ==========================================================================

function getCurrentPayoutDataFromForm() {

    const method =
        getSelectedPaymentCode();

    switch (method) {

        case "bank":
            return {
                payoutType: "local",
                method: "bank",
                bankName:
                    $("bankNameSelect")?.value?.trim() || "",
                fullName:
                    $("accountName")?.value?.trim() || "",
                iban:
                    $("iban")?.value?.trim() || "",
                recipientName:
                    $("recipientName")?.value?.trim() || ""
            };

        case "wallet":
            return {
                payoutType: "local",
                method: "wallet",
                walletName:
                    $("walletTypeSelect")?.value?.trim() || "",
                phone:
                    $("walletNumber")?.value?.trim() || ""
            };

        case "usd":
            return {
                payoutType: "international",
                method: "usd",
                wallet:
                    $("usdDetails")?.value?.trim() || "",
                network:
                    "TRC20"
            };

        case "paypal":
            return {
                payoutType: "international",
                method: "paypal",
                email:
                    $("paypalEmail")?.value?.trim() || ""
            };

        case "western":
            return {
                payoutType: "international",
                method: "western",
                fullNameEnglish:
                    $("wuName")?.value?.trim() || "",
                country:
                    $("wuCountry")?.value?.trim() || ""
            };

        default:
            return {
                payoutType: "",
                method: ""
            };
    }
}

function getPayoutDetailsObject() {
    return getCurrentPayoutDataFromForm();
}


// ==========================================================================
// 19. شاشة الخطوة
// ==========================================================================

function getCurrentStepNumber() {

    if (!$("step1Screen")?.classList.contains("hidden")) {
        return 1;
    }

    if (!$("step2Screen")?.classList.contains("hidden")) {
        return 2;
    }

    if (!$("step3ReviewScreen")?.classList.contains("hidden")) {
        return 3;
    }

    if (!$("step4SuccessScreen")?.classList.contains("hidden")) {
        return 3;
    }

    return 1;
}

function updateProgressUI(step) {

    const titles = {
        1: "step1Title",
        2: "step2Title",
        3: "step3Title"
    };

    const titleKey =
        titles[step] || titles[1];

    const dictionary =
        translations[currentLanguage];

    setText(
        "currentStepTitle",
        dictionary[titleKey]
    );

    setText(
        "currentStepCount",
        `${Math.min(step, 3)} / 3`
    );

    const fill =
        $("orderProgressFill");

    if (fill) {
        fill.style.width =
            `${((Math.min(step, 3) - 1) / 2) * 100}%`;
    }

    document
        .querySelectorAll(".progress-step")
        .forEach((item) => {

            const itemStep =
                Number(item.dataset.step);

            item.classList.toggle(
                "active",
                itemStep <= step
            );
        });
}

function showScreen(screenId) {

    [
        "step1Screen",
        "step2Screen",
        "step3ReviewScreen",
        "step4SuccessScreen"
    ].forEach((id) => {
        $(id)?.classList.add("hidden");
    });

    $(screenId)?.classList.remove("hidden");

    updateAppBackButton(screenId);

    let step = 1;

    if (screenId === "step2Screen") {
        step = 2;
    }

    if (screenId === "step3ReviewScreen") {
        step = 3;
    }

    if (screenId === "step4SuccessScreen") {
        step = 3;
    }

    updateProgressUI(step);

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


// ==========================================================================
// 20. الانتقال للخطوة الثانية
// ==========================================================================

function getFieldErrorAnchor(element) {
    if (!element) return null;
    if (element.classList?.contains("input-box-wrap")) return element;
    return element.closest(".input-box-wrap") ||
        element.closest(".phone-input-wrap") ||
        element.closest(".code-input-row") ||
        element.parentElement ||
        element;
}

function clearFieldError(element) {
    if (!element) return;
    element.classList?.remove("field-invalid");
    element.removeAttribute?.("aria-invalid");
    const anchor = getFieldErrorAnchor(element);
    anchor?.classList?.remove("field-invalid-wrap");
    anchor?.querySelector?.(":scope > .field-error")?.remove();
}

function markInvalid(element, message = "") {
    if (!element) return;
    clearFieldError(element);
    element.classList?.add("field-invalid");
    element.setAttribute?.("aria-invalid", "true");
    const anchor = getFieldErrorAnchor(element);
    anchor?.classList?.add("field-invalid-wrap");
    if (anchor) {
        const error = document.createElement("div");
        error.className = "field-error";
        error.setAttribute("role", "alert");
        error.textContent = message ||
            (currentLanguage === "ar" ? "يرجى التحقق من هذه البيانات." : "Please check this field.");
        anchor.appendChild(error);
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearInvalidFields() {
    document.querySelectorAll(
        "#step1Screen input, #step1Screen select, #step2Screen input, #step2Screen select, #step1Screen .field-invalid, #step2Screen .field-invalid"
    ).forEach((field) => clearFieldError(field));
    document.querySelectorAll(
        ".field-error"
    ).forEach((error) => error.remove());
    document.querySelectorAll(
        ".validation-invalid"
    ).forEach((el) => el.classList.remove("validation-invalid"));
}

function validateAccountStep1() {
    clearInvalidFields();
    const email=$("eaEmail"), password=$("eaPass"), code1=$("code1"), code2=$("code2"), code3=$("code3");
    for (const field of [email,password,code1,code2,code3]) {
        if (!field || !String(field.value||"").trim()) { markInvalid(field); return false; }
    }
    if (!/^\S+@\S+\.\S+$/.test(String(email.value).trim())) { markInvalid(email,"أدخل بريدًا إلكترونيًا صحيحًا."); return false; }
    if (!/[A-Z]/.test(password.value)) { markInvalid(password,"يجب أن تحتوي كلمة المرور على حرف إنجليزي كبير واحد على الأقل."); return false; }
    const codes=[code1.value.trim(),code2.value.trim(),code3.value.trim()];
    const bad=[code1,code2,code3].find(x=>{const v=String(x?.value||"").trim();return v.length<6||v.length>11;});
    if(bad){markInvalid(bad,"الكود يجب أن يكون بين 6 و11 خانة.");return false;}
    if(new Set(codes).size!==3){markInvalid(code3,"يجب أن تكون الأكواد الثلاثة مختلفة.");return false;}
    return true;
}

function goToStep2() {
    if(!selectedPlatform){
        const platformGrid = document.querySelector(".platforms-flex");
        const prompt = $("platformPromptBox");
        platformGrid?.classList.add("platform-required-error");
        prompt?.classList.add("platform-required-error");
        prompt?.scrollIntoView({behavior:"smooth",block:"center"});
        showToast(currentLanguage === "ar" ? "اختر المنصة أولًا للمتابعة." : "Please select a platform first.");
        return;
    }
    document.querySelector(".platforms-flex")?.classList.remove("platform-required-error");
    $("platformPromptBox")?.classList.remove("platform-required-error");
    if(currentQty<minLimit||(maxLimit>0&&currentQty>maxLimit)){markInvalid($("quantityInput"),"أدخل كمية ضمن الحدود المسموحة.");return;}
    if(!validateAccountStep1()) return;
    showScreen("step2Screen");
}


// 21. التحقق من الخطوة الثانية
// ==========================================================================

function validateStep2() {
    clearInvalidFields();
    const name=$("customerName"), phone=$("customerPhone");
    if(!name||!String(name.value||"").trim()){markInvalid(name);return false;}
    if(!phone||!String(phone.value||"").trim()){markInvalid(phone);return false;}
    const p=String(phone.value||"").replace(/[\s()-]/g,"").replace(/^00/,"+");
    if(!/^(?:\+966|966|0)5\d{8}$/.test(p)){markInvalid(phone,"أدخل رقم جوال صحيحًا مع مفتاح الدولة، مثال: +966 5XXXXXXXX.");return false;}
    if(!currentPaymentCategory||!selectedPaymentMethod){showToast("اختر طريقة استلام المبلغ أولاً.");$("dynamicPaymentMethodsGrid")?.scrollIntoView({behavior:"smooth",block:"center"});return false;}
    const fields=document.querySelectorAll("#step2PaymentFieldsContainer input,#step2PaymentFieldsContainer select");
    for(const field of fields){if(!String(field.value||"").trim()){markInvalid(field);return false;}}
    const method=getSelectedPaymentCode();
    if(method==="bank"){
        const iban=String($("iban")?.value||"").replace(/\s+/g,"").toUpperCase();
        if(!/^\S{18,30}$/.test(iban)||/[\u0600-\u06FF]/.test(iban)){markInvalid($("iban"),"IBAN يجب أن يكون بين 18 و30 خانة وبدون أحرف عربية.");return false;}
        $("iban").value=iban;
    }
    if(method==="usd"){
        const address=String($("usdDetails")?.value||"").trim();
        if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)){markInvalid($("usdDetails"),"أدخل عنوان USDT صحيحًا على شبكة TRC20 يبدأ بحرف T.");return false;}
    }
    if(method==="paypal"){
        const email=String($("paypalEmail")?.value||"").trim();
        if(!/^\S+@\S+\.\S+$/.test(email)){markInvalid($("paypalEmail"),"أدخل بريد PayPal صحيحًا.");return false;}
    }
    if(method==="western"){
        const wu=String($("wuName")?.value||"").trim();
        if(!/^[A-Za-z][A-Za-z .'-]*$/.test(wu)){markInvalid($("wuName"),"اسم Western Union يجب أن يكون بالإنجليزية فقط ويطابق الاسم في الهوية.");return false;}
    }
    if(storeSettings.termsEnabled!==false&&!$("termsCheck")?.checked){$("termsCheck")?.scrollIntoView({behavior:"smooth",block:"center"});showToast("يجب الموافقة على الشروط والأحكام.");return false;}
    return true;
}


// 22. تفاصيل الدفع في المراجعة
// ==========================================================================

function buildPaymentDetailsHTML() {

    const method =
        getSelectedPaymentCode();

    if (method === "bank") {

        const bank =
            $("bankNameSelect")?.value || "";

        const fullName =
            $("accountName")?.value?.trim() || "";

        const iban = $("iban")?.value?.trim() || "";

        return `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    تحويل بنكي — ${escapeHtml(bank)}
                </span>
            </div>

            <div class="field-label">
                الاسم الثلاثي:
            </div>

            <div class="review-value-box">
                <span>
                    ${escapeHtml(fullName)}
                </span>
            </div>

            <div class="field-label">
                الآيبان:
            </div>

            <div class="review-value-box">
                <span>
                    ${escapeHtml(iban)}
                </span>
            </div>

                    `;
    }

    if (method === "wallet") {

        const wallet =
            $("walletTypeSelect")?.value || "";

        const phone =
            $("walletNumber")?.value?.trim() || "";

        return `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    ${escapeHtml(wallet)}
                    (${escapeHtml(phone)})
                </span>
            </div>
        `;
    }

    if (method === "usd") {

        const wallet =
            $("usdtWalletType")?.value?.trim() || "";

        return `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    USDT (TRC20): ${escapeHtml(wallet)}
                </span>
            </div>
        `;
    }

    if (method === "paypal") {

        const email =
            $("paypalEmail")?.value?.trim() || "";

        return `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    PayPal: ${escapeHtml(email)}
                </span>
            </div>
        `;
    }

    if (method === "western") {

        const name =
            $("wuName")?.value?.trim() || "";

        const country =
            $("wuCountry")?.value?.trim() || "";

        return `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    Western Union
                    (${escapeHtml(name)} -
                    ${escapeHtml(country)})
                </span>
            </div>
        `;
    }

    return "";
}


// ==========================================================================
// 23. تحديث منصة المراجعة
// ==========================================================================

function updateReviewPlatformUI() {

    const box =
        $("revPlatformBoxTheme");

    const icon =
        $("revPlatformIcon");

    const name =
        $("revPlatformName");

    if (!box || !icon) {
        return;
    }

    box.className =
        "review-summary-item platform-summary";

    if (selectedPlatform === "PlayStation") {

        box.classList.add("ps-theme");

        icon.className =
            "fa-brands fa-playstation";
    }

    if (selectedPlatform === "Xbox") {

        box.classList.add("xbox-theme");

        icon.className =
            "fa-brands fa-xbox";
    }

    if (selectedPlatform === "PC") {

        box.classList.add("pc-theme");

        icon.className =
            "fa-solid fa-desktop";
    }

    if (name) {
        name.textContent =
            selectedPlatform || "--";
    }
}


// ==========================================================================
// 24. المراجعة
// ==========================================================================

function goToReview() {

    if (!validateStep2()) {
        return false;
    }

    const name =
        $("customerName").value.trim();

    const phone =
        $("customerPhone").value.trim();

    const email =
        $("eaEmail").value.trim();

    const password =
        $("eaPass").value.trim();

    const codes = [
        $("code1").value.trim(),
        $("code2").value.trim(),
        $("code3").value.trim()
    ];

    updateReviewPlatformUI();

    setText(
        "revQty",
        currentQty.toLocaleString("en-US")
    );

    setText(
        "revTotal",
        $("totalAmountText")?.textContent ||
        "0.00 ر.س"
    );

    setText(
        "revEmail",
        email
    );

    setText(
        "revPass",
        password
    );

    setText(
        "revClientName",
        name
    );

    setText(
        "revClientPhone",
        phone
    );

    const codesEl =
        $("revCodes");

    if (codesEl) {

        codesEl.innerHTML = `
            <div class="backup-codes-stack">

                <div class="code-display-row">
                    <span class="code-number-tag">#1</span>
                    <span>${escapeHtml(codes[0])}</span>
                </div>

                <div class="code-display-row">
                    <span class="code-number-tag">#2</span>
                    <span>${escapeHtml(codes[1])}</span>
                </div>

                <div class="code-display-row">
                    <span class="code-number-tag">#3</span>
                    <span>${escapeHtml(codes[2])}</span>
                </div>

            </div>
        `;
    }

    const details =
        $("revSpecificDetailsContainer");

    if (details) {
        details.innerHTML =
            buildPaymentDetailsHTML();
    }

    // بيانات التعديل
    $("editEaEmail").value =
        email;

    $("editEaPass").value =
        password;

    $("editCode1").value =
        codes[0];

    $("editCode2").value =
        codes[1];

    $("editCode3").value =
        codes[2];

    $("editClientName").value =
        name;

    $("editClientPhone").value =
        phone;

    $("inlineQtyInput").value =
        currentQty.toLocaleString("en-US");

    renderInlinePayoutEdit();

    isEditingAll = false;

    [
        "editPlatformQtyPanel",
        "eaEditMode",
        "clientEditMode",
        "payoutEditMode",
        "saveEditsButtonWrap"
    ].forEach(hideElement);

    [
        "eaViewMode",
        "clientViewMode",
        "payoutViewMode"
    ].forEach(showElement);

    resetEditButton();

    showScreen(
        "step3ReviewScreen"
    );

    return false;
}


// ==========================================================================
// 25. وضع التعديل
// ==========================================================================

function openReviewEditSection(section) {
    const targetMap = { client: "clientEditMode", ea: "eaEditMode", payout: "payoutEditMode" };
    const target = targetMap[section];
    if (!target) return;
    ["clientEditMode","eaEditMode","payoutEditMode"].forEach((id) => {
        if (id === target) showElement($(id)); else hideElement($(id));
    });
    showElement($("saveEditsButtonWrap"));
    document.getElementById(target)?.scrollIntoView({behavior:"smooth", block:"center"});
}

function resetEditButton() {

    const button =
        $("editToggleBtn");

    if (!button) return;

    button.innerHTML = `
        <i class="fa-solid fa-pen-to-square"></i>
        <span data-i18n="edit">
            ${translations[currentLanguage].edit}
        </span>
    `;

    button.style.background =
        "";

    button.style.borderColor =
        "";

    button.style.color =
        "";
}

function renderInlinePayoutEdit() {

    const wrap =
        $("inlinePayoutEditWrap");

    if (!wrap) return;

    const method =
        getSelectedPaymentCode();

    if (method === "bank") {

        wrap.innerHTML = `
            <label class="field-label">اسم البنك:</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editBankName"
                    value="${escapeHtml(
                        $("bankNameSelect")?.value || ""
                    )}"
                >
            </div>

            <label class="field-label">الاسم:</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editAccountName"
                    value="${escapeHtml(
                        $("accountName")?.value || ""
                    )}"
                >
            </div>

            <label class="field-label">الإيبان:</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editIban"
                    value="${escapeHtml(
                        $("iban")?.value || ""
                    )}"
                >
            </div>
        `;

        return;
    }

    if (method === "wallet") {

        wrap.innerHTML = `
            <label class="field-label">اسم المحفظة:</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editWalletName"
                    value="${escapeHtml(
                        $("walletTypeSelect")?.value || ""
                    )}"
                >
            </div>

            <label class="field-label">رقم الجوال:</label>

            <div class="input-box-wrap">
                <input
                    type="tel"
                    id="editWalletNumber"
                    value="${escapeHtml(
                        $("walletNumber")?.value || ""
                    )}"
                    oninput="convertArabicNumbersToEnglish(this)"
                >
            </div>
        `;

        return;
    }

    if (method === "usd") {

        wrap.innerHTML = `
            <label class="field-label">عنوان USDT (TRC20):</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editUsdtWalletType"
                    value="${escapeHtml(
                        $("usdDetails")?.value || ""
                    )}"
                >
            </div>
        `;

        return;
    }

    if (method === "paypal") {

        wrap.innerHTML = `
            <label class="field-label">بريد PayPal:</label>

            <div class="input-box-wrap">
                <input
                    type="email"
                    id="editPaypalEmail"
                    value="${escapeHtml(
                        $("paypalEmail")?.value || ""
                    )}"
                >
            </div>
        `;

        return;
    }

    if (method === "western") {

        wrap.innerHTML = `
            <label class="field-label">الاسم بالإنجليزية:</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editWuName"
                    value="${escapeHtml(
                        $("wuName")?.value || ""
                    )}"
                >
            </div>

            <label class="field-label">الدولة:</label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="editWuCountry"
                    value="${escapeHtml(
                        $("wuCountry")?.value || ""
                    )}"
                >
            </div>
        `;

        return;
    }

    wrap.innerHTML = "";
}

function toggleEditMode() {

    isEditingAll =
        !isEditingAll;

    const button =
        $("editToggleBtn");

    if (isEditingAll) {

        [
            "editPlatformQtyPanel",
            "eaEditMode",
            "clientEditMode",
            "payoutEditMode",
            "saveEditsButtonWrap"
        ].forEach(showElement);

        [
            "eaViewMode",
            "clientViewMode",
            "payoutViewMode"
        ].forEach(hideElement);

        renderInlinePayoutEdit();

        if (button) {

            button.innerHTML = `
                <i class="fa-solid fa-xmark"></i>
                <span>
                    ${
                        currentLanguage === "ar"
                            ? "إغلاق التعديل"
                            : "Close Editing"
                    }
                </span>
            `;

            button.style.background =
                "rgba(239,68,68,0.15)";

            button.style.borderColor =
                "var(--pc-color)";

            button.style.color =
                "var(--pc-color)";
        }

        return;
    }

    saveAllEdits();

    [
        "editPlatformQtyPanel",
        "eaEditMode",
        "clientEditMode",
        "payoutEditMode",
        "saveEditsButtonWrap"
    ].forEach(hideElement);

    [
        "eaViewMode",
        "clientViewMode",
        "payoutViewMode"
    ].forEach(showElement);

    resetEditButton();
}

function saveAllEdits() {

    const newEmail =
        $("editEaEmail")?.value.trim() || "";

    const newPass =
        $("editEaPass")?.value.trim() || "";

    const codes = [
        $("editCode1")?.value.trim() || "",
        $("editCode2")?.value.trim() || "",
        $("editCode3")?.value.trim() || ""
    ];

    const newName =
        $("editClientName")?.value.trim() || "";

    const newPhone =
        $("editClientPhone")?.value.trim() || "";

    if (
        !newEmail ||
        !newPass ||
        codes.some((code) => !code) ||
        !newName ||
        !newPhone
    ) {
        showToast(
            currentLanguage === "ar"
                ? "يرجى تعبئة جميع بيانات التعديل."
                : "Please complete all edited fields."
        );

        isEditingAll = true;
        return;
    }

    $("eaEmail").value =
        newEmail;

    $("eaPass").value =
        newPass;

    $("code1").value =
        codes[0];

    $("code2").value =
        codes[1];

    $("code3").value =
        codes[2];

    $("customerName").value =
        newName;

    $("customerPhone").value =
        newPhone;

    // الدفع
    const method =
        getSelectedPaymentCode();

    if (method === "bank") {

        const bank =
            $("editBankName")?.value || "";

        const account =
            $("editAccountName")?.value || "";

        const iban =
            $("editIban")?.value || "";

        if ($("bankNameSelect")) {
            $("bankNameSelect").value =
                bank;
        }

        if ($("accountName")) {
            $("accountName").value =
                account;
        }

        if ($("iban")) {
            $("iban").value =
                iban;
        }
    }

    if (method === "wallet") {

        const wallet =
            $("editWalletName")?.value || "";

        const phone =
            $("editWalletNumber")?.value || "";

        if ($("walletTypeSelect")) {
            $("walletTypeSelect").value =
                wallet;
        }

        if ($("walletNumber")) {
            $("walletNumber").value =
                phone;
        }
    }

    if (method === "usd") {

        if ($("usdDetails")) {
            $("usdDetails").value =
                $("editUsdtWalletType")?.value || "";
        }
    }

    if (method === "paypal") {

        if ($("paypalEmail")) {
            $("paypalEmail").value =
                $("editPaypalEmail")?.value || "";
        }
    }

    if (method === "western") {

        if ($("wuName")) {
            $("wuName").value =
                $("editWuName")?.value || "";
        }

        if ($("wuCountry")) {
            $("wuCountry").value =
                $("editWuCountry")?.value || "";
        }
    }

    updateReviewAfterEdit();
}

function updateReviewAfterEdit() {

    updateReviewPlatformUI();

    setText(
        "revQty",
        currentQty.toLocaleString("en-US")
    );

    setText(
        "revTotal",
        $("totalAmountText")?.textContent ||
        "0.00 ر.س"
    );

    setText(
        "revEmail",
        $("eaEmail")?.value || ""
    );

    setText(
        "revPass",
        $("eaPass")?.value || ""
    );

    setText(
        "revClientName",
        $("customerName")?.value || ""
    );

    setText(
        "revClientPhone",
        $("customerPhone")?.value || ""
    );

    const codes = [
        $("code1")?.value || "",
        $("code2")?.value || "",
        $("code3")?.value || ""
    ];

    $("revCodes").innerHTML = `
        <div class="backup-codes-stack">

            <div class="code-display-row">
                <span class="code-number-tag">#1</span>
                <span>${escapeHtml(codes[0])}</span>
            </div>

            <div class="code-display-row">
                <span class="code-number-tag">#2</span>
                <span>${escapeHtml(codes[1])}</span>
            </div>

            <div class="code-display-row">
                <span class="code-number-tag">#3</span>
                <span>${escapeHtml(codes[2])}</span>
            </div>

        </div>
    `;

    $("revSpecificDetailsContainer").innerHTML =
        buildPaymentDetailsHTML();
}


// ==========================================================================
// 26. تعديل المنصة من المراجعة
// ==========================================================================

function selectPlatformInline(platform) {

    selectPlatform(
        platform,
        true
    );

    updateReviewPlatformUI();

    setText(
        "revQty",
        currentQty.toLocaleString("en-US")
    );

    setText(
        "revTotal",
        $("totalAmountText")?.textContent ||
        "0.00 ر.س"
    );

    const inline =
        $("inlineQtyInput");

    if (inline) {
        inline.value =
            currentQty.toLocaleString("en-US");
    }
}


// ==========================================================================
// 27. تعديل الكمية من المراجعة
// ==========================================================================

function adjustQtyInline(amount) {

    adjustQty(amount);

    setText(
        "revQty",
        currentQty.toLocaleString("en-US")
    );

    setText(
        "revTotal",
        $("totalAmountText")?.textContent ||
        "0.00 ر.س"
    );

    if ($("inlineQtyInput")) {
        $("inlineQtyInput").value =
            currentQty.toLocaleString("en-US");
    }
}

function formatAndCalculateInline(input) {

    formatAndCalculate(input);

    setText(
        "revQty",
        currentQty.toLocaleString("en-US")
    );

    setText(
        "revTotal",
        $("totalAmountText")?.textContent ||
        "0.00 ر.س"
    );
}


// ==========================================================================
// 28.1 حماية البيانات الحساسة في المتصفح
// ==========================================================================

/**
 * يمسح البيانات الحساسة من حقول الصفحة بعد اكتمال إرسال الطلب.
 *
 * البيانات الحساسة لا نحتاج أن تبقى في DOM بعد إنشاء الطلب؛
 * السيرفر يكون قد استلمها وشفرها قبل حفظها في Firestore.
 */
function clearSensitiveOrderFields() {

    const sensitiveFieldIds = [
        "eaEmail",
        "eaPass",
        "code1",
        "code2",
        "code3",
        "accountName",
        "iban",
        "recipientName",
        "walletNumber",
        "usdtWalletType",
        "usdDetails",
        "paypalEmail",
        "wuName",
        "wuCountry"
    ];

    sensitiveFieldIds.forEach((id) => {
        const field = $(id);

        if (field) {
            field.value = "";
        }
    });
}

/**
 * يمسح البيانات الحساسة بعد فترة قصيرة من نجاح الطلب.
 *
 * لا يؤثر ذلك على البيانات التي تم إرسالها؛ الهدف فقط تقليل مدة بقاء
 * البيانات الحساسة داخل ذاكرة/DOM المتصفح.
 */
function scheduleSensitiveFieldCleanup() {

    window.setTimeout(
        () => {
            clearSensitiveOrderFields();
        },
        90 * 1000
    );
}

// ==========================================================================
// 28. إنشاء الطلب
// ==========================================================================

async function submitOrderFinal() {
    if (!settingsLoaded) {
        showToast(
            currentLanguage === "ar"
                ? "إعدادات المتجر غير جاهزة. حاول تحديث الصفحة."
                : "Store settings are not ready. Please refresh the page."
        );
        return;
    }


    if (isEditingAll) {
        toggleEditMode();

        if (isEditingAll) {
            return;
        }
    }

    if (!validateAccountStep1()) {
        showScreen("step1Screen");
        return;
    }

    if (!validateStep2()) {
        showScreen("step2Screen");
        return;
    }

    const payoutDetails =
        getPayoutDetailsObject();

    const accountData = {
        eaEmail:
            $("eaEmail")?.value.trim() || "",

        eaPassword:
            $("eaPass")?.value.trim() || "",

        backupCodes: [
            $("code1")?.value.trim() || "",
            $("code2")?.value.trim() || "",
            $("code3")?.value.trim() || ""
        ]
    };

    const orderData = {

        customerName:
            $("customerName")?.value.trim() || "",

        phone:
            $("customerPhone")?.value.trim() || "",

        platform:
            selectedPlatform,

        quantity:
            currentQty,

        totalPrice:
            $("totalAmountText")?.textContent || "",

        paymentMethod:
            selectedPaymentMethod,

        paymentMethodType:
            payoutDetails.method,

        payoutDetails,

        accountData
    };

    const submitButton =
        document.querySelector(
            ".create-order-final-btn"
        );

    const originalButtonHTML =
        submitButton?.innerHTML;

    try {

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin"></i>
                ${
                    currentLanguage === "ar"
                        ? "جاري إنشاء الطلب..."
                        : "Creating order..."
                }
            `;
        }

        const response =
            await fetch(
                "/api/orders/create",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        Accept:
                            "application/json"
                    },
                    body:
                        JSON.stringify(orderData)
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.success
        ) {
            throw new Error(
                data.message ||
                "تعذر إنشاء الطلب."
            );
        }

        generatedReferenceNumber =
            data.referenceNumber || "";

        generatedOrderId =
            data.orderId || "";

        generatedInternalReference =
            data.internalReference || "";

        generatedDocumentId =
            data.documentId || "";

        const serverPricing = data.pricing || {};
        const serverDisplayTotal =
            String(serverPricing.displayTotal || "").trim();

        if (serverDisplayTotal) {
            setText(
                "totalAmountText",
                serverDisplayTotal
            );
        }

        setText(
            "finalOrderId",
            generatedReferenceNumber || "--"
        );

        setText(
            "finalInternalReference",
            generatedInternalReference || "--"
        );

        const trackingUrl =
            new URL(
                "/tracking/?ref=" + encodeURIComponent(generatedReferenceNumber || ""),
                window.location.origin
            ).href;

        setText(
            "finalTrackingLink",
            trackingUrl
        );

        setText(
            "billClientName",
            orderData.customerName
        );

        setText("billClientPhone", orderData.phone);
        setText("billOrderNumber", generatedReferenceNumber || "--");
        setText("billStatusText", currentLanguage === "ar" ? "طلب جديد" : "New Order");

        setText("billPlatform", selectedPlatform);
        const billOval = $("billPlatformOval");
        if (billOval) {
            billOval.classList.remove("ps-theme","xbox-theme","pc-theme");
            billOval.classList.add(selectedPlatform === "PlayStation" ? "ps-theme" : selectedPlatform === "Xbox" ? "xbox-theme" : "pc-theme");
        }

        setText(
            "billQty",
            `${currentQty.toLocaleString("en-US")} ${currentLanguage === "ar" ? "كوينز" : "Coins"}`
        );

        setText(
            "billTotal",
            serverDisplayTotal ||
                $("totalAmountText")?.textContent ||
                ""
        );

        setText(
            "successWithdrawText",
            storeSettings.withdrawDays || "--"
        );

        setText(
            "successTransferText",
            storeSettings.transferHours || "--"
        );

        setText(
            "successSafeMethodText",
            storeSettings.safeMethod || "--"
        );

        const paymentCard =
            $("billPaymentCard");

        if (paymentCard) {

            paymentCard.innerHTML = `
                <div class="box-card-title">
                    <span>
                        <i class="fa-solid fa-wallet"></i>
                        ${
                            currentLanguage === "ar"
                                ? "تفاصيل التحويل والاستلام"
                                : "Payment & Receiving Details"
                        }
                    </span>
                </div>

                ${buildPaymentDetailsHTML()}
            `;
        }

        showScreen(
            "step4SuccessScreen"
        );

        scheduleSensitiveFieldCleanup();

    } catch (error) {

        console.error(
            "Create Order Error:",
            error
        );

        showToast(
            currentLanguage === "ar"
                ? `فشل إنشاء الطلب: ${
                    error?.message ||
                    "خطأ غير معروف"
                }`
                : `Failed to create order: ${
                    error?.message ||
                    "Unknown error"
                }`
        );

    } finally {

        if (submitButton) {
            submitButton.disabled = false;

            submitButton.innerHTML =
                originalButtonHTML ||
                `
                    <span>
                        ${translations[currentLanguage].createOrder}
                    </span>
                    <i class="fa-solid fa-check"></i>
                `;
        }
    }
}


// ==========================================================================
// 29. النوافذ المنبثقة
// ==========================================================================

function openModal(title, content) {

    setText(
        "modalTitle",
        title
    );

    const body =
        $("modalBodyContent");

    if (body) {
        body.innerHTML =
            content;
    }

    const modal =
        $("customModal");

    if (modal) {
        modal.classList.add("active");
        modal.setAttribute(
            "aria-hidden",
            "false"
        );
    }
}

function closeModal() {

    const modal =
        $("customModal");

    if (modal) {
        modal.classList.remove("active");
        modal.setAttribute(
            "aria-hidden",
            "true"
        );
    }
}


// ==========================================================================
// 30. Backup Codes
// ==========================================================================

function openBackupGuideModal() {

    openModal(
        currentLanguage === "ar"
            ? "طريقة استخراج الأكواد الاحتياطية"
            : "How to Get Backup Codes",

        `
        <div style="text-align:right;line-height:2;">

            <p>
                ${
                    currentLanguage === "ar"
                        ? `
                            1. قم بتسجيل الدخول إلى حساب EA الخاص بك.
                            <br>
                            2. افتح إعدادات الحساب.
                            <br>
                            3. انتقل إلى Security & Privacy.
                            <br>
                            4. افتح Two-factor Authentication.
                            <br>
                            5. اختر Show backup codes.
                            <br>
                            6. سيظهر لك 6 أكواد احتياطية.
                            <br>
                            7. نحتاج إلى 3 أكواد مختلفة منها.
                        `
                        : `
                            1. Sign in to your EA account.
                            <br>
                            2. Open Account Settings.
                            <br>
                            3. Go to Security & Privacy.
                            <br>
                            4. Open Two-factor Authentication.
                            <br>
                            5. Select Show backup codes.
                            <br>
                            6. You will see 6 backup codes.
                            <br>
                            7. We need 3 different codes.
                        `
                }
            </p>

        </div>
        `
    );
}


// ==========================================================================
// 31. الدعم
// ==========================================================================

function showSupportModal() {

    const number =
        getSupportWhatsappNumber();

    const link =
        number
            ? `https://wa.me/${number}`
            : "#";

    openModal(
        currentLanguage === "ar"
            ? "الدعم الفني والخدمة"
            : "Technical Support",

        `
        <div style="text-align:center;">

            <p>
                ${
                    currentLanguage === "ar"
                        ? "نحن هنا لخدمتك."
                        : "We are here to help."
                }
            </p>

            ${
                number
                    ? `
                        <a
                            href="${link}"
                            target="_blank"
                            rel="noopener noreferrer"
                            style="
                                background:#25D366;
                                color:#000;
                                padding:10px 20px;
                                border-radius:10px;
                                font-weight:bold;
                                display:inline-block;
                                text-decoration:none;
                            "
                        >
                            <i class="fa-brands fa-whatsapp"></i>
                            ${
                                currentLanguage === "ar"
                                    ? "التواصل عبر واتساب"
                                    : "Contact via WhatsApp"
                            }
                        </a>
                    `
                    : `
                        <p style="color:#ef4444;">
                            ${
                                currentLanguage === "ar"
                                    ? "رقم الدعم غير متوفر حاليًا."
                                    : "Support number is unavailable."
                            }
                        </p>
                    `
            }

        </div>
        `
    );
}


// ==========================================================================
// 32. الخصوصية
// ==========================================================================

function showPrivacyModal() {
    const ar = `
        <div class="legal-content" dir="rtl">
            <p><strong>متجر سامي كوينز</strong> يحترم خصوصيتك ويلتزم بالتعامل مع بياناتك الشخصية بسرية وأمان وفق الأنظمة المعمول بها في المملكة العربية السعودية.</p>
            <h4>البيانات التي يتم جمعها</h4>
            <p>قد نقوم بجمع الاسم، رقم الجوال، بيانات الطلب، البريد الإلكتروني وكلمة المرور لحساب EA، الأكواد الاحتياطية، وبيانات الدفع اللازمة لتنفيذ الطلب.</p>
            <h4>الغرض من جمع البيانات</h4>
            <p>تُستخدم البيانات لمعالجة الطلب، تنفيذ خدمة بيع الكوينز، التواصل مع العميل، تحويل المستحقات، تحديث حالة الطلب، ومعالجة المشكلات المتعلقة بالطلب.</p>
            <h4>حماية البيانات</h4>
            <p>نستخدم وسائل تقنية وتنظيمية مناسبة لحماية البيانات الحساسة، بما في ذلك التشفير وضوابط الوصول. لا يتم إرسال كلمات مرور EA أو الأكواد الاحتياطية أو بيانات الدفع الحساسة عبر واتساب.</p>
            <h4>مشاركة البيانات</h4>
            <p>لا نبيع بيانات العملاء. وقد يتم الإفصاح عن البيانات عند الحاجة لتقديم الخدمة أو تنفيذ الطلب أو عند وجود مسوغ نظامي.</p>
            <h4>الاحتفاظ والإتلاف</h4>
            <p>نحتفظ بالبيانات للمدة اللازمة للغرض من جمعها أو للمدة التي تتطلبها الأنظمة، ثم تُحذف أو تُتلف بصورة آمنة عند انتهاء الحاجة إليها، مع مراعاة الاستثناءات النظامية.</p>
            <h4>حقوق صاحب البيانات</h4>
            <p>تشمل الحقوق، وفق الضوابط النظامية، الحق في العلم والوصول والحصول على نسخة مقروءة، وطلب التصحيح أو الإكمال أو التحديث، وطلب الإتلاف عند انتهاء الحاجة إليها.</p>
            <h4>التواصل</h4>
            <p>واتساب: <strong dir="ltr">+966 57 077 0465</strong><br>البريد الإلكتروني: <strong dir="ltr">mt.samicoins@gmail.com</strong></p>
            <p class="legal-update">آخر تحديث: 2026</p>
        </div>`;
    const en = `
        <div class="legal-content" dir="ltr">
            <p><strong>SAMI COINS Store</strong> respects your privacy and handles personal data confidentially and securely in accordance with applicable laws and regulations in Saudi Arabia.</p>
            <h4>Data We Collect</h4>
            <p>We may collect your name, mobile number, order details, EA account email and password, backup codes, and payment information required to process your order.</p>
            <h4>Purpose of Processing</h4>
            <p>Data is used to process orders, perform the coin-selling service, communicate with customers, transfer payouts, update order status, and resolve order-related issues.</p>
            <h4>Data Protection</h4>
            <p>Sensitive data is protected using appropriate technical and organizational safeguards, including encryption and access controls. EA passwords, backup codes, and sensitive payment data are not sent through WhatsApp.</p>
            <h4>Data Sharing</h4>
            <p>We do not sell customer data. Data may be disclosed when necessary to provide the service, process an order, or where there is a legal basis.</p>
            <h4>Retention & Deletion</h4>
            <p>Data is retained only as long as necessary for the purpose for which it was collected or as required by law, then securely deleted or destroyed when no longer needed, subject to legal exceptions.</p>
            <h4>Your Rights</h4>
            <p>Subject to applicable rules, your rights include being informed, accessing your data, obtaining a readable copy, requesting correction or completion/update, and requesting deletion when the data is no longer needed.</p>
            <h4>Contact</h4>
            <p>WhatsApp: <strong>+966 57 077 0465</strong><br>Email: <strong>mt.samicoins@gmail.com</strong></p>
            <p class="legal-update">Last updated: 2026</p>
        </div>`;
    openModal(currentLanguage === "ar" ? "سياسة الخصوصية" : "Privacy Policy", currentLanguage === "ar" ? ar : en);
}

const INLINE_TERMS_AR = [
    "يتم تنفيذ الطلب وفق سعر السوق وقت المعالجة.",
    "في حال تغيّر السوق، سيتم إشعار البائع بأي تعديل في السعر قبل التنفيذ.",
    "لن يتم سحب أو تحويل أي عملات دون موافقة البائع المسبقة.",
    "تقديم الطلب لا يضمن التنفيذ الكامل أو التنفيذ بالسعر الأصلي.",
    "تختلف مدة التنفيذ حسب حالة السوق وحجم الطلبات، وقد تحدث تأخيرات بسيطة.",
    "بيع العملات ينطوي على نسبة مخاطر تقديرية أقل من 1% لاحتمالية تقييد أو حظر حساب EA.",
    "تعتمد Samicoins طرق نقل احترافية لتقليل المخاطر إلى أدنى حد ممكن، دون تقديم ضمان نهائي.",
    "لا تتحمل Samicoins مسؤولية أي إغلاق أو تقييد أو حظر يصدر من EA على الحساب.",
    "لا يوجد تعويض عن أي خسائر أو إجراءات ناتجة عن قرارات EA أو تقلبات السوق.",
    "إتمام عملية البيع يعني إقرار البائع بقراءة هذه الشروط والموافقة عليها بالكامل."
];

const INLINE_TERMS_EN = [
    "Orders are processed according to the market price at the time of processing.",
    "If the market changes, the seller will be notified of any price adjustment before processing.",
    "No coins will be withdrawn or transferred without prior approval.",
    "Submitting an order does not guarantee full execution or execution at the original price.",
    "Processing time varies according to market conditions and order volume, and minor delays may occur.",
    "Coin selling carries an estimated risk of less than 1% of an EA account being restricted or banned.",
    "SAMI COINS uses professional transfer methods to reduce risks as much as possible, without providing an absolute guarantee.",
    "SAMI COINS is not responsible for any closure, restriction, or ban imposed by EA on the account.",
    "No compensation is provided for losses or actions resulting from EA decisions or market fluctuations.",
    "Completing the sale means the seller acknowledges reading and fully accepting these Terms & Conditions."
];

function showTermsModal() {
    const terms = currentLanguage === "en"\n        ? (Array.isArray(storeSettings.termsEn) ? storeSettings.termsEn : [])\n        : (Array.isArray(storeSettings.terms) ? storeSettings.terms : []);\n    const dir = currentLanguage === "ar" ? "rtl" : "ltr";
    const title = currentLanguage === "ar" ? "الشروط والأحكام" : "Terms & Conditions";

    const html = `
        <div class="legal-content" dir="${dir}">
            <ol>${terms.map((item) => "<li>" + escapeHtml(item) + "</li>").join("")}</ol>
        </div>
    `;

    openModal(title, html);
}

function renderInlineTerms() {
    const containers = [$("inlineTermsList"), $("reviewInlineTermsList")].filter(Boolean);
    if (!containers.length) return;
    const terms = currentLanguage === "en"\n        ? (Array.isArray(storeSettings.termsEn) ? storeSettings.termsEn : [])\n        : (Array.isArray(storeSettings.terms) ? storeSettings.terms : []);\n    const html = terms.length\n        ? "<ol>" + terms.map(item => "<li>" + escapeHtml(item) + "</li>").join("") + "</ol>"\n        : "<p class=\"terms-empty\">" + (currentLanguage === "ar" ? "لا توجد إقرارات مضافة حاليًا." : "No declarations are currently configured.") + "</p>";
    containers.forEach(container => { container.innerHTML = html; });
}

function syncTermsChecks(source) {
    const checked = Boolean(source?.checked);
    const first = $("termsCheck");
    const review = $("termsCheckReview");
    if (first && first !== source) first.checked = checked;
    if (review && review !== source) review.checked = checked;
}

async function copyTrackingLinkUrl() {
    const reference = generatedReferenceNumber || "";
    if (!reference) return;
    const url = new URL("/tracking/?ref=" + encodeURIComponent(reference), window.location.origin).href;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(url);
        } else {
            const textarea = document.createElement("textarea");
            textarea.value = url;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
        }
        showToast(currentLanguage === "ar" ? "تم نسخ رابط التتبع." : "Tracking link copied.");
    } catch (error) {
        console.error("Copy tracking link error:", error);
    }
}

async function copyOrderId() {
    const reference = generatedReferenceNumber || $("finalOrderId")?.textContent?.trim() || "";
    if (!reference) return;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(reference);
        } else {
            const textarea = document.createElement("textarea");
            textarea.value = reference;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
        }
        showToast(currentLanguage === "ar" ? "تم نسخ رقم الطلب." : "Order number copied.");
    } catch (error) {
        console.error("Copy order number error:", error);
    }
}

// 35. الاستعلام
// ==========================================================================

function openInquiryPage() {

    const ref =
        generatedReferenceNumber ||
        $("finalOrderId")?.textContent?.trim() ||
        "";

    if (ref && ref !== "--") {

        window.location.href =
            `/tracking/?ref=${encodeURIComponent(ref)}`;

        return;
    }

    window.location.href =
        "/tracking/";
}


// ==========================================================================
// 36. واتساب
// ==========================================================================

function sendOrderViaWhatsapp() {
    const number = getSupportWhatsappNumber();
    if (!number) {
        showToast(currentLanguage === "ar" ? "رقم الدعم غير متوفر حاليًا." : "Support number is unavailable.");
        return;
    }
    const en = currentLanguage === "en";
    const clientName = $("customerName")?.value.trim() || "--";
    const total = $("totalAmountText")?.textContent || "--";
    const reference = generatedReferenceNumber || "--";
    const orderDate = new Intl.DateTimeFormat(en ? "en-GB" : "ar-SA", { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date());
    const message = en ? [
        "Coin Selling Order", "━━━━━━━━━━━━━━━━━━",
        "Order Number: " + reference, "Order Date: " + orderDate, "",
        "Customer Name: " + clientName,
        "Quantity: " + currentQty.toLocaleString("en-US") + " Coins",
        "Platform: " + (selectedPlatform || "--"), "Amount: " + total,
        "━━━━━━━━━━━━━━━━━━", "samicoins"
    ].join("\n") : [
        "طلب بيع كوينز", "━━━━━━━━━━━━━━━━━━",
        "رقم الطلب: " + reference, "تاريخ الطلب: " + orderDate, "",
        "اسم العميل: " + clientName,
        "الكمية: " + currentQty.toLocaleString("en-US") + " كوينز",
        "المنصة: " + (selectedPlatform || "--"), "المبلغ: " + total,
        "━━━━━━━━━━━━━━━━━━", "samicoins"
    ].join("\n");
    const url = "https://wa.me/" + number + "?text=" + encodeURIComponent(message);
    window.open(url, "_blank", "noopener,noreferrer");
}
// 37. إغلاق المودال عند الضغط خارج النافذة
// ==========================================================================

function setupModalEvents() {

    const modal =
        $("customModal");

    if (!modal) return;

    modal.addEventListener(
        "click",
        (event) => {

            if (
                event.target === modal
            ) {
                closeModal();
            }
        }
    );
}


// ==========================================================================
// UI helpers
function showToast(message) {
    const container = $("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = String(message || "");
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

function updateAppBackButton(screenId) {
    const btn = $("appBackButton");
    if (!btn) return;
    btn.classList.toggle("hidden", screenId === "step1Screen" || screenId === "step4SuccessScreen");
    if (screenId === "step2Screen") btn.onclick = () => showScreen("step1Screen");
    if (screenId === "step3ReviewScreen") btn.onclick = () => showScreen("step2Screen");
}

// 38. تهيئة الصفحة
// ==========================================================================

window.addEventListener(
    "beforeunload",
    () => {
        clearSensitiveOrderFields();
    }
);





// ==========================================================================
// 39. ربط الدوال مع window
// ==========================================================================

window.loadSettings =
    loadSettings;

window.applySettingsToUI =
    applySettingsToUI;

window.toggleLanguage =
    toggleLanguage;

window.toggleTheme =
    toggleTheme;

window.contactClosedStoreWhatsapp =
    contactClosedStoreWhatsapp;

window.convertArabicNumbersToEnglish =
    convertArabicNumbersToEnglish;

window.selectPlatform =
    selectPlatform;

window.updateRateCardsUI =
    updateRateCardsUI;

window.switchPaymentCategory =
    switchPaymentCategory;

window.updateDynamicUI =
    updateDynamicUI;

window.selectPaymentMethod =
    selectPaymentMethod;

window.adjustQty =
    adjustQty;

window.formatAndCalculate =
    formatAndCalculate;

window.sliderChanged =
    sliderChanged;

window.calculateTotal =
    calculateTotal;

window.renderStep2PaymentFields =
    renderStep2PaymentFields;

window.showScreen =
    showScreen;

window.goToStep2 =
    goToStep2;

window.goToReview =
    goToReview;

window.buildPaymentDetailsHTML =
    buildPaymentDetailsHTML;

window.getPayoutDetailsObject =
    getPayoutDetailsObject;

window.toggleEditMode =
    toggleEditMode;

window.selectPlatformInline =
    selectPlatformInline;

window.adjustQtyInline =
    adjustQtyInline;

window.formatAndCalculateInline =
    formatAndCalculateInline;

window.submitOrderFinal =
    submitOrderFinal;

window.openModal =
    openModal;

window.closeModal =
    closeModal;

window.openBackupGuideModal =
    openBackupGuideModal;

window.showSupportModal =
    showSupportModal;

window.showPrivacyModal =
    showPrivacyModal;

window.showTermsModal =
    showTermsModal;

window.copyOrderId =
    copyOrderId;

window.copyTrackingLinkUrl =
    copyTrackingLinkUrl;

window.openInquiryPage =
    openInquiryPage;

window.sendOrderViaWhatsapp =
    sendOrderViaWhatsapp;


// Automatic application initialization
document.addEventListener("DOMContentLoaded", () => {
    const savedLanguage = localStorage.getItem("samiCoinsLanguage");
    const savedTheme = localStorage.getItem("samiCoinsTheme");
    if (savedLanguage === "ar" || savedLanguage === "en") currentLanguage = savedLanguage;
    applyTheme(savedTheme === "light" ? "light" : "dark");
    applyLanguage();
    setupModalEvents();
    const passwordInput = $("eaPass");
    const passwordEye = passwordInput?.parentElement?.querySelector("i");
    if (passwordEye) {
        passwordEye.addEventListener("click", () => {
            const isPassword = passwordInput.type === "password";
            passwordInput.type = isPassword ? "text" : "password";
            passwordEye.className = isPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
        });
    }
    const editPasswordInput = $("editEaPass");
    const editPasswordWrap = editPasswordInput?.parentElement;
    if (editPasswordWrap && !editPasswordWrap.querySelector("i")) {
        const eye = document.createElement("i");
        eye.className = "fa-solid fa-eye";
        eye.addEventListener("click", () => {
            const isPassword = editPasswordInput.type === "password";
            editPasswordInput.type = isPassword ? "text" : "password";
            eye.className = isPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
        });
        editPasswordWrap.appendChild(eye);
    }
    loadSettings();
    updateAppBackButton("step1Screen");
});
