import { db, auth } from "../shared/firebase.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  subscribeToSettings,
  savePricing,
  updateStock,
  addBank as systemAddBank,
  deleteBank as systemDeleteBank,
  addWallet as systemAddWallet,
  deleteWallet as systemDeleteWallet,
  addPaymentMethod as systemAddPaymentMethod,
  deletePaymentMethod as systemDeletePaymentMethod,
  addTerm as systemAddTerm,
  deleteTerm as systemDeleteTerm,
  toggleStore
} from "../shared/system.js";

const ALLOWED_EMAILS = [
  "mt.samicoins@gmail.com",
  "psnsa7@gmail.com"
];

let currentAdmin = {
  uid: null,
  name: "مشرف النظام",
  email: "",
  role: "admin"
};

let ordersData = [];
let adminsData = [];
let auditLogsData = [];
let currentSettingsData = {};
let activeSearchQuery = "";

let unsubscribeOrders = null;
let unsubscribeSettings = null;
let unsubscribeAdmins = null;
let unsubscribeAudit = null;

// ==========================================================================
// 1) حارس الأمان والتسجيل
// ==========================================================================
function startAllListeners() {
  if (!unsubscribeOrders) unsubscribeOrders = initOrdersListener();
  if (!unsubscribeSettings) unsubscribeSettings = initSystemSettingsListener();
  if (!unsubscribeAdmins) unsubscribeAdmins = initAdminsListener();
  if (!unsubscribeAudit) unsubscribeAudit = initAuditLogsListener();
  startLiveClock();
}

function initAuthGuard() {
  if (!auth) return;

  getRedirectResult(auth)
    .then((result) => {
      if (result && result.user) console.log("Google Redirect Login Successful:", result.user.email);
    })
    .catch((err) => showLoginError("فشل الدخول عبر التوجيه المباشر: " + (err.message || "")));

  onAuthStateChanged(auth, async (user) => {
    const loginOverlay = document.getElementById("loginOverlay");
    if (user) {
      if (!ALLOWED_EMAILS.includes(user.email)) {
        await signOut(auth);
        alert("غير مصرح لك بدخول لوحة التحكم");
        if (loginOverlay) loginOverlay.classList.add("active");
        return;
      }

      try {
        const adminRef = doc(db, "admins", user.uid);
        const adminSnap = await getDoc(adminRef);

        if (!adminSnap.exists() || adminSnap.data().active === false) {
          alert("الحساب غير مصرح له أو معطل");
          await signOut(auth);
          if (loginOverlay) loginOverlay.classList.add("active");
          return;
        }

        currentAdmin = { uid: user.uid, ...adminSnap.data() };
        await updateDoc(adminRef, { lastLogin: serverTimestamp() });

        if (loginOverlay) loginOverlay.classList.remove("active");
        updateSidebarAdminUI();
        startAllListeners();
        await logAuditEvent("تسجيل دخول المشرف", "النظام", `تم الدخول بواسطة: ${currentAdmin.email}`);

      } catch (err) {
        showLoginError("⚠️ خطأ في التوثيق: " + err.message);
        await signOut(auth);
        if (loginOverlay) loginOverlay.classList.add("active");
      }
    } else {
      if (loginOverlay) loginOverlay.classList.add("active");
    }
  });
}

function showLoginError(msg) {
  const alertEl = document.getElementById("loginErrorAlert");
  if (alertEl) {
    alertEl.innerText = msg;
    alertEl.style.display = "block";
  }
}

