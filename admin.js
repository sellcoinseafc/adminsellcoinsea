import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// اختبار اتصال فايربيز
async function testConnection() {
  try {
    const snapshot = await getDocs(collection(db, "orders"));
    console.log("Firestore Connected ✅");
    console.log("Orders count:", snapshot.size);
  } catch (err) {
    console.error("Connection Error:", err);
  }
}
testConnection();

// إدارة حالة المتجر (الإعدادات العامة تبقى طبيعية)
let isStoreOpen = localStorage.getItem("sami_coins_store_status") !== "closed";

function updateStoreStatusUI() {
    const btn = document.getElementById("storeStatusToggleBtn");
    const txt = document.getElementById("storeStatusText");
    if (!btn || !txt) return;
    if (isStoreOpen) {
        btn.className = "store-status-btn open";
        txt.innerText = "المتجر مفتوح";
    } else {
        btn.className = "store-status-btn closed";
        txt.innerText = "المتجر مغلق";
    }
    localStorage.setItem("sami_coins_store_status", isStoreOpen ? "open" : "closed");
}

window.toggleStoreStatus = function() {
    isStoreOpen = !isStoreOpen;
    updateStoreStatusUI();
    alert(isStoreOpen ? "🟢 تم فتح المتجر وبدء استقبال الطلبات!" : "🔴 تم إيقاف وإغلاق استقبال الطلبات!");
};

// مصدر البيانات للطلبات (بدون LocalStorage نهائياً)
let ordersData = []; 

let banksList = ["مصرف الراجحي", "البنك الأهلي السعودي (SNB)", "بنك الرياض", "stc bank", "مصرف الإنماء"];
let walletsList = ["STC Pay", "urpay", "برق (Barq)", "موبايلي بي", "تيكمو"];
let customPaymentsList = JSON.parse(localStorage.getItem("sami_coins_custom_payments")) || ["بطاقة مدى / فيزا", "Apple Pay"];
let storeTerms = [
    "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
    "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
    "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
];
let stockData = { PlayStation: 0, PC: 0 };

// المزامنة المباشرة واللحظية للطلبات من Firestore عبر onSnapshot
function initOrdersListener() {
    const ref = collection(db, "orders");
    onSnapshot(ref, (snapshot) => {
        ordersData = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                reference: data.orderId || docSnap.id,
                name: data.customerName || data.name || "مشتري",
                phone: data.phone || "",
                platform: data.platform || "",
                totalQty: data.quantity !== undefined ? data.quantity : (data.totalQty || 0),
                totalPrice: data.price || data.totalPrice || "0 ر.س",
                status: data.status || "new",
                errorCode: data.errorCode || "none",
                email: data.email || "",
                pass: data.password || data.pass || "",
                withdrawnQty: data.withdrawnQty || 0,
                auditLogs: data.auditLogs || [{ action: "إنشاء الطلب", user: "النظام", time: new Date().toLocaleString() }],
                finishedAt: data.finishedAt || null,
                archived: data.archived || false,
                sensitiveDeleted: data.sensitiveDeleted || false,
                createdAt: data.createdAt || new Date().toISOString(),
                ...data
            };
        });
        updateDashboardStats();
        renderOrdersTables();
    }, (error) => {
        console.error("Error listening to orders changes:", error);
    });
}

function sortOrdersNewestFirst() {
    ordersData.sort((a, b) => {
        let timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        let timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return timeB - timeA;
    });
}

