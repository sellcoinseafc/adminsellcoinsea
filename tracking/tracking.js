/**
 * SAMI COINS - tracking.js
 * Customer Tracking
 *
 * متوافق مع:
 * - الطلبات الجديدة
 * - الطلبات القديمة
 * - referenceNumber
 * - status / orderStatus
 * - drawnCoins / withdrawnQuantity
 * - issue كمشكلة مستقلة عن حالة الطلب
 * - payoutDetails / paymentInfoData
 * - Realtime Server-Sent Events (SSE)
 */

let activeRef = null;
let trackingEventSource = null;

let cachedState = {
    status: null,
    issue: null,
    drawnCoins: null,
    sensitivePurged: null
};

/* ==========================================
   إعدادات الحالات
   ========================================== */

const STATUS_CONFIG = {
    new: {
        text: "طلب جديد",
        percentage: 15,
        className: "new"
    },

    review: {
        text: "طلب بانتظار المراجعة",
        percentage: 35,
        className: "review"
    },

    progress: {
        text: "جاري سحب الكوينز من حسابك",
        percentage: 65,
        className: "executing"
    },

    finished: {
        text: "تم الانتهاء من سحب الكوينز من حسابك",
        percentage: 85,
        className: "finished"
    },

    transferred: {
        text: "تم تحويل المبلغ إلى حسابك",
        percentage: 95,
        className: "success"
    },

    completed: {
        text: "مكتمل",
        percentage: 100,
        className: "success"
    }
};

/**
 * حالات قديمة للتوافق مع الطلبات القديمة
 */
const LEGACY_STATUS_MAP = {
    pending: "new"
};

/* ==========================================
   عند فتح الصفحة
   ========================================== */

document.addEventListener("DOMContentLoaded", () => {
    setupInputFormatting();
    initTrackingSession();
});

/* ==========================================
   تهيئة جلسة التتبع
   ========================================== */

async function initTrackingSession() {
    const urlParams = new URLSearchParams(window.location.search);

    const refFromUrl = urlParams.get("ref");
    const refFromStorage = localStorage.getItem("sami_active_order");

    let targetRef = null;

    if (refFromUrl) {
        targetRef = sanitizeRef(refFromUrl);
    } else if (refFromStorage) {
        targetRef = sanitizeRef(refFromStorage);
    }

    if (targetRef) {
        const orderInput = document.getElementById("orderInput");

        if (orderInput) {
            orderInput.value = targetRef;
        }

        await fetchAndRenderOrder(targetRef);
    } else {
        showLookupView();
    }
}

/* ==========================================
   البحث عن طلب
   ========================================== */

async function handleLookupSubmit(event) {
    if (event) {
        event.preventDefault();
    }

    const orderInput = document.getElementById("orderInput");

    if (!orderInput) {
        return;
    }

    const ref = sanitizeRef(orderInput.value);

    if (!ref) {
        showLookupError("يرجى إدخال رقم الطلب");
        return;
    }

    hideLookupError();

    await fetchAndRenderOrder(ref);
}

/* ==========================================
   جلب الطلب
   ========================================== */

async function fetchAndRenderOrder(ref) {
    try {
        const response = await fetch(
            `/api/tracking/${encodeURIComponent(ref)}`,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            stopRealtimeTracking();
            showLookupView();

            showLookupError(
                "لم يتم العثور على طلب بهذا الرقم، يرجى التأكد وإعادة المحاولة."
            );

            return;
        }

        const data = await response.json();

        if (!data || !data.success || !data.order) {
            showLookupView();

            showLookupError(
                data?.message ||
                "تعذر تحميل بيانات الطلب، يرجى المحاولة لاحقاً."
            );

            return;
        }

        activeRef = sanitizeRef(
            data.order.referenceNumber ||
            ref
        );

        /*
         * تحديث الرابط بدون إعادة تحميل الصفحة
         */
        const newUrl =
            `${window.location.pathname}?ref=${encodeURIComponent(activeRef)}`;

        window.history.replaceState(
            { path: newUrl },
            "",
            newUrl
        );

        /*
         * نحفظ رقم الطلب أثناء متابعة الطلب.
         * بعد completed يمكن إزالة الجلسة.
         */
        const normalizedStatus = normalizeStatus(
            data.order.status ||
            data.order.orderStatus
        );

        if (normalizedStatus !== "completed") {
            localStorage.setItem(
                "sami_active_order",
                activeRef
            );
        }

        showTrackingView();

        updateTrackingUI(
            data.order,
            data.statusMessage,
            data.issueMessage
        );

        setupSecurityEvents();

        updateCachedState(data.order);

        startRealtimeTracking();

    } catch (error) {
        console.error("Tracking fetch error:", error);

        showLookupView();

        showLookupError(
            "حدث خطأ في الاتصال بالخادم، يُرجى المحاولة لاحقاً."
        );
    }
}

/* ==========================================
   Realtime Tracking - Server-Sent Events
   ========================================== */

