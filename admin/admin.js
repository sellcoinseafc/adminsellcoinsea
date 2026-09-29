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

// مستمعات الأحداث اللحظية
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
    clockEl.innerText = now.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
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
      timeString: new Date().toLocaleString("en-US", { hour12: true }),
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
        <td><span class="date-en">${log.timeString || '---'}</span></td>
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
  if (priceVal === undefined || priceVal === null || priceVal === "") return "0 SAR";
  let cleanStr = String(priceVal).replace(/[^0-9.]/g, '');
  if (!cleanStr) return "0 SAR";
  return Number(cleanStr).toLocaleString('en-US') + " SAR";
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
    return `<span style="color:var(--danger); font-weight:900;" class="num-en"><i class="fa-solid fa-triangle-exclamation"></i> EXPIRED</span>`;
  }

  const daysLeft = Math.floor(remainingHours / 24);
  const hoursLeft = Math.floor(remainingHours % 24);

  let colorStyle = "color:var(--success); font-weight:900;";
  if (daysLeft <= 1) {
    colorStyle = "color:var(--danger); font-weight:900;";
  } else if (daysLeft <= 3) {
    colorStyle = "color:#f59e0b; font-weight:900;";
  }

  return `<span style="${colorStyle}" class="num-en"><i class="fa-solid fa-stopwatch"></i> ${daysLeft}d ${hoursLeft}h left</span>`;
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
// 3) قراءة الطلبات والتحميل والإحصائيات
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

  if (document.getElementById("dashStockPS")) document.getElementById("dashStockPS").innerText = formatCoinsNumber(currentSettingsData.psStock || 0) + " Coins";
  if (document.getElementById("dashStockPC")) document.getElementById("dashStockPC").innerText = formatCoinsNumber(currentSettingsData.pcStock || 0) + " Coins";
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
  if (document.getElementById("statTotalMoney")) document.getElementById("statTotalMoney").innerText = totalMoney.toLocaleString('en-US') + " SAR";
  if (document.getElementById("statTodayCoins")) document.getElementById("statTodayCoins").innerText = formatCoinsNumber(todayCoins);
  if (document.getElementById("statTodayMoney")) document.getElementById("statTodayMoney").innerText = todayMoney.toLocaleString('en-US') + " SAR";
}

window.handleGlobalSearch = function (queryVal) {
  activeSearchQuery = queryVal.trim().toLowerCase();
  renderOrdersTables();
  renderWithdrawOrdersTable();
  renderClientsTable(activeSearchQuery);
};

