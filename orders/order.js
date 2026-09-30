// ==========================================================================
// SAMI COINS - Orders Frontend
// ==========================================================================

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
  safeMethod: "",
  termsEnabled: true,
  terms: [],
  storeOpen: true,
  supportWhatsapp: ""
};

// حالة التطبيق المتغيرة ديناميكياً
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

let isEditingAll = false;


// ==========================================================================
// 1. أدوات عامة
// ==========================================================================

function normalizePaymentMethodCode(method) {
    const value = String(method || "").trim().toLowerCase();

    if (
        value.includes("بنك") ||
        value.includes("تحويل")
    ) {
        return "bank";
    }

    if (
        value.includes("محفظ") ||
        value.includes("wallet")
    ) {
        return "wallet";
    }

    if (value === "usdt" || value.includes("usdt")) {
        return "usdt";
    }

    if (value === "paypal" || value.includes("paypal")) {
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

    if (Array.isArray(paymentMethods)) {
        return paymentMethods;
    }

    if (
        paymentMethods &&
        typeof paymentMethods === "object"
    ) {
        const methods = paymentMethods[category];

        return Array.isArray(methods)
            ? methods
            : [];
    }

    return [];
}

function getSelectedPaymentCode() {
    return normalizePaymentMethodCode(
        selectedPaymentMethod
    );
}

function getSupportWhatsappNumber() {
    const configured =
        storeSettings.supportWhatsapp ||
        storeSettings.supportWhatsappNumber ||
        "";

    return String(configured)
        .replace(/[^\d]/g, "");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCurrentDisplayedTotal() {
    return (
        document.getElementById("totalAmountText")
            ?.innerText ||
        ""
    );
}

function getCurrentPayoutDataFromForm() {
    const method = getSelectedPaymentCode();

    switch (method) {
        case "bank":
            return {
                payoutType: "local",
                method: "bank",
                bankName:
                    document.getElementById("bankNameSelect")
                        ?.value
                        ?.trim() || "",
                fullName:
                    document.getElementById("accountName")
                        ?.value
                        ?.trim() || "",
                iban:
                    document.getElementById("iban")
                        ?.value
                        ?.trim() || ""
            };

        case "wallet":
            return {
                payoutType: "local",
                method: "wallet",
                walletName:
                    document.getElementById("walletTypeSelect")
                        ?.value
                        ?.trim() || "",
                phone:
                    document.getElementById("walletNumber")
                        ?.value
                        ?.trim() || ""
            };

        case "usdt":
            return {
                payoutType: "international",
                method: "usdt",
                wallet:
                    document.getElementById("usdtWalletType")
                        ?.value
                        ?.trim() || ""
            };

        case "paypal":
            return {
                payoutType: "international",
                method: "paypal",
                email:
                    document.getElementById("paypalEmail")
                        ?.value
                        ?.trim() || ""
            };

        case "western":
            return {
                payoutType: "international",
                method: "western",
                fullNameEnglish:
                    document.getElementById("wuName")
                        ?.value
                        ?.trim() || "",
                country:
                    document.getElementById("wuCountry")
                        ?.value
                        ?.trim() || ""
            };

        default:
            return {
                payoutType: "",
                method: ""
            };
    }
}


// ==========================================================================
// 2. جلب إعدادات النظام
// ==========================================================================

async function loadSettings() {
    try {
        const response =
            await fetch("/api/orders/settings", {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            });

        const data =
            await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message ||
                "Failed to load settings"
            );
        }

        storeSettings = {
            ...storeSettings,
            ...data
        };

        applySettingsToUI();

    } catch (err) {
        console.error(
            "Settings Error:",
            err
        );

        alert(
            "تعذر تحميل إعدادات المتجر. حاول تحديث الصفحة."
        );
    }
}


// ==========================================================================
// 3. تطبيق الإعدادات على الواجهة
// ==========================================================================

function applySettingsToUI() {

    // ------------------------------------------------------
    // الأسعار
    // ------------------------------------------------------

    if (storeSettings.rates) {
        const psSub =
            document.getElementById("psSubPrice");

        const xboxSub =
            document.getElementById("xboxSubPrice");

        const pcSub =
            document.getElementById("pcSubPrice");

        if (
            psSub &&
            storeSettings.rates.PlayStation !== undefined
        ) {
            psSub.innerText =
                `${storeSettings.rates.PlayStation} ر.س`;
        }

        if (
            xboxSub &&
            storeSettings.rates.Xbox !== undefined
        ) {
            xboxSub.innerText =
                `${storeSettings.rates.Xbox} ر.س`;
        }

        if (
            pcSub &&
            storeSettings.rates.PC !== undefined
        ) {
            pcSub.innerText =
                `${storeSettings.rates.PC} ر.س`;
        }
    }

    // ------------------------------------------------------
    // المدد وطريقة السحب
    // ------------------------------------------------------

    const withdrawEl =
        document.getElementById("withdrawText");

    const transferEl =
        document.getElementById("transferText");

    const safeEl =
        document.getElementById("safeMethodText");

    const revWithdrawEl =
        document.getElementById("revWithdrawText");

    const revTransferEl =
        document.getElementById("revTransferText");

    const revSafeEl =
        document.getElementById("revSafeMethodText");

    if (withdrawEl) {
        withdrawEl.innerText =
            storeSettings.withdrawDays || "--";
    }

    if (transferEl) {
        transferEl.innerText =
            storeSettings.transferHours || "--";
    }

    if (safeEl) {
        safeEl.innerText =
            storeSettings.safeMethod || "--";
    }

    if (revWithdrawEl) {
        revWithdrawEl.innerText =
            storeSettings.withdrawDays || "--";
    }

    if (revTransferEl) {
        revTransferEl.innerText =
            storeSettings.transferHours || "--";
    }

    if (revSafeEl) {
        revSafeEl.innerText =
            storeSettings.safeMethod || "--";
    }

    // ------------------------------------------------------
    // الشروط
    // ------------------------------------------------------

    const termsContainer =
        document.getElementById("termsContainer");

    if (termsContainer) {
        termsContainer.style.display =
            storeSettings.termsEnabled
                ? "flex"
                : "none";
    }

    // ------------------------------------------------------
    // المتجر مغلق
    // ------------------------------------------------------

    const form =
        document.getElementById("orderForm");

    if (
        form &&
        storeSettings.storeOpen === false
    ) {
        form.style.opacity = "0.65";
    }

    // ------------------------------------------------------
    // إعادة حساب المنصة المختارة
    // ------------------------------------------------------

    if (selectedPlatform) {
        selectPlatform(
            selectedPlatform
        );
    }
}


// ==========================================================================
// 4. تحويل الأرقام العربية إلى إنجليزية
// ==========================================================================

function convertArabicNumbersToEnglish(
    inputElement
) {
    if (!inputElement) return;

    const arabicNumbers = [
        /٠/g,
        /١/g,
        /٢/g,
        /٣/g,
        /٤/g,
        /٥/g,
        /٦/g,
        /٧/g,
        /٨/g,
        /٩/g
    ];

    let val =
        inputElement.value;

    for (
        let i = 0;
        i < 10;
        i++
    ) {
        val =
            val.replace(
                arabicNumbers[i],
                i
            );
    }

    inputElement.value =
        val.replace(
            /[^0-9]/g,
            ""
        );
}