/**
 * فتح قناة realtime آمنة لصفحة التتبع.
 *
 * لا نستخدم polling ولا setInterval.
 *
 * السيرفر يرسل فقط DTO آمن خاص بالتتبع، ولا يرسل:
 * - EA password
 * - EA email
 * - backup codes
 * - IBAN
 * - أرقام المحافظ
 * - أي بيانات حساسة مشفرة
 *
 * Endpoint:
 * GET /api/tracking/:referenceNumber/events
 *
 * EventSource يعيد الاتصال تلقائيًا عند انقطاع الاتصال.
 */
function startRealtimeTracking() {
    stopRealtimeTracking();

    if (!activeRef) {
        return;
    }

    if (typeof EventSource === "undefined") {
        console.error(
            "Realtime tracking is not supported by this browser."
        );

        return;
    }

    const endpoint =
        `/api/tracking/${encodeURIComponent(activeRef)}/events`;

    try {
        trackingEventSource =
            new EventSource(endpoint);

        trackingEventSource.onopen = () => {
            /*
             * الاتصال أصبح فعالًا.
             * لا نحتاج أي polling إضافي.
             */
        };

        trackingEventSource.onmessage =
            (event) => {
                handleRealtimeTrackingEvent(
                    event?.data
                );
            };

        /*
         * ندعم أيضًا event باسم "order-update"
         * إذا استخدمه السيرفر صراحة.
         */
        trackingEventSource.addEventListener(
            "order-update",
            (event) => {
                handleRealtimeTrackingEvent(
                    event?.data
                );
            }
        );

        trackingEventSource.onerror =
            (error) => {
                /*
                 * EventSource يتولى إعادة الاتصال
                 * تلقائيًا.
                 *
                 * لا نبدأ polling كبديل، لأن النظام
                 * يعتمد على realtime وليس على refresh دوري.
                 */
                console.warn(
                    "Tracking realtime connection interrupted. Browser will retry automatically.",
                    error
                );
            };

    } catch (error) {
        console.error(
            "Unable to start realtime tracking:",
            error
        );

        trackingEventSource = null;
    }
}

/**
 * معالجة حدث تحديث الطلب القادم من السيرفر.
 *
 * @param {string} rawData
 */
function handleRealtimeTrackingEvent(rawData) {
    if (!rawData) {
        return;
    }

    let data;

    try {
        data = JSON.parse(rawData);
    } catch (error) {
        console.warn(
            "Invalid realtime tracking payload.",
            error
        );

        return;
    }

    if (!data || data.success === false) {
        return;
    }

    /*
     * بعض SSE implementations قد ترسل:
     *
     * {
     *   order: {...}
     * }
     *
     * وبعضها قد ترسل:
     *
     * {
     *   success: true,
     *   order: {...}
     * }
     *
     * لذلك نعتمد على order مباشرة.
     */
    const order = data.order;

    if (!order) {
        return;
    }

    /*
     * حماية إضافية:
     * لا نقبل تحديثًا يخص طلبًا مختلفًا.
     */
    const incomingRef =
        sanitizeRef(
            order.referenceNumber ||
            data.referenceNumber ||
            ""
        );

    if (
        incomingRef &&
        activeRef &&
        incomingRef !== activeRef
    ) {
        return;
    }

    const newStatus =
        normalizeStatus(
            order.status ||
            order.orderStatus
        );

    const newIssue =
        order.issue ||
        null;

    const newDrawnCoins =
        getDrawnCoins(order);

    const newSensitivePurged =
        Boolean(
            order.sensitivePurged ||
            order.purgedAt
        );

    const hasChanged =
        newStatus !== cachedState.status ||
        newIssue !== cachedState.issue ||
        newDrawnCoins !== cachedState.drawnCoins ||
        newSensitivePurged !==
            cachedState.sensitivePurged;

    /*
     * حتى لو كان الحدث وصل بدون تغيير في
     * القيم الرئيسية، نسمح بتحديث الواجهة
     * إذا أرسل السيرفر payload جديد.
     */
    if (
        hasChanged ||
        data.forceUpdate === true
    ) {
        updateTrackingUI(
            order,
            data.statusMessage,
            data.issueMessage
        );

        setupSecurityEvents();

        updateCachedState(order);
    }

    /*
     * إذا اكتمل الطلب، نستمر في الاستماع.
     *
     * السبب:
     * قد يصل لاحقًا حدث sensitivePurged
     * من السيرفر، ويجب أن يظهر للعميل مباشرة.
     */
}

/**
 * إغلاق قناة realtime.
 */
function stopRealtimeTracking() {
    if (trackingEventSource) {
        try {
            trackingEventSource.close();
        } catch (error) {
            console.warn(
                "Error closing tracking realtime connection:",
                error
            );
        }

        trackingEventSource = null;
    }
}

/* ==========================================
   حفظ الحالة الحالية
   ========================================== */

function updateCachedState(order) {
    if (!order) {
        return;
    }

    cachedState.status = normalizeStatus(
        order.status ||
        order.orderStatus
    );

    cachedState.issue =
        order.issue ||
        null;

    cachedState.drawnCoins =
        getDrawnCoins(order);

    cachedState.sensitivePurged =
        Boolean(
            order.sensitivePurged ||
            order.purgedAt
        );
}

