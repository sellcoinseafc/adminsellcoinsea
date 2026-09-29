 /**
 * SAMI COINS - tracking.js
 * إدارة العرض، وحفظ جلسة العميل، والتحديث الذكي (Smart Polling)
 */

let activeRef = null;
let pollingInterval = null;
let cachedState = {
    orderStatus: null,
    withdrawnQuantity: null
};

// عند فتح الصفحة
document.addEventListener("DOMContentLoaded", () => {
    setupInputFormatting();
    initTrackingSession();
});

/**
 * تهيئة الجلسة ومصادر قراءة رقم الطلب
 */
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
        if (orderInput) orderInput.value = targetRef;
        await fetchAndRenderOrder(targetRef);
    } else {
        showLookupView();
    }
}

/**
 * معالجة إرسال النموذج من واجهة الإدخال
 */
async function handleLookupSubmit(event) {
    if (event) event.preventDefault();

    const orderInput = document.getElementById("orderInput");
    if (!orderInput) return;

    const ref = sanitizeRef(orderInput.value);

    if (!ref) {
        showLookupError("يرجى إدخال رقم الطلب");
        return;
    }

    hideLookupError();
    await fetchAndRenderOrder(ref);
}

/**
 * جلب واستعراض بيانات الطلب من الـ API
 */
async function fetchAndRenderOrder(ref) {
    try {
        const response = await fetch(`/api/tracking/${encodeURIComponent(ref)}`);
        
        if (!response.ok) {
            showLookupView();
            showLookupError("لم يتم العثور على طلب بهذا الرقم، يرجى التأكد وإعادة المحاولة.");
            return;
        }

        const data = await response.json();

        if (data && data.order) {
            activeRef = ref;
            
            // تحديث رابط الصفحة بدون إعادة تحميل
            const newUrl = `${window.location.pathname}?ref=${encodeURIComponent(ref)}`;
            window.history.replaceState({ path: newUrl }, '', newUrl);

            // حفظ رقم الطلب في الجلسة إذا لم يكن مكتملاً
            if (data.order.orderStatus !== "completed") {
                localStorage.setItem("sami_active_order", ref);
            }

            // إظهار واجهة التتبع
            showTrackingView();

            // رسم البيانات الأولية
            updateTrackingUI(data.order, data.statusMessage);
            setupSecurityEvents();
            setupReviewSystem(data.order, data.reviewSuggestions);

            // حفظ الحالة الحالية للكاش
            cachedState.orderStatus = data.order.orderStatus;
            cachedState.withdrawnQuantity = data.order.withdrawnQuantity || 0;

            // بدء التحديث الذكي (Smart Polling)
            startSmartPolling();
        }
    } catch (error) {
        console.error("Error fetching order:", error);
        showLookupView();
        showLookupError("حدث خطأ في الاتصال بالخادم، يُرجى المحاولة لاحقاً.");
    }
}

/**
 * التحديث الذكي: استدعاء الـ API كل 10 ثوانٍ وتحديث الـ DOM فقط في حال تغيير الحقول الأساسية
 */
function startSmartPolling() {
    stopSmartPolling();

    pollingInterval = setInterval(async () => {
        if (!activeRef) return;

        try {
            const res = await fetch(`/api/tracking/${encodeURIComponent(activeRef)}`);
            if (!res.ok) return;

            const data = await res.json();
            if (!data || !data.order) return;

            const newStatus = data.order.orderStatus;
            const newWithdrawn = data.order.withdrawnQuantity || 0;

            // فحص التغيير الذكي: لا نعدل في الـ DOM إلا إذا تغيرت الحالة أو الكمية المسحوبة
            if (newStatus !== cachedState.orderStatus || newWithdrawn !== cachedState.withdrawnQuantity) {
                cachedState.orderStatus = newStatus;
                cachedState.withdrawnQuantity = newWithdrawn;

                // تحديث الواجهة
                updateTrackingUI(data.order, data.statusMessage);

                // عند اكتمال الطلب بالكامل: حذف الرقم من الجلسة وإيقاف المتابعة
                if (newStatus === "completed") {
                    localStorage.removeItem("sami_active_order");
                    stopSmartPolling();
                }
            }
        } catch (err) {
            console.error("Polling error:", err);
        }
    }, 10000); // 10 ثوانٍ
}

function stopSmartPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

/**
 * إعادة الصفحة لوضع الإدخال لطلب جديد
 */