// ==========================================================================
// 4) رسم الجداول والتصفية الفورية عند تغيير الفلتر
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

  // عند اختيار تصنيف يختفي أي عنصر خارج هذا التصنيف فوراً
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

  tbody.innerHTML = filteredData.map(o => {
    const orderNum = o.orderNumber || o.id;
    const ref = o.referenceNumber || "";
    return `
      <tr>
        <td><b class="num-en" style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td><span class="num-en" style="font-size:0.85rem; color:var(--text-muted);">${ref || '---'}</span></td>
        <td>${o.name || '---'}</td>
        <td>${getPlatformBadgeHTML(o.platform)}</td>
        <td class="num-en">${formatCoinsNumber(o.totalQty)}</td>
        <td><b class="price-en">${o.totalPrice}</b></td>
        <td>${badgeMap[o.status] || `<span class="badge">${o.status}</span>`}</td>
        <td>${buildActionButtonsHTML(o)}</td>
      </tr>
    `;
  }).join("");

  mobileContainer.innerHTML = filteredData.map(o => {
    const orderNum = o.orderNumber || o.id;
    const ref = o.referenceNumber || "";
    return `
      <div class="mobile-order-card-item">
        <div class="mobile-order-header">
          <b class="num-en" style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b>
          ${badgeMap[o.status] || `<span class="badge">${o.status}</span>`}
        </div>
        <div class="mobile-order-body">
          <div><b>العميل:</b> ${o.name || '---'}</div>
          <div><b>الجوال:</b> <span class="num-en">${o.phone || '---'}</span></div>
          <div><b>الكمية:</b> <span class="num-en">${formatCoinsNumber(o.totalQty)}</span></div>
          <div><b>السعر:</b> <b class="price-en">${o.totalPrice}</b></div>
        </div>
        <div style="margin-bottom:8px;">${getPlatformBadgeHTML(o.platform)}</div>
        <div class="mobile-order-footer">
          <span class="num-en" style="font-size:0.8rem; color:var(--text-muted);">${ref}</span>
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
        <td><b class="num-en" style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td><span class="num-en" style="font-size:0.85rem; color:var(--text-muted);">${ref || '---'}</span></td>
        <td>${o.name || '---'}</td>
        <td>${getPlatformBadgeHTML(o.platform)}</td>
        <td class="num-en">${formatCoinsNumber(o.totalQty)}</td>
        <td><b class="price-en">${o.totalPrice}</b></td>
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
        <td><b class="num-en" style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td>${o.name || '---'}</td>
        <td>${getPlatformBadgeHTML(o.platform)}</td>
        <td class="num-en"><b>${formatCoinsNumber(total)}</b></td>
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
        <td><b class="num-en" style="color:var(--primary); cursor:pointer;" onclick="copyTrackingLink('${ref}')">#${orderNum}</b></td>
        <td>${o.name || '---'}</td>
        <td><span class="num-en">${o.phone || '---'}</span></td>
        <td><b class="price-en">${o.totalPrice}</b></td>
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
// 5) النافذة المنبثقة الفاخرة للطلب (Order Detail Modal System)
// ==========================================================================
let currentModalOrderId = null;

window.openOrderModal = async function (orderId) {
  currentModalOrderId = orderId;
  const modal = document.getElementById("orderModalOverlay");
  if (!modal) return;

  const order = ordersData.find(o => o.id === orderId);
  if (!order) return;

  // إظهار النافذة الحوارية
  modal.classList.add("active");

  // تعبئة البيانات الأساسية في الهيدر المتوازي
  if (document.getElementById("modalOrderNumTitle")) document.getElementById("modalOrderNumTitle").innerText = order.orderNumber || order.id;
  if (document.getElementById("modalRefSubtitle")) document.getElementById("modalRefSubtitle").innerText = order.referenceNumber || "---";
  if (document.getElementById("modalCustomerNameHero")) document.getElementById("modalCustomerNameHero").innerText = order.name || "---";
  if (document.getElementById("modalCustomerPhoneHero")) document.getElementById("modalCustomerPhoneHero").innerText = order.phone || "---";

  // تعبئة بطاقات المعدلات الأساسية الثلاثة
  if (document.getElementById("modalPlatformBox")) document.getElementById("modalPlatformBox").innerHTML = getPlatformBadgeHTML(order.platform);
  if (document.getElementById("modalCoinsBox")) document.getElementById("modalCoinsBox").innerText = formatCoinsNumber(order.totalQty) + " Coins";
  if (document.getElementById("modalPriceBox")) document.getElementById("modalPriceBox").innerText = order.totalPrice;

  // تعيين حالة الطلب المحددة مسبقاً في القائمة
  const statusSelect = document.getElementById("modalOrderStatusSelect");
  if (statusSelect) statusSelect.value = order.status || "new";

  // إعداد شريط ومؤشر سحب الكوينز المطور
  initModalCoinsProgressControl(order);

  // جلب البيانات الحساسة وتجهيز العد التنازلي الحصري
  await fetchAndRenderSensitiveOrderData(orderId);
};

window.closeOrderModal = function () {
  const modal = document.getElementById("orderModalOverlay");
  if (modal) modal.classList.remove("active");
  currentModalOrderId = null;

  // إيقاف مؤقت العد التنازلي التلقائي لفك التشفير عند الإغلاق
  if (decryptTimer) {
    clearInterval(decryptTimer);
    decryptTimer = null;
  }
};

function initModalCoinsProgressControl(order) {
  const totalQty = Number(order.totalQty || 0);
  const drawnCoins = Number(order.drawnCoins || 0);
  const remainingCoins = Math.max(0, totalQty - drawnCoins);
  const progressPercent = totalQty > 0 ? Math.min(100, Math.round((drawnCoins / totalQty) * 100)) : 0;

  if (document.getElementById("modalProgressCoinsText")) {
    document.getElementById("modalProgressCoinsText").innerText = `${formatCoinsNumber(drawnCoins)} / ${formatCoinsNumber(totalQty)} Coins (${progressPercent}%)`;
  }

  const fillBar = document.getElementById("modalProgressBarFill");
  if (fillBar) fillBar.style.width = `${progressPercent}%`;

  const inputEl = document.getElementById("modalDrawnCoinsInput");
  if (inputEl) {
    inputEl.value = drawnCoins;
    inputEl.max = totalQty;
  }
}

window.handleUpdateDrawnCoins = async function () {
  if (!currentModalOrderId) return;
  const inputEl = document.getElementById("modalDrawnCoinsInput");
  if (!inputEl) return;

  const newDrawnVal = Number(inputEl.value || 0);
  const order = ordersData.find(o => o.id === currentModalOrderId);
  if (!order) return;

  try {
    const res = await fetch(`/api/orders/${currentModalOrderId}/draw-coins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drawnCoins: newDrawnVal })
    });
    const data = await res.json();

    if (data.success) {
      order.drawnCoins = newDrawnVal;
      initModalCoinsProgressControl(order);
      await logAuditEvent("تحديث الكوينز المسحوبة", order.referenceNumber || order.id, `المسحوب الجديد: ${newDrawnVal}`);
      alert("✅ تم تحديث كمية الكوينز المسحوبة بنجاح");
    } else {
      alert("❌ فشل تحديث كمية السحب: " + (data.message || ""));
    }
  } catch (err) {
    alert("⚠️ خطأ في الاتصال بالسيرفر أثناء حفظ السحب");
  }
};