/* ==========================================
   إعادة الصفحة للبحث
   ========================================== */

function resetToLookup() {
    stopRealtimeTracking();

    activeRef = null;

    localStorage.removeItem(
        "sami_active_order"
    );

    window.history.replaceState(
        {},
        "",
        window.location.pathname
    );

    const orderInput =
        document.getElementById("orderInput");

    if (orderInput) {
        orderInput.value = "";
    }

    hideLookupError();

    cachedState = {
        status: null,
        issue: null,
        drawnCoins: null,
        sensitivePurged: null
    };

    showLookupView();
}

/* ==========================================
   Views
   ========================================== */

function showLookupView() {
    const lookupSection =
        document.getElementById("lookupSection");

    const trackingContent =
        document.getElementById("trackingContent");

    if (lookupSection) {
        lookupSection.style.display = "block";
    }

    if (trackingContent) {
        trackingContent.style.display = "none";
    }
}

function showTrackingView() {
    const lookupSection =
        document.getElementById("lookupSection");

    const trackingContent =
        document.getElementById("trackingContent");

    if (lookupSection) {
        lookupSection.style.display = "none";
    }

    if (trackingContent) {
        trackingContent.style.display = "flex";
    }
}

/* ==========================================
   تنسيق رقم الطلب
   ========================================== */

function setupInputFormatting() {
    const orderInput =
        document.getElementById("orderInput");

    if (!orderInput) {
        return;
    }

    orderInput.addEventListener("input", (event) => {
        event.target.value =
            sanitizeRef(event.target.value);

        hideLookupError();
    });
}

function sanitizeRef(value) {
    if (!value) {
        return "";
    }

    return value
        .toString()
        .replace(/\s+/g, "")
        .toUpperCase()
        .trim();
}

/* ==========================================
   رسائل البحث
   ========================================== */

function showLookupError(message) {
    const errorElement =
        document.getElementById("inputError");

    const inputElement =
        document.getElementById("orderInput");

    if (inputElement) {
        inputElement.classList.add("has-error");
    }

    if (errorElement) {
        errorElement.innerText = message;
        errorElement.style.display = "block";
    }
}

function hideLookupError() {
    const errorElement =
        document.getElementById("inputError");

    const inputElement =
        document.getElementById("orderInput");

    if (inputElement) {
        inputElement.classList.remove("has-error");
    }

    if (errorElement) {
        errorElement.style.display = "none";
        errorElement.innerText = "";
    }
}

function formatTrackingDateTime(value) { if (!value) return ""; const d=new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("ar-SA", {dateStyle:"medium", timeStyle:"short"}); }

function getCurrencyDisplay(order) { return String(order?.priceCurrency || "SAR").toUpperCase()==="USD" ? "دولار أمريكي" : "ريال سعودي"; }

