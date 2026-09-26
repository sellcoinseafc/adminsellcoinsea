let isStoreOpen = localStorage.getItem("sami_coins_store_status") !== "closed";

function updateStoreStatusUI() {
    const btn = document.getElementById("storeStatusToggleBtn");
    const txt = document.getElementById("storeStatusText");
    if (isStoreOpen) {
        btn.className = "store-status-btn open";
        txt.innerText = "المتجر مفتوح";
    } else {
        btn.className = "store-status-btn closed";
        txt.innerText = "المتجر مغلق";
    }
    localStorage.setItem("sami_coins_store_status", isStoreOpen ? "open" : "closed");
}

function toggleStoreStatus() {
    isStoreOpen = !isStoreOpen;
    updateStoreStatusUI();
    alert(isStoreOpen ? "🟢 تم فتح المتجر وبدء استقبال الطلبات!" : "🔴 تم إيقاف وإغلاق استقبال الطلبات!");
}

let ordersData = JSON.parse(localStorage.getItem("sami_coins_orders_v2")) || [];
let banksList = ["مصرف الراجحي", "البنك الأهلي السعودي (SNB)", "بنك الرياض", "stc bank", "مصرف الإنماء"];
let walletsList = ["STC Pay", "urpay", "برق (Barq)", "موبايلي بي", "تيكمو"];
let customPaymentsList = JSON.parse(localStorage.getItem("sami_coins_custom_payments")) || ["بطاقة مدى / فيزا", "Apple Pay"];
let storeTerms = [
    "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
    "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
    "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
];
let stockData = { PlayStation: 0, PC: 0 };

// التأكد من توفر المرجع وتاريخ الإنشاء وسجل التغييرات لكل طلب
ordersData.forEach(o => {
    if(!o.reference) o.reference = "SC-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    if(!o.createdAt) o.createdAt = new Date().toISOString();
    if(!o.auditLogs) o.auditLogs = [{ action: "إنشاء الطلب", user: "النظام", time: new Date().toLocaleString() }];
});

function sortOrdersNewestFirst() {
    ordersData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateDashboardStats() {
    sortOrdersNewestFirst();
    let countNew = ordersData.filter(o => o.status === 'new').length;
    let countReview = ordersData.filter(o => o.status === 'review').length;
    let countProgress = ordersData.filter(o => o.status === 'progress').length;
    let countCompleted = ordersData.filter(o => o.status === 'completed').length;

    // عداد الطلبات الجديدة في القائمة الجانبية
    const sbBadge = document.getElementById("sidebarNewOrdersBadge");
    if(countNew > 0) {
        sbBadge.style.display = "inline-block";
        sbBadge.innerText = countNew;
    } else {
        sbBadge.style.display = "none";
    }

    // الطلبات التي تحتاج تحويل
    let transferNeededList = ordersData.filter(o => o.status === 'finished' || (o.withdrawnQty >= o.totalQty && o.status !== 'transferred' && o.status !== 'completed'));
    
    document.getElementById("transferBadgeCount").innerText = transferNeededList.length;
    document.getElementById("transferHeaderBadge").innerText = `${transferNeededList.length} طلبات بحاجة للتحويل`;

    const banner = document.getElementById("urgentTransferBanner");
    if(transferNeededList.length > 0) {
        banner.style.display = "flex";
        document.getElementById("bannerTransferText").innerText = `لديك ${transferNeededList.length} طلبات منتهية تحتاج إلى التحويل المالي للعملاء خلال 3-5 أيام عمل من تاريخ الانتهاء.`;
    } else {
        banner.style.display = "none";
    }

    let totalCompletedCoins = ordersData.filter(o => o.status === 'completed').reduce((sum, o) => sum + o.totalQty, 0);
    let totalTransferredMoney = ordersData.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.totalPrice || 200), 0);

    document.getElementById("statNewOrders").innerText = countNew;
    document.getElementById("statReviewOrders").innerText = countReview;
    document.getElementById("statProgressOrders").innerText = countProgress;
    document.getElementById("statCompletedOrders").innerText = countCompleted;
    document.getElementById("statCompletedCoins").innerText = totalCompletedCoins.toLocaleString();
    document.getElementById("statTransferredMoney").innerText = totalTransferredMoney.toLocaleString() + " ر.س";

    document.getElementById("stockPS").innerText = stockData.PlayStation.toLocaleString();
    document.getElementById("stockPC").innerText = stockData.PC.toLocaleString();

    renderTransferAlertsTable(transferNeededList);
}