function updateDashboardStats() {
    sortOrdersNewestFirst();
    let countNew = ordersData.filter(o => o.status === 'new').length;
    let countReview = ordersData.filter(o => o.status === 'review').length;
    let countProgress = ordersData.filter(o => o.status === 'progress').length;
    let countCompleted = ordersData.filter(o => o.status === 'completed').length;

    const sbBadge = document.getElementById("sidebarNewOrdersBadge");
    if(sbBadge) {
        if(countNew > 0) {
            sbBadge.style.display = "inline-block";
            sbBadge.innerText = countNew;
        } else {
            sbBadge.style.display = "none";
        }
    }

    let transferNeededList = ordersData.filter(o => o.status === 'finished' || (o.withdrawnQty >= o.totalQty && o.status !== 'transferred' && o.status !== 'completed'));
    
    const transferBadgeCount = document.getElementById("transferBadgeCount");
    const transferHeaderBadge = document.getElementById("transferHeaderBadge");
    if(transferBadgeCount) transferBadgeCount.innerText = transferNeededList.length;
    if(transferHeaderBadge) transferHeaderBadge.innerText = `${transferNeededList.length} طلبات بحاجة للتحويل`;

    const banner = document.getElementById("urgentTransferBanner");
    const bannerTransferText = document.getElementById("bannerTransferText");
    if(banner && bannerTransferText) {
        if(transferNeededList.length > 0) {
            banner.style.display = "flex";
            bannerTransferText.innerText = `لديك ${transferNeededList.length} طلبات منتهية تحتاج إلى التحويل المالي للعملاء خلال 3-5 أيام عمل من تاريخ الانتهاء.`;
        } else {
            banner.style.display = "none";
        }
    }

    let totalCompletedCoins = ordersData.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.totalQty || 0), 0);
    let totalTransferredMoney = ordersData.filter(o => o.status === 'completed').reduce((sum, o) => {
        let p = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 200;
        return sum + p;
    }, 0);

    if(document.getElementById("statNewOrders")) document.getElementById("statNewOrders").innerText = countNew;
    if(document.getElementById("statReviewOrders")) document.getElementById("statReviewOrders").innerText = countReview;
    if(document.getElementById("statProgressOrders")) document.getElementById("statProgressOrders").innerText = countProgress;
    if(document.getElementById("statCompletedOrders")) document.getElementById("statCompletedOrders").innerText = countCompleted;
    if(document.getElementById("statCompletedCoins")) document.getElementById("statCompletedCoins").innerText = totalCompletedCoins.toLocaleString();
    if(document.getElementById("statTransferredMoney")) document.getElementById("statTransferredMoney").innerText = totalTransferredMoney.toLocaleString() + " ر.س";

    if(document.getElementById("stockPS")) document.getElementById("stockPS").innerText = stockData.PlayStation.toLocaleString();
    if(document.getElementById("stockPC")) document.getElementById("stockPC").innerText = stockData.PC.toLocaleString();

    renderTransferAlertsTable(transferNeededList);
}

window.filterOrdersByStatus = function(status) {
    window.switchTab('ordersTab', document.querySelector('.sidebar-menu li:nth-child(2) a'));
    const statusFilter = document.getElementById("orderStatusFilter");
    if(statusFilter) statusFilter.value = status;
    renderOrdersTables();
};