function getAmountDisplay(order) { const currency=String(order?.priceCurrency || "SAR").toUpperCase(); const value=currency==="USD" ? (order?.totalPriceUsd ?? order?.totalPrice ?? order?.total ?? "") : (order?.totalPriceSar ?? order?.totalPrice ?? order?.total ?? ""); return value==="" ? "" : Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US", {maximumFractionDigits:2}) : String(value); }

function getIssueTitle(issue) { const labels={wrong_credentials:"بيانات الدخول غير صحيحة",wrong_backup_codes:"الأكواد الاحتياطية غير صحيحة",logged_in_platform:"يرجى تسجيل الخروج من المنصة",market_closed:"سوق الانتقالات مغلق",wrong_platform:"المنصة غير صحيحة",other_issue:"توجد مشكلة في الطلب"}; return labels[String(issue||"").toLowerCase()] || "توجد مشكلة في الطلب"; }

function renderTrackingExtras(order,statusMessage,issueMessage){
 const total=Number(order?.orderedQuantity||order?.quantity||0)||0;
 const withdrawn=Math.max(0,Number(order?.withdrawnQuantity||order?.drawnCoins||0)||0);
 const remaining=Math.max(0,Number(order?.remainingQuantity ?? (total-withdrawn))||0);
 const pct=total>0?Math.min(100,(withdrawn/total)*100):0;
 setElementText('requestedQuantity',formatNumber(total));
 setElementText('withdrawnQuantityDetail',formatNumber(withdrawn));
 setElementText('remainingQuantity',formatNumber(remaining));
 setElementText('withdrawalPercentage',Math.round(pct)+'%');
 const status=normalizeStatus(order?.status||order?.orderStatus);
 const cfg=STATUS_CONFIG[status]||STATUS_CONFIG.new;
 setElementText('statusDetailLabel',order?.statusLabel||cfg.text);
 setElementText('statusDetailMessage',statusMessage||order?.statusMessage||cfg.text);
 setElementText('lastUpdateDetail',formatTrackingDateTime(order?.updatedAt)||order?.lastUpdate||'');
 const action=document.getElementById('customerActionCard');
 const needs=Boolean(order?.issue)&&String(order?.issueState||'needs_customer_action')==='needs_customer_action';
 if(action)action.style.display=needs?'block':'none';
 if(needs){setElementText('customerActionTitle',getIssueTitle(order.issue));setElementText('customerActionMessage',issueMessage||order?.issueMessage||'');setElementText('customerActionState','حالة الطلب: بانتظار إجراء العميل');}
 const key=String(order?.transferStatusKey||'pending');
 const labels={pending:'بانتظار التحويل',processing:'جاري التحويل',transferred:'تم التحويل',completed:'اكتمل التحويل'};
 const messages={pending:'لم تبدأ مرحلة التحويل بعد.',processing:'جاري تجهيز وتحويل المبلغ.',transferred:'تم تسجيل تحويل المبلغ.',completed:'تم اكتمال التحويل وإغلاق الطلب.'};
 setElementText('transferStatusLabel',labels[key]||labels.pending);
 setElementText('transferStatusMessage',messages[key]||messages.pending);
 const tr=document.getElementById('transferCompletionRow'),cr=document.getElementById('completedAtRow');
 if(tr)tr.style.display=order?.transferredAt?'flex':'none';
 if(cr)cr.style.display=order?.completedAt?'flex':'none';
 setElementText('transferredAt',formatTrackingDateTime(order?.transferredAt));
 setElementText('completedAt',formatTrackingDateTime(order?.completedAt));
 const hc=document.getElementById('trackingHistoryCard'),hl=document.getElementById('trackingHistoryList');
 const history=Array.isArray(order?.statusHistory)?order.statusHistory:[];
 if(hc&&hl){hc.style.display=history.length?'block':'none';hl.innerHTML=history.map(function(item){return '<div class="tracking-history-item"><div class="tracking-history-dot"></div><div><strong>'+escapeHtml(item?.statusLabel||item?.label||'تحديث الطلب')+'</strong>'+((item?.message||item?.statusMessage)?'<p>'+escapeHtml(item.message||item.statusMessage)+'</p>':'')+'<small>'+escapeHtml(formatTrackingDateTime(item?.timestamp||item?.at||item?.createdAt))+'</small></div></div>';}).join('');}
}
/* ==========================================
   تحديث واجهة الطلب
   ========================================== */

function updateTrackingUI(
    order,
    statusMessage,
    issueMessage
) {
    if (!order) {
        return;
    }

    const status = normalizeStatus(
        order.status ||
        order.orderStatus
    );

    const issue =
        order.issue ||
        null;

    setElementText(
        "welcomeCustomerName",
        order.customerName
    );

    setElementText(
        "customerName",
        order.customerName
    );

    setElementText(
        "referenceNumber",
        order.referenceNumber ||
        order.orderId ||
        ""
    );

    setElementText(
        "phone",
        order.phone
    );

    setElementText(
        "customerEmail",
        order.customerEmail
    );

    setElementText(
        "platform",
        order.platform
    );

    setElementText(
        "platformDetail",
        order.platform
    );

    setElementText(
        "quantity",
        formatNumber(order.quantity)
    );

    setElementText("totalPrice", getAmountDisplay(order));
    setElementText("totalPriceCurrency", getCurrencyDisplay(order));

    /*
     * طريقة الدفع يجب أن تبقى ظاهرة دائماً.
     */
    setElementText(
        "paymentMethod",
        getPaymentMethodDisplay(order)
    );

    setElementText(
        "orderDate",
        order.orderDate
    );

    setElementText(
        "orderTime",
        order.orderTime
    );

    setElementText(
        "lastUpdate",
        order.lastUpdate
    );

    setElementText(
        "withdrawDuration",
        order.withdrawDuration
    );

    setElementText(
        "transferDuration",
        order.transferDuration
    );

    /*
     * عرض بيانات الدفع بشكل آمن.
     */
    renderPaymentInfo(order);
    renderTrackingExtras(order, statusMessage, issueMessage);

    /*
     * عرض بيانات الحساب بشكل آمن.
     */
    renderAccountInfo(order);

    /*
     * المشكلة مستقلة عن status.
     */
    renderIssueState(
        issue,
        issueMessage,
        order
    );

    /*
     * الحالة الأساسية.
     */
    handleStatusState(
        status,
        statusMessage,
        order,
        Boolean(issue),
        issueMessage
    );

    /*
     * حالة الإتلاف.
     */
    renderSensitiveDataLifecycle(order);
}

/* ==========================================
   أدوات عامة
   ========================================== */

function setElementText(id, text) {
    const element =
        document.getElementById(id);

    if (!element) {
        return;
    }

    element.innerText =
        text === null ||
        text === undefined
            ? ""
            : String(text);
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return value || "";
    }

    return number.toLocaleString("en-US");
}