function filterOrdersByStatus(status) {
    switchTab('ordersTab', document.querySelector('.sidebar-menu li:nth-child(2) a'));
    document.getElementById("orderStatusFilter").value = status;
    renderOrdersTables();
}

function renderTransferAlertsTable(list) {
    const tbody = document.getElementById("transferAlertsTableBody");
    if(list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات بحاجة للتحويل حالياً.</td></tr>`;
        return;
    }
    tbody.innerHTML = "";
    list.forEach((order) => {
        let finishDateStr = order.finishedAt ? new Date(order.finishedAt).toLocaleDateString('en-GB') : 'عند الانتهاء';
        tbody.innerHTML += `
            <tr>
                <td><code style="color:var(--primary);">${order.reference}</code></td>
                <td>#${order.id}</td>
                <td><b>${order.name}</b></td>
                <td style="direction:ltr; text-align:right;">${order.phone}</td>
                <td style="color:var(--primary);">${order.totalPrice || 200} SAR</td>
                <td><span class="badge badge-review"><i class="fa-solid fa-clock"></i> بدأ العد من: ${finishDateStr} (3 - 5 أيام عمل)</span></td>
                <td><button class="btn-action" onclick="openOrderModalById(${order.id})"><i class="fa-solid fa-money-bill-transfer"></i> إتمام التحويل</button></td>
            </tr>
        `;
    });
}

function openOrderModalById(id) {
    let idx = ordersData.findIndex(o => o.id === id);
    if(idx !== -1) openOrderModal(idx);
}

function renderOrdersTables() {
    sortOrdersNewestFirst();
    const dashBody = document.getElementById("dashboardOrdersTableBody");
    const fullBody = document.getElementById("fullOrdersTableBody");
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    
    let filteredOrders = ordersData;
    if(statusFilter !== "all") {
        filteredOrders = ordersData.filter(o => o.status === statusFilter);
    }

    if(ordersData.length === 0) {
        dashBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات حالياً.</td></tr>`;
        fullBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات مسجلة.</td></tr>`;
        updateDashboardStats();
        renderClientsList();
        return;
    }

    dashBody.innerHTML = "";
    fullBody.innerHTML = "";

    let topRecent = ordersData.slice(0, 5);
    topRecent.forEach((order) => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        let statusBadge = getStatusBadge(order.status);
        let errorBadge = getErrorBadge(order.errorCode);
        if(order.archived) statusBadge = '<span class="badge badge-archived">مؤرشف</span>';

        dashBody.innerHTML += `
            <tr>
                <td><code style="color:var(--primary);">${order.reference}</code></td>
                <td>#${order.id}</td>
                <td><b>${order.name}</b></td>
                <td>${order.platform}</td>
                <td><b>${order.totalQty.toLocaleString()}</b></td>
                <td style="color:var(--primary);">${order.totalPrice || 200} SAR</td>
                <td><div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">${statusBadge} ${errorBadge}</div></td>
                <td><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-eye"></i> التفاصيل</button></td>
            </tr>
        `;
    });

    if(filteredOrders.length === 0) {
        fullBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات مطابقة للفلتر المختار.</td></tr>`;
    } else {
        filteredOrders.forEach((order) => {
            let actualIndex = ordersData.findIndex(o => o.id === order.id);
            let statusBadge = getStatusBadge(order.status);
            let errorBadge = getErrorBadge(order.errorCode);
            if(order.archived) statusBadge = '<span class="badge badge-archived">مؤرشف</span>';

            fullBody.innerHTML += `
                <tr>
                    <td><code style="color:var(--primary);">${order.reference}</code></td>
                    <td>#${order.id}</td>
                    <td><b>${order.name}</b></td>
                    <td>${order.platform}</td>
                    <td><b>${order.totalQty.toLocaleString()}</b></td>
                    <td style="color:var(--primary);">${order.totalPrice || 200} SAR</td>
                    <td><div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${statusBadge} ${errorBadge}</div></td>
                    <td>
                        <button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-pen-to-square"></i> التفاصيل والنسخ</button>
                        <button class="btn-action" style="color:#f59e0b;" onclick="toggleArchive(${actualIndex})">${order.archived ? 'استرجاع' : 'أرشفة'}</button>
                    </td>
                </tr>
            `;
        });
    }

    localStorage.setItem("sami_coins_orders_v2", JSON.stringify(ordersData));
    updateDashboardStats();
    renderClientsList();
}

