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

// ==========================================================================
// 0) القوائم والمتغيرات العامة للنظام
// ==========================================================================
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
let reviewsData = [];
let adminsData = [];
let auditLogsData = [];
let currentSettingsData = {};
let activeSearchQuery = "";
let activeReviewSearchQuery = "";
let currentOrderTabFilter = "all";

// متغيرات مؤقت فك التشفير الحساس
let decryptTimer = null;
let decryptSeconds = 90;

// مستمعات الأحداث اللحظية (Unsubscribe Handlers)
let unsubscribeOrders = null;
let unsubscribeReviews = null;
let unsubscribeSettings = null;
let unsubscribeAdmins = null;
let unsubscribeAudit = null;

let lastOrdersCount = null;
let lastReviewsCount = null;

// ==========================================================================
// 1) حارس الأمان وتسجيل الدخول/الخروج
// ==========================================================================
function startAllListeners() {
  if (!unsubscribeOrders) unsubscribeOrders = initOrdersListener();
  if (!unsubscribeReviews) unsubscribeReviews = initReviewsListener();
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
// 2) السجل والساعة التفاعلية والإشعارات
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

function showSystemNotification(title, text, actionCallback = null) {
  const banner = document.getElementById("systemNotificationBanner");
  const titleEl = document.getElementById("notificationBannerTitle");
  const textEl = document.getElementById("notificationBannerText");
  const actionBtn = document.getElementById("notificationBannerAction");

  if (!banner) return;

  if (titleEl) titleEl.innerText = title;
  if (textEl) textEl.innerText = text;
  if (actionBtn && actionCallback) {
    actionBtn.onclick = () => {
      actionCallback();
      banner.style.display = "none";
    };
  }

  banner.style.display = "flex";
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

window.copyTrackingLink = async function(refCode) {
  if (!refCode || refCode === "---" || refCode === "عام") return;
  const url = `https://status.sa4coins.com/?ref=${refCode}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt("نسخ رابط التتبع المباشر:", url);
  }
};

window.copyToClipboardSilent = async function(textVal) {
  if (!textVal || textVal === "••••••••" || textVal === "---" || textVal === "••••") return;
  try {
    await navigator.clipboard.writeText(textVal);
  } catch (e) {}
};

function formatCoinsNumber(num) {
  if (num === "" || num === null || isNaN(num)) return "0";
  return Number(num).toLocaleString('en-US');
}

function formatOrderPrice(priceVal) {
  if (priceVal === undefined || priceVal === null || priceVal === "") return "0 ر.س";
  let cleanStr = String(priceVal).trim();
  if (!cleanStr.includes("ر.س") && !cleanStr.includes("SAR") && !cleanStr.includes("ريال")) {
    cleanStr = cleanStr + " ر.س";
  }
  return cleanStr;
}

function calculateTransferCountdown(createdAt) {
  if (!createdAt) return '<span style="color:var(--text-muted);">---</span>';
  const createdDate = new Date(createdAt);
  if (isNaN(createdDate.getTime())) return '<span style="color:var(--text-muted);">---</span>';

  const maxHours = 120;
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

function getPlatformBadgeHTML(platformStr) {
  const p = (platformStr || "").toLowerCase();
  if (p.includes("ps") || p.includes("playstation") || p.includes("بلايستيشن")) {
    return `<span class="platform-badge ps"><i class="fa-brands fa-playstation"></i> PlayStation</span>`;
  } else if (p.includes("xbox") || p.includes("إكس بوكس") || p.includes("اكس بوكس")) {
    return `<span class="platform-badge xbox"><i class="fa-brands fa-xbox"></i> Xbox</span>`;
  } else if (p.includes("pc") || p.includes("بي سي") || p.includes("حاسب")) {
    return `<span class="platform-badge pc"><i class="fa-solid fa-desktop"></i> PC</span>`;
  }
  return `<span class="badge badge-new">${platformStr || '---'}</span>`;
}

// ==========================================================================
// 3) قراءة الطلبات الموحدة عبر السيرفر والتحويل المباشر للحقول
// ==========================================================================
function initOrdersListener() {
  loadOrders();
  return () => {};
}

async function loadOrders() {
  try {
    const res = await fetch("/api/orders/list");
    const data = await res.json();

    if (!data.success) return;

    ordersData = (data.orders || []).map(order => ({
      id: order.id,
      orderNumber: order.orderNumber || order.id || "",
      referenceNumber: order.referenceNumber || order.reference || "",
      name: order.customerName || order.name || "",
      phone: order.phone || "",
      platform: order.platform || "",
      totalQty: Number(order.quantity ?? order.totalQty ?? 0),
      totalPrice: formatOrderPrice(order.totalPrice || order.price || order.amount),
      status: order.status || order.orderStatus || "new",
      paymentMethod: order.paymentMethod || "",
      bankName: order.paymentInfoData?.bankName || order.bankName || "",
      accountIban: order.paymentInfoData?.iban || order.accountIban || "",
      drawnCoins: Number(order.drawnCoins || 0),
      createdAt: order.createdAt?.seconds
        ? new Date(order.createdAt.seconds * 1000)
        : order.createdAt
          ? new Date(order.createdAt)
          : null
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
    console.error("Load Orders Error:", err);
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
  const countFinished = ordersData.filter(o => o.status === 'completed' || o.status === 'finished' || o.status === 'transferred').length;
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
// 4) رسم الجداول والعمليات الكاملة
// ==========================================================================
function buildActionButtonsHTML(order) {
  const refNum = order.referenceNumber || order.id;
  return `
    <div style="display:flex; gap:4px; flex-wrap:wrap;">
      <button class="btn-action" title="معاينة والتفاصيل" onclick="openOrderModal('${order.id}')"><i class="fa-solid fa-eye"></i></button>
      <button class="btn-action" style="color:var(--warning); border-color:var(--warning);" title="تعديل سريع" onclick="promptEditOrder('${order.id}')"><i class="fa-solid fa-pen"></i></button>
      <button class="btn-action" style="color:var(--purple); border-color:var(--purple);" title="أرشفة" onclick="handleArchiveOrder('${order.id}', '${refNum}')"><i class="fa-solid fa-box-archive"></i></button>
      <button class="btn-action" style="color:var(--danger); border-color:var(--danger);" title="حذف الطلب" onclick="handleDeleteOrder('${order.id}', '${refNum}')"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
}

window.filterOrdersByTab = function(statusKey, btnEl) {
  currentOrderTabFilter = statusKey;
  if (btnEl) {
    document.querySelectorAll(".status-pill").forEach(p => p.classList.remove("active"));
    btnEl.classList.add("active");
  }
  const mobileSel = document.getElementById("orderStatusFilterMobile");
  if (mobileSel && mobileSel.value !== statusKey) mobileSel.value = statusKey;
  renderOrdersTables();
};

window.renderOrdersTables = function () {
  const tbody = document.getElementById("fullOrdersTableBody");
  const mobileContainer = document.getElementById("mobileOrdersCardsContainer");
  if (!tbody || !mobileContainer) return;

  let filteredData = ordersData;

  if (currentOrderTabFilter !== "all") {
    filteredData = ordersData.filter(o => o.status === currentOrderTabFilter);
  }

  if (activeSearchQuery !== "") {
    filteredData = filteredData.filter(o =>
      (o.orderNumber && String(o.orderNumber).toLowerCase().includes(activeSearchQuery)) ||
      (o.referenceNumber && o.referenceNumber.toLowerCase().includes(activeSearchQuery)) ||
      (o.name && o.name.toLowerCase().includes(activeSearchQuery)) ||
      (o.phone && o.phone.toLowerCase().includes(activeSearchQuery))
    );
  }

  if (filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px; color:var(--text-muted);">لا توجد طلبات مسجلة مطابقة.</td></tr>`;
    mobileContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد طلبات مسجلة مطابقة.</div>`;
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

  // 1. جدول الديسكتوب
  tbody.innerHTML = filteredData.map(o => {
    const orderNum = o.orderNumber || o.id;
    const ref = o.referenceNumber || "";
    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td><span style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${ref || '---'}</span></td>
        <td>${o.name || '---'}</td>
        <td>${getPlatformBadgeHTML(o.platform)}</td>
        <td style="font-family:monospace;">${formatCoinsNumber(o.totalQty)}</td>
        <td><b style="color:var(--primary); font-family:monospace;">${o.totalPrice}</b></td>
        <td>${badgeMap[o.status] || `<span class="badge">${o.status}</span>`}</td>
        <td>${buildActionButtonsHTML(o)}</td>
      </tr>
    `;
  }).join("");

  // 2. بطاقات الموبايل السريعة المدمجة (Mobile Card-View)
  mobileContainer.innerHTML = filteredData.map(o => {
    const orderNum = o.orderNumber || o.id;
    const ref = o.referenceNumber || "";
    return `
      <div class="mobile-order-card-item">
        <div class="mobile-order-header">
          <b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b>
          ${badgeMap[o.status] || `<span class="badge">${o.status}</span>`}
        </div>
        <div class="mobile-order-body">
          <div><b>العميل:</b> ${o.name || '---'}</div>
          <div><b>الجوال:</b> <span style="font-family:monospace;">${o.phone || '---'}</span></div>
          <div><b>الكمية:</b> <span style="font-family:monospace;">${formatCoinsNumber(o.totalQty)}</span></div>
          <div><b>السعر:</b> <b style="color:var(--primary); font-family:monospace;">${o.totalPrice}</b></div>
        </div>
        <div style="margin-bottom:8px;">${getPlatformBadgeHTML(o.platform)}</div>
        <div class="mobile-order-footer">
          <span style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${ref}</span>
          ${buildActionButtonsHTML(o)}
        </div>
      </div>
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
    const orderNum = o.orderNumber || o.id;
    const ref = o.referenceNumber || "";
    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td><span style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${ref || '---'}</span></td>
        <td>${o.name || '---'}</td>
        <td>${getPlatformBadgeHTML(o.platform)}</td>
        <td style="font-family:monospace;">${formatCoinsNumber(o.totalQty)}</td>
        <td><b style="color:var(--primary); font-family:monospace;">${o.totalPrice}</b></td>
        <td>${badgeMap[o.status] || `<span class="badge">${o.status}</span>`}</td>
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
    const ref = o.referenceNumber || "";
    const orderNum = o.orderNumber || o.id;

    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td>${o.name || '---'}</td>
        <td>${getPlatformBadgeHTML(o.platform)}</td>
        <td style="font-family:monospace;"><b>${formatCoinsNumber(total)}</b></td>
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
    const ref = o.referenceNumber || "";
    const orderNum = o.orderNumber || o.id;
    return `
      <tr>
        <td><b style="color:var(--primary); font-family:monospace; cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td>${o.name || '---'}</td>
        <td><span style="font-family:monospace;">${o.phone || '---'}</span></td>
        <td><b style="color:#f59e0b; font-family:monospace;">${o.totalPrice}</b></td>
        <td><span class="badge badge-review">${o.paymentMethod || 'تحويل بنكي'} - ${o.bankName || ''}</span></td>
        <td>${calculateTransferCountdown(o.createdAt)}</td>
        <td>
          <button class="btn-custom" style="background:#f59e0b; color:#fff; font-size:0.75rem; padding:6px 12px;" onclick="openOrderModal('${o.id}')">معاينة وإتمام التحويل</button>
        </td>
      </tr>
    `;
  }).join('');
};

// ==========================================================================
// 5) نظام التقييمات اللحظي والشامل (Reviews System)
// ==========================================================================
function initReviewsListener() {
  const q = query(collection(db, "reviews"));
  return onSnapshot(q, (snapshot) => {
    reviewsData = snapshot.docs.map(docSnap => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        customerName: d.customerName || d.name || "عميل",
        referenceNumber: d.referenceNumber || d.orderId || "---",
        rating: Number(d.rating || 5),
        comment: d.comment || d.text || "بدون تعليق",
        createdAt: d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toLocaleDateString("ar-SA") : d.createdAt) : "---",
        status: d.status || "published",
        ...d
      };
    });

    if (lastReviewsCount !== null && reviewsData.length > lastReviewsCount) {
      showSystemNotification(
        "⭐ تقييم جديد من عميل!",
        "تم استقبال تقييم جديد للخدمة، اضغط لاستعراضه.",
        () => switchTab("reviewsTab", document.querySelector('.sidebar-menu li:nth-child(5) a'))
      );
    }
    lastReviewsCount = reviewsData.length;

    renderReviewsTable();
  }, (err) => {
    console.error("Reviews Snapshot Error:", err);
  });
}

function renderReviewsTable() {
  const tbody = document.getElementById("reviewsTableBody");
  const emptyState = document.getElementById("reviewsEmptyState");
  if (!tbody) return;

  const totalReviews = reviewsData.length;
  const fiveStarsCount = reviewsData.filter(r => r.rating === 5).length;
  const pendingCount = reviewsData.filter(r => r.status === "pending").length;
  const avgRating = totalReviews > 0 
    ? (reviewsData.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1)
    : "0.0";

  if (document.getElementById("statTotalReviews")) document.getElementById("statTotalReviews").innerText = totalReviews;
  if (document.getElementById("statAverageRating")) document.getElementById("statAverageRating").innerText = `${avgRating} ⭐`;
  if (document.getElementById("statFiveStarReviews")) document.getElementById("statFiveStarReviews").innerText = fiveStarsCount;
  if (document.getElementById("statPendingReviews")) document.getElementById("statPendingReviews").innerText = pendingCount;
  if (document.getElementById("reviewsBadgeCount")) document.getElementById("reviewsBadgeCount").innerText = `${totalReviews} تقييمات`;

  const sidebarBadge = document.getElementById("sidebarReviewsBadge");
  if (sidebarBadge) {
    sidebarBadge.innerText = pendingCount;
    sidebarBadge.style.display = pendingCount > 0 ? "inline-block" : "none";
  }

  const filterVal = document.getElementById("reviewStatusFilter")?.value || "all";
  let filtered = reviewsData;

  if (filterVal !== "all") {
    filtered = filtered.filter(r => r.status === filterVal);
  }

  if (activeReviewSearchQuery !== "") {
    filtered = filtered.filter(r =>
      r.customerName.toLowerCase().includes(activeReviewSearchQuery) ||
      r.referenceNumber.toLowerCase().includes(activeReviewSearchQuery)
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  const statusBadgeMap = {
    'published': '<span class="badge badge-completed">منشور</span>',
    'pending': '<span class="badge badge-review">بانتظار المراجعة</span>',
    'hidden': '<span class="badge badge-archived">مخفي</span>'
  };

  tbody.innerHTML = filtered.map(r => {
    const starsHTML = "⭐".repeat(r.rating);
    return `
      <tr>
        <td><b>${r.customerName}</b></td>
        <td><code class="copyable-box" onclick="copyTrackingLink('${r.referenceNumber}')">${r.referenceNumber}</code></td>
        <td><span style="color:#f59e0b;">${starsHTML} (${r.rating})</span></td>
        <td><span style="font-size:0.85rem; max-width:250px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.comment}</span></td>
        <td><span style="font-size:0.8rem; color:var(--text-muted);">${r.createdAt}</span></td>
        <td>${statusBadgeMap[r.status] || r.status}</td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="btn-action" title="معاينة التقييم" onclick="openReviewModal('${r.id}')"><i class="fa-solid fa-eye"></i></button>
            ${r.status !== 'published' ? `<button class="btn-action" style="color:var(--primary);" title="نشر التقييم" onclick="updateReviewStatus('${r.id}', 'published')"><i class="fa-solid fa-check"></i></button>` : ''}
            ${r.status !== 'hidden' ? `<button class="btn-action" style="color:var(--warning);" title="إخفاء التقييم" onclick="updateReviewStatus('${r.id}', 'hidden')"><i class="fa-solid fa-eye-slash"></i></button>` : ''}
            <button class="btn-action" style="color:var(--danger);" title="حذف التقييم" onclick="deleteReview('${r.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.addEventListener("DOMContentLoaded", () => {
  const reviewSearch = document.getElementById("reviewSearchInput");
  const reviewFilter = document.getElementById("reviewStatusFilter");
  if (reviewSearch) {
    reviewSearch.addEventListener("input", (e) => {
      activeReviewSearchQuery = e.target.value.trim().toLowerCase();
      renderReviewsTable();
    });
  }
  if (reviewFilter) {
    reviewFilter.addEventListener("change", () => renderReviewsTable());
  }
});

window.openReviewModal = function(reviewId) {
  const modal = document.getElementById("reviewModal");
  const modalTitle = document.getElementById("reviewModalTitle");
  const modalBody = document.getElementById("reviewModalBody");
  if (!modal || !modalBody) return;

  const review = reviewsData.find(r => r.id === reviewId);
  if (!review) return;

  if (modalTitle) modalTitle.innerText = `تفاصيل تقييم العميل: ${review.customerName}`;

  modalBody.innerHTML = `
    <div style="background:var(--input-bg); padding:16px; border-radius:12px; border:1px solid var(--card-border); margin-bottom:15px;">
      <p style="margin-bottom:8px;"><b>العميل:</b> ${review.customerName}</p>
      <p style="margin-bottom:8px;"><b>رقم المرجع:</b> <code style="color:var(--primary);">${review.referenceNumber}</code></p>
      <p style="margin-bottom:8px;"><b>التقييم:</b> <span style="color:#f59e0b;">${"⭐".repeat(review.rating)} (${review.rating} من 5)</span></p>
      <p style="margin-bottom:8px;"><b>التاريخ:</b> ${review.createdAt}</p>
      <p style="margin-bottom:8px;"><b>الحالة:</b> ${review.status}</p>
    </div>
    <div style="background:var(--input-bg); padding:16px; border-radius:12px; border:1px solid var(--card-border); margin-bottom:20px;">
      <h4 style="color:var(--primary); margin-bottom:8px;"><i class="fa-solid fa-comment-dots"></i> نص التقييم:</h4>
      <p style="font-size:0.95rem; line-height:1.8; color:var(--text-main);">${review.comment}</p>
    </div>
    <div style="display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn-custom" style="background:var(--primary); color:#000;" onclick="updateReviewStatus('${review.id}', 'published'); closeReviewModal();">نشر التقييم</button>
      <button class="btn-custom" style="background:#f59e0b; color:#fff;" onclick="updateReviewStatus('${review.id}', 'hidden'); closeReviewModal();">إخفاء</button>
      <button class="btn-custom" style="background:#ef4444; color:#fff;" onclick="deleteReview('${review.id}'); closeReviewModal();">حذف</button>
      <button class="btn-custom" style="background:var(--input-bg); color:var(--text-main); border:1px solid var(--card-border);" onclick="closeReviewModal()">إغلاق</button>
    </div>
  `;

  modal.classList.add("active");
};

window.closeReviewModal = function() {
  const modal = document.getElementById("reviewModal");
  if (modal) modal.classList.remove("active");
};

window.updateReviewStatus = async function(reviewId, newStatus) {
  try {
    await updateDoc(doc(db, "reviews", reviewId), { status: newStatus });
    await logAuditEvent("تحديث حالة التقييم", reviewId, `تغيير الحالة إلى: ${newStatus}`);
  } catch (err) {
    alert("❌ فشل تحديث حالة التقييم: " + err.message);
  }
};

window.deleteReview = async function(reviewId) {
  if (!confirm("هل أنت متأكد من حذف هذا التقييم نهائياً؟")) return;
  try {
    await deleteDoc(doc(db, "reviews", reviewId));
    await logAuditEvent("حذف تقييم", reviewId, "تم حذف التقييم من النظام");
  } catch (err) {
    alert("❌ فشل حذف التقييم: " + err.message);
  }
};

// ==========================================================================
// 6) ملف العملاء وسجل الطلبات
// ==========================================================================
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
            const ref = o.referenceNumber || "";
            const orderNum = o.orderNumber || o.id;
            return `
              <tr>
                <td><b style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
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
// 7) دالتي فك التشفير والعداد التنازلي (90 ثانية)
// ==========================================================================
async function decryptOrder(orderId) {
  try {
    const res = await fetch("/api/admin/decrypt-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ orderId })
    });

    const data = await res.json();

    if (!data.success) {
      alert("فشل فك التشفير");
      return;
    }

    const emailEl = document.getElementById("secureEmail");
    const eaPassEl = document.getElementById("secureEaPass");
    const code1El = document.getElementById("secureCode1");
    const code2El = document.getElementById("secureCode2");
    const code3El = document.getElementById("secureCode3");

    const fullEmail = data.data.eaEmail || data.data.customerEmail || "-";
    const fullPass = data.data.eaPassword || "-";
    const rawCodes = (data.data.backupCodes || "").split(/[\s,]+/).filter(Boolean);

    if (emailEl) {
      emailEl.textContent = fullEmail;
      emailEl.onclick = () => copyToClipboardSilent(fullEmail);
    }
    if (eaPassEl) {
      eaPassEl.textContent = fullPass;
      eaPassEl.onclick = () => copyToClipboardSilent(fullPass);
    }

    if (code1El) {
      code1El.textContent = rawCodes[0] || "---";
      code1El.onclick = () => copyToClipboardSilent(rawCodes[0]);
    }
    if (code2El) {
      code2El.textContent = rawCodes[1] || "---";
      code2El.onclick = () => copyToClipboardSilent(rawCodes[1]);
    }
    if (code3El) {
      code3El.textContent = rawCodes[2] || "---";
      code3El.onclick = () => copyToClipboardSilent(rawCodes[2]);
    }

    startDecryptTimer();
    await logAuditEvent("فك تشفير بيانات حساسة", orderId, "تم كشف بيانات الحساب لمدة 90 ثانية");
  } catch (e) {
    console.error(e);
    alert("خطأ في الاتصال بالسيرفر");
  }
}
window.decryptOrder = decryptOrder;

function startDecryptTimer() {
  clearInterval(decryptTimer);
  decryptSeconds = 90;

  const timerEl = document.getElementById("decryptTimer");
  if (timerEl) timerEl.textContent = decryptSeconds + " ثانية";

  decryptTimer = setInterval(() => {
    decryptSeconds--;

    const timerLabel = document.getElementById("decryptTimer");
    if (timerLabel) {
      timerLabel.textContent = decryptSeconds + " ثانية";
    }

    if (decryptSeconds <= 0) {
      clearInterval(decryptTimer);

      ["secureEmail", "secureEaPass", "secureCode1", "secureCode2", "secureCode3"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = "••••••••";
          el.onclick = null;
        }
      });

      if (timerLabel) timerLabel.textContent = "منتهي";
    }
  }, 1000);
}

// ==========================================================================
// 8) تفاصيل الطلب وإدارتها بالكامل (تصميم فاخر Redesign 180° مع Auto-Close)
// ==========================================================================
window.openOrderModal = function (orderId) {
  const modal = document.getElementById("orderDetailModal");
  const modalTitle = document.getElementById("modalOrderIdTitle");
  const modalSubTitle = document.getElementById("modalRefNumberSubtitle");
  const modalBody = document.getElementById("modalOrderBody");
  if (!modal || !modalBody) return;

  const order = ordersData.find(o => o.id === orderId || o.referenceNumber === orderId || o.orderNumber === orderId);
  if (!order) { alert("لم يتم العثور على بيانات الطلب المطلوب."); return; }

  const orderNum = order.orderNumber || order.id;
  const refNum = order.referenceNumber || order.id;

  if (modalTitle) modalTitle.innerText = `طلب رقم: #${orderNum}`;
  if (modalSubTitle) {
    modalSubTitle.innerText = `المرجع: ${refNum}`;
    modalSubTitle.onclick = () => copyTrackingLink(refNum);
  }

  const drawn = Number(order.drawnCoins || 0);
  const total = Number(order.totalQty || 0);
  const remaining = Math.max(0, total - drawn);
  const progressPercent = total > 0 ? Math.min(100, Math.round((drawn / total) * 100)) : 0;
  
  const isNewOrReview = (order.status === 'new' || order.status === 'pending' || order.status === 'review');
  const isFinalState = (order.status === 'finished' || order.status === 'transferred' || order.status === 'completed');

  modalBody.innerHTML = `
    <!-- هيدر البيانات بتصميم زجاجي احترافي فاخر -->
    <div style="background: linear-gradient(135deg, rgba(0,255,135,0.06) 0%, rgba(56,189,248,0.06) 100%); border: 1.5px solid rgba(0,255,135,0.2); padding: 20px; border-radius: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
      <div style="display:flex; align-items:center; gap:16px;">
        <div style="font-size:1.8rem;">${getPlatformBadgeHTML(order.platform)}</div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:900; letter-spacing:0.5px; display:block; margin-bottom:2px;">اسم العميل الكريم</span>
          <strong style="font-size:1.15rem; color:var(--text-main); font-weight:900;">${order.name || '---'}</strong>
        </div>
      </div>
      <div style="background: rgba(245,158,11,0.12); border: 1.5px solid rgba(245,158,11,0.4); padding: 10px 18px; border-radius: 14px; color: #f59e0b; font-weight: 900; font-family: monospace; font-size: 1.05rem; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-phone"></i> ${order.phone || '---'}
      </div>
    </div>

    <!-- لوحة حالة الطلب مع خيار الإغلاق التلقائي للقائمة -->
    <div style="background:var(--input-bg); border:1.5px solid var(--card-border); padding:16px 20px; border-radius:18px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
      <div style="display:flex; align-items:center; gap:10px; width:100%; max-width:340px;">
        <span style="font-weight:900; color:var(--text-muted); font-size:0.85rem;"><i class="fa-solid fa-sliders" style="color:var(--primary);"></i> حالة الطلب:</span>
        <select id="modalOrderStatusSelect" class="form-control" style="font-weight:900; border-color:var(--primary);" onchange="handleStatusSelectionChanged(this)">
          <option value="new" ${order.status === 'new' || order.status === 'pending' ? 'selected' : ''}>طلب جديد</option>
          <option value="progress" ${order.status === 'progress' ? 'selected' : ''}>قيد التنفيذ</option>
          <option value="review" ${order.status === 'review' ? 'selected' : ''}>انتظار المراجعة</option>
          <option value="finished" ${order.status === 'finished' ? 'selected' : ''}>تم الانتهاء</option>
          <option value="transferred" ${order.status === 'transferred' ? 'selected' : ''}>تم التحويل</option>
          <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>مكتمل</option>
          <option value="archived" ${order.status === 'archived' ? 'selected' : ''}>مؤرشف</option>
        </select>
      </div>
      <button class="btn-custom" style="padding:10px 20px; font-size:0.85rem;" onclick="saveOrderStatusDirect('${order.id}', '${orderNum}')">
        <i class="fa-solid fa-check-double"></i> حفظ وإرسال واتساب
      </button>
    </div>

    <!-- بطاقات الكمية والمبلغ المالي بتصميم هندسي فائق الأناقة -->
    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:14px; margin-bottom:20px;">
      <div style="background:var(--input-bg); padding:16px; border-radius:16px; border:1.5px solid var(--card-border); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:800; display:block; margin-bottom:4px;">إجمالي الكمية المطلوبة</span>
          <b style="font-family:monospace; color:var(--primary); font-size:1.2rem;">${formatCoinsNumber(total)}</b>
        </div>
        <div style="width:40px; height:40px; background:rgba(0,255,135,0.1); border-radius:12px; display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:1.1rem;"><i class="fa-solid fa-coins"></i></div>
      </div>
      <div style="background:var(--input-bg); padding:16px; border-radius:16px; border:1.5px solid var(--card-border); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); font-weight:800; display:block; margin-bottom:4px;">المبلغ المالي المدفوع</span>
          <b style="font-family:monospace; color:#f59e0b; font-size:1.2rem;">${order.totalPrice}</b>
        </div>
        <div style="width:40px; height:40px; background:rgba(245,158,11,0.1); border-radius:12px; display:flex; align-items:center; justify-content:center; color:#f59e0b; font-size:1.1rem;"><i class="fa-solid fa-sack-dollar"></i></div>
      </div>
    </div>

    <!-- شريط ومربع سحب الكوينز المطور -->
    ${!isNewOrReview ? `
      <div class="progress-container-nextgen">
        <div class="progress-header">
          <span style="font-size:0.9rem; font-weight:900; color:var(--text-main);"><i class="fa-solid fa-chart-pie" style="color:var(--primary);"></i> متابعة سحب الكوينز اللحظي</span>
          <span style="font-size:1rem; font-weight:900; font-family:monospace; color:var(--primary);" id="modalProgressPercent">${progressPercent}%</span>
        </div>

        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-bottom:16px; text-align:center;">
          <div style="background:var(--card-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);"><span style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:2px;">الإجمالي</span><b style="font-family:monospace; font-size:1.05rem;">${formatCoinsNumber(total)}</b></div>
          <div style="background:var(--card-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);"><span style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:2px;">المسحوبة</span><b style="font-family:monospace; color:#38bdf8; font-size:1.05rem;" id="modalDrawnVal">${formatCoinsNumber(drawn)}</b></div>
          <div style="background:var(--card-bg); padding:12px; border-radius:12px; border:1px solid var(--card-border);"><span style="font-size:0.72rem; color:var(--text-muted); display:block; margin-bottom:2px;">المتبقية</span><b style="font-family:monospace; color:#ef4444; font-size:1.05rem;" id="modalRemainingVal">${formatCoinsNumber(remaining)}</b></div>
        </div>

        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="modalProgressBarFill" style="width: ${progressPercent}%;"></div>
        </div>

        ${!isFinalState ? `
          <div class="withdraw-input-control">
            <input type="text" id="modalDrawnInput" class="form-control" value="${formatCoinsNumber(drawn)}" oninput="formatInputCoinsWithCommas(this)">
            <button class="btn-custom" style="background:var(--primary); color:#000; flex-shrink:0; padding:12px 22px;" onclick="saveDrawnCoinsDirect('${order.id}', ${total})">
              <i class="fa-solid fa-floppy-disk"></i> حفظ الكمية
            </button>
          </div>
        ` : `
          <div style="text-align:center; color:var(--success); font-size:0.88rem; font-weight:900; background:rgba(16,185,129,0.1); padding:12px; border-radius:12px; border:1px solid rgba(16,185,129,0.3);">
            <i class="fa-solid fa-lock"></i> تم قفل تعديل الكمية المسحوبة نهائياً لوصول الطلب للحالات النهائية.
          </div>
        `}
      </div>
    ` : `
      <div style="background:var(--input-bg); border:1.5px dashed var(--card-border); padding:18px; border-radius:16px; text-align:center; color:var(--text-muted); font-size:0.88rem; margin-bottom:20px;">
        ℹ️ حقول وشريط سحب الكوينز غير مفعلين في حالتي (طلب جديد / انتظار المراجعة).
      </div>
    `}

    <!-- البيانات الحساسة -->
    <div class="secure-box" style="background:var(--input-bg); padding:20px; border-radius:20px; border:1.5px solid var(--card-border); margin-bottom:20px;">
      <div class="secure-head" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <span style="color:#38bdf8; font-weight:900; font-size:1rem;"><i class="fa-solid fa-shield-cat"></i> البيانات الحساسة (اضغط للنسخ الفوري)</span>
        <button class="decrypt-btn btn-custom" style="background:#38bdf8; color:#060913; font-size:0.8rem; padding:8px 16px; border:none; border-radius:12px; cursor:pointer;" onclick="decryptOrder('${order.id}')">
          <i class="fa-solid fa-lock-open"></i> فك التشفير
        </button>
      </div>

      <div id="decryptTimer" style="color:#f59e0b; font-weight:800; font-size:0.85rem; margin-bottom:14px; font-family:monospace;">مشفرة بالكامل</div>

      <div class="secure-item-row" title="نسخ البريد">
        <span class="label"><i class="fa-solid fa-at"></i> البريد الإلكتروني:</span>
        <span class="value" id="secureEmail">••••••••</span>
      </div>

      <div class="secure-item-row" title="نسخ كلمة المرور">
        <span class="label"><i class="fa-solid fa-key"></i> كلمة المرور:</span>
        <span class="value" id="secureEaPass">••••••••</span>
      </div>

      <div style="margin-top:12px;">
        <span style="font-size:0.82rem; font-weight:900; color:var(--text-muted); display:block; margin-bottom:8px;">الأكواد الاحتياطية الثلاثة:</span>
        <div class="backup-codes-grid">
          <div class="code-box-single" id="secureCode1">••••</div>
          <div class="code-box-single" id="secureCode2">••••</div>
          <div class="code-box-single" id="secureCode3">••••</div>
        </div>
      </div>
    </div>

    <!-- أزرار الإجراءات السفلية -->
    <div style="display:flex; gap:12px; justify-content:space-between; align-items:center;">
      <button class="btn-custom" style="background:#ef4444; color:#fff;" onclick="openPurgeModal('${order.id}')">
        <i class="fa-solid fa-skull-crossbones"></i> إتلاف البيانات الحساسة
      </button>
      <button class="btn-custom" style="background:var(--input-bg); color:var(--text-main); border:1.5px solid var(--card-border);" onclick="closeOrderModal()">إغلاق النافذة</button>
    </div>
  `;
  modal.classList.add("active");
};

// دالة إغلاق قائمة الحالات تلقائياً بمجرد الاختيار
window.handleStatusSelectionChanged = function(selectEl) {
  if (selectEl) {
    selectEl.blur(); // يفقد التركيز لتغلق القائمة المنسدلة فوراً
  }
};

window.formatInputCoinsWithCommas = function(inputEl) {
  let val = inputEl.value.replace(/[^0-9]/g, "");
  if (!val) { inputEl.value = "0"; return; }
  inputEl.value = Number(val).toLocaleString("en-US");
};

window.saveOrderStatusDirect = async function(orderId, orderNum) {
  const statusSelect = document.getElementById("modalOrderStatusSelect");
  if (!statusSelect) return;
  const newStatus = statusSelect.value;
  try {
    const res = await fetch("/api/orders/update-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      await logAuditEvent("تحديث حالة الطلب", orderId, `تغيير الحالة إلى: ${newStatus}`);
      const order = ordersData.find(o => o.id === orderId);
      if (order && order.phone) {
        let msgTemplate = "";
        if (newStatus === 'new' || newStatus === 'pending') msgTemplate = document.getElementById("msgTemplateNew")?.value || "";
        else if (newStatus === 'review') msgTemplate = document.getElementById("msgTemplateReview")?.value || "";
        else if (newStatus === 'progress') msgTemplate = document.getElementById("msgTemplateProgress")?.value || "";
        else if (newStatus === 'finished') msgTemplate = document.getElementById("msgTemplateFinished")?.value || "";
        else if (newStatus === 'transferred') msgTemplate = document.getElementById("msgTemplateTransferred")?.value || "";
        else if (newStatus === 'completed') msgTemplate = document.getElementById("msgTemplateCompleted")?.value || "";

        if (msgTemplate) {
          const finalMsg = msgTemplate.replace(/#{orderNumber}/g, orderNum || order.referenceNumber);
          const cleanPhone = order.phone.replace(/[^0-9]/g, "");
          const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(finalMsg)}`;
          if (confirm("✅ تم حفظ الحالة بنجاح!\nهل تريد فتح الواتساب لإرسال الإشعار للعميل فوراً؟")) {
            window.open(waUrl, "_blank");
          }
        }
      }
      loadOrders();
      closeOrderModal();
    } else { alert("❌ فشل التحديث: " + data.message); }
  } catch (err) { alert("❌ خطأ: " + err.message); }
};

window.saveDrawnCoinsDirect = async function(orderId, totalQty) {
  const inputEl = document.getElementById("modalDrawnInput");
  if (!inputEl) return;
  const newDrawn = Number(inputEl.value.replace(/,/g, "")) || 0;
  try {
    const res = await fetch("/api/orders/update-drawn", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, drawnCoins: newDrawn })
    });
    const data = await res.json();
    if (data.success) {
      await logAuditEvent("تحديث المسحوب", orderId, `المسحوب: ${newDrawn}`);
      const remaining = Math.max(0, totalQty - newDrawn);
      const percent = totalQty > 0 ? Math.min(100, Math.round((newDrawn / totalQty) * 100)) : 0;
      if (document.getElementById("modalDrawnVal")) document.getElementById("modalDrawnVal").innerText = formatCoinsNumber(newDrawn);
      if (document.getElementById("modalRemainingVal")) document.getElementById("modalRemainingVal").innerText = formatCoinsNumber(remaining);
      if (document.getElementById("modalProgressPercent")) document.getElementById("modalProgressPercent").innerText = `${percent}%`;
      if (document.getElementById("modalProgressBarFill")) document.getElementById("modalProgressBarFill").style.width = `${percent}%`;
      if (newDrawn >= totalQty) {
        await fetch("/api/orders/update-status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, status: "finished" })
        });
      }
      loadOrders();
    }
  } catch (err) { alert("❌ خطأ: " + err.message); }
};

window.closeOrderModal = function () {
  clearInterval(decryptTimer);
  decryptTimer = null;
  decryptSeconds = 90;

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
  openOrderModal(orderId);
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
// 9) لوحة المخزون العرضية وإعدادات النظام
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
    if (settings.whatsappTemplates) {
      if (document.getElementById("msgTemplateNew")) document.getElementById("msgTemplateNew").value = settings.whatsappTemplates.new || "";
      if (document.getElementById("msgTemplateReview")) document.getElementById("msgTemplateReview").value = settings.whatsappTemplates.review || "";
      if (document.getElementById("msgTemplateProgress")) document.getElementById("msgTemplateProgress").value = settings.whatsappTemplates.progress || "";
      if (document.getElementById("msgTemplateFinished")) document.getElementById("msgTemplateFinished").value = settings.whatsappTemplates.finished || "";
      if (document.getElementById("msgTemplateTransferred")) document.getElementById("msgTemplateTransferred").value = settings.whatsappTemplates.transferred || "";
      if (document.getElementById("msgTemplateCompleted")) document.getElementById("msgTemplateCompleted").value = settings.whatsappTemplates.completed || "";
    }
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

window.saveWhatsappTemplates = async function() {
  const templates = {
    new: document.getElementById("msgTemplateNew")?.value || "",
    review: document.getElementById("msgTemplateReview")?.value || "",
    progress: document.getElementById("msgTemplateProgress")?.value || "",
    finished: document.getElementById("msgTemplateFinished")?.value || "",
    transferred: document.getElementById("msgTemplateTransferred")?.value || "",
    completed: document.getElementById("msgTemplateCompleted")?.value || ""
  };
  await savePricing({ whatsappTemplates: templates });
  await logAuditEvent("حفظ قوالب رسائل الواتساب", "الإعدادات", "تحديث رسائل أتمتة الواتساب بنجاح");
  alert("✅ تم حفظ قوالب رسائل حالات الطلب بنجاح!");
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

// ==========================================================================
// 10) التنقل وإدارة الواجهة العامة
// ==========================================================================
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

// تشغيل حارس التوثيق
initAuthGuard();