function normalizeStatus(status) {
    if (!status) {
        return "new";
    }

    const raw =
        String(status).trim();

    const normalized =
        raw.toLowerCase();

    const arabicStatusMap = {
        "طلب جديد": "new",

        "طلب بانتظار المراجعة":
            "review",

        "انتظار المراجعة":
            "review",

        "جاري سحب الكوينز من حسابك":
            "progress",

        "تم الانتهاء من سحب الكوينز بحسابك":
            "finished",

        "تم الانتهاء من سحب الكوينز من حسابك":
            "finished",

        "تم تحويل المبلغ إلى حسابك":
            "transferred",

        "مكتمل":
            "completed"
    };

    if (arabicStatusMap[raw]) {
        return arabicStatusMap[raw];
    }

    return LEGACY_STATUS_MAP[normalized] ||
        normalized;
}

function getDrawnCoins(order) {
    if (!order) {
        return 0;
    }

    const value =
        order.drawnCoins ??
        order.withdrawnQuantity ??
        0;

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : 0;
}

/* ==========================================
   طريقة الدفع
   ========================================== */

function getPaymentMethodCode(order) {
    if (!order) {
        return "";
    }

    const payout =
        order.payoutDetails ||
        order.paymentInfoData ||
        {};

    return (
        payout.method ||
        order.paymentMethodType ||
        order.paymentMethodCode ||
        ""
    ).toString().toLowerCase();
}

function getPaymentMethodDisplay(order) {
    if (!order) {
        return "";
    }

    if (order.paymentMethodName) {
        return order.paymentMethodName;
    }

    if (order.paymentMethod) {
        return order.paymentMethod;
    }

    const method =
        getPaymentMethodCode(order);

    const labels = {
        bank: "تحويل بنكي",
        wallet: "محفظة إلكترونية",
        usdt: "USDT",
        paypal: "PayPal",
        western: "Western Union"
    };

    return labels[method] || method;
}

/* ==========================================
   بيانات الدفع
   ========================================== */

function renderPaymentInfo(order) {
    const paymentInfoElement =
        document.getElementById("paymentInfo");

    if (!paymentInfoElement) {
        return;
    }

    const method =
        getPaymentMethodCode(order);

    const payout =
        order.payoutDetails ||
        order.paymentInfoData ||
        {};

    const price = getAmountDisplay(order);
    const currency = getCurrencyDisplay(order);
    const recipientName = payout.recipientName || order.recipientName || "";

    let html = "";

    /*
     * البنك
     */
    if (method === "bank") {
        const bankName =
            payout.bankName ||
            "";

        const ibanLast6 =
            payout.ibanLast6 ||
            extractLast6(payout.iban) ||
            "";

        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">اسم البنك</span>
                    <span class="grid-value">
                        ${escapeHtml(bankName)}
                    </span>
                </div>
            </div>

            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">اسم المستفيد</span>
                    <span class="grid-value">${escapeHtml(recipientName || "—")}</span>
                </div>
            </div>

            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">آخر 6 أرقام من IBAN</span>
                    <span class="grid-value">
                        ${ibanLast6
                            ? "******" + escapeHtml(ibanLast6)
                            : "******"}
                    </span>
                </div>
            </div>

            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">المبلغ</span>
                    <span class="grid-value">
                        ${escapeHtml(price)} ${escapeHtml(currency)}
                    </span>
                </div>
            </div>
        `;
    }

    /*
     * المحفظة
     */
    else if (method === "wallet") {
        const walletName =
            payout.walletName ||
            payout.walletType ||
            "";

        const phone =
            payout.phone ||
            payout.walletNumber ||
            payout.walletPhone ||
            "";

        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">المحفظة</span>
                    <span class="grid-value">
                        ${escapeHtml(walletName)}
                    </span>
                </div>
            </div>

            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">رقم الجوال</span>
                    <span class="grid-value">
                        ${escapeHtml(maskPhone(phone))}
                    </span>
                </div>
            </div>

            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">المبلغ</span>
                    <span class="grid-value">
                        ${escapeHtml(price)} ${escapeHtml(currency)}
                    </span>
                </div>
            </div>
        `;
    }

    /*
     * USDT
     */
    else if (method === "usdt") {
        const wallet =
            payout.wallet ||
            payout.usdtWallet ||
            payout.walletAddress ||
            "";

        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">محفظة USDT</span>
                    <span class="grid-value">
                        ${escapeHtml(maskWallet(wallet))}
                    </span>
                </div>
            </div>
        `;
    }

    /*
     * PayPal
     */
    else if (method === "paypal") {
        const email =
            payout.email ||
            payout.paypalEmail ||
            "";

        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">حساب PayPal</span>
                    <span class="grid-value">
                        ${escapeHtml(maskEmail(email))}
                    </span>
                </div>
            </div>
        `;
    }

    /*
     * Western Union
     */
    else if (method === "western") {
        const fullName =
            payout.fullNameEnglish ||
            payout.fullName ||
            payout.westernName ||
            "";

        const country =
            payout.country ||
            payout.westernCountry ||
            "";

        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">الاسم</span>
                    <span class="grid-value">
                        ${escapeHtml(fullName)}
                    </span>
                </div>
            </div>

            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">الدولة</span>
                    <span class="grid-value">
                        ${escapeHtml(country)}
                    </span>
                </div>
            </div>
        `;
    }

    /*
     * في حال لم نتعرف على النوع
     */
    else {
        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">طريقة الدفع</span>
                    <span class="grid-value">
                        ${escapeHtml(
                            getPaymentMethodDisplay(order)
                        )}
                    </span>
                </div>
            </div>
        `;
    }

    paymentInfoElement.innerHTML = html;
}