function resetToLookup() {
    stopSmartPolling();
    activeRef = null;
    localStorage.removeItem("sami_active_order");
    
    // تنظيف URL
    window.history.replaceState({}, '', window.location.pathname);
    
    const orderInput = document.getElementById("orderInput");
    if (orderInput) orderInput.value = "";
    hideLookupError();

    showLookupView();
}

/**
 * دوال التبديل بين الواجهات (Views Switcher)
 */
function showLookupView() {
    document.getElementById("lookupSection").style.display = "block";
    document.getElementById("trackingContent").style.display = "none";
}

function showTrackingView() {
    document.getElementById("lookupSection").style.display = "none";
    document.getElementById("trackingContent").style.display = "flex";
}

/**
 * تنسيق حقل الإدخال تلقائياً
 */
function setupInputFormatting() {
    const orderInput = document.getElementById("orderInput");
    if (orderInput) {
        orderInput.addEventListener("input", (e) => {
            e.target.value = sanitizeRef(e.target.value);
            hideLookupError();
        });
    }
}

function sanitizeRef(str) {
    if (!str) return "";
    return str.toString().replace(/\s+/g, "").toUpperCase().trim();
}

function showLookupError(msg) {
    const errorElem = document.getElementById("inputError");
    const inputElem = document.getElementById("orderInput");
    if (inputElem) inputElem.classList.add("has-error");
    if (errorElem) {
        errorElem.innerText = msg;
        errorElem.style.display = "block";
    }
}

function hideLookupError() {
    const errorElem = document.getElementById("inputError");
    const inputElem = document.getElementById("orderInput");
    if (inputElem) inputElem.classList.remove("has-error");
    if (errorElem) {
        errorElem.style.display = "none";
        errorElem.innerText = "";
    }
}

/* ==========================================
   دوال تحديث واجهة التتبع الأصلية
   ========================================== */

function updateTrackingUI(order, statusMessage) {
    if (!order) return;

    setElementText('welcomeCustomerName', order.customerName);
    setElementText('customerName', order.customerName);
    setElementText('referenceNumber', order.referenceNumber);
    setElementText('phone', order.phone);
    setElementText('customerEmail', order.customerEmail);
    setElementText('platform', order.platform);
    setElementText('platformDetail', order.platform);
    setElementText('quantity', order.quantity);
    setElementText('totalPrice', order.totalPrice);
    setElementText('paymentMethod', order.paymentMethodName || order.paymentMethod);

    setElementText('orderDate', order.orderDate);
    setElementText('orderTime', order.orderTime);
    setElementText('lastUpdate', order.lastUpdate);

    setElementText('withdrawDuration', order.withdrawDuration);
    setElementText('transferDuration', order.transferDuration);

    renderPaymentInfo(order.paymentMethodType, order.paymentInfoData, order.totalPrice);
    handleStatusState(order.orderStatus, statusMessage, order);
}

function setElementText(id, text) {
    const elem = document.getElementById(id);
    if (elem) elem.innerText = text || '';
}