// ==========================================================================
// 5. اختيار المنصة
// ==========================================================================

function selectPlatform(platform) {

    selectedPlatform =
        platform;

    document
        .querySelectorAll(".platform-btn")
        .forEach((btn) => {
            btn.classList.remove(
                "active"
            );
        });

    if (
        platform === "PlayStation"
    ) {
        document
            .querySelectorAll(".ps-btn")
            .forEach((b) =>
                b.classList.add("active")
            );
    } else if (
        platform === "Xbox"
    ) {
        document
            .querySelectorAll(".xbox-btn")
            .forEach((b) =>
                b.classList.add("active")
            );
    } else if (
        platform === "PC"
    ) {
        document
            .querySelectorAll(".pc-btn")
            .forEach((b) =>
                b.classList.add("active")
            );
    }

    const rates =
        storeSettings.rates || {};

    const limits =
        storeSettings.limits || {};

    if (
        platform === "PC"
    ) {
        currentRate =
            Number(
                rates.PC ?? 0
            );

        minLimit =
            Number(
                limits.pcMin ?? 0
            );

        maxLimit =
            Number(
                limits.pcMax ?? 0
            );

    } else if (
        platform === "Xbox"
    ) {
        currentRate =
            Number(
                rates.Xbox ?? 0
            );

        minLimit =
            Number(
                limits.psMin ?? 0
            );

        maxLimit =
            Number(
                limits.psMax ?? 0
            );

    } else {
        currentRate =
            Number(
                rates.PlayStation ?? 0
            );

        minLimit =
            Number(
                limits.psMin ?? 0
            );

        maxLimit =
            Number(
                limits.psMax ?? 0
            );
    }

    document
        .getElementById(
            "platformPromptBox"
        )
        ?.classList.add("hidden");

    document
        .getElementById(
            "singlePlatformRateCard"
        )
        ?.classList.remove("hidden");

    document
        .getElementById(
            "durationInfoCardsStep1"
        )
        ?.classList.remove("hidden");

    document
        .getElementById(
            "qtyCardContainer"
        )
        ?.classList.remove("hidden");

    document
        .getElementById(
            "totalAmountBoxCard"
        )
        ?.classList.remove("hidden");

    document
        .getElementById(
            "paymentCategoryCard"
        )
        ?.classList.remove("hidden");

    document
        .getElementById(
            "payoutCardContainer"
        )
        ?.classList.remove("hidden");

    const minTextEl =
        document.getElementById(
            "minLimitText"
        );

    const maxTextEl =
        document.getElementById(
            "maxLimitText"
        );

    if (minTextEl) {
        minTextEl.innerText =
            minLimit.toLocaleString(
                "en-US"
            );
    }

    if (maxTextEl) {
        maxTextEl.innerText =
            maxLimit.toLocaleString(
                "en-US"
            );
    }

    const range =
        document.getElementById(
            "qtyRange"
        );

    if (range) {
        range.min = 0;
        range.max =
            maxLimit;
        range.value =
            currentQty;
    }

    const qtyInput =
        document.getElementById(
            "quantityInput"
        );

    if (qtyInput) {
        qtyInput.value =
            currentQty > 0
                ? currentQty.toLocaleString(
                    "en-US"
                )
                : "";
    }

    updateRateCardsUI();
    calculateTotal();
}


// ==========================================================================
// 6. عرض السعر
// ==========================================================================

function updateRateCardsUI() {

    if (!selectedPlatform) {
        return;
    }

    const rateValEl =
        document.getElementById(
            "displaySelectedRate"
        );

    const platIconEl =
        document.getElementById(
            "selectedPlatformIcon"
        );

    if (rateValEl) {
        rateValEl.innerText =
            currentRate;
    }

    if (platIconEl) {
        if (
            selectedPlatform ===
            "PlayStation"
        ) {
            platIconEl.className =
                "fa-brands fa-playstation";

        } else if (
            selectedPlatform ===
            "Xbox"
        ) {
            platIconEl.className =
                "fa-brands fa-xbox";

        } else if (
            selectedPlatform ===
            "PC"
        ) {
            platIconEl.className =
                "fa-solid fa-desktop";
        }
    }
}


// ==========================================================================
// 7. اختيار فئة الدفع
// ==========================================================================

function switchPaymentCategory(
    category
) {
    currentPaymentCategory =
        category;

    const tabLocal =
        document.getElementById(
            "tabLocal"
        );

    const tabIntl =
        document.getElementById(
            "tabIntl"
        );

    if (tabLocal) {
        tabLocal.classList.toggle(
            "active",
            category === "local"
        );

        tabLocal.style.borderColor =
            "var(--border-color)";
    }

    if (tabIntl) {
        tabIntl.classList.toggle(
            "active",
            category ===
                "international"
        );

        tabIntl.style.borderColor =
            "var(--border-color)";
    }

    const availableMethods =
        getPaymentMethodsForCategory(
            category
        );

    selectedPaymentMethod =
        availableMethods.length > 0
            ? availableMethods[0]
            : "";

    const payGridContainer =
        document.getElementById(
            "dynamicPaymentMethodsGrid"
        );

    payGridContainer
        ?.classList.remove(
            "hidden"
        );

    updateDynamicUI();

    if (
        selectedPaymentMethod
    ) {
        selectPaymentMethod(
            selectedPaymentMethod
        );
    }
}


// ==========================================================================
// 8. بناء طرق الدفع ديناميكياً
// ==========================================================================

function updateDynamicUI() {

    const payGridContainer =
        document.getElementById(
            "dynamicPaymentMethodsGrid"
        );

    if (!payGridContainer) {
        return;
    }

    payGridContainer.innerHTML =
        "";

    const availableMethods =
        getPaymentMethodsForCategory(
            currentPaymentCategory
        );

    availableMethods.forEach(
        (method) => {

            const btn =
                document.createElement(
                    "button"
                );

            btn.type =
                "button";

            btn.className =
                `pay-btn-compact ${
                    selectedPaymentMethod ===
                    method
                        ? "active"
                        : ""
                }`;

            btn.onclick = () =>
                selectPaymentMethod(
                    method
                );

            let iconClass =
                "fa-solid fa-wallet";

            if (
                method ===
                    "تحويل بنكي" ||
                String(method).includes(
                    "بنك"
                )
            ) {
                iconClass =
                    "fa-solid fa-building-columns";

            } else if (
                method ===
                    "المحافظ الرقمية" ||
                String(method).includes(
                    "محفظ"
                )
            ) {
                iconClass =
                    "fa-solid fa-mobile-screen-button";

            } else if (
                String(method)
                    .toUpperCase()
                    .includes("USDT")
            ) {
                iconClass =
                    "fa-solid fa-coins";

            } else if (
                String(method)
                    .toLowerCase()
                    .includes("paypal")
            ) {
                iconClass =
                    "fa-brands fa-paypal";

            } else if (
                String(method)
                    .toLowerCase()
                    .includes("western") ||
                String(method).includes(
                    "ويسترن"
                )
            ) {
                iconClass =
                    "fa-solid fa-globe";
            }

            btn.innerHTML =
                `<i class="${iconClass}"></i> ${escapeHtml(method)}`;

            payGridContainer
                .appendChild(btn);
        }
    );
}