/* ==========================================
   بيانات الحساب الحساسة
   ========================================== */

function renderAccountInfo(order) {
    const accountElement =
        document.getElementById("accountInfo");

    /*
     * إذا لم يوجد العنصر في HTML الحالي
     * لا نوقف الصفحة.
     */
    if (!accountElement) {
        return;
    }

    /*
     * بعد الإتلاف لا نعرض أي بيانات حساسة.
     */
    const purged =
        Boolean(
            order.sensitivePurged ||
            order.purgedAt
        );

    if (purged) {
        accountElement.innerHTML = `
            <div class="security-success-message">
                تمت معالجة طلبك بنجاح، وتم حذف بيانات الحساب الحساسة حفاظًا على أمانك.
            </div>
        `;

        return;
    }

    const account =
        order.accountData ||
        {};

    const eaEmail =
        account.eaEmail ||
        order.eaEmail ||
        "";

    const eaPassword =
        account.eaPassword ||
        order.eaPassword ||
        "";

    const backupCodes =
        account.backupCodes ||
        order.backupCodes ||
        [];

    /*
     * الـ Backend النهائي من المفترض أن يعيد
     * بيانات مقنعة فقط للعميل.
     *
     * إذا وصلت بيانات مقنعة جاهزة نعرضها.
     */
    const emailDisplay =
        order.eaEmailMasked ||
        maskEmail(eaEmail);

    const passwordDisplay =
        order.eaPasswordMasked ||
        maskPassword(eaPassword);

    const codesDisplay =
        order.backupCodesMasked ||
        maskBackupCodes(backupCodes);

    accountElement.innerHTML = `
        <div class="grid-card">
            <div class="grid-info">
                <span class="grid-label">EA Email</span>
                <span class="grid-value">
                    ${escapeHtml(emailDisplay)}
                </span>
            </div>
        </div>

        <div class="grid-card">
            <div class="grid-info">
                <span class="grid-label">كلمة مرور EA</span>
                <span class="grid-value">
                    ${escapeHtml(passwordDisplay)}
                </span>
            </div>
        </div>

        <div class="grid-card">
            <div class="grid-info">
                <span class="grid-label">Backup Codes</span>
                <span class="grid-value">
                    ${escapeHtml(codesDisplay)}
                </span>
            </div>
        </div>
    `;
}

/* ==========================================
   إخفاء البيانات
   ========================================== */

function maskEmail(email) {
    if (!email) {
        return "";
    }

    const value =
        String(email).trim();

    const atIndex =
        value.indexOf("@");

    if (atIndex <= 0) {
        return maskText(value);
    }

    const local =
        value.substring(0, atIndex);

    const domain =
        value.substring(atIndex);

    if (local.length <= 2) {
        return (
            local.charAt(0) +
            "****" +
            domain
        );
    }

    return (
        local.substring(0, 2) +
        "****" +
        domain
    );
}

function maskPassword(password) {
    if (!password) {
        return "";
    }

    return "••••••••";
}

function maskPhone(phone) {
    if (!phone) {
        return "";
    }

    const value =
        String(phone).replace(/\s+/g, "");

    if (value.length <= 4) {
        return "****";
    }

    return (
        "*".repeat(
            Math.max(0, value.length - 4)
        ) +
        value.slice(-4)
    );
}

function maskWallet(wallet) {
    if (!wallet) {
        return "";
    }

    const value =
        String(wallet).trim();

    if (value.length <= 10) {
        return "********";
    }

    return (
        value.substring(0, 4) +
        "..." +
        value.substring(value.length - 6)
    );
}

function maskText(value) {
    if (!value) {
        return "";
    }

    const text =
        String(value);

    if (text.length <= 4) {
        return "****";
    }

    return (
        text.substring(0, 2) +
        "****" +
        text.substring(text.length - 2)
    );
}

function maskBackupCodes(codes) {
    if (!codes) {
        return "";
    }

    let list = [];

    if (Array.isArray(codes)) {
        list = codes;
    } else {
        list = String(codes)
            .split(/\r?\n|,|\s+/)
            .filter(Boolean);
    }

    if (!list.length) {
        return "";
    }

    return list
        .slice(0, 3)
        .map(() => "••••••")
        .join("  |  ");
}

function extractLast6(value) {
    if (!value) {
        return "";
    }

    const text =
        String(value)
            .replace(/\s+/g, "");

    if (text.length < 6) {
        return "";
    }

    return text.slice(-6);
}

/* ==========================================
   الحالة والمشكلة
   ========================================== */