function renderPaymentInfo(methodType, info, price) {
    const paymentInfoElem = document.getElementById('paymentInfo');
    if (!paymentInfoElem) return;

    let html = '';
    info = info || {};

    if (methodType === 'bank') {
        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">اسم البنك</span>
                    <span class="grid-value">${info.bankName || ''}</span>
                </div>
            </div>
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">آخر 6 أرقام IBAN</span>
                    <span class="grid-value">${info.ibanLast6 ? '******' + info.ibanLast6 : ''}</span>
                </div>
            </div>
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">المبلغ المحول</span>
                    <span class="grid-value">${price || 0} ريال</span>
                </div>
            </div>
        `;
    } else if (methodType === 'paypal') {
        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">البريد المحجوب</span>
                    <span class="grid-value">${info.paypalEmail || ''}</span>
                </div>
            </div>
        `;
    } else if (methodType === 'usdt') {
        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">عنوان المحفظة</span>
                    <span class="grid-value">${info.usdtWallet || ''}</span>
                </div>
            </div>
        `;
    } else if (methodType === 'western') {
        html = `
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">الاسم</span>
                    <span class="grid-value">${info.westernName || ''}</span>
                </div>
            </div>
            <div class="grid-card">
                <div class="grid-info">
                    <span class="grid-label">الدولة</span>
                    <span class="grid-value">${info.westernCountry || ''}</span>
                </div>
            </div>
        `;
    }

    paymentInfoElem.innerHTML = html;
}

function handleStatusState(status, message, order) {
    const statusMessageElem = document.getElementById('statusMessage');
    const progressBarElem = document.getElementById('progressBar');
    const progressTextElem = document.getElementById('progressText');
    const orderStatusElem = document.getElementById('orderStatus');
    const securityCardElem = document.getElementById('securityCard');
    const timelineLineElem = document.getElementById('timelineLine');
    const withdrawnSectionElem = document.getElementById('withdrawnSection');
    const withdrawnQuantityElem = document.getElementById('withdrawnQuantity');
    const totalQuantityDisplayElem = document.getElementById('totalQuantityDisplay');
    const gradientProgressBarElem = document.getElementById('gradientProgressBar');

    let percentage = (order && typeof order.progressPercentage === 'number') ? order.progressPercentage : 0;
    let statusText = "";
    let showSecurity = false;
    let showWithdrawn = false;

    switch (status) {
        case 'new':
            if (percentage === 0) percentage = 15;
            statusText = "جديد";
            showWithdrawn = false;
            break;
        case 'review':
            if (percentage === 0) percentage = 35;
            statusText = "قيد المراجعة";
            showWithdrawn = false;
            break;
        case 'progress':
            if (percentage === 0) percentage = 65;
            statusText = "قيد التنفيذ";
            showWithdrawn = true;
            break;
        case 'finished':
            if (percentage === 0) percentage = 85;
            statusText = "مكتمل السحب";
            showSecurity = true;
            showWithdrawn = true;
            break;
        case 'transferred':
            if (percentage === 0) percentage = 95;
            statusText = "تم التحويل";
            showSecurity = true;
            showWithdrawn = true;
            break;
        case 'completed':
            if (percentage === 0) percentage = 100;
            statusText = "مكتمل";
            showSecurity = true;
            showWithdrawn = true;
            break;
        default:
            statusText = "معلق";
            showWithdrawn = false;
    }

    updateTimelineSteps(status);

    if (statusMessageElem && orderStatusElem) {
        statusMessageElem.className = "status-message-main";
        orderStatusElem.className = "status-badge";

        if (status === "review") {
            statusMessageElem.classList.add("review");
            orderStatusElem.classList.add("review");
        } else if (status === "progress") {
            statusMessageElem.classList.add("executing");
            orderStatusElem.classList.add("executing");
        } else if (status === "finished") {
            statusMessageElem.classList.add("finished");
            orderStatusElem.classList.add("finished");
        } else if (status === "transferred" || status === "completed") {
            statusMessageElem.classList.add("success");
            orderStatusElem.classList.add("success");
        }
    }

    if (statusMessageElem) statusMessageElem.innerText = message || '';
    if (progressTextElem) progressTextElem.innerText = percentage + "%";

    if (orderStatusElem) {
        const textSpan = orderStatusElem.querySelector('.status-text');
        if (textSpan) textSpan.innerText = statusText;
    }

    if (progressBarElem) {
        const circumference = 314.15;
        const offset = circumference - (percentage / 100) * circumference;
        progressBarElem.style.strokeDashoffset = offset;
    }

    if (timelineLineElem) {
        timelineLineElem.style.width = percentage + "%";
    }

    if (withdrawnSectionElem) {
        if (showWithdrawn) {
            withdrawnSectionElem.style.display = 'flex';

            const totalQtyStr = (order && order.quantity) ? order.quantity.toString() : '0';
            const numericTotal = parseInt(totalQtyStr.replace(/,/g, ''), 10) || 0;

            let currentWithdrawn = 0;
            if (order && typeof order.withdrawnQuantity === 'number') {
                currentWithdrawn = order.withdrawnQuantity;
            } else {
                currentWithdrawn = Math.round((numericTotal * percentage) / 100);
            }

            if (withdrawnQuantityElem) withdrawnQuantityElem.innerText = currentWithdrawn.toLocaleString();
            if (totalQuantityDisplayElem) totalQuantityDisplayElem.innerText = totalQtyStr;

            if (gradientProgressBarElem) {
                gradientProgressBarElem.style.width = percentage + "%";
            }
        } else {
            withdrawnSectionElem.style.display = 'none';
        }
    }

    if (securityCardElem) {
        securityCardElem.style.display = showSecurity ? 'block' : 'none';
    }
}

function updateTimelineSteps(status) {
    const steps = ['new', 'review', 'progress', 'finished', 'transferred'];
    const statusMap = {
        'new': 0,
        'review': 1,
        'progress': 2,
        'finished': 3,
        'transferred': 4,
        'completed': 4
    };

    const activeIndex = statusMap[status] !== undefined ? statusMap[status] : -1;

    steps.forEach((stepKey, index) => {
        const stepElem = document.getElementById(`step-${stepKey}`);
        if (!stepElem) return;

        stepElem.classList.remove('step-completed', 'step-active', 'step-pending');

        if (index < activeIndex) {
            stepElem.classList.add('step-completed');
        } else if (index === activeIndex) {
            stepElem.classList.add('step-active');
        } else {
            stepElem.classList.add('step-pending');
        }
    });
}

function setupSecurityEvents() {
    const confirmYesBtn = document.getElementById('confirmYes');
    const confirmNoBtn = document.getElementById('confirmNo');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const securityWarning = document.getElementById('securityWarning');
    const securitySuccess = document.getElementById('securitySuccess');
    const securityCard = document.getElementById('securityCard');

    if (confirmYesBtn) {
        confirmYesBtn.onclick = () => {
            if (securitySuccess) securitySuccess.style.display = 'flex';
            if (securityWarning) securityWarning.style.display = 'none';
            if (confirmYesBtn) confirmYesBtn.style.display = 'none';
            if (confirmNoBtn) confirmNoBtn.style.display = 'none';
            if (changePasswordBtn) changePasswordBtn.style.display = 'none';

            setTimeout(() => {
                if (securityCard) securityCard.remove();
            }, 3000);
        };
    }

    if (confirmNoBtn) {
        confirmNoBtn.onclick = () => {
            if (securityWarning) securityWarning.style.display = 'flex';
            if (securitySuccess) securitySuccess.style.display = 'none';
        };
    }
}

function setupReviewSystem(order, reviewSuggestions) {
    const reviewSection = document.getElementById("reviewSection");
    if (!reviewSection) return;

    if (order.reviewSubmitted) {
        reviewSection.remove();
        return;
    }

    if (order.orderStatus !== "transferred" && order.orderStatus !== "completed") {
        reviewSection.style.display = "none";
        return;
    }

    reviewSection.style.display = "block";

    const reviewTextarea = document.getElementById("reviewTextarea") || document.getElementById("reviewText");
    const counter = document.getElementById("reviewCounter");

    if (reviewTextarea && counter) {
        counter.innerText = `${reviewTextarea.value.length}/500`;
        reviewTextarea.addEventListener("input", () => {
            counter.innerText = `${reviewTextarea.value.length}/500`;
        });
    }

    const suggestionsContainer = document.getElementById("reviewSuggestions");
    if (suggestionsContainer && reviewSuggestions && Array.isArray(reviewSuggestions)) {
        suggestionsContainer.innerHTML = "";
        reviewSuggestions.forEach(text => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "suggestion-btn";
            btn.innerText = text;
            btn.onclick = () => {
                if (reviewTextarea) {
                    reviewTextarea.value = text;
                    if (counter) counter.innerText = `${reviewTextarea.value.length}/500`;
                }
            };
            suggestionsContainer.appendChild(btn);
        });
    }

    const submitBtn = document.getElementById("submitReviewBtn");
    if (submitBtn) {
        submitBtn.onclick = async () => {
            if (!reviewTextarea) return;
            const text = reviewTextarea.value.trim();

            if (text.length < 150) {
                return alert("الحد الأدنى 150 حرف");
            }

            if (text.length > 500) {
                return alert("الحد الأقصى 500 حرف");
            }

            try {
                const response = await fetch("/api/review/submit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        referenceNumber: order.referenceNumber,
                        reviewText: text
                    })
                });

                if (response.ok) {
                    reviewSection.remove();
                    const reviewSuccessElem = document.getElementById("reviewSuccess");
                    if (reviewSuccessElem) reviewSuccessElem.style.display = "block";
                } else {
                    alert("حدث خطأ أثناء إرسال التقييم، يرجى المحاولة لاحقاً.");
                }
            } catch (error) {
                console.error("Error submitting review:", error);
                alert("حدث خطأ في الاتصال بالشبكة.");
            }
        };
    }
}