function getStatusBadge(status) {
    switch(status) {
        case 'new': return '<span class="badge badge-new">طلب جديد</span>';
        case 'review': return '<span class="badge badge-review">انتظار المراجعة</span>';
        case 'progress': return '<span class="badge badge-progress">قيد التنفيذ</span>';
        case 'finished': return '<span class="badge badge-finished">تم الانتهاء</span>';
        case 'transferred': return '<span class="badge badge-transferred">تم التحويل</span>';
        case 'completed': return '<span class="badge badge-completed">مكتمل</span>';
        default: return '<span class="badge badge-new">طلب جديد</span>';
    }
}

function getErrorBadge(code) {
    switch(code) {
        case 'err_pass': return '<span class="badge badge-error">❌ الإيميل أو الباسورد غلط</span>';
        case 'err_codes': return '<span class="badge badge-error">❌ الأكواد الاحتياطية غلط</span>';
        case 'err_login': return '<span class="badge badge-error">❌ العميل مسجل دخول على المنصة</span>';
        case 'err_market': return '<span class="badge badge-error">❌ سوق الانتقالات مغلق</span>';
        default: return '<span class="badge badge-success">✔ سليم</span>';
    }
}

function openOrderModal(index) {
    const order = ordersData[index];
    const modal = document.getElementById("orderDetailModal");
    const body = document.getElementById("modalOrderBody");
    const remaining = order.totalQty - (order.withdrawnQty || 0);

    let logsHtml = (order.auditLogs || []).map(l => `<li style="font-size:0.78rem; color:var(--text-muted);">${l.time} - ${l.action} (${l.user})</li>`).join("");

    let sensitiveContent = order.sensitiveDeleted ? 
        `<div style="background:rgba(239,68,68,0.1); color:#ef4444; padding:10px; border-radius:10px; text-align:center; font-weight:900;">⚠️ تم إتلاف وحذف البيانات الحساسة أمنياً.</div>` :
        `<div style="background:var(--input-bg); padding:14px; border-radius:12px; margin-bottom:12px; border:1px solid var(--card-border);">
            <strong style="color:var(--primary); display:block; margin-bottom:8px;"><i class="fa-solid fa-key"></i> بيانات الحساب:</strong>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span>الإيميل: <code>${order.email || '---'}</code></span>
                <button class="copy-btn" onclick="copyToClipboard('${order.email}', 'الإيميل')">نسخ الإيميل</button>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span>كلمة المرور: <code style="color:#f59e0b; font-weight:900;">${order.pass || '---'}</code></span>
                <button class="copy-btn" onclick="copyToClipboard('${order.pass}', 'الباسورد')">نسخ الباسورد</button>
            </div>
        </div>`;

    let withdrawnBox = order.status === 'progress' ? `
        <div style="background:rgba(0,255,135,0.05); padding:14px; border-radius:12px; border:1.5px solid var(--primary); margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span>الإجمالية: <b>${order.totalQty.toLocaleString()}</b></span>
                <span style="color:#f59e0b;">المتبقية: <b id="remainingDisplay">${remaining.toLocaleString()}</b></span>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label>تحديث الكمية المسحوبة:</label>
                <input type="number" id="modalWithdrawnInput" class="form-control" value="${order.withdrawnQty || 0}" oninput="calcRemaining(${index}, this)">
            </div>
        </div>` : "";

    body.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:16px;">
            <button class="btn-custom" style="background:linear-gradient(135deg, #38bdf8 0%, #2563eb 100%); color:#fff; justify-content:center; font-size:0.8rem;" onclick="migrateToGoogleSheets(${index})">
                <i class="fa-solid fa-cloud-arrow-up"></i> ترحيل للشيت
            </button>
            <button class="btn-custom" style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:#fff; justify-content:center; font-size:0.8rem;" onclick="backupOrderData(${index})">
                <i class="fa-solid fa-copy"></i> نسخ احتياطي
            </button>
            <button class="btn-custom" style="background:linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color:#fff; justify-content:center; font-size:0.8rem;" onclick="destroySensitiveData(${index})">
                <i class="fa-solid fa-shield-halved"></i> إتلاف حساس
            </button>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; background:var(--input-bg); padding:12px; border-radius:12px;">
            <div><strong>المرجع:</strong> <code style="color:var(--primary);">${order.reference}</code></div>
            <div><strong>رقم الطلب:</strong> #${order.id}</div>
            <div><strong>العميل:</strong> ${order.name}</div>
            <div><strong>الجوال:</strong> ${order.phone}</div>
            <div><strong>المنصة:</strong> ${order.platform}</div>
            <div><strong>المبلغ:</strong> <span style="color:var(--primary);">${order.totalPrice || 200} SAR</span></div>
        </div>

        ${sensitiveContent}
        ${withdrawnBox}

        <div class="form-grid-2">
            <div class="form-group">
                <label>حالة الطلب:</label>
                <select id="modalStatusSelect" class="form-control">
                    <option value="new" ${order.status==='new'?'selected':''}>طلب جديد</option>
                    <option value="review" ${order.status==='review'?'selected':''}>انتظار المراجعة</option>
                    <option value="progress" ${order.status==='progress'?'selected':''}>قيد التنفيذ</option>
                    <option value="finished" ${order.status==='finished'?'selected':''}>تم الانتهاء</option>
                    <option value="transferred" ${order.status==='transferred'?'selected':''}>تم التحويل</option>
                    <option value="completed" ${order.status==='completed'?'selected':''}>مكتمل (رقم 6)</option>
                </select>
            </div>
            <div class="form-group">
                <label>حالة الخطأ:</label>
                <select id="modalErrorSelect" class="form-control" style="border-color:#ef4444;">
                    <option value="none" ${order.errorCode==='none'?'selected':''}>سليم</option>
                    <option value="err_pass" ${order.errorCode==='err_pass'?'selected':''}>الإيميل أو الباسورد غلط</option>
                    <option value="err_codes" ${order.errorCode==='err_codes'?'selected':''}>الأكواد الاحتياطية غلط</option>
                    <option value="err_login" ${order.errorCode==='err_login'?'selected':''}>العميل مسجل دخول</option>
                    <option value="err_market" ${order.errorCode==='err_market'?'selected':''}>سوق الانتقالات مغلق</option>
                </select>
            </div>
        </div>

        <div style="margin-top:12px; background:rgba(255,255,255,0.02); padding:10px; border-radius:10px;">
            <strong style="font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:4px;"><i class="fa-solid fa-history"></i> سجل التغييرات (Audit Log):</strong>
            <ul style="padding-right:15px; max-height:80px; overflow-y:auto;">${logsHtml}</ul>
        </div>

        <button class="btn-custom" style="width:100%; justify-content:center; margin-top:14px;" onclick="saveOrderModalChanges(${index})"><i class="fa-solid fa-floppy-disk"></i> حفظ التحديثات وتسجيل السجل</button>
    `;
    modal.classList.add("active");
}

function calcRemaining(index, input) {
    let withdrawn = parseInt(input.value) || 0;
    const total = ordersData[index].totalQty;
    if(withdrawn > total) withdrawn = total;
    document.getElementById("remainingDisplay").innerText = (total - withdrawn).toLocaleString();
}

function saveOrderModalChanges(index) {
    let newStatus = document.getElementById("modalStatusSelect").value;
    let newError = document.getElementById("modalErrorSelect").value;
    let oldStatus = ordersData[index].status;
    let withdrawnInput = document.getElementById("modalWithdrawnInput");
    
    if(withdrawnInput) {
        let oldWithdrawn = ordersData[index].withdrawnQty || 0;
        let newWithdrawn = parseInt(withdrawnInput.value) || 0;
        let diff = newWithdrawn - oldWithdrawn;
        let platform = ordersData[index].platform;
        if(stockData[platform] !== undefined) {
            stockData[platform] = Math.max(0, stockData[platform] - diff);
        }
        ordersData[index].withdrawnQty = newWithdrawn;
    }

    if(oldStatus !== newStatus) {
        if(newStatus === 'finished' && !ordersData[index].finishedAt) {
            ordersData[index].finishedAt = new Date().toISOString();
        }
        if(!ordersData[index].auditLogs) ordersData[index].auditLogs = [];
        ordersData[index].auditLogs.unshift({
            action: `تغيير الحالة من (${oldStatus}) إلى (${newStatus})`,
            user: "سامي القحطاني",
            time: new Date().toLocaleString()
        });
    }

    ordersData[index].status = newStatus;
    ordersData[index].errorCode = newError;

    renderOrdersTables();
    alert("✅ تم حفظ التحديثات وسجل التغييرات بنجاح!");
    closeOrderModal();
}

function closeOrderModal() {
    document.getElementById("orderDetailModal").classList.remove("active");
}

function migrateToGoogleSheets(index) {
    ordersData[index].migrated = true;
    renderOrdersTables();
    alert(`🚀 تم ترحيل الطلب المرجع (${ordersData[index].reference}) بنجاح.`);
}

function backupOrderData(index) {
    const o = ordersData[index];
    navigator.clipboard.writeText(`المرجع: ${o.reference} | الطلب: #${o.id} | العميل: ${o.name} | الجوال: ${o.phone}`);
    alert("📋 تم نسخ النسخة الاحتياطية.");
}