function handleStatusState(
    status,
    message,
    order,
    hasIssue,
    issueMessage = ""
) {
    const statusMessageElement =
        document.getElementById(
            "statusMessage"
        );

    const progressBarElement =
        document.getElementById(
            "progressBar"
        );

    const progressTextElement =
        document.getElementById(
            "progressText"
        );

    const orderStatusElement =
        document.getElementById(
            "orderStatus"
        );

    const securityCardElement =
        document.getElementById(
            "securityCard"
        );

    const timelineLineElement =
        document.getElementById(
            "timelineLine"
        );

    const withdrawnSectionElement =
        document.getElementById(
            "withdrawnSection"
        );

    const withdrawnQuantityElement =
        document.getElementById(
            "withdrawnQuantity"
        );

    const totalQuantityDisplayElement =
        document.getElementById(
            "totalQuantityDisplay"
        );

    const gradientProgressBarElement =
        document.getElementById(
            "gradientProgressBar"
        );

    const config =
        STATUS_CONFIG[status] ||
        STATUS_CONFIG.new;

    let percentage =
        order &&
        typeof order.progressPercentage === "number"
            ? order.progressPercentage
            : config.percentage;

    percentage =
        Math.max(
            0,
            Math.min(
                100,
                Number(percentage) || 0
            )
        );

    let showSecurity = false;
    let showWithdrawn = false;

    /*
     * لا نعرض بيانات السحب في المراحل الأولى.
     */
    if (
        status === "progress" ||
        status === "finished" ||
        status === "transferred" ||
        status === "completed"
    ) {
        showWithdrawn = true;
    }

    if (
        status === "finished" ||
        status === "transferred" ||
        status === "completed"
    ) {
        showSecurity = true;
    }

    /*
     * تنسيق الحالة الأساسية.
     *
     * المشكلة لها واجهة منفصلة،
     * لذلك status يبقى كما هو.
     */
    updateTimelineSteps(status);

    if (
        statusMessageElement &&
        orderStatusElement
    ) {
        statusMessageElement.className =
            "status-message-main";

        orderStatusElement.className =
            "status-badge";

        if (hasIssue) {
            statusMessageElement.classList.add(
                "issue"
            );

            orderStatusElement.classList.add(
                "issue"
            );
        } else if (config.className) {
            statusMessageElement.classList.add(
                config.className
            );

            orderStatusElement.classList.add(
                config.className
            );
        }
    }

    /*
     * رسالة الحالة الأساسية.
     * إذا لم توجد رسالة من النظام،
     * نستخدم نص الحالة.
     */
    if (statusMessageElement) {
        statusMessageElement.innerText =
            (
                hasIssue &&
                String(issueMessage || "").trim()
                    ? issueMessage
                    : message
            ) ||
            config.text ||
            "";
    }

    if (progressTextElement) {
        progressTextElement.innerText =
            `${percentage}%`;
    }

    if (orderStatusElement) {
        const textSpan =
            orderStatusElement.querySelector(
                ".status-text"
            );

        if (textSpan) {
            textSpan.innerText =
                config.text ||
                "طلب";
        }
    }

    /*
     * الدائرة
     */
    if (progressBarElement) {
        const circumference =
            314.15;

        const offset =
            circumference -
            (percentage / 100) *
            circumference;

        progressBarElement.style.strokeDashoffset =
            offset;
    }

    /*
     * خط التقدم
     */
    if (timelineLineElement) {
        timelineLineElement.style.width =
            `${percentage}%`;
    }

    /*
     * الكمية المسحوبة
     */
    if (withdrawnSectionElement) {
        if (showWithdrawn) {
            withdrawnSectionElement.style.display =
                "flex";

            const numericTotal =
                Number(
                    order?.quantity || 0
                );

            const currentWithdrawn =
                getDrawnCoins(order);

            if (withdrawnQuantityElement) {
                withdrawnQuantityElement.innerText =
                    currentWithdrawn.toLocaleString(
                        "en-US"
                    );
            }

            if (totalQuantityDisplayElement) {
                totalQuantityDisplayElement.innerText =
                    numericTotal.toLocaleString(
                        "en-US"
                    );
            }

            if (gradientProgressBarElement) {
                const withdrawalPercentage =
                    numericTotal > 0
                        ? Math.min(
                            100,
                            (
                                currentWithdrawn /
                                numericTotal
                            ) * 100
                        )
                        : percentage;

                gradientProgressBarElement.style.width =
                    `${withdrawalPercentage}%`;
            }
        } else {
            withdrawnSectionElement.style.display =
                "none";
        }
    }

    /*
     * كرت الأمان
     */
    if (securityCardElement) {
        securityCardElement.style.display =
            showSecurity
                ? "block"
                : "none";
    }
}

/* ==========================================
   Timeline
   ========================================== */

function updateTimelineSteps(status) {
    const steps = [
        "new",
        "review",
        "progress",
        "finished",
        "transferred"
    ];

    const statusMap = {
        new: 0,
        review: 1,
        progress: 2,
        finished: 3,
        transferred: 4,
        completed: 4
    };

    const activeIndex =
        statusMap[status] !== undefined
            ? statusMap[status]
            : -1;

    steps.forEach(
        (stepKey, index) => {
            const element =
                document.getElementById(
                    `step-${stepKey}`
                );

            if (!element) {
                return;
            }

            element.classList.remove(
                "step-completed",
                "step-active",
                "step-pending"
            );

            if (index < activeIndex) {
                element.classList.add(
                    "step-completed"
                );
            } else if (
                index === activeIndex
            ) {
                element.classList.add(
                    "step-active"
                );
            } else {
                element.classList.add(
                    "step-pending"
                );
            }
        }
    );
}