window.handleSaveModalOrderStatus = async function () {
  if (!currentModalOrderId) return;
  const statusSelect = document.getElementById("modalOrderStatusSelect");
  if (!statusSelect) return;

  const newStatus = statusSelect.value;
  const order = ordersData.find(o => o.id === currentModalOrderId);
  if (!order) return;

  try {
    const res = await fetch(`/api/orders/${currentModalOrderId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();

    if (data.success) {
      order.status = newStatus;
      renderOrdersTables();
      renderWithdrawOrdersTable();
      renderTransferAlertsTable();
      await logAuditEvent("تغيير حالة الطلب", order.referenceNumber || order.id, `الحالة الجديدة: ${newStatus}`);
      alert("✅ تم حفظ حالة الطلب الجديدة بنجاح");
      closeOrderModal();
    } else {
      alert("❌ فشل تحديث حالة الطلب: " + (data.message || ""));
    }
  } catch (err) {
    alert("⚠️ خطأ في التواصل مع السيرفر عند حفظ الحالة");
  }
};

async function fetchAndRenderSensitiveOrderData(orderId) {
  const container = document.getElementById("modalSensitiveDataContainer");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> جاري فك تشفير البيانات الحساسة...</div>`;

  try {
    const res = await fetch(`/api/orders/${orderId}/sensitive`);
    const data = await res.json();

    if (!data.success) {
      container.innerHTML = `<div class="alert-danger" style="display:block;">⚠️ غير مصرح لك بفك تشفير هذا الطلب أو انتهت جلسة الأمان.</div>`;
      return;
    }

    const { email, password, backupCodes, iban, bankName } = data.sensitiveData || {};

    container.innerHTML = `
      <div class="secure-item-row" onclick="copyToClipboardSilent('${email}')" title="انقر للنسخ الفوري">
        <span class="label"><i class="fa-solid fa-envelope" style="color:var(--blue);"></i> البريد الإلكتروني:</span>
        <span class="value">${email || '---'}</span>
      </div>

      <div class="secure-item-row" onclick="copyToClipboardSilent('${password}')" title="انقر للنسخ الفوري">
        <span class="label"><i class="fa-solid fa-key" style="color:var(--warning);"></i> كلمة المرور:</span>
        <span class="value">${password || '---'}</span>
      </div>

      <div style="margin-top:16px;">
        <span style="font-size:0.85rem; font-weight:800; color:var(--text-muted);"><i class="fa-solid fa-shield-halved" style="color:var(--primary);"></i> الأكواد الاحتياطية (Backup Codes):</span>
        <div class="backup-codes-grid">
          ${(backupCodes || ['---', '---', '---']).map(code => `
            <div class="code-box-single" onclick="copyToClipboardSilent('${code}')" title="انقر للنسخ">${code}</div>
          `).join('')}
        </div>
      </div>

      ${iban ? `
        <div class="secure-item-row" style="margin-top:16px; border-color:rgba(16,185,129,0.3);" onclick="copyToClipboardSilent('${iban}')" title="انقر لنسخ الآيبان">
          <span class="label"><i class="fa-solid fa-building-columns" style="color:var(--success);"></i> بيانات التحويل (${bankName || 'البنك'}):</span>
          <span class="value">${iban}</span>
        </div>
      ` : ''}

      <div style="text-align:center; margin-top:18px;">
        <span id="decryptCountdownBadge" class="badge badge-review" style="font-size:0.82rem;">
          <i class="fa-solid fa-lock"></i> سيتم قفل وتشفير البيانات تلقائياً خلال: <b class="num-en" id="decryptSecondsText">90</b> ثانية
        </span>
      </div>
    `;

    startDecryptLockTimer();

  } catch (err) {
    container.innerHTML = `<div class="alert-danger" style="display:block;">⚠️ خطأ في الاتصال عند جلب بيانات الحساب المشفّرة.</div>`;
  }
}

function startDecryptLockTimer() {
  if (decryptTimer) clearInterval(decryptTimer);
  decryptSeconds = 90;

  decryptTimer = setInterval(() => {
    decryptSeconds--;
    const txtEl = document.getElementById("decryptSecondsText");
    if (txtEl) txtEl.innerText = decryptSeconds;

    if (decryptSeconds <= 0) {
      clearInterval(decryptTimer);
      decryptTimer = null;
      const container = document.getElementById("modalSensitiveDataContainer");
      if (container) {
        container.innerHTML = `
          <div style="text-align:center; padding:20px; background:rgba(239,68,68,0.1); border:1.5px solid rgba(239,68,68,0.3); border-radius:18px;">
            <i class="fa-solid fa-user-lock" style="font-size:2rem; color:var(--danger); margin-bottom:8px;"></i>
            <h4 style="color:#fff; font-weight:900;">تم إعادة قفل البيانات الحساسة لأواعي الأمان</h4>
            <p style="color:var(--text-muted); font-size:0.82rem; margin-top:4px;">يرجى إعادة فتح النافذة في حال احتجت للمعاينة مرة أخرى.</p>
          </div>
        `;
      }
    }
  }, 1000);
}

// ==========================================================================
// 6) إجراءات حذف الطلبات والأرشفة والتعديل السريع
// ==========================================================================
window.handleDeleteOrder = async function (orderId, refNum) {
  if (!confirm(`⚠️ هل أنت متأكد تماماً من حذف الطلب رقم #${refNum}؟ لا يمكن التراجع عن هذه الخطوة!`)) return;

  try {
    const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    const data = await res.json();

    if (data.success) {
      ordersData = ordersData.filter(o => o.id !== orderId);
      renderOrdersTables();
      renderWithdrawOrdersTable();
      renderTransferAlertsTable();
      await logAuditEvent("حذف طلب النهائي", refNum, "تم مسح الطلب من القاعدة");
      alert("✅ تم حذف الطلب بنجاح");
    } else {
      alert("❌ فشل الحذف: " + (data.message || ""));
    }
  } catch (err) {
    alert("⚠️ خطأ في الاتصال عند الحذف");
  }
};

window.handleArchiveOrder = async function (orderId, refNum) {
  if (!confirm(`هل ترغب بنقل الطلب رقم #${refNum} إلى الأرشيف؟`)) return;

  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" })
    });
    const data = await res.json();

    if (data.success) {
      const order = ordersData.find(o => o.id === orderId);
      if (order) order.status = "archived";
      renderOrdersTables();
      renderWithdrawOrdersTable();
      await logAuditEvent("أرشفة طلب", refNum, "تم النقل للأرشيف");
      alert("📦 تم أرشفة الطلب بنجاح");
    } else {
      alert("❌ فشل الأرشفة: " + (data.message || ""));
    }
  } catch (err) {
    alert("⚠️ خطأ عند تنفيذ الأرشفة");
  }
};