// ==========================================================================
// 9. اختيار طريقة الدفع
// ==========================================================================

function selectPaymentMethod(
    method
) {
    selectedPaymentMethod =
        method;

    updateDynamicUI();

    renderStep2PaymentFields();

    calculateTotal();
}


// ==========================================================================
// 10. حساب الكمية
// ==========================================================================

function adjustQty(amount) {

    if (!selectedPlatform) {
        selectPlatform(
            "PlayStation"
        );
    }

    currentQty +=
        Number(amount || 0);

    if (currentQty < 0) {
        currentQty = 0;
    }

    const qtyInput =
        document.getElementById(
            "quantityInput"
        );

    if (qtyInput) {
        qtyInput.value =
            currentQty > 0
                ? currentQty.toLocaleString(
                    "en-US"
                )
                : "";

        qtyInput.style.borderColor =
            "var(--border-color)";
    }

    const range =
        document.getElementById(
            "qtyRange"
        );

    if (range) {
        range.value =
            currentQty;
    }

    calculateTotal();
}


// ==========================================================================
// 11. إدخال الكمية
// ==========================================================================

function formatAndCalculate(
    input
) {

    if (!selectedPlatform) {
        selectPlatform(
            "PlayStation"
        );
    }

    let val =
        input.value.replace(
            /[^0-9]/g,
            ""
        );

    currentQty =
        val === ""
            ? 0
            : parseInt(
                val,
                10
            );

    input.value =
        currentQty > 0
            ? currentQty.toLocaleString(
                "en-US"
            )
            : "";

    input.style.borderColor =
        "var(--border-color)";

    const range =
        document.getElementById(
            "qtyRange"
        );

    if (range) {
        range.value =
            currentQty;
    }

    calculateTotal();
}


// ==========================================================================
// 12. Slider
// ==========================================================================

function sliderChanged(
    slider
) {

    if (!selectedPlatform) {
        selectPlatform(
            "PlayStation"
        );
    }

    currentQty =
        parseInt(
            slider.value,
            10
        ) || 0;

    const qtyInput =
        document.getElementById(
            "quantityInput"
        );

    if (qtyInput) {
        qtyInput.value =
            currentQty > 0
                ? currentQty.toLocaleString(
                    "en-US"
                )
                : "";

        qtyInput.style.borderColor =
            "var(--border-color)";
    }

    calculateTotal();
}


// ==========================================================================
// 13. حساب السعر
// ==========================================================================

function calculateTotal() {

    if (!selectedPlatform) {
        return;
    }

    const totalEl =
        document.getElementById(
            "totalAmountText"
        );

    if (!totalEl) {
        return;
    }

    const millions =
        currentQty / 1000000;

    const totalSar =
        millions * Number(
            currentRate || 0
        );

    const isDollar =
        currentPaymentCategory ===
        "international";

    if (isDollar) {

        const totalUsd =
            totalSar / 3.75;

        totalEl.innerHTML =
            `$${totalUsd.toFixed(2)}`;

    } else {

        totalEl.innerHTML =
            `${totalSar.toFixed(2)} ر.س`;
    }
}


// ==========================================================================
// 14. حقول الدفع
// ==========================================================================

function renderStep2PaymentFields() {

    const container =
        document.getElementById(
            "step2PaymentFieldsContainer"
        );

    if (!container) {
        return;
    }

    const method =
        getSelectedPaymentCode();

    // ------------------------------------------------------
    // Bank
    // ------------------------------------------------------

    if (method === "bank") {

        const banksList =
            Array.isArray(
                storeSettings.banks
            )
                ? storeSettings.banks
                : [];

        const optionsHtml =
            banksList
                .map(
                    (bank) =>
                        `<option value="${escapeHtml(bank)}">${escapeHtml(bank)}</option>`
                )
                .join("");

        container.innerHTML = `
            <label class="field-label">
                اسم البنك المحول إليه
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <select id="bankNameSelect" required>
                    ${optionsHtml}
                </select>
            </div>

            <label class="field-label">
                الاسم الكامل للحساب البنكي
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="accountName"
                    placeholder="الاسم كما في الحساب البنكي"
                    required
                >
            </div>

            <label class="field-label">
                رقم الإيبان (IBAN)
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="iban"
                    placeholder="SA0000000000000000000000"
                    required
                >
            </div>
        `;

        return;
    }

    // ------------------------------------------------------
    // Wallet
    // ------------------------------------------------------

    if (method === "wallet") {

        const walletsList =
            Array.isArray(
                storeSettings.wallets
            )
                ? storeSettings.wallets
                : [];

        const optionsHtml =
            walletsList
                .map(
                    (wallet) =>
                        `<option value="${escapeHtml(wallet)}">${escapeHtml(wallet)}</option>`
                )
                .join("");

        container.innerHTML = `
            <label class="field-label">
                اسم المحفظة الرقمية
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <select id="walletTypeSelect" required>
                    ${optionsHtml}
                </select>
            </div>

            <label class="field-label">
                رقم الجوال المرتبط بالمحفظة
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <input
                    type="tel"
                    id="walletNumber"
                    placeholder="9665xxxxxxxx"
                    oninput="convertArabicNumbersToEnglish(this)"
                    required
                >
            </div>
        `;

        return;
    }

    // ------------------------------------------------------
    // USDT
    // ------------------------------------------------------

    if (method === "usdt") {

        container.innerHTML = `
            <label class="field-label">
                عنوان المحفظة (USDT TRC20)
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="usdtWalletType"
                    placeholder="أدخل عنوان محفظة USDT الخاص بك"
                    required
                >
            </div>
        `;

        return;
    }

    // ------------------------------------------------------
    // PayPal
    // ------------------------------------------------------

    if (method === "paypal") {

        container.innerHTML = `
            <label class="field-label">
                بريد PayPal الإلكتروني
                <span style="color:#ef4444">*</span>:
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

    // ------------------------------------------------------
    // Western Union
    // ------------------------------------------------------

    if (method === "western") {

        container.innerHTML = `
            <label class="field-label">
                الاسم الكامل بالإنجليزية حسب الهوية
                <span style="color:#ef4444">*</span>:
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
                الدولة
                <span style="color:#ef4444">*</span>:
            </label>

            <div class="input-box-wrap">
                <input
                    type="text"
                    id="wuCountry"
                    placeholder="مثال: Saudi Arabia"
                    required
                >
            </div>
        `;

        return;
    }

    container.innerHTML = "";
}


// ==========================================================================
// 15. التنقل
// ==========================================================================

function showScreen(
    screenId
) {

    [
        "step1Screen",
        "step2Screen",
        "step3ReviewScreen",
        "step4SuccessScreen"
    ].forEach(
        (id) => {
            document
                .getElementById(id)
                ?.classList.add(
                    "hidden"
                );
        }
    );

    document
        .getElementById(screenId)
        ?.classList.remove(
            "hidden"
        );

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


// ==========================================================================
// 16. الانتقال للخطوة الثانية
// ==========================================================================

function goToStep2() {

    if (!selectedPlatform) {

        document
            .querySelector(
                ".platforms-flex"
            )
            ?.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

        return;
    }

    if (!currentPaymentCategory) {

        const payBox =
            document.getElementById(
                "paymentCategoryCard"
            );

        if (payBox) {
            payBox.style.borderColor =
                "#ef4444";

            payBox.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    if (
        currentQty <
            minLimit ||
        (
            maxLimit > 0 &&
            currentQty >
                maxLimit
        )
    ) {

        const qtyWrap =
            document.getElementById(
                "quantityInput"
            );

        if (qtyWrap) {
            qtyWrap.style.borderColor =
                "#ef4444";

            qtyWrap.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    renderStep2PaymentFields();

    showScreen(
        "step2Screen"
    );
}


// ==========================================================================
// 17. عرض تفاصيل الدفع في المراجعة
// ==========================================================================

function buildPaymentDetailsHTML() {

    const method =
        getSelectedPaymentCode();

    let html = "";

    if (method === "bank") {

        const bank =
            document.getElementById(
                "bankNameSelect"
            )?.value || "";

        const name =
            document.getElementById(
                "accountName"
            )?.value
                ?.trim() || "";

        const iban =
            document.getElementById(
                "iban"
            )?.value
                ?.trim() || "";

        html = `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    تحويل بنكي (${escapeHtml(bank)})
                </span>
            </div>

            <div class="field-label">
                اسم الحساب:
            </div>

            <div class="review-value-box">
                <span>
                    ${escapeHtml(name)}
                </span>
            </div>

            <div class="field-label">
                الإيبان:
            </div>

            <div class="review-value-box">
                <span>
                    ${escapeHtml(iban)}
                </span>
            </div>
        `;

    } else if (
        method === "wallet"
    ) {

        const wallet =
            document.getElementById(
                "walletTypeSelect"
            )?.value || "";

        const phone =
            document.getElementById(
                "walletNumber"
            )?.value
                ?.trim() || "";

        html = `
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

    } else if (
        method === "usdt"
    ) {

        const addr =
            document.getElementById(
                "usdtWalletType"
            )?.value
                ?.trim() || "";

        html = `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    USDT: ${escapeHtml(addr)}
                </span>
            </div>
        `;

    } else if (
        method === "paypal"
    ) {

        const email =
            document.getElementById(
                "paypalEmail"
            )?.value
                ?.trim() || "";

        html = `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    PayPal: ${escapeHtml(email)}
                </span>
            </div>
        `;

    } else if (
        method === "western"
    ) {

        const name =
            document.getElementById(
                "wuName"
            )?.value
                ?.trim() || "";

        const country =
            document.getElementById(
                "wuCountry"
            )?.value
                ?.trim() || "";

        html = `
            <div class="field-label">
                طريقة التحويل:
            </div>

            <div class="review-value-box">
                <span>
                    Western Union
                    (${escapeHtml(name)}
                    - ${escapeHtml(country)})
                </span>
            </div>
        `;
    }

    return html;
}