window.handleEmailLogin = async function (e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const alertEl = document.getElementById("loginErrorAlert");
    if (alertEl) alertEl.style.display = "none";
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showLoginError("❌ البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  }
};

window.handleGoogleLogin = async function () {
  const alertEl = document.getElementById("loginErrorAlert");
  try {
    if (alertEl) alertEl.style.display = "none";
    const provider = new GoogleAuthProvider();
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (alertEl) {
      alertEl.innerText = err.message;
      alertEl.style.display = "block";
    }
  }
};

function updateSidebarAdminUI() {
  const nameEl = document.getElementById("sidebarUserName");
  const roleEl = document.getElementById("sidebarUserRole");
  const avatarEl = document.getElementById("userAvatarText");
  if (nameEl) nameEl.innerText = currentAdmin.name;
  if (roleEl) roleEl.innerText = currentAdmin.role === "owner" ? "Owner (مالك)" : "Admin (مشرف)";
  if (avatarEl && currentAdmin.name) avatarEl.innerText = currentAdmin.name.charAt(0);
}

window.handleLogout = async function () {
  if (confirm("هل ترغب بتسجيل الخروج؟")) {
    await logAuditEvent("تسجيل خروج", "النظام", `تم خروج: ${currentAdmin.email}`);
    if (auth) await signOut(auth);
    window.location.reload();
  }
};

// ==========================================================================
// 2) السجل والساعة التفاعلية والأدوات المساعدة
// ==========================================================================
function startLiveClock() {
  const clockEl = document.getElementById("liveDatetime");
  if (!clockEl) return;
  setInterval(() => {
    const now = new Date();
    clockEl.innerText = now.toLocaleString("ar-SA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }, 1000);
}

async function logAuditEvent(action, targetOrder = "عام", details = "") {
  try {
    await addDoc(collection(db, "audit_logs"), {
      timestamp: serverTimestamp(),
      timeString: new Date().toLocaleString("ar-SA"),
      user: currentAdmin.name || "مشرف",
      userId: currentAdmin.uid || "system",
      action,
      targetOrder,
      details,
      userAgent: navigator.userAgent.substring(0, 50)
    });
  } catch (err) {
    console.error("Audit Logging Error:", err);
  }
}

function initAuditLogsListener() {
  const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(100));
  return onSnapshot(q, (snapshot) => {
    auditLogsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderAuditLogsTable();
  });
}

function renderAuditLogsTable() {
  const tbody = document.getElementById("stockLogsTableBody");
  if (!tbody) return;
  if (auditLogsData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:15px; color:var(--text-muted);">لا توجد سجلاّت حركة مسجلة.</td></tr>`;
    return;
  }
  tbody.innerHTML = auditLogsData.map(log => {
    const refCode = log.targetOrder || 'عام';
    return `
      <tr>
        <td><span style="font-size:0.78rem; color:var(--text-muted);">${log.timeString || '---'}</span></td>
        <td><b>${log.user || 'مشرف'}</b></td>
        <td><span class="badge badge-review">${log.action}</span></td>
        <td><code class="copyable-box" style="cursor:pointer;" onclick="copyTrackingLink('${refCode}')">#${refCode}</code></td>
        <td><span style="font-size:0.75rem; color:var(--text-muted);">${log.details || '---'}</span></td>
      </tr>
    `;
  }).join('');
}

function initAdminsListener() {
  return onSnapshot(collection(db, "admins"), (snapshot) => {
    adminsData = snapshot.docs.map(docSnap => ({ uid: docSnap.id, ...docSnap.data() }));
  });
}

function initOrdersListener() {
  loadOrders();
  const interval = setInterval(loadOrders, 4000);
  return () => clearInterval(interval);
}

// الدالة المعتمدة لنسخ رابط التتبع بالكامل
window.copyTrackingLink = async function(refCode) {
  if (!refCode || refCode === "---" || refCode === "عام") return;
  const url = `https://status.sa4coins.com/?ref=${refCode}`;
  try {
    await navigator.clipboard.writeText(url);
    alert("✅ تم نسخ رابط التتبع بنجاح:\n" + url);
  } catch {
    prompt("نسخ رابط التتبع المباشر:", url);
  }
};

function formatCoinsNumber(num) {
  if (num === "" || num === null || isNaN(num)) return "0";
  return Number(num).toLocaleString('en-US');
}

function calculateTransferCountdown(createdAt) {
  if (!createdAt) return '<span style="color:var(--text-muted);">---</span>';
  const createdDate = new Date(createdAt);
  if (isNaN(createdDate.getTime())) return '<span style="color:var(--text-muted);">---</span>';

  const maxHours = 120; // 5 أيام عمل
  const now = new Date();
  const diffMs = now.getTime() - createdDate.getTime();
  const passedHours = diffMs / (1000 * 60 * 60);
  const remainingHours = Math.max(0, maxHours - passedHours);

  if (remainingHours <= 0) {
    return `<span style="color:var(--danger); font-weight:900;"><i class="fa-solid fa-triangle-exclamation"></i> منتهي (انتهت المهلة)</span>`;
  }

  const daysLeft = Math.floor(remainingHours / 24);
  const hoursLeft = Math.floor(remainingHours % 24);

  let colorStyle = "color:var(--success); font-weight:800;";
  if (daysLeft <= 1) {
    colorStyle = "color:var(--danger); font-weight:900;";
  } else if (daysLeft <= 3) {
    colorStyle = "color:#f59e0b; font-weight:800;";
  }

  return `<span style="${colorStyle} font-size:0.8rem;"><i class="fa-solid fa-stopwatch"></i> متبقي ${daysLeft} يوم و ${hoursLeft} ساعة</span>`;
}

// ==========================================================================
// 3) قراءة الطلبات الموحدة عبر السيرفر وتحديث الواجهات
// ==========================================================================
async function loadOrders() {
  try {
    const res = await fetch("/api/orders/list");
    const data = await res.json();
    if (!data.success) return;

    ordersData = data.orders.map(order => ({
      id: order.id,
      reference: order.orderId,
      referenceNumber: order.referenceNumber || order.orderId || "",
      name: order.customerName || "عميل",
      phone: order.customerPhone || "",
      platform: order.platform || "PlayStation",
      totalQty: Number(order.quantity || 0),
      drawnCoins: Number(order.drawnCoins || 0),
      totalPrice: order.total || "0 ر.س",
      status: order.status || "pending",
      createdAt: order.createdAt || null,
      paymentMethod: order.paymentMethod || "تحويل بنكي",
      bankName: order.bankName || "---",
      accountIban: order.accountIban || "---",
      accountEmail: order.accountEmail || "",
      accountPassword: order.accountPassword || "",
      backupCodes: order.backupCodes || "",
      ...order
    }));

    sortOrdersByPriority();
    renderDashboardQuickStats();
    renderStatisticsPage();
    renderOrdersTables();
    renderWithdrawOrdersTable();
    renderRecentOrdersTable();
    renderTransferAlertsTable();
    renderClientsTable(activeSearchQuery);

  } catch (err) {
    console.error("Load Orders API Error:", err);
  }
}

function sortOrdersByPriority() {
  const priorityMap = {
    'progress': 1,
    'new': 2,
    'pending': 2,
    'review': 3,
    'finished': 4,
    'completed': 4,
    'transferred': 5,
    'archived': 6
  };

  ordersData.sort((a, b) => {
    const pA = priorityMap[a.status] || 7;
    const pB = priorityMap[b.status] || 7;
    if (pA !== pB) return pA - pB;
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
}

function renderDashboardQuickStats() {
  const countNew = ordersData.filter(o => o.status === 'new' || o.status === 'pending').length;
  const countProgress = ordersData.filter(o => o.status === 'progress').length;
  const countFinished = ordersData.filter(o => o.status === 'completed' || o.status === 'finished').length;
  const countTransferPending = ordersData.filter(o => o.status === 'finished').length;

  if (document.getElementById("dashStatNew")) document.getElementById("dashStatNew").innerText = countNew;
  if (document.getElementById("dashStatProgress")) document.getElementById("dashStatProgress").innerText = countProgress;
  if (document.getElementById("dashStatCompleted")) document.getElementById("dashStatCompleted").innerText = countFinished;
  if (document.getElementById("dashStatPendingTransfer")) document.getElementById("dashStatPendingTransfer").innerText = countTransferPending;
  if (document.getElementById("sidebarNewOrdersBadge")) {
    const badge = document.getElementById("sidebarNewOrdersBadge");
    badge.innerText = countNew;
    badge.style.display = countNew > 0 ? "inline-block" : "none";
  }

  if (document.getElementById("dashStockPS")) document.getElementById("dashStockPS").innerText = formatCoinsNumber(currentSettingsData.psStock || 0) + " كوينز";
  if (document.getElementById("dashStockPC")) document.getElementById("dashStockPC").innerText = formatCoinsNumber(currentSettingsData.pcStock || 0) + " كوينز";
}

function renderStatisticsPage() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  let totalCoins = 0, totalMoney = 0, todayCoins = 0, todayMoney = 0;
  const clientsSet = new Set();

  ordersData.forEach(o => {
    if (o.phone) clientsSet.add(o.phone);
    const pVal = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 0;

    if (o.status === 'completed' || o.status === 'finished' || o.status === 'transferred') {
      totalCoins += o.totalQty;
      totalMoney += pVal;
      const orderDateStr = o.createdAt ? new Date(o.createdAt).toISOString().split('T')[0] : "";
      if (orderDateStr === todayStr) {
        todayCoins += o.totalQty;
        todayMoney += pVal;
      }
    }
  });

  if (document.getElementById("statTotalOrders")) document.getElementById("statTotalOrders").innerText = ordersData.length;
  if (document.getElementById("statTotalClients")) document.getElementById("statTotalClients").innerText = clientsSet.size;
  if (document.getElementById("statTotalCoins")) document.getElementById("statTotalCoins").innerText = formatCoinsNumber(totalCoins);
  if (document.getElementById("statTotalMoney")) document.getElementById("statTotalMoney").innerText = totalMoney.toLocaleString() + " ريال";
  if (document.getElementById("statTodayCoins")) document.getElementById("statTodayCoins").innerText = formatCoinsNumber(todayCoins);
  if (document.getElementById("statTodayMoney")) document.getElementById("statTodayMoney").innerText = todayMoney.toLocaleString() + " ريال";
}

window.handleGlobalSearch = function (queryVal) {
  activeSearchQuery = queryVal.trim().toLowerCase();
  renderOrdersTables();
  renderWithdrawOrdersTable();
  renderClientsTable(activeSearchQuery);
};

// ==========================================================================
// 4) رسم الجداول والعمليات الكاملة (تعديل، حذف، أرشفة، معاينة)
// ==========================================================================
function buildActionButtonsHTML(order) {
  const refNum = order.referenceNumber || order.reference || order.id;
  return `
    <div style="display:flex; gap:4px; flex-wrap:wrap;">
      <button class="btn-action" title="معاينة والتفاصيل" onclick="openOrderModal('${order.id}')"><i class="fa-solid fa-eye"></i></button>
      <button class="btn-action" style="color:var(--warning); border-color:var(--warning);" title="تعديل الطلب" onclick="promptEditOrder('${order.id}')"><i class="fa-solid fa-pen"></i></button>
      <button class="btn-action" style="color:var(--purple); border-color:var(--purple);" title="أرشفة" onclick="handleArchiveOrder('${order.id}', '${refNum}')"><i class="fa-solid fa-box-archive"></i></button>
      <button class="btn-action" style="color:var(--danger); border-color:var(--danger);" title="حذف الطلب" onclick="handleDeleteOrder('${order.id}', '${refNum}')"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
}

window.renderOrdersTables = function () {
  const tbody = document.getElementById("fullOrdersTableBody");
  if (!tbody) return;

  const filter = document.getElementById("orderStatusFilter")?.value || "all";
  let filteredData = ordersData;

  if (filter !== "all") {
    filteredData = ordersData.filter(o => o.status === filter);
  }

  if (activeSearchQuery !== "") {
    filteredData = filteredData.filter(o =>
      (o.referenceNumber && o.referenceNumber.toLowerCase().includes(activeSearchQuery)) ||
      (o.name && o.name.toLowerCase().includes(activeSearchQuery)) ||
      (o.phone && o.phone.toLowerCase().includes(activeSearchQuery))
    );
  }

  if (filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px; color:var(--text-muted);">لا توجد طلبات مسجلة مطابقة.</td></tr>`;
    return;
  }

  const badgeMap = {
    'progress': '<span class="badge badge-progress">قيد التنفيذ</span>',
    'new': '<span class="badge badge-new">طلب جديد</span>',
    'pending': '<span class="badge badge-new">طلب جديد</span>',
    'review': '<span class="badge badge-review">انتظار المراجعة</span>',
    'finished': '<span class="badge badge-finished">تم الانتهاء</span>',
    'transferred': '<span class="badge badge-transferred">تم التحويل</span>',
    'completed': '<span class="badge badge-completed">مكتمل</span>',
    'archived': '<span class="badge" style="background:rgba(100,116,139,0.2); color:#94a3b8;">مؤرشف</span>'
  };

  tbody.innerHTML = filteredData.map(o => {
    const ref = o.referenceNumber || o.reference || "";
    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')" title="اضغط لنسخ رابط التتبع">${ref || "---"} <i class="fa-solid fa-copy" style="font-size:0.75rem;"></i></b></td>
        <td><span style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${o.reference || '---'}</span></td>
        <td>${o.name}</td>
        <td><span class="badge badge-new">${o.platform}</span></td>
        <td>${formatCoinsNumber(o.totalQty)}</td>
        <td><b style="color:var(--primary);">${o.totalPrice}</b></td>
        <td>${badgeMap[o.status] || `<span class="badge badge-archived">${o.status}</span>`}</td>
        <td>${buildActionButtonsHTML(o)}</td>
      </tr>
    `;
  }).join("");
};

window.renderRecentOrdersTable = function () {
  const tbody = document.getElementById("recentOrdersTableBody");
  if (!tbody) return;

  const recentOrders = [...ordersData]
    .sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0))
    .slice(0, 5);

  if (recentOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد طلبات حديثة.</td></tr>`;
    return;
  }

  const badgeMap = {
    'progress': '<span class="badge badge-progress">قيد التنفيذ</span>',
    'new': '<span class="badge badge-new">طلب جديد</span>',
    'pending': '<span class="badge badge-new">طلب جديد</span>',
    'review': '<span class="badge badge-review">انتظار المراجعة</span>',
    'finished': '<span class="badge badge-finished">تم الانتهاء</span>',
    'transferred': '<span class="badge badge-transferred">تم التحويل</span>',
    'completed': '<span class="badge badge-completed">مكتمل</span>'
  };

  tbody.innerHTML = recentOrders.map(o => {
    const ref = o.referenceNumber || o.reference || "";
    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">${ref || "---"}</b></td>
        <td><span style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${o.reference || '---'}</span></td>
        <td>${o.name}</td>
        <td><span class="badge badge-new">${o.platform}</span></td>
        <td>${formatCoinsNumber(o.totalQty)}</td>
        <td><b style="color:var(--primary);">${o.totalPrice}</b></td>
        <td>${badgeMap[o.status] || `<span class="badge badge-archived">${o.status}</span>`}</td>
        <td>${buildActionButtonsHTML(o)}</td>
      </tr>
    `;
  }).join("");
};

window.renderWithdrawOrdersTable = function () {
  const tbody = document.getElementById("withdrawOrdersTableBody");
  if (!tbody) return;

  let withdrawOrders = ordersData.filter(o => o.status === 'new' || o.status === 'pending' || o.status === 'review');
  const under500k = withdrawOrders.filter(o => (o.totalQty || 0) < 500000);
  const over500k = withdrawOrders.filter(o => (o.totalQty || 0) >= 500000);

  if (document.getElementById("countUnder500k")) document.getElementById("countUnder500k").innerText = under500k.length;
  if (document.getElementById("countOver500k")) document.getElementById("countOver500k").innerText = over500k.length;
  if (document.getElementById("withdrawBadgeCount")) document.getElementById("withdrawBadgeCount").innerText = withdrawOrders.length;
  if (document.getElementById("withdrawHeaderBadge")) document.getElementById("withdrawHeaderBadge").innerText = withdrawOrders.length + " طلبات بانتظار الإجراء";

  const filterVal = document.getElementById("withdrawFilter")?.value || "all";
  if (filterVal === "under") withdrawOrders = under500k;
  else if (filterVal === "over") withdrawOrders = over500k;

  if (withdrawOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد طلبات سحب مطابقة للفلتر المختار.</td></tr>`;
    return;
  }

  tbody.innerHTML = withdrawOrders.map(o => {
    const total = o.totalQty || 0;
    const isUnder = total < 500000;
    const badgeStatus = (o.status === 'review') ? '<span class="badge badge-review">انتظار المراجعة</span>' : '<span class="badge badge-new">طلب جديد</span>';
    const categoryBadge = isUnder 
      ? '<span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.3);">أقل من 500K</span>'
      : '<span class="badge" style="background:rgba(0,255,135,0.12); color:var(--primary); border:1px solid rgba(0,255,135,0.3);">500K فأكثر</span>';
    const ref = o.referenceNumber || o.reference || "";

    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">${ref || '---'}</b></td>
        <td>${o.name}</td>
        <td><span class="badge badge-new">${o.platform}</span></td>
        <td><b>${formatCoinsNumber(total)}</b></td>
        <td>${badgeStatus}</td>
        <td>${categoryBadge}</td>
        <td>${buildActionButtonsHTML(o)}</td>
      </tr>
    `;
  }).join('');
};

window.renderTransferAlertsTable = function () {
  const tbody = document.getElementById("transferAlertsTableBody");
  const banner = document.getElementById("urgentTransferBanner");
  const bannerText = document.getElementById("bannerTransferText");
  const transferOrders = ordersData.filter(o => o.status === 'finished');

  if (document.getElementById("transferBadgeCount")) document.getElementById("transferBadgeCount").innerText = transferOrders.length;
  if (document.getElementById("transferHeaderBadge")) document.getElementById("transferHeaderBadge").innerText = transferOrders.length + " طلبات بحاجة للتحويل";

  if (banner) {
    if (transferOrders.length > 0) {
      banner.style.display = "flex";
      if (bannerText) bannerText.innerText = `لديك (${transferOrders.length}) طلبات مكتملة السحب بانتظار التحويل المالي للعملاء.`;
    } else {
      banner.style.display = "none";
    }
  }

  if (!tbody) return;
  if (transferOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات بحاجة للتحويل حالياً.</td></tr>`;
    return;
  }

  tbody.innerHTML = transferOrders.map(o => {
    const ref = o.referenceNumber || o.reference || "";
    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">${ref || '---'}</b></td>
        <td>${o.name}</td>
        <td><span style="font-family:monospace;">${o.phone || '---'}</span></td>
        <td><b style="color:#f59e0b;">${o.totalPrice}</b></td>
        <td><span class="badge badge-review">${o.paymentMethod || 'تحويل بنكي'} - ${o.bankName || ''}</span></td>
        <td>${calculateTransferCountdown(o.createdAt)}</td>
        <td>
          <button class="btn-custom" style="background:#f59e0b; color:#fff; font-size:0.75rem; padding:6px 12px;" onclick="openOrderModal('${o.id}')">معاينة وإتمام التحويل</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.renderClientsTable = function (searchQuery = "") {
  const tbody = document.getElementById("clientsTableBody");
  if (!tbody) return;

  const clientsMap = {};
  ordersData.forEach(o => {
    const key = o.phone ? o.phone.trim() : (o.name ? o.name.trim() : "عميل غير معروف");
    if (!clientsMap[key]) {
      clientsMap[key] = { phone: o.phone || "بدون رقم", name: o.name || "عميل", orderCount: 0, totalCoins: 0, totalMoney: 0 };
    }
    clientsMap[key].orderCount += 1;
    clientsMap[key].totalCoins += (o.totalQty || 0);
    clientsMap[key].totalMoney += parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 0;
  });

  let clientsList = Object.values(clientsMap);
  if (searchQuery && searchQuery.trim() !== "") {
    const q = searchQuery.toLowerCase().trim();
    clientsList = clientsList.filter(c => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q));
  }

  if (clientsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد نتائج مطابقة للبحث.</td></tr>`;
    return;
  }

  tbody.innerHTML = clientsList.map(c => `
    <tr>
      <td><b>${c.name}</b></td>
      <td><span style="font-family:monospace; color:var(--primary);">${c.phone}</span></td>
      <td><span class="badge badge-new">${c.orderCount} طلبات</span></td>
      <td><b>${formatCoinsNumber(c.totalCoins)} كوينز</b></td>
      <td><b style="color:var(--primary);">${c.totalMoney.toLocaleString()} ريال</b></td>
      <td><button class="btn-action" onclick="openClientModal('${encodeURIComponent(c.phone)}')">سجل الطلبات</button></td>
    </tr>
  `).join('');
};

window.filterClients = function (val) { renderClientsTable(val); };

window.openClientModal = function (encodedPhone) {
  const phone = decodeURIComponent(encodedPhone);
  const modal = document.getElementById("clientDetailModal");
  const modalTitle = document.getElementById("clientModalTitle");
  const modalBody = document.getElementById("clientModalBody");
  if (!modal || !modalBody) return;

  const clientOrders = ordersData.filter(o => o.phone === phone || o.name === phone);
  if (modalTitle) modalTitle.innerText = `سجل طلبات العميل: ${phone}`;

  modalBody.innerHTML = `
    <div style="margin-bottom:15px; background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
      <strong>إجمالي الطلبات:</strong> ${clientOrders.length} | 
      <strong>إجمالي الكوينز:</strong> ${formatCoinsNumber(clientOrders.reduce((acc, cur) => acc + (cur.totalQty || 0), 0))}
    </div>
    <div class="table-responsive">
      <table>
        <thead><tr><th>رقم الطلب</th><th>المنصة</th><th>الكمية</th><th>السعر</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>
          ${clientOrders.map(o => {
            const ref = o.referenceNumber || o.reference || "";
            return `
              <tr>
                <td><b style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">${ref}</b></td>
                <td>${o.platform}</td>
                <td>${formatCoinsNumber(o.totalQty)}</td>
                <td>${o.totalPrice}</td>
                <td><span class="badge badge-new">${o.status}</span></td>
                <td>${o.createdAt ? new Date(o.createdAt).toLocaleDateString("ar-SA") : "---"}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  modal.classList.add("active");
};

window.closeClientModal = function () {
  const modal = document.getElementById("clientDetailModal");
  if (modal) modal.classList.remove("active");
};

// ==========================================================================
// 5) نافذة التفاصيل والوظائف الكاملة (تحديث كوينز، أرشفة، إتلاف، حذف، تعديل)
// ==========================================================================
window.openOrderModal = function (orderId) {
  const modal = document.getElementById("orderDetailModal");
  const modalTitle = document.getElementById("modalOrderIdTitle");
  const modalBody = document.getElementById("modalOrderBody");
  if (!modal || !modalBody) return;

  const order = ordersData.find(o => o.id === orderId || o.reference === orderId || o.referenceNumber === orderId);
  if (!order) { alert("لم يتم العثور على بيانات الطلب المطلوب."); return; }

  const refNum = order.referenceNumber || order.reference || order.id;

  if (modalTitle) modalTitle.innerText = `تفاصيل الطلب رقم: #${refNum}`;

  const statusMap = {
    'progress': '<span class="badge badge-progress">قيد التنفيذ</span>',
    'new': '<span class="badge badge-new">طلب جديد</span>',
    'pending': '<span class="badge badge-new">طلب جديد</span>',
    'review': '<span class="badge badge-review">انتظار المراجعة</span>',
    'finished': '<span class="badge badge-finished">تم الانتهاء (بانتظار التحويل)</span>',
    'transferred': '<span class="badge badge-transferred">تم التحويل</span>',
    'completed': '<span class="badge badge-completed">مكتمل</span>',
    'archived': '<span class="badge" style="background:rgba(100,116,139,0.2); color:#94a3b8;">مؤرشف</span>'
  };

  const showTransferBtn = (order.status === 'finished');

  modalBody.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:20px;">
      <div style="background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="color:var(--text-muted); font-size:0.8rem;">رقم المرجع (اضغط للنسخ)</span>
        <h4 style="color:var(--primary); font-family:monospace; margin-top:4px; cursor:pointer;" onclick="copyTrackingLink('${refNum}')">
          ${refNum} <i class="fa-solid fa-copy"></i>
        </h4>
      </div>
      <div style="background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="color:var(--text-muted); font-size:0.8rem;">اسم العميل:</span>
        <h4 style="color:var(--text-main); margin-top:4px;">${order.name}</h4>
      </div>
      <div style="background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="color:var(--text-muted); font-size:0.8rem;">رقم الجوال:</span>
        <h4 style="color:var(--text-main); font-family:monospace; margin-top:4px;">${order.phone || '---'}</h4>
      </div>
      <div style="background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="color:var(--text-muted); font-size:0.8rem;">المنصة والكمية:</span>
        <h4 style="color:var(--primary); margin-top:4px;">${order.platform} - ${formatCoinsNumber(order.totalQty)} كوينز</h4>
      </div>
      <div style="background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="color:var(--text-muted); font-size:0.8rem;">المبلغ الإجمالي:</span>
        <h4 style="color:#f59e0b; margin-top:4px;">${order.totalPrice}</h4>
      </div>
      <div style="background:var(--input-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="color:var(--text-muted); font-size:0.8rem;">الحالة الحالية:</span>
        <div style="margin-top:4px;">${statusMap[order.status] || order.status}</div>
      </div>
    </div>

    <div style="background:var(--input-bg); padding:16px; border-radius:14px; border:1px solid var(--card-border); margin-bottom:20px;">
      <h4 style="color:var(--primary); margin-bottom:10px;"><i class="fa-solid fa-credit-card"></i> بيانات الدفع والتحويل</h4>
      <p style="margin-bottom:6px;"><b>وسيلة الدفع:</b> ${order.paymentMethod || '---'}</p>
      <p style="margin-bottom:6px;"><b>اسم البنك:</b> ${order.bankName || '---'}</p>
      <p style="margin-bottom:6px;"><b>رقم الآيبان (IBAN):</b> <span style="font-family:monospace; color:var(--primary);">${order.accountIban || '---'}</span></p>
      <p style="margin-bottom:6px;"><b>الكوينز المسحوبة حتى الآن:</b> ${formatCoinsNumber(order.drawnCoins || 0)} / ${formatCoinsNumber(order.totalQty)}</p>
      <p style="margin-top:6px;"><b>المهلة المتبقية للتحويل:</b> ${calculateTransferCountdown(order.createdAt)}</p>
    </div>

    <div style="background:var(--input-bg); padding:16px; border-radius:14px; border:1px solid var(--card-border); margin-bottom:20px;">
      <h4 style="color:#38bdf8; margin-bottom:10px;"><i class="fa-solid fa-key"></i> بيانات الحساب الحساسة</h4>
      <p style="margin-bottom:6px;"><b>الإيميل:</b> <code style="color:var(--primary);">${order.accountEmail || 'محذوف / مشفر'}</code></p>
      <p style="margin-bottom:6px;"><b>كلمة المرور:</b> <code>${order.accountPassword || 'محذوفة / مشفرة'}</code></p>
      <p style="margin-bottom:6px;"><b>الأكواد الاحتياطية:</b> <code>${order.backupCodes || 'محذوفة'}</code></p>
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
      ${showTransferBtn ? `
        <button class="btn-custom" style="background:#f59e0b; color:#fff; box-shadow:0 4px 15px rgba(245,158,11,0.4);" onclick="handleMarkTransferred('${order.id}', '${refNum}')">
          <i class="fa-solid fa-money-bill-transfer"></i> تم التحويل المالي
        </button>
      ` : ''}
      <button class="btn-custom" style="background:var(--primary); color:#000;" onclick="updateDrawnCoinsPrompt('${order.id}', '${refNum}', ${order.drawnCoins || 0}, ${order.totalQty})">
        <i class="fa-solid fa-pen"></i> تحديث الكوينز المسحوبة
      </button>
      <button class="btn-custom" style="background:#ef4444; color:#fff;" onclick="openPurgeModal('${order.id}')">
        <i class="fa-solid fa-skull-crossbones"></i> إتلاف البيانات الحساسة
      </button>
      <button class="btn-custom" style="background:var(--input-bg); color:var(--text-main); border:1px solid var(--card-border);" onclick="closeOrderModal()">إغلاق</button>
    </div>
  `;
  modal.classList.add("active");
};

window.closeOrderModal = function () {
  const modal = document.getElementById("orderDetailModal");
  if (modal) modal.classList.remove("active");
};

window.openPurgeModal = function (orderId) {
  const inputEl = document.getElementById("purgeTargetOrderId");
  const modal = document.getElementById("purgeConfirmModal");
  if (inputEl) inputEl.value = orderId;
  if (modal) modal.classList.add("active");
};

window.closePurgeModal = function () {
  const modal = document.getElementById("purgeConfirmModal");
  if (modal) modal.classList.remove("active");
};

window.confirmPurgeDataFinal = async function () {
  const orderId = document.getElementById("purgeTargetOrderId")?.value;
  if (!orderId) return;

  try {
    const res = await fetch("/api/orders/purge-sensitive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (data.success) {
      await logAuditEvent("إتلاف بيانات حساسة", orderId, "تم إتلاف كلمة المرور والأكواد الاحتياطية نهائياً");
      alert("✅ تم إتلاف البيانات الحساسة بنجاح!");
      closePurgeModal();
      closeOrderModal();
      loadOrders();
    } else {
      alert("❌ فشل الإتلاف: " + (data.message || "حدث خطأ بالخادم"));
    }
  } catch (err) {
    alert("❌ خطأ بالاتصال بالخادم: " + err.message);
  }
};

window.promptEditOrder = async function (orderId) {
  const order = ordersData.find(o => o.id === orderId);
  if (!order) return;

  const newStatus = prompt("أدخل الحالة الجديدة للطلب (new, progress, review, finished, transferred, completed, archived):", order.status);
  if (!newStatus) return;

  try {
    const res = await fetch("/api/orders/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, status: newStatus.trim() })
    });
    const data = await res.json();
    if (data.success) {
      await logAuditEvent("تعديل حالة الطلب", order.referenceNumber, `تعديل الحالة إلى: ${newStatus}`);
      alert("✅ تم تعديل الطلب بنجاح!");
      loadOrders();
    } else {
      alert("❌ فشل التعديل: " + data.message);
    }
  } catch (err) {
    alert("❌ خطأ: " + err.message);
  }
};

window.handleArchiveOrder = async function (orderId, refNum) {
  if (!confirm(`هل تؤكد أرشفة الطلب #${refNum}؟`)) return;
  try {
    const res = await fetch("/api/orders/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status: "archived" })
    });
    const data = await res.json();
    if (data.success) {
      await logAuditEvent("أرشفة طلب", refNum, "تم تغيير الحالة إلى مؤرشف");
      alert("✅ تم أرشفة الطلب بنجاح!");
      loadOrders();
    }
  } catch (err) {
    alert("❌ خطأ بالأرشفة: " + err.message);
  }
};

window.handleDeleteOrder = async function (orderId, refNum) {
  if (!confirm(`⚠️ تحذير: هل أنت متأكد من حذف الطلب #${refNum} نهائياً؟`)) return;
  try {
    const res = await fetch("/api/orders/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (data.success) {
      await logAuditEvent("حذف طلب", refNum, "تم حذف الطلب نهائياً من قاعدة البيانات");
      alert("✅ تم حذف الطلب بنجاح!");
      loadOrders();
    } else {
      alert("❌ فشل الحذف: " + data.message);
    }
  } catch (err) {
    alert("❌ خطأ في الحذف: " + err.message);
  }
};

window.handleMarkTransferred = async function (orderId, refNum) {
  if (!confirm(`هل تؤكد إتمام التحويل المالي للطلب #${refNum} وتغيير حالته إلى (تم التحويل)؟`)) return;

  try {
    const res = await fetch("/api/orders/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status: "transferred" })
    });

    const data = await res.json();
    if (data.success) {
      await logAuditEvent("تحويل مالي", refNum, "تم تغيير حالة الطلب إلى تم التحويل المالي بنجاح");
      alert("✅ تم تحديث حالة الطلب إلى (تم التحويل المالي) بنجاح!");
      closeOrderModal();
      loadOrders();
    } else {
      alert("❌ فشل تغيير الحالة: " + (data.message || "خطأ غير معروف في الخادم"));
    }
  } catch (err) {
    alert("❌ خطأ أثناء تغيير الحالة: " + err.message);
  }
};

// تحديث الكوينز عن طريق Backend والخصم المباشر
window.updateDrawnCoinsPrompt = async function (orderId, refNum, currentDrawn, totalQty) {
  const newDrawnStr = prompt(`تحديث الكوينز المسحوبة للطلب #${refNum}:\nالكمية المطلوبة الكلية: ${formatCoinsNumber(totalQty)}`, currentDrawn);
  
  if (newDrawnStr !== null && !isNaN(newDrawnStr)) {
    const newDrawn = Number(newDrawnStr);
    try {
      const res = await fetch("/api/orders/update-drawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderId,
          drawnCoins: newDrawn
        })
      });

      const data = await res.json();

      if (data.success) {
        await logAuditEvent("تحديث سحب الكوينز", refNum, `تم تحديث المسحوب إلى: ${formatCoinsNumber(newDrawn)} / ${formatCoinsNumber(totalQty)} (تم الخصم تلقائياً من المخزون)`);

        if (newDrawn >= totalQty) {
          await fetch("/api/orders/update-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: orderId, status: "finished" })
          });
          await logAuditEvent("اكتمال السحب تلقائياً", refNum, "انتقال الطلب إلى حالة (بانتظار التحويل) لاكتمال الكمية");
          alert("🎉 اكتمل سحب الكوينز للطلب بالكامل! تم خصم الكمية من المخزون ونقله تلقائياً إلى (بانتظار التحويل المالي).");
        } else {
          alert("✅ تم تحديث الكمية المسحوبة وخصم المخزون تلقائياً!");
        }

        closeOrderModal();
        loadOrders();
      } else {
        alert("❌ فشل التحديث: " + (data.message || "خطأ غير معروف في الخادم"));
      }
    } catch (err) {
      alert("❌ خطأ في التحديث: " + err.message);
    }
  }
};

// ==========================================================================
// 6) لوحة المخزون العرضية وإعدادات النظام
// ==========================================================================
function renderInventoryUI(settings) {
  if (document.getElementById("invStockPS")) document.getElementById("invStockPS").innerText = formatCoinsNumber(settings.psStock || 0);
  if (document.getElementById("invStockPC")) document.getElementById("invStockPC").innerText = formatCoinsNumber(settings.pcStock || 0);
  if (document.getElementById("invLastUpdate")) document.getElementById("invLastUpdate").innerText = settings.lastStockUpdate || "تحديث تلقائي لحظي";
}

function initSystemSettingsListener() {
  return subscribeToSettings((settings) => {
    currentSettingsData = settings;
    updateStoreStatusUI(settings.storeOpen !== false);
    populatePricingUI(settings);
    renderInventoryUI(settings);
    renderDashboardQuickStats();
    renderBanks(settings.banks || []);
    renderWallets(settings.wallets || []);
    renderCustomPayments(settings.paymentMethods || []);
    renderTerms(settings.terms || []);
  });
}

function updateStoreStatusUI(isOpen) {
  const btn = document.getElementById("storeStatusToggleBtn");
  const txt = document.getElementById("storeStatusText");
  if (!btn || !txt) return;
  btn.className = isOpen ? "store-status-btn" : "store-status-btn closed";
  txt.innerText = isOpen ? "المتجر مفتوح" : "المتجر مغلق";
}

window.toggleStoreStatus = async function () {
  const newStatus = await toggleStore();
  await logAuditEvent("تغيير حالة المتجر", "المتجر", `الحالة الجديدة: ${newStatus ? 'مفتوح' : 'مغلق'}`);
};

function populatePricingUI(config = {}) {
  if (document.getElementById("psRate")) document.getElementById("psRate").value = config.psRate || 200;
  if (document.getElementById("psMin")) document.getElementById("psMin").value = formatCoinsNumber(config.psMin || 100000);
  if (document.getElementById("psMax")) document.getElementById("psMax").value = formatCoinsNumber(config.psMax || 5000000);
  if (document.getElementById("psWithdrawDuration")) document.getElementById("psWithdrawDuration").value = config.psWithdrawDuration || "3 - 5 أيام عمل";
  if (document.getElementById("psTransferDuration")) document.getElementById("psTransferDuration").value = config.psTransferDuration || "24 ساعة";

  if (document.getElementById("pcRate")) document.getElementById("pcRate").value = config.pcRate || 150;
  if (document.getElementById("pcMin")) document.getElementById("pcMin").value = formatCoinsNumber(config.pcMin || 100000);
  if (document.getElementById("pcMax")) document.getElementById("pcMax").value = formatCoinsNumber(config.pcMax || 1000000);
  if (document.getElementById("pcWithdrawDuration")) document.getElementById("pcWithdrawDuration").value = config.pcWithdrawDuration || "2 - 4 أيام عمل";
  if (document.getElementById("pcTransferDuration")) document.getElementById("pcTransferDuration").value = config.pcTransferDuration || "24 ساعة";

  if (document.getElementById("storeNameInput")) document.getElementById("storeNameInput").value = config.storeName || "SAMICOINS";
  if (document.getElementById("supportWhatsappInput")) document.getElementById("supportWhatsappInput").value = config.supportWhatsapp || "";
  if (document.getElementById("promoActiveSelect")) document.getElementById("promoActiveSelect").value = config.offers ? "true" : "false";
  if (document.getElementById("promoText")) document.getElementById("promoText").value = config.offerText || "";
}

window.saveProductsConfig = async function () {
  const pricingData = {
    storeName: document.getElementById("storeNameInput")?.value,
    supportWhatsapp: document.getElementById("supportWhatsappInput")?.value,
    psRate: Number(document.getElementById("psRate")?.value),
    psMin: Number(String(document.getElementById("psMin")?.value || "").replace(/,/g, "")),
    psMax: Number(String(document.getElementById("psMax")?.value || "").replace(/,/g, "")),
    psWithdrawDuration: document.getElementById("psWithdrawDuration")?.value,
    psTransferDuration: document.getElementById("psTransferDuration")?.value,
    pcRate: Number(document.getElementById("pcRate")?.value),
    pcMin: Number(String(document.getElementById("pcMin")?.value || "").replace(/,/g, "")),
    pcMax: Number(String(document.getElementById("pcMax")?.value || "").replace(/,/g, "")),
    pcWithdrawDuration: document.getElementById("pcWithdrawDuration")?.value,
    pcTransferDuration: document.getElementById("pcTransferDuration")?.value,
    offers: document.getElementById("promoActiveSelect")?.value === "true",
    offerText: document.getElementById("promoText")?.value || ""
  };

  await savePricing(pricingData);
  await logAuditEvent("حفظ إعدادات الأسعار", "الإعدادات", "تحديث الأسعار وإعدادات المنصات بنجاح");
  alert("✅ تم حفظ إعدادات الأسعار والمنصات بنجاح!");
};

function renderBanks(banksArray = []) {
  const c = document.getElementById("banksListContainer");
  if (!c) return;
  c.innerHTML = banksArray.map((b, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span style="font-size:0.88rem; font-weight:800;">${i + 1}. ${b}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteBank(${i})"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
}

window.addBank = async function () {
  const input = document.getElementById("newBankInput");
  if (input && input.value.trim()) { await systemAddBank(input.value.trim()); input.value = ""; }
};
window.deleteBank = async function (i) { await systemDeleteBank(i); };

function renderWallets(walletsArray = []) {
  const c = document.getElementById("walletsListContainer");
  if (!c) return;
  c.innerHTML = walletsArray.map((w, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span style="font-size:0.88rem; font-weight:800;">${i + 1}. ${w}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteWallet(${i})"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
}

window.addWallet = async function () {
  const input = document.getElementById("newWalletInput");
  if (input && input.value.trim()) { await systemAddWallet(input.value.trim()); input.value = ""; }
};
window.deleteWallet = async function (i) { await systemDeleteWallet(i); };

function renderCustomPayments(methodsArray = []) {
  const c = document.getElementById("customPayMethodsContainer");
  if (!c) return;
  c.innerHTML = methodsArray.map((p, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span style="font-size:0.88rem; font-weight:800;">${i + 1}. ${p}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteCustomPayment(${i})"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
}

window.addCustomPaymentMethod = async function () {
  const input = document.getElementById("newCustomPaymentInput");
  if (input && input.value.trim()) { await systemAddPaymentMethod(input.value.trim()); input.value = ""; }
};
window.deleteCustomPayment = async function (i) { await systemDeletePaymentMethod(i); };

function renderTerms(termsArray = []) {
  const c = document.getElementById("termsListContainer");
  if (!c) return;
  c.innerHTML = termsArray.map((t, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1px solid var(--card-border); padding:10px; border-radius:10px;">
      <span style="font-size:0.85rem;">${i + 1}. ${t}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteTerm(${i})"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
}

window.addNewTerm = async function () {
  const input = document.getElementById("newTermInput");
  if (input && input.value.trim()) { await systemAddTerm(input.value.trim()); input.value = ""; }
};
window.deleteTerm = async function (i) { await systemDeleteTerm(i); };

// التنقل بين الأقسام
window.switchTab = function (tabId, element) {
  document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
  document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add("active");
  if (element) element.classList.add("active");

  const pageHeading = document.getElementById("pageTitleHeading");
  const breadcrumbActive = document.getElementById("breadcrumbActive");
  if (element && pageHeading && breadcrumbActive) {
    const titleText = element.innerText.trim();
    pageHeading.innerText = titleText;
    breadcrumbActive.innerText = titleText;
  }
};

window.toggleSidebar = function () {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.toggle("mobile-open");
};

window.toggleTheme = function () {
  document.body.classList.toggle("light-mode");
  const themeIcon = document.querySelector("#themeToggleBtn i");
  if (themeIcon) {
    if (document.body.classList.contains("light-mode")) {
      themeIcon.className = "fa-regular fa-sun";
    } else {
      themeIcon.className = "fa-regular fa-moon";
    }
  }
};

initAuthGuard();