function destroySensitiveData(index) {
    if(confirm("إتلاف البيانات الحساسة أمنياً؟")) {
        ordersData[index].email = "[محذوف أمنياً]";
        ordersData[index].pass = "[محذوف أمنياً]";
        ordersData[index].sensitiveDeleted = true;
        renderOrdersTables();
        alert("🔒 تم إتلاف البيانات الحساسة أمنياً.");
        closeOrderModal();
    }
}

// ملف العملاء مع منع تكرار العميل بناء على رقم الجوال الفريد
function renderClientsList(searchQuery = "") {
    const tbody = document.getElementById("clientsTableBody");
    let clientsMap = {};
    ordersData.forEach(o => {
        let phoneKey = o.phone ? o.phone.trim() : "unknown";
        if(!clientsMap[phoneKey]) {
            clientsMap[phoneKey] = { name: o.name, phone: phoneKey, ordersCount: 0, totalCoins: 0, totalPaid: 0, orders: [] };
        }
        clientsMap[phoneKey].ordersCount += 1;
        clientsMap[phoneKey].totalCoins += o.totalQty;
        clientsMap[phoneKey].totalPaid += (o.totalPrice || 200);
        clientsMap[phoneKey].orders.push(o);
    });

    let clientsArray = Object.values(clientsMap);
    if(searchQuery.trim() !== "") {
        clientsArray = clientsArray.filter(c => c.name.includes(searchQuery) || c.phone.includes(searchQuery));
    }

    if(clientsArray.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد بيانات عملاء حالياً.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    clientsArray.forEach((client) => {
        tbody.innerHTML += `
            <tr>
                <td><b>${client.name}</b></td>
                <td style="direction:ltr; text-align:right;">${client.phone}</td>
                <td>${client.ordersCount}</td>
                <td style="color:#f59e0b;">${client.totalCoins.toLocaleString()}</td>
                <td style="color:#38bdf8;">${client.totalPaid.toLocaleString()} SAR</td>
                <td><button class="btn-action" onclick="openClientDetail('${client.phone}')"><i class="fa-solid fa-list-check"></i> عرض السجل</button></td>
            </tr>
        `;
    });
}

function filterClients(query) { renderClientsList(query); }

function openClientDetail(phone) {
    let clientOrders = ordersData.filter(o => o.phone === phone);
    if(clientOrders.length === 0) return;
    const clientName = clientOrders[0].name;
    document.getElementById("clientModalTitle").innerText = `سجل العميل الفريد: ${clientName} (${phone})`;
    let body = document.getElementById("clientModalBody");
    let tableHtml = `<div class="table-responsive"><table><thead><tr><th>المرجع</th><th>رقم الطلب</th><th>المنصة</th><th>الكمية</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>`;
    clientOrders.forEach(o => {
        tableHtml += `<tr><td><code>${o.reference}</code></td><td>#${o.id}</td><td>${o.platform}</td><td><b>${o.totalQty.toLocaleString()}</b></td><td>${o.totalPrice || 200} SAR</td><td>${getStatusBadge(o.status)}</td></tr>`;
    });
    tableHtml += `</tbody></table></div>`;
    body.innerHTML = tableHtml;
    document.getElementById("clientDetailModal").classList.add("active");
}

function closeClientModal() { document.getElementById("clientDetailModal").classList.remove("active"); }
function toggleArchive(index) { ordersData[index].archived = !ordersData[index].archived; renderOrdersTables(); }
function copyToClipboard(text, label) { navigator.clipboard.writeText(text).then(() => alert(`📋 تم نسخ ${label}.`)); }

function savePricingConfig() {
    const config = {
        ps: { rate: document.getElementById("psRate").value, min: document.getElementById("psMin").value, max: document.getElementById("psMax").value, duration: document.getElementById("psDuration").value },
        pc: { rate: document.getElementById("pcRate").value, min: document.getElementById("pcMin").value, max: document.getElementById("pcMax").value, duration: document.getElementById("pcDuration").value },
        promo: { active: document.getElementById("promoActiveSelect").value, rate: document.getElementById("promoRateInput").value, expiry: document.getElementById("promoExpiryInput").value, text: document.getElementById("promoText").value }
    };
    localStorage.setItem("sami_coins_pricing", JSON.stringify(config));
    alert("✨ تم الحفظ ومزامنة الأسعار والعروض بنجاح!");
}

function saveStatusMessages() {
    const messages = { new: document.getElementById("msgNew").value, review: document.getElementById("msgReview").value, progress: document.getElementById("msgProgress").value, finished: document.getElementById("msgFinished").value, transferred: document.getElementById("msgTransferred").value, completed: document.getElementById("msgCompleted").value };
    localStorage.setItem("sami_coins_status_messages", JSON.stringify(messages));
    alert("✨ تم حفظ رسائل الحالات بنجاح!");
}

function renderBanks() {
    const c = document.getElementById("banksListContainer");
    c.innerHTML = "";
    banksList.forEach((b, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${b}</span><button class="btn-action" style="color:#ef4444;" onclick="banksList.splice(${i},1);renderBanks()">حذف</button></div>`);
}
function addBank() { const i = document.getElementById("newBankInput"); if(i.value.trim()){ banksList.push(i.value.trim()); i.value=""; renderBanks(); } }

function renderWallets() {
    const c = document.getElementById("walletsListContainer");
    c.innerHTML = "";
    walletsList.forEach((w, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${w}</span><button class="btn-action" style="color:#ef4444;" onclick="walletsList.splice(${i},1);renderWallets()">حذف</button></div>`);
}
function addWallet() { const i = document.getElementById("newWalletInput"); if(i.value.trim()){ walletsList.push(i.value.trim()); i.value=""; renderWallets(); } }

function renderCustomPayments() {
    const c = document.getElementById("customPayMethodsContainer");
    c.innerHTML = "";
    customPaymentsList.forEach((p, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${p}</span><button class="btn-action" style="color:#ef4444;" onclick="customPaymentsList.splice(${i},1);renderCustomPayments();localStorage.setItem('sami_coins_custom_payments',JSON.stringify(customPaymentsList))">حذف</button></div>`);
}
function addCustomPaymentMethod() { const i = document.getElementById("newCustomPaymentInput"); if(i.value.trim()){ customPaymentsList.push(i.value.trim()); i.value=""; renderCustomPayments(); localStorage.setItem('sami_coins_custom_payments',JSON.stringify(customPaymentsList)); } }

function renderTerms() {
    const c = document.getElementById("termsListContainer");
    c.innerHTML = "";
    storeTerms.forEach((t, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1.5px solid var(--card-border); padding:10px; border-radius:12px;"><span style="font-size:0.85rem;">${i+1}. ${t}</span><button class="btn-action" style="color:#ef4444;" onclick="storeTerms.splice(${i},1);renderTerms()">حذف</button></div>`);
}
function addNewTerm() { const i = document.getElementById("newTermInput"); if(i.value.trim()){ storeTerms.push(i.value.trim()); i.value=""; renderTerms(); } }

function updateLiveDatetime() {
    const now = new Date();
    const el = document.getElementById("liveDatetime");
    if (el) el.innerText = `${now.toLocaleDateString('en-GB')} | ${now.toLocaleTimeString('en-GB', { hour12: false })}`;
}
setInterval(updateLiveDatetime, 1000);
updateLiveDatetime();

function switchTab(tabId, element) {
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
    element.classList.add("active");
    document.getElementById("pageTitleHeading").innerText = element.innerText.trim();
    document.getElementById("breadcrumbActive").innerText = element.innerText.trim();
    if (window.innerWidth <= 992) document.getElementById("sidebar").classList.remove("mobile-open");
}

function toggleSidebar() {
    const s = document.getElementById("sidebar"), m = document.getElementById("mainWrapper");
    if (window.innerWidth <= 992) s.classList.toggle("mobile-open");
    else { s.classList.toggle("collapsed"); m.classList.toggle("full-width"); }
}

function toggleTheme() {
    document.body.classList.toggle("light-mode");
    const isLight = document.body.classList.contains("light-mode");
    document.getElementById("themeToggleBtn").innerHTML = isLight ? '<i class="fa-regular fa-sun"></i>' : '<i class="fa-regular fa-moon"></i>';
}

function handleGlobalSearch(query) {
    if(!query.trim()) { renderOrdersTables(); return; }
    let q = query.trim().toLowerCase();
    let matched = ordersData.filter(o => o.name.toLowerCase().includes(q) || o.phone.includes(q) || o.reference.toLowerCase().includes(q) || String(o.id).includes(q));
    const fullBody = document.getElementById("fullOrdersTableBody");
    fullBody.innerHTML = "";
    if(matched.length === 0) {
        fullBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px;">لا توجد نتائج مطابقة لـ "${query}".</td></tr>`;
        return;
    }
    matched.forEach(order => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        fullBody.innerHTML += `
            <tr>
                <td><code style="color:var(--primary);">${order.reference}</code></td>
                <td>#${order.id}</td>
                <td><b>${order.name}</b></td>
                <td>${order.platform}</td>
                <td><b>${order.totalQty.toLocaleString()}</b></td>
                <td style="color:var(--primary);">${order.totalPrice || 200} SAR</td>
                <td>${getStatusBadge(order.status)}</td>
                <td><button class="btn-action" onclick="openOrderModal(${actualIndex})">التفاصيل</button></td>
            </tr>
        `;
    });
}

// التشغيل الأولي للنظام
updateStoreStatusUI();
renderOrdersTables();
renderBanks();
renderWallets();
renderCustomPayments();
renderTerms();