/* ==========================================
   عرض المشكلة
   ========================================== */

function renderIssueState(
    issue,
    issueMessage,
    order
) {
    /*
     * لا تظهر المشكلة إطلاقاً إذا لم يخترها الأدمن.
     */
    const issueElement =
        document.getElementById(
            "issueSection"
        );

    const issueMessageElement =
        document.getElementById(
            "issueMessage"
        );

    const issueTitleElement =
        document.getElementById(
            "issueTitle"
        );

    /*
     * إذا لم يكن HTML يحتوي قسم المشكلة،
     * ننشئه داخل منطقة statusMessage.
     */
    if (!issue) {
        if (issueElement) {
            issueElement.style.display =
                "none";
        }

        return;
    }

    const labels = {
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

    const title =
        labels[issue] ||
        "توجد مشكلة في الطلب";

    /*
     * إذا كان القسم موجوداً في HTML.
     */
    if (issueElement) {
        issueElement.style.display =
            "block";

        issueElement.classList.remove(
            "issue-warning",
            "issue-error",
            "issue-active"
        );

        issueElement.classList.add(
            "issue-active"
        );
    }

    if (issueTitleElement) {
        issueTitleElement.innerText =
            title;
    }

    if (issueMessageElement) {
        const lifecycle = {
            needs_customer_action: "بانتظار إجراء العميل",
            data_received: "تم استلام البيانات",
            resolved: "تم الحل"
        };

        issueMessageElement.innerText =
            (issueMessage || title) +
            " — " +
            (lifecycle[order?.issueState] || lifecycle.needs_customer_action);
    }

    /*
     * fallback:
     * إذا لم يوجد issueSection،
     * نعرض المشكلة داخل statusMessage.
     */
    if (!issueElement) {
        const statusMessageElement =
            document.getElementById(
                "statusMessage"
            );

        if (statusMessageElement) {
            statusMessageElement.className =
                "status-message-main issue";

            statusMessageElement.innerText =
                issueMessage ||
                title;
        }
    }
}

/* ==========================================
   دورة حياة البيانات الحساسة
   ========================================== */

function renderSensitiveDataLifecycle(order) {
    const purged =
        Boolean(
            order?.sensitivePurged ||
            order?.purgedAt
        );

    const purgeMessageElement =
        document.getElementById(
            "sensitivePurgeMessage"
        );

    const accountElement =
        document.getElementById(
            "accountInfo"
        );

    const exactMessage =
        "تمت معالجة طلبك بنجاح، وتم حذف بيانات الحساب الحساسة حفاظًا على أمانك.";

    if (purged) {
        if (purgeMessageElement) {
            purgeMessageElement.innerText =
                exactMessage;

            purgeMessageElement.style.display =
                "block";
        }

        if (accountElement) {
            accountElement.innerHTML = `
                <div class="security-success-message">
                    ${exactMessage}
                </div>
            `;
        }

        return;
    }

    if (purgeMessageElement) {
        purgeMessageElement.style.display =
            "none";
    }
}

/* ==========================================
   كرت الأمان
   ========================================== */

function setupSecurityEvents() {
    const confirmYesButton =
        document.getElementById(
            "confirmYes"
        );

    const confirmNoButton =
        document.getElementById(
            "confirmNo"
        );

    const changePasswordButton =
        document.getElementById(
            "changePasswordBtn"
        );

    const securityWarning =
        document.getElementById(
            "securityWarning"
        );

    const securitySuccess =
        document.getElementById(
            "securitySuccess"
        );

    const securityCard =
        document.getElementById(
            "securityCard"
        );

    if (confirmYesButton) {
        confirmYesButton.onclick = () => {
            if (securitySuccess) {
                securitySuccess.style.display =
                    "flex";
            }

            if (securityWarning) {
                securityWarning.style.display =
                    "none";
            }

            confirmYesButton.style.display =
                "none";

            if (confirmNoButton) {
                confirmNoButton.style.display =
                    "none";
            }

            if (changePasswordButton) {
                changePasswordButton.style.display =
                    "none";
            }

            setTimeout(() => {
                if (securityCard) {
                    securityCard.style.display =
                        "none";
                }
            }, 3000);
        };
    }

    if (confirmNoButton) {
        confirmNoButton.onclick = () => {
            if (securityWarning) {
                securityWarning.style.display =
                    "flex";
            }

            if (securitySuccess) {
                securitySuccess.style.display =
                    "none";
            }
        };
    }
}

/* ==========================================
   تنظيف عند مغادرة الصفحة
   ========================================== */

window.addEventListener(
    "beforeunload",
    () => {
        stopRealtimeTracking();
    }
);