window.promptEditOrder = async function (orderId) {
  const order = ordersData.find(o => o.id === orderId);
  if (!order) return;

  const newName = prompt("تعديل اسم العميل:", order.name);
  if (newName === null) return;

  const newPhone = prompt("تعديل رقم الجوال:", order.phone);
  if (newPhone === null) return;

  try {
    const res = await fetch(`/api/orders/${orderId}/update-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, phone: newPhone })
    });
    const data = await res.json();

    if (data.success) {
      order.name = newName;
      order.phone = newPhone;
      renderOrdersTables();
      await logAuditEvent("تعديل بيانات عميل", order.referenceNumber || order.id, `الاسم: ${newName} | الجوال: ${newPhone}`);
      alert("✅ تم تحديث بيانات الطلب بنجاح");
    } else {
      alert("❌ فشل التعديل: " + (data.message || ""));
    }
  } catch (err) {
    alert("⚠️ خطأ في الاتصال عند التحديث");
  }
};

// ==========================================================================
// 7) إدارة التقييمات وقائمة العملاء وحسابات المشرفين
// ==========================================================================
function initReviewsListener() {
  const q = query(collection(db, "reviews"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    reviewsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderReviewsTable();
  });
}

function renderReviewsTable() {
  const tbody = document.getElementById("reviewsTableBody");
  if (!tbody) return;

  let filtered = reviewsData;
  if (activeReviewSearchQuery) {
    filtered = filtered.filter(r =>
      (r.clientName && r.clientName.toLowerCase().includes(activeReviewSearchQuery)) ||
      (r.comment && r.comment.toLowerCase().includes(activeReviewSearchQuery))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد تقييمات مطابقة.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><b>${r.clientName || 'عميل'}</b></td>
      <td><span style="color:#ffd700;">${'★'.repeat(r.rating || 5)}</span></td>
      <td><span style="font-size:0.85rem;">${r.comment || 'بدون تعليق'}</span></td>
      <td><span class="badge ${r.status === 'approved' ? 'badge-completed' : 'badge-review'}">${r.status === 'approved' ? 'منشور' : 'بانتظار الموافقة'}</span></td>
      <td><span class="date-en">${r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000).toLocaleDateString("en-US") : '---'}</span></td>
      <td>
        <button class="btn-action" style="color:var(--success);" title="موافقة ونشر" onclick="handleApproveReview('${r.id}')"><i class="fa-solid fa-check"></i></button>
        <button class="btn-action" style="color:var(--danger);" title="حذف" onclick="handleDeleteReview('${r.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

window.handleApproveReview = async function (reviewId) {
  try {
    await updateDoc(doc(db, "reviews", reviewId), { status: "approved" });
    await logAuditEvent("الموافقة على تقييم", "التقييمات", `المعرف: ${reviewId}`);
    alert("✅ تم نشر التقييم بنجاح");
  } catch (err) {
    alert("❌ فشل التحديث");
  }
};

window.handleDeleteReview = async function (reviewId) {
  if (!confirm("هل ترغب بحذف هذا التقييم؟")) return;
  try {
    await deleteDoc(doc(db, "reviews", reviewId));
    await logAuditEvent("حذف تقييم", "التقييمات", `المعرف: ${reviewId}`);
    alert("✅ تم حذف التقييم");
  } catch (err) {
    alert("❌ فشل الحذف");
  }
};

function renderClientsTable(searchQuery = "") {
  const tbody = document.getElementById("clientsTableBody");
  if (!tbody) return;

  const clientsMap = {};
  ordersData.forEach(o => {
    if (!o.phone) return;
    if (!clientsMap[o.phone]) {
      clientsMap[o.phone] = {
        name: o.name || "عميل",
        phone: o.phone,
        ordersCount: 0,
        totalCoins: 0,
        totalSpent: 0,
        lastOrderDate: o.createdAt
      };
    }
    clientsMap[o.phone].ordersCount++;
    clientsMap[o.phone].totalCoins += Number(o.totalQty || 0);
    const pVal = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 0;
    clientsMap[o.phone].totalSpent += pVal;
  });

  let clientsList = Object.values(clientsMap);
  if (searchQuery) {
    clientsList = clientsList.filter(c =>
      c.name.toLowerCase().includes(searchQuery) ||
      c.phone.toLowerCase().includes(searchQuery)
    );
  }

  if (clientsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">لا يوجد عملاء مسجلين.</td></tr>`;
    return;
  }

  tbody.innerHTML = clientsList.map(c => `
    <tr>
      <td><b>${c.name}</b></td>
      <td><span class="num-en">${c.phone}</span></td>
      <td><span class="badge badge-review">${c.ordersCount} طلبات</span></td>
      <td><b class="num-en">${formatCoinsNumber(c.totalCoins)} Coins</b></td>
      <td><b class="price-en">${c.totalSpent.toLocaleString('en-US')} SAR</b></td>
    </tr>
  `).join('');
}

function initSystemSettingsListener() {
  return subscribeToSettings((settings) => {
    currentSettingsData = settings || {};
    if (document.getElementById("psStockInput")) document.getElementById("psStockInput").value = currentSettingsData.psStock || 0;
    if (document.getElementById("pcStockInput")) document.getElementById("pcStockInput").value = currentSettingsData.pcStock || 0;
    renderDashboardQuickStats();
  });
}

// ==========================================================================
// 8) تهيئة وتتبع التبويبات والمستمعات عند تحميل الصفحة
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  initAuthGuard();

  // إعداد التنقل بين تبويبات اللوحة
  const menuLinks = document.querySelectorAll(".sidebar-link[data-tab]");
  menuLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetTabId = link.getAttribute("data-tab");

      menuLinks.forEach(l => l.classList.remove("active"));
      link.classList.add("active");

      document.querySelectorAll(".tab-content").forEach(content => {
        content.classList.remove("active");
      });

      const activeContent = document.getElementById(targetTabId);
      if (activeContent) activeContent.classList.add("active");
    });
  });

  // نموذج تسجيل الدخول
  const loginForm = document.getElementById("loginForm");
  if (loginForm) loginForm.addEventListener("submit", window.handleEmailLogin);

  // إعداد البحث العلوى المباشر
  const globalSearchInput = document.getElementById("globalSearchInput");
  if (globalSearchInput) {
    globalSearchInput.addEventListener("input", (e) => window.handleGlobalSearch(e.target.value));
  }
});