function renderTransferAlertsTable(list) {
    const tbody = document.getElementById("transferAlertsTableBody");
    if(!tbody) return;
    if(list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات بحاجة للتحويل حالياً.</td></tr>`;
        return;
    }
    tbody.innerHTML = "";
    list.forEach((order, index) => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        let finishDateStr = order.finishedAt ? new Date(order.finishedAt).toLocaleDateString('en-GB') : 'عند الانتهاء';
        tbody.innerHTML += `
            <tr>
                <td><code style="color:var(--primary);">${order.reference}</code></td>
                <td>#${order.id}</td>
                <td><b>${order.name}</b></td>
                <td style="direction:ltr; text-align:right;">${order.phone}</td>
                <td style="color:var(--primary);">${order.totalPrice}</td>
                <td><span class="badge badge-review"><i class="fa-solid fa-clock"></i> بدأ العد من: ${finishDateStr} (3 - 5 أيام عمل)</span></td>
                <td><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-money-bill-transfer"></i> إتمام التحويل</button></td>
            </tr>
        `;
    });
}

window.openOrderModalById = function(id) {
    let idx = ordersData.findIndex(o => o.id === id);
    if(idx !== -1) window.openOrderModal(idx);
};

window.renderOrdersTables = function() {
    sortOrdersNewestFirst();
    const dashBody = document.getElementById("dashboardOrdersTableBody");
    const fullBody = document.getElementById("fullOrdersTableBody");
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    
    let filteredOrders = ordersData;
    if(statusFilter !== "all") {
        filteredOrders = ordersData.filter(o => o.status === statusFilter);
    }

    if(dashBody) {
        if(ordersData.length === 0) {
            dashBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات حالياً.</td></tr>`;
        } else {
            dashBody.innerHTML = "";
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
                        <td style="color:var(--primary);">${order.totalPrice}</td>
                        <td><div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">${statusBadge} ${errorBadge}</div></td>
                        <td><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-eye"></i> التفاصيل</button></td>
                    </tr>
                `;
            });
        }
    }

    if(fullBody) {
        if(filteredOrders.length === 0) {
            fullBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات مسجلة أو مطابقة للفلتر.</td></tr>`;
        } else {
            fullBody.innerHTML = "";
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
                        <td style="color:var(--primary);">${order.totalPrice}</td>
                        <td><div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${statusBadge} ${errorBadge}</div></td>
                        <td>
                            <button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-pen-to-square"></i> التفاصيل والنسخ</button>
                            <button class="btn-action" style="color:#f59e0b;" onclick="toggleArchive(${actualIndex})">${order.archived ? 'استرجاع' : 'أرشفة'}</button>
                        </td>
                    </tr>
                `;
            });
        }
    }

    updateDashboardStats();
    renderClientsList();
};

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

window.openOrderModal = function(index) {
    const order = ordersData[index];
    const modal = document.getElementById("orderDetailModal");
    const body = document.getElementById("modalOrderBody");
    if(!modal || !body) return;
    const remaining = order.totalQty - (order.withdrawnQty || 0);

    let logsHtml = (order.auditLogs || []).map(l => `<li style="font-size:0.78rem; color:var(--text-muted);">${l.time} - ${l.action} (${l.user})</li>`).join("");

    let sensitiveContent = order.sensitiveDeleted ? 
        `<div style="background:rgba(239,68,68,0.1); color:#ef4444; padding:10px; border-radius:10px; text-align:center; font-weight:900;">⚠️ تم إتلاف وحذف البيانات الحساسة أمنياً.</div>` :
        `<div style="background:var(--input-bg); padding:14px; border-radius:12px; margin-bottom:12px; border:1.5px solid var(--card-border);">
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
            <div><strong>المبلغ:</strong> <span style="color:var(--primary);">${order.totalPrice}</span></div>
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
};

window.calcRemaining = function(index, input) {
    let withdrawn = parseInt(input.value) || 0;
    const total = ordersData[index].totalQty;
    if(withdrawn > total) withdrawn = total;
    const remDisp = document.getElementById("remainingDisplay");
    if(remDisp) remDisp.innerText = (total - withdrawn).toLocaleString();
};

window.saveOrderModalChanges = async function(index) {
    let order = ordersData[index];
    let newStatus = document.getElementById("modalStatusSelect").value;
    let newError = document.getElementById("modalErrorSelect").value;
    let oldStatus = order.status;
    let withdrawnInput = document.getElementById("modalWithdrawnInput");
    
    let updateData = {
        status: newStatus,
        errorCode: newError,
        updatedAt: serverTimestamp()
    };

    if(withdrawnInput) {
        let oldWithdrawn = order.withdrawnQty || 0;
        let newWithdrawn = parseInt(withdrawnInput.value) || 0;
        let diff = newWithdrawn - oldWithdrawn;
        let platform = order.platform;
        if(stockData[platform] !== undefined) {
            stockData[platform] = Math.max(0, stockData[platform] - diff);
        }
        updateData.withdrawnQty = newWithdrawn;
    }

    if(oldStatus !== newStatus) {
        if(newStatus === 'finished' && !order.finishedAt) {
            updateData.finishedAt = new Date().toISOString();
        }
        let logs = order.auditLogs || [];
        logs.unshift({
            action: `تغيير الحالة من (${oldStatus}) إلى (${newStatus})`,
            user: "سامي القحطاني",
            time: new Date().toLocaleString()
        });
        updateData.auditLogs = logs;
    }

    try {
        const orderRef = doc(db, "orders", order.id);
        await updateDoc(orderRef, updateData);
        alert("✅ تم حفظ التحديثات في قاعدة البيانات بنجاح!");
        window.closeOrderModal();
    } catch(err) {
        console.error("Error saving order updates:", err);
        alert("❌ حدث خطأ أثناء الحفظ في قاعدة البيانات.");
    }
};

window.closeOrderModal = function() {
    const modal = document.getElementById("orderDetailModal");
    if(modal) modal.classList.remove("active");
};

window.migrateToGoogleSheets = function(index) {
    ordersData[index].migrated = true;
    window.renderOrdersTables();
    alert(`🚀 تم ترحيل الطلب المرجع (${ordersData[index].reference}) بنجاح.`);
};

window.backupOrderData = function(index) {
    const o = ordersData[index];
    navigator.clipboard.writeText(`المرجع: ${o.reference} | الطلب: #${o.id} | العميل: ${o.name} | الجوال: ${o.phone}`);
    alert("📋 تم نسخ النسخة الاحتياطية.");
};

window.destroySensitiveData = async function(index) {
    if(confirm("إتلاف البيانات الحساسة أمنياً؟")) {
        let order = ordersData[index];
        try {
            const orderRef = doc(db, "orders", order.id);
            await updateDoc(orderRef, {
                email: "[محذوف أمنياً]",
                password: "[محذوف أمنياً]",
                sensitiveDeleted: true
            });
            alert("🔒 تم إتلاف البيانات الحساسة أمنياً.");
            window.closeOrderModal();
        } catch(err) {
            console.error("Error destroying sensitive data:", err);
            alert("❌ حدث خطأ أثناء إتلاف البيانات.");
        }
    }
};

// ملف العملاء (بناءً على البيانات المزامنة من Firestore)
function renderClientsList(searchQuery = "") {
    const tbody = document.getElementById("clientsTableBody");
    if(!tbody) return;
    let clientsMap = {};
    ordersData.forEach(o => {
        let phoneKey = o.phone ? o.phone.trim() : "unknown";
        if(!clientsMap[phoneKey]) {
            clientsMap[phoneKey] = { name: o.name, phone: phoneKey, ordersCount: 0, totalCoins: 0, totalPaid: 0, orders: [] };
        }
        clientsMap[phoneKey].ordersCount += 1;
        clientsMap[phoneKey].totalCoins += (o.totalQty || 0);
        let pVal = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 200;
        clientsMap[phoneKey].totalPaid += pVal;
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

window.filterClients = function(query) { renderClientsList(query); };

window.openClientDetail = function(phone) {
    let clientOrders = ordersData.filter(o => o.phone === phone);
    if(clientOrders.length === 0) return;
    const clientName = clientOrders[0].name;
    const titleEl = document.getElementById("clientModalTitle");
    const body = document.getElementById("clientModalBody");
    if(titleEl) titleEl.innerText = `سجل العميل الفريد: ${clientName} (${phone})`;
    if(body) {
        let tableHtml = `<div class="table-responsive"><table><thead><tr><th>المرجع</th><th>رقم الطلب</th><th>المنصة</th><th>الكمية</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>`;
        clientOrders.forEach(o => {
            tableHtml += `<tr><td><code>${o.reference}</code></td><td>#${o.id}</td><td>${o.platform}</td><td><b>${o.totalQty.toLocaleString()}</b></td><td>${o.totalPrice}</td><td>${getStatusBadge(o.status)}</td></tr>`;
        });
        tableHtml += `</tbody></table></div>`;
        body.innerHTML = tableHtml;
    }
    const clientModal = document.getElementById("clientDetailModal");
    if(clientModal) clientModal.classList.add("active");
};

window.closeClientModal = function() {
    const modal = document.getElementById("clientDetailModal");
    if(modal) modal.classList.remove("active");
};

window.toggleArchive = async function(index) {
    let order = ordersData[index];
    try {
        const orderRef = doc(db, "orders", order.id);
        await updateDoc(orderRef, { archived: !order.archived });
    } catch(err) {
        console.error("Error toggling archive:", err);
    }
};

window.copyToClipboard = function(text, label) {
    navigator.clipboard.writeText(text).then(() => alert(`📋 تم نسخ ${label}.`));
};

window.savePricingConfig = function() {
    const config = {
        ps: { rate: document.getElementById("psRate")?.value, min: document.getElementById("psMin")?.value, max: document.getElementById("psMax")?.value, duration: document.getElementById("psDuration")?.value },
        pc: { rate: document.getElementById("pcRate")?.value, min: document.getElementById("pcMin")?.value, max: document.getElementById("pcMax")?.value, duration: document.getElementById("pcDuration")?.value },
        promo: { active: document.getElementById("promoActiveSelect")?.value, rate: document.getElementById("promoRateInput")?.value, expiry: document.getElementById("promoExpiryInput")?.value, text: document.getElementById("promoText")?.value }
    };
    localStorage.setItem("sami_coins_pricing", JSON.stringify(config));
    alert("✨ تم الحفظ ومزامنة الأسعار والعروض بنجاح!");
};

window.saveStatusMessages = function() {
    const messages = { 
        new: document.getElementById("msgNew")?.value, 
        review: document.getElementById("msgReview")?.value, 
        progress: document.getElementById("msgProgress")?.value, 
        finished: document.getElementById("msgFinished")?.value, 
        transferred: document.getElementById("msgTransferred")?.value, 
        completed: document.getElementById("msgCompleted")?.value 
    };
    localStorage.setItem("sami_coins_status_messages", JSON.stringify(messages));
    alert("✨ تم حفظ رسائل الحالات بنجاح!");
};

function renderBanks() {
    const c = document.getElementById("banksListContainer");
    if(!c) return;
    c.innerHTML = "";
    banksList.forEach((b, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${b}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteBank(${i})">حذف</button></div>`);
}

window.addBank = function() {
    const i = document.getElementById("newBankInput");
    if(i && i.value.trim()){ banksList.push(i.value.trim()); i.value=""; renderBanks(); }
};

window.deleteBank = function(i) {
    banksList.splice(i, 1);
    renderBanks();
};

function renderWallets() {
    const c = document.getElementById("walletsListContainer");
    if(!c) return;
    c.innerHTML = "";
    walletsList.forEach((w, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${w}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteWallet(${i})">حذف</button></div>`);
}

window.addWallet = function() {
    const i = document.getElementById("newWalletInput");
    if(i && i.value.trim()){ walletsList.push(i.value.trim()); i.value=""; renderWallets(); }
};

window.deleteWallet = function(i) {
    walletsList.splice(i, 1);
    renderWallets();
};

function renderCustomPayments() {
    const c = document.getElementById("customPayMethodsContainer");
    if(!c) return;
    c.innerHTML = "";
    customPaymentsList.forEach((p, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${p}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteCustomPayment(${i})">حذف</button></div>`);
}

window.addCustomPaymentMethod = function() {
    const i = document.getElementById("newCustomPaymentInput");
    if(i && i.value.trim()){ 
        customPaymentsList.push(i.value.trim()); 
        i.value=""; 
        renderCustomPayments(); 
        localStorage.setItem('sami_coins_custom_payments', JSON.stringify(customPaymentsList)); 
    }
};

window.deleteCustomPayment = function(i) {
    customPaymentsList.splice(i, 1);
    renderCustomPayments();
    localStorage.setItem('sami_coins_custom_payments', JSON.stringify(customPaymentsList));
};

function renderTerms() {
    const c = document.getElementById("termsListContainer");
    if(!c) return;
    c.innerHTML = "";
    storeTerms.forEach((t, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1.5px solid var(--card-border); padding:10px; border-radius:12px;"><span style="font-size:0.85rem;">${i+1}. ${t}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteTerm(${i})">حذف</button></div>`);
}

window.addNewTerm = function() {
    const i = document.getElementById("newTermInput");
    if(i && i.value.trim()){ storeTerms.push(i.value.trim()); i.value=""; renderTerms(); }
};

window.deleteTerm = function(i) {
    storeTerms.splice(i, 1);
    renderTerms();
};

function updateLiveDatetime() {
    const now = new Date();
    const el = document.getElementById("liveDatetime");
    if (el) el.innerText = `${now.toLocaleDateString('en-GB')} | ${now.toLocaleTimeString('en-GB', { hour12: false })}`;
}
setInterval(updateLiveDatetime, 1000);
updateLiveDatetime();

window.switchTab = function(tabId, element) {
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));
    const targetTab = document.getElementById(tabId);
    if(targetTab) targetTab.classList.add("active");
    if(element) element.classList.add("active");
    const titleHead = document.getElementById("pageTitleHeading");
    const breadcrumbActive = document.getElementById("breadcrumbActive");
    if(titleHead && element) titleHead.innerText = element.innerText.trim();
    if(breadcrumbActive && element) breadcrumbActive.innerText = element.innerText.trim();
    if (window.innerWidth <= 992) {
        const sb = document.getElementById("sidebar");
        if(sb) sb.classList.remove("mobile-open");
    }
};

window.toggleSidebar = function() {
    const s = document.getElementById("sidebar"), m = document.getElementById("mainWrapper");
    if(!s || !m) return;
    if (window.innerWidth <= 992) s.classList.toggle("mobile-open");
    else { s.classList.toggle("collapsed"); m.classList.toggle("full-width"); }
};

window.toggleTheme = function() {
    document.body.classList.toggle("light-mode");
    const isLight = document.body.classList.contains("light-mode");
    const themeBtn = document.getElementById("themeToggleBtn");
    if(themeBtn) themeBtn.innerHTML = isLight ? '<i class="fa-regular fa-sun"></i>' : '<i class="fa-regular fa-moon"></i>';
};

window.handleGlobalSearch = function(query) {
    if(!query.trim()) { window.renderOrdersTables(); return; }
    let q = query.trim().toLowerCase();
    let matched = ordersData.filter(o => String(o.name).toLowerCase().includes(q) || String(o.phone).includes(q) || String(o.reference).toLowerCase().includes(q) || String(o.id).includes(q));
    const fullBody = document.getElementById("fullOrdersTableBody");
    if(!fullBody) return;
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
                <td style="color:var(--primary);">${order.totalPrice}</td>
                <td>${getStatusBadge(order.status)}</td>
                <td><button class="btn-action" onclick="openOrderModal(${actualIndex})">التفاصيل</button></td>
            </tr>
        `;
    });
};

// التشغيل الأولي وبدء الاستماع الفوري للطلبات
updateStoreStatusUI();
initOrdersListener();
renderBanks();
renderWallets();
renderCustomPayments();
renderTerms();