// ==========================================================================
// 18. بيانات الدفع الموحدة
// ==========================================================================

function getPayoutDetailsObject() {
    return getCurrentPayoutDataFromForm();
}


// ==========================================================================
// 19. مراجعة الطلب
// ==========================================================================

function goToReview() {

    const nameInput =
        document.getElementById(
            "customerName"
        );

    const phoneInput =
        document.getElementById(
            "customerPhone"
        );

    const emailInput =
        document.getElementById(
            "eaEmail"
        );

    const passInput =
        document.getElementById(
            "eaPass"
        );

    const c1Input =
        document.getElementById(
            "code1"
        );

    const c2Input =
        document.getElementById(
            "code2"
        );

    const c3Input =
        document.getElementById(
            "code3"
        );

    const termsCheck =
        document.getElementById(
            "termsCheck"
        );

    [
        nameInput,
        phoneInput,
        emailInput,
        passInput,
        c1Input,
        c2Input,
        c3Input
    ].forEach(
        (el) => {
            if (el) {
                el.style.borderColor =
                    "var(--border-color)";
            }
        }
    );

    if (
        !nameInput ||
        !nameInput.value.trim()
    ) {
        if (nameInput) {
            nameInput.style.borderColor =
                "#ef4444";

            nameInput.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    if (
        !phoneInput ||
        !phoneInput.value.trim()
    ) {
        if (phoneInput) {
            phoneInput.style.borderColor =
                "#ef4444";

            phoneInput.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    if (
        !emailInput ||
        !emailInput.value.trim()
    ) {
        if (emailInput) {
            emailInput.style.borderColor =
                "#ef4444";

            emailInput.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    const pass =
        passInput
            ? passInput.value.trim()
            : "";

    const hasUpperCase =
        /[A-Z]/.test(pass);

    if (!hasUpperCase) {
        if (passInput) {
            passInput.style.borderColor =
                "#ef4444";

            passInput.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    if (
        !c1Input ||
        !c1Input.value.trim()
    ) {
        if (c1Input) {
            c1Input.style.borderColor =
                "#ef4444";

            c1Input.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    if (
        !c2Input ||
        !c2Input.value.trim()
    ) {
        if (c2Input) {
            c2Input.style.borderColor =
                "#ef4444";

            c2Input.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    if (
        !c3Input ||
        !c3Input.value.trim()
    ) {
        if (c3Input) {
            c3Input.style.borderColor =
                "#ef4444";

            c3Input.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }

        return;
    }

    // ------------------------------------------------------
    // الشروط
    // ------------------------------------------------------

    if (
        storeSettings.termsEnabled &&
        termsCheck &&
        !termsCheck.checked
    ) {

        if (termsCheck.parentElement) {
            termsCheck.parentElement.style.color =
                "#ef4444";
        }

        termsCheck.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        return;

    } else if (termsCheck) {

        if (termsCheck.parentElement) {
            termsCheck.parentElement.style.color =
                "inherit";
        }
    }

    // ------------------------------------------------------
    // حقول الدفع
    // ------------------------------------------------------

    const dynamicFields =
        document.querySelectorAll(
            "#step2PaymentFieldsContainer input, #step2PaymentFieldsContainer select"
        );

    for (
        const field of dynamicFields
    ) {

        if (!String(field.value).trim()) {

            field.style.borderColor =
                "#ef4444";

            field.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            return;
        }
    }

    // ------------------------------------------------------
    // البيانات
    // ------------------------------------------------------

    const name =
        nameInput.value.trim();

    const phoneVal =
        phoneInput.value.trim();

    const email =
        emailInput.value.trim();

    const c1 =
        c1Input.value.trim();

    const c2 =
        c2Input.value.trim();

    const c3 =
        c3Input.value.trim();

    // ------------------------------------------------------
    // منصة المراجعة
    // ------------------------------------------------------

    const platBox =
        document.getElementById(
            "revPlatformBoxTheme"
        );

    const revIcon =
        document.getElementById(
            "revPlatformIcon"
        );

    if (
        platBox &&
        revIcon
    ) {

        platBox.className =
            "review-styled-box";

        if (
            selectedPlatform ===
            "PlayStation"
        ) {

            platBox.classList.add(
                "ps-theme"
            );

            revIcon.className =
                "fa-brands fa-playstation";

        } else if (
            selectedPlatform ===
            "Xbox"
        ) {

            platBox.classList.add(
                "xbox-theme"
            );

            revIcon.className =
                "fa-brands fa-xbox";

        } else if (
            selectedPlatform ===
            "PC"
        ) {

            platBox.classList.add(
                "pc-theme"
            );

            revIcon.className =
                "fa-solid fa-desktop";
        }
    }

    // ------------------------------------------------------
    // عناصر المراجعة
    // ------------------------------------------------------

    const revQtyEl =
        document.getElementById(
            "revQty"
        );

    const revTotalEl =
        document.getElementById(
            "revTotal"
        );

    const revEmailEl =
        document.getElementById(
            "revEmail"
        );

    const revPassEl =
        document.getElementById(
            "revPass"
        );

    const revCodesEl =
        document.getElementById(
            "revCodes"
        );

    const revClientNameEl =
        document.getElementById(
            "revClientName"
        );

    const revClientPhoneEl =
        document.getElementById(
            "revClientPhone"
        );

    if (revQtyEl) {
        revQtyEl.innerText =
            currentQty.toLocaleString(
                "en-US"
            );
    }

    if (revTotalEl) {
        revTotalEl.innerText =
            getCurrentDisplayedTotal();
    }

    if (revEmailEl) {
        revEmailEl.innerText =
            email;
    }

    if (revPassEl) {
        revPassEl.innerText =
            pass;
    }

    if (revCodesEl) {

        revCodesEl.innerHTML = `
            <div class="backup-codes-stack">
                <div class="code-display-row">
                    <span class="code-number-tag">#1</span>
                    <span>${escapeHtml(c1)}</span>
                </div>

                <div class="code-display-row">
                    <span class="code-number-tag">#2</span>
                    <span>${escapeHtml(c2)}</span>
                </div>

                <div class="code-display-row">
                    <span class="code-number-tag">#3</span>
                    <span>${escapeHtml(c3)}</span>
                </div>
            </div>
        `;
    }

    if (revClientNameEl) {
        revClientNameEl.innerText =
            name;
    }

    if (revClientPhoneEl) {
        revClientPhoneEl.innerText =
            phoneVal;
    }

    const revSpecDetails =
        document.getElementById(
            "revSpecificDetailsContainer"
        );

    if (revSpecDetails) {
        revSpecDetails.innerHTML =
            buildPaymentDetailsHTML();
    }

    // ------------------------------------------------------
    // تعبئة حقول التعديل
    // ------------------------------------------------------

    const editEaEmailEl =
        document.getElementById(
            "editEaEmail"
        );

    const editEaPassEl =
        document.getElementById(
            "editEaPass"
        );

    const editCode1El =
        document.getElementById(
            "editCode1"
        );

    const editCode2El =
        document.getElementById(
            "editCode2"
        );

    const editCode3El =
        document.getElementById(
            "editCode3"
        );

    const editClientNameEl =
        document.getElementById(
            "editClientName"
        );

    const editClientPhoneEl =
        document.getElementById(
            "editClientPhone"
        );

    const inlineQtyInputEl =
        document.getElementById(
            "inlineQtyInput"
        );

    if (editEaEmailEl) {
        editEaEmailEl.value =
            email;
    }

    if (editEaPassEl) {
        editEaPassEl.value =
            pass;
    }

    if (editCode1El) {
        editCode1El.value =
            c1;
    }

    if (editCode2El) {
        editCode2El.value =
            c2;
    }

    if (editCode3El) {
        editCode3El.value =
            c3;
    }

    if (editClientNameEl) {
        editClientNameEl.value =
            name;
    }

    if (editClientPhoneEl) {
        editClientPhoneEl.value =
            phoneVal;
    }

    if (inlineQtyInputEl) {
        inlineQtyInputEl.value =
            currentQty.toLocaleString(
                "en-US"
            );
    }

    // ------------------------------------------------------
    // تعديل الدفع
    // ------------------------------------------------------

    const payoutWrap =
        document.getElementById(
            "inlinePayoutEditWrap"
        );

    if (payoutWrap) {

        const method =
            getSelectedPaymentCode();

        if (method === "bank") {

            payoutWrap.innerHTML = `
                <label class="field-label">
                    اسم البنك:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editBankName"
                        value="${escapeHtml(
                            document.getElementById(
                                "bankNameSelect"
                            )?.value || ""
                        )}"
                    >
                </div>

                <label class="field-label">
                    الاسم:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editAccountName"
                        value="${escapeHtml(
                            document.getElementById(
                                "accountName"
                            )?.value || ""
                        )}"
                    >
                </div>

                <label class="field-label">
                    الإيبان:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editIban"
                        value="${escapeHtml(
                            document.getElementById(
                                "iban"
                            )?.value || ""
                        )}"
                    >
                </div>
            `;

        } else if (
            method === "wallet"
        ) {

            payoutWrap.innerHTML = `
                <label class="field-label">
                    اسم المحفظة:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editWalletName"
                        value="${escapeHtml(
                            document.getElementById(
                                "walletTypeSelect"
                            )?.value || ""
                        )}"
                    >
                </div>

                <label class="field-label">
                    رقم الجوال للمحفظة:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="tel"
                        id="editWalletNumber"
                        value="${escapeHtml(
                            document.getElementById(
                                "walletNumber"
                            )?.value || ""
                        )}"
                        oninput="convertArabicNumbersToEnglish(this)"
                    >
                </div>
            `;

        } else if (
            method === "usdt"
        ) {

            payoutWrap.innerHTML = `
                <label class="field-label">
                    عنوان USDT:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editUsdtWalletType"
                        value="${escapeHtml(
                            document.getElementById(
                                "usdtWalletType"
                            )?.value || ""
                        )}"
                    >
                </div>
            `;

        } else if (
            method === "paypal"
        ) {

            payoutWrap.innerHTML = `
                <label class="field-label">
                    بريد PayPal:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="email"
                        id="editPaypalEmail"
                        value="${escapeHtml(
                            document.getElementById(
                                "paypalEmail"
                            )?.value || ""
                        )}"
                    >
                </div>
            `;

        } else if (
            method === "western"
        ) {

            payoutWrap.innerHTML = `
                <label class="field-label">
                    الاسم بالإنجليزية:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editWuName"
                        value="${escapeHtml(
                            document.getElementById(
                                "wuName"
                            )?.value || ""
                        )}"
                    >
                </div>

                <label class="field-label">
                    الدولة:
                </label>

                <div class="input-box-wrap">
                    <input
                        type="text"
                        id="editWuCountry"
                        value="${escapeHtml(
                            document.getElementById(
                                "wuCountry"
                            )?.value || ""
                        )}"
                    >
                </div>
            `;
        }
    }

    showScreen(
        "step3ReviewScreen"
    );
}


// ==========================================================================
// 20. تعديل الكل
// ==========================================================================

function toggleEditMode() {

    isEditingAll =
        !isEditingAll;

    const btn =
        document.getElementById(
            "editToggleBtn"
        );

    [
        "editPlatformQtyPanel",
        "eaEditMode",
        "clientEditMode",
        "payoutEditMode",
        "saveEditsButtonWrap"
    ].forEach(
        (id) => {
            document
                .getElementById(id)
                ?.classList.toggle(
                    "hidden",
                    !isEditingAll
                );
        }
    );

    [
        "eaViewMode",
        "clientViewMode",
        "payoutViewMode"
    ].forEach(
        (id) => {
            document
                .getElementById(id)
                ?.classList.toggle(
                    "hidden",
                    isEditingAll
                );
        }
    );

    if (isEditingAll) {

        if (btn) {

            btn.innerHTML =
                `<i class="fa-solid fa-xmark"></i> إغلاق التعديل`;

            btn.style.background =
                "rgba(239, 68, 68, 0.15)";

            btn.style.borderColor =
                "var(--pc-color)";

            btn.style.color =
                "var(--pc-color)";
        }

        return;
    }

    // ------------------------------------------------------
    // حفظ التعديلات في الصفحة
    // ------------------------------------------------------

    const newEmail =
        document.getElementById(
            "editEaEmail"
        )?.value || "";

    const newPass =
        document.getElementById(
            "editEaPass"
        )?.value || "";

    const newC1 =
        document.getElementById(
            "editCode1"
        )?.value || "";

    const newC2 =
        document.getElementById(
            "editCode2"
        )?.value || "";

    const newC3 =
        document.getElementById(
            "editCode3"
        )?.value || "";

    const newName =
        document.getElementById(
            "editClientName"
        )?.value || "";

    const newPhone =
        document.getElementById(
            "editClientPhone"
        )?.value || "";

    if (
        document.getElementById(
            "eaEmail"
        )
    ) {
        document.getElementById(
            "eaEmail"
        ).value =
            newEmail;
    }

    if (
        document.getElementById(
            "eaPass"
        )
    ) {
        document.getElementById(
            "eaPass"
        ).value =
            newPass;
    }

    if (
        document.getElementById(
            "customerName"
        )
    ) {
        document.getElementById(
            "customerName"
        ).value =
            newName;
    }

    if (
        document.getElementById(
            "customerPhone"
        )
    ) {
        document.getElementById(
            "customerPhone"
        ).value =
            newPhone;
    }

    const revEmailEl =
        document.getElementById(
            "revEmail"
        );

    const revPassEl =
        document.getElementById(
            "revPass"
        );

    const revCodesEl =
        document.getElementById(
            "revCodes"
        );

    const revClientNameEl =
        document.getElementById(
            "revClientName"
        );

    const revClientPhoneEl =
        document.getElementById(
            "revClientPhone"
        );

    if (revEmailEl) {
        revEmailEl.innerText =
            newEmail;
    }

    if (revPassEl) {
        revPassEl.innerText =
            newPass;
    }

    if (revCodesEl) {

        revCodesEl.innerHTML = `
            <div class="backup-codes-stack">
                <div class="code-display-row">
                    <span class="code-number-tag">#1</span>
                    <span>${escapeHtml(newC1)}</span>
                </div>

                <div class="code-display-row">
                    <span class="code-number-tag">#2</span>
                    <span>${escapeHtml(newC2)}</span>
                </div>

                <div class="code-display-row">
                    <span class="code-number-tag">#3</span>
                    <span>${escapeHtml(newC3)}</span>
                </div>
            </div>
        `;
    }

    if (revClientNameEl) {
        revClientNameEl.innerText =
            newName;
    }

    if (revClientPhoneEl) {
        revClientPhoneEl.innerText =
            newPhone;
    }

    const method =
        getSelectedPaymentCode();

    if (method === "bank") {

        const bankName =
            document.getElementById(
                "editBankName"
            )?.value || "";

        const accountName =
            document.getElementById(
                "editAccountName"
            )?.value || "";

        const iban =
            document.getElementById(
                "editIban"
            )?.value || "";

        if (
            document.getElementById(
                "bankNameSelect"
            )
        ) {
            document.getElementById(
                "bankNameSelect"
            ).value =
                bankName;
        }

        if (
            document.getElementById(
                "accountName"
            )
        ) {
            document.getElementById(
                "accountName"
            ).value =
                accountName;
        }

        if (
            document.getElementById(
                "iban"
            )
        ) {
            document.getElementById(
                "iban"
            ).value =
                iban;
        }

    } else if (
        method === "wallet"
    ) {

        const walletName =
            document.getElementById(
                "editWalletName"
            )?.value || "";

        const walletNumber =
            document.getElementById(
                "editWalletNumber"
            )?.value || "";

        if (
            document.getElementById(
                "walletTypeSelect"
            )
        ) {
            document.getElementById(
                "walletTypeSelect"
            ).value =
                walletName;
        }

        if (
            document.getElementById(
                "walletNumber"
            )
        ) {
            document.getElementById(
                "walletNumber"
            ).value =
                walletNumber;
        }

    } else if (
        method === "usdt"
    ) {

        const wallet =
            document.getElementById(
                "editUsdtWalletType"
            )?.value || "";

        if (
            document.getElementById(
                "usdtWalletType"
            )
        ) {
            document.getElementById(
                "usdtWalletType"
            ).value =
                wallet;
        }

    } else if (
        method === "paypal"
    ) {

        const email =
            document.getElementById(
                "editPaypalEmail"
            )?.value || "";

        if (
            document.getElementById(
                "paypalEmail"
            )
        ) {
            document.getElementById(
                "paypalEmail"
            ).value =
                email;
        }

    } else if (
        method === "western"
    ) {

        const name =
            document.getElementById(
                "editWuName"
            )?.value || "";

        const country =
            document.getElementById(
                "editWuCountry"
            )?.value || "";

        if (
            document.getElementById(
                "wuName"
            )
        ) {
            document.getElementById(
                "wuName"
            ).value =
                name;
        }

        if (
            document.getElementById(
                "wuCountry"
            )
        ) {
            document.getElementById(
                "wuCountry"
            ).value =
                country;
        }
    }

    const revSpecDetails =
        document.getElementById(
            "revSpecificDetailsContainer"
        );

    if (revSpecDetails) {
        revSpecDetails.innerHTML =
            buildPaymentDetailsHTML();
    }

    if (btn) {

        btn.innerHTML =
            `<i class="fa-solid fa-pen-to-square"></i> تعديل الكل`;

        btn.style.background =
            "rgba(0,210,255,0.12)";

        btn.style.borderColor =
            "var(--accent-color)";

        btn.style.color =
            "var(--accent-color)";
    }
}


// ==========================================================================
// 21. تعديل المنصة داخل المراجعة
// ==========================================================================

function selectPlatformInline(
    platform
) {

    selectPlatform(
        platform
    );

    const platBox =
        document.getElementById(
            "revPlatformBoxTheme"
        );

    const revIcon =
        document.getElementById(
            "revPlatformIcon"
        );

    if (
        platBox &&
        revIcon
    ) {

        platBox.className =
            "review-styled-box";

        if (
            platform ===
            "PlayStation"
        ) {

            platBox.classList.add(
                "ps-theme"
            );

            revIcon.className =
                "fa-brands fa-playstation";

        } else if (
            platform ===
            "Xbox"
        ) {

            platBox.classList.add(
                "xbox-theme"
            );

            revIcon.className =
                "fa-brands fa-xbox";

        } else if (
            platform ===
            "PC"
        ) {

            platBox.classList.add(
                "pc-theme"
            );

            revIcon.className =
                "fa-solid fa-desktop";
        }
    }

    const revTotalEl =
        document.getElementById(
            "revTotal"
        );

    if (revTotalEl) {
        revTotalEl.innerText =
            getCurrentDisplayedTotal();
    }
}


// ==========================================================================
// 22. تعديل الكمية داخل المراجعة
// ==========================================================================

function adjustQtyInline(
    amount
) {

    adjustQty(
        amount
    );

    const inlineQtyInputEl =
        document.getElementById(
            "inlineQtyInput"
        );

    const revQtyEl =
        document.getElementById(
            "revQty"
        );

    const revTotalEl =
        document.getElementById(
            "revTotal"
        );

    if (inlineQtyInputEl) {
        inlineQtyInputEl.value =
            currentQty > 0
                ? currentQty.toLocaleString(
                    "en-US"
                )
                : "";
    }

    if (revQtyEl) {
        revQtyEl.innerText =
            currentQty.toLocaleString(
                "en-US"
            );
    }

    if (revTotalEl) {
        revTotalEl.innerText =
            getCurrentDisplayedTotal();
    }
}


// ==========================================================================
// 23. إدخال الكمية داخل المراجعة
// ==========================================================================

function formatAndCalculateInline(
    input
) {

    formatAndCalculate(
        input
    );

    const revQtyEl =
        document.getElementById(
            "revQty"
        );

    const revTotalEl =
        document.getElementById(
            "revTotal"
        );

    if (revQtyEl) {
        revQtyEl.innerText =
            currentQty.toLocaleString(
                "en-US"
            );
    }

    if (revTotalEl) {
        revTotalEl.innerText =
            getCurrentDisplayedTotal();
    }
}


// ==========================================================================
// 24. إنشاء الطلب
// ==========================================================================

async function submitOrderFinal() {

    if (isEditingAll) {
        toggleEditMode();
    }

    const payoutDetails =
        getPayoutDetailsObject();

    const accountData = {
        eaEmail:
            document.getElementById(
                "eaEmail"
            )?.value
                ?.trim() || "",

        eaPassword:
            document.getElementById(
                "eaPass"
            )?.value
                ?.trim() || "",

        backupCodes: [
            document.getElementById(
                "code1"
            )?.value
                ?.trim() || "",

            document.getElementById(
                "code2"
            )?.value
                ?.trim() || "",

            document.getElementById(
                "code3"
            )?.value
                ?.trim() || ""
        ]
    };

    const orderData = {

        customerName:
            document.getElementById(
                "customerName"
            )?.value
                ?.trim() || "",

        phone:
            document.getElementById(
                "customerPhone"
            )?.value
                ?.trim() || "",

        platform:
            selectedPlatform,

        quantity:
            currentQty,

        /*
         * Kept for compatibility/display.
         * Backend remains authoritative.
         */
        totalPrice:
            getCurrentDisplayedTotal(),

        /*
         * Legacy display field.
         */
        paymentMethod:
            selectedPaymentMethod,

        /*
         * Backend compatibility.
         */
        paymentMethodType:
            payoutDetails.method,

        /*
         * Canonical schema.
         */
        payoutDetails,

        /*
         * EA data.
         * Backend encrypts immediately.
         */
        accountData
    };

    try {

        const res =
            await fetch(
                "/api/orders/create",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            orderData
                        )
                }
            );

        const data =
            await res.json();

        if (
            !res.ok ||
            !data.success
        ) {
            throw new Error(
                data.message ||
                "تعذر إنشاء الطلب."
            );
        }

        /*
         * The customer-facing tracking number
         * is referenceNumber.
         */
        generatedReferenceNumber =
            data.referenceNumber || "";

        generatedOrderId =
            data.orderId || "";

        generatedDocumentId =
            data.documentId || "";

        /*
         * Keep the existing UI using the reference
         * as the main number shown to the customer.
         */
        document.getElementById(
            "finalOrderId"
        ).innerText =
            generatedReferenceNumber;

        document.getElementById(
            "billClientName"
        ).innerText =
            orderData.customerName;

        document.getElementById(
            "billClientPhone"
        ).innerText =
            orderData.phone;

        document.getElementById(
            "billPlatform"
        ).innerText =
            selectedPlatform;

        document.getElementById(
            "billQty"
        ).innerText =
            currentQty.toLocaleString(
                "en-US"
            ) + " كوينز";

        document.getElementById(
            "billTotal"
        ).innerText =
            getCurrentDisplayedTotal();

        const billPaymentCardEl =
            document.getElementById(
                "billPaymentCard"
            );

        if (billPaymentCardEl) {

            billPaymentCardEl.innerHTML = `
                <div class="box-card-title">
                    <i class="fa-solid fa-wallet"></i>
                    تفاصيل التحويل والاستلام
                </div>

                ${buildPaymentDetailsHTML()}
            `;
        }

        showScreen(
            "step4SuccessScreen"
        );

    } catch (err) {

        alert(
            "فشل إنشاء الطلب: " +
            (
                err?.message ||
                "خطأ غير معروف"
            )
        );

        console.error(
            "Create Order Error:",
            err
        );
    }
}


// ==========================================================================
// 25. النوافذ المنبثقة
// ==========================================================================

function openModal(
    title,
    content
) {

    const modalTitleEl =
        document.getElementById(
            "modalTitle"
        );

    const modalBodyContentEl =
        document.getElementById(
            "modalBodyContent"
        );

    const customModalEl =
        document.getElementById(
            "customModal"
        );

    if (modalTitleEl) {
        modalTitleEl.innerText =
            title;
    }

    if (modalBodyContentEl) {
        modalBodyContentEl.innerHTML =
            content;
    }

    if (customModalEl) {
        customModalEl.classList.add(
            "active"
        );
    }
}

function closeModal() {

    document
        .getElementById(
            "customModal"
        )
        ?.classList.remove(
            "active"
        );
}


// ==========================================================================
// 26. دليل Backup Codes
// ==========================================================================

function openBackupGuideModal() {

    openModal(
        "طريقة استخراج الأكواد الاحتياطية",
        `
        <div style="text-align:right;">
            <p>
                1. قم بتسجيل الدخول إلى حسابك في موقع EA عبر الرابط الرسمي.
                <br>
                2. اذهب إلى إعدادات الحساب (Account Settings).
                <br>
                3. اختر تبويب الأمان (Security).
                <br>
                4. ابحث عن خيار Backup Codes وانقر على View لاستخراج الأكواد.
            </p>
        </div>
        `
    );
}


// ==========================================================================
// 27. الدعم الفني
// ==========================================================================

function showSupportModal() {

    const supportNumber =
        getSupportWhatsappNumber();

    const whatsappLink =
        supportNumber
            ? `https://wa.me/${supportNumber}`
            : "#";

    openModal(
        "الدعم الفني والخدمة",
        `
        <div style="text-align:center;">

            <p style="margin-bottom:10px;">
                نحن هنا لخدمتك على مدار الساعة طوال أيام الأسبوع.
            </p>

            ${
                supportNumber
                    ? `
                        <a
                            href="${whatsappLink}"
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
                            التواصل المباشر عبر واتساب
                        </a>
                    `
                    : `
                        <p style="color:#ef4444;">
                            رقم الدعم غير متوفر حاليًا.
                        </p>
                    `
            }

        </div>
        `
    );
}


// ==========================================================================
// 28. الخصوصية
// ==========================================================================

function showPrivacyModal() {

    openModal(
        "سياسة الخصوصية والأمان",
        `
        <div style="text-align:right;">
            <p>
                نحن نضمن حماية كافة بياناتك وحساباتك
                بأعلى معايير التشفير والأمان المعتمدة
                دون مشاركتها مع أي طرف ثالث.
            </p>
        </div>
        `
    );
}


// ==========================================================================
// 29. الشروط
// ==========================================================================

function showTermsModal() {

    openModal(
        "شروط وقواعد الخدمة",
        `
        <div style="text-align:right;">
            <p>
                يجب التأكد من صحة بيانات الحساب والأكواد
                الاحتياطية، وأن يكون سوق الانتقالات مفتوحاً
                في تطبيق الويب لضمان سرعة إنجاز الطلب
                في المواعيد المحددة.
            </p>
        </div>
        `
    );
}


// ==========================================================================
// 30. نسخ رقم التتبع
// ==========================================================================

function copyOrderId() {

    if (
        generatedReferenceNumber
    ) {

        navigator.clipboard
            ?.writeText(
                generatedReferenceNumber
            )
            .catch(
                () => {}
            );
    }
}


// ==========================================================================
// 31. صفحة التتبع
// ==========================================================================

function openInquiryPage() {

    const ref =
        generatedReferenceNumber;

    if (ref) {
        window.location.href =
            `/tracking/?ref=${encodeURIComponent(
                ref
            )}`;

        return;
    }

    window.location.href =
        "/tracking/";
}


// ==========================================================================
// 32. إرسال الطلب عبر WhatsApp
// ==========================================================================

function sendOrderViaWhatsapp() {

    const supportNumber =
        getSupportWhatsappNumber();

    if (!supportNumber) {

        alert(
            "رقم الدعم غير متوفر حاليًا."
        );

        return;
    }

    const clientName =
        document.getElementById(
            "customerName"
        )?.value
            ?.trim() || "--";

    const clientPhone =
        document.getElementById(
            "customerPhone"
        )?.value
            ?.trim() || "--";

    const emailVal =
        document.getElementById(
            "eaEmail"
        )?.value
            ?.trim() || "--";

    const passVal =
        document.getElementById(
            "eaPass"
        )?.value
            ?.trim() || "--";

    const c1 =
        document.getElementById(
            "code1"
        )?.value
            ?.trim() || "--";

    const c2 =
        document.getElementById(
            "code2"
        )?.value
            ?.trim() || "--";

    const c3 =
        document.getElementById(
            "code3"
        )?.value
            ?.trim() || "--";

    const totalVal =
        getCurrentDisplayedTotal() ||
        "--";

    const reference =
        generatedReferenceNumber ||
        "--";

    const businessOrderId =
        generatedOrderId ||
        "--";

    let paymentDetailsText =
        "";

    const method =
        getSelectedPaymentCode();

    if (method === "bank") {

        const bank =
            document.getElementById(
                "bankNameSelect"
            )?.value || "";

        const name =
            document.getElementById(
                "accountName"
            )?.value
                ?.trim() || "";

        const iban =
            document.getElementById(
                "iban"
            )?.value
                ?.trim() || "";

        paymentDetailsText = `
🏦 طريقة الدفع:
تحويل بنكي

• البنك: ${bank}
• اسم الحساب: ${name}
• IBAN: ${iban}
`;

    } else if (
        method === "wallet"
    ) {

        const wallet =
            document.getElementById(
                "walletTypeSelect"
            )?.value || "";

        const phone =
            document.getElementById(
                "walletNumber"
            )?.value
                ?.trim() || "";

        paymentDetailsText = `
📱 طريقة الدفع:
محفظة رقمية

• المحفظة: ${wallet}
• رقم الجوال: ${phone}
`;

    } else if (
        method === "usdt"
    ) {

        const wallet =
            document.getElementById(
                "usdtWalletType"
            )?.value
                ?.trim() || "";

        paymentDetailsText = `
🪙 طريقة الدفع:
USDT

• عنوان المحفظة: ${wallet}
`;

    } else if (
        method === "paypal"
    ) {

        const email =
            document.getElementById(
                "paypalEmail"
            )?.value
                ?.trim() || "";

        paymentDetailsText = `
🅿️ طريقة الدفع:
PayPal

• البريد: ${email}
`;

    } else if (
        method === "western"
    ) {

        const name =
            document.getElementById(
                "wuName"
            )?.value
                ?.trim() || "";

        const country =
            document.getElementById(
                "wuCountry"
            )?.value
                ?.trim() || "";

        paymentDetailsText = `
🌍 طريقة الدفع:
Western Union

• الاسم بالإنجليزية: ${name}
• الدولة: ${country}
`;
    }

    const message = `
طلب بيع جديد
━━━━━━━━━━━━━━━━━━

📋 بيانات الطلب
• رقم التتبع: ${reference}
• رقم الطلب: ${businessOrderId}

👤 بيانات العميل
• الاسم: ${clientName}
• رقم الجوال: ${clientPhone}

🎮 بيانات الكوينز
• المنصة: ${selectedPlatform || "--"}
• الكمية: ${currentQty.toLocaleString("en-US")} كوينز
• إجمالي المبلغ: ${totalVal}

${paymentDetailsText}

🔐 بيانات حساب EA
• البريد: ${emailVal}
• كلمة المرور: ${passVal}

🔑 الأكواد الاحتياطية
• #1: ${c1}
• #2: ${c2}
• #3: ${c3}

━━━━━━━━━━━━━━━━━━
SAMI COINS
`;

    const url =
        `https://wa.me/${supportNumber}?text=${encodeURIComponent(
            message
        )}`;

    window.open(
        url,
        "_blank",
        "noopener,noreferrer"
    );
}


// ==========================================================================
// 33. تهيئة الصفحة
// ==========================================================================

window.addEventListener(
    "DOMContentLoaded",
    () => {

        showScreen(
            "step1Screen"
        );

        loadSettings();

        const range =
            document.getElementById(
                "qtyRange"
            );

        if (range) {

            range.addEventListener(
                "input",
                () =>
                    sliderChanged(
                        range
                    )
            );
        }

        const form =
            document.getElementById(
                "orderForm"
            );

        if (form) {

            form.addEventListener(
                "submit",
                (e) => {

                    e.preventDefault();

                    goToReview();
                }
            );
        }
    }
);


// ==========================================================================
// 34. ربط الدوال مع window
// ==========================================================================

window.loadSettings =
    loadSettings;

window.applySettingsToUI =
    applySettingsToUI;

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

window.buildPaymentDetailsHTML =
    buildPaymentDetailsHTML;

window.getPayoutDetailsObject =
    getPayoutDetailsObject;

window.goToReview =
    goToReview;

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

window.openInquiryPage =
    openInquiryPage;

window.sendOrderViaWhatsapp =
    sendOrderViaWhatsapp;
