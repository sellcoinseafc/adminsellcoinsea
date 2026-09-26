import { db, auth } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
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
  signOut,
  createUserWithEmailAndPassword,
  getAuth
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

// ==========================================================================
// 1. المتغيرات العامة وحالة النظام والمشرف الحالي
// ==========================================================================
let currentAdmin = {
  uid: null,
  name: "مشرف النظام",
  email: "",
  role: "admin" // "owner" | "admin"
};

let isStoreOpen = true;
let banksList = ["مصرف الراجحي", "البنك الأهلي السعودي (SNB)", "بنك الرياض", "stc bank", "مصرف الإنماء"];
let walletsList = ["STC Pay", "urpay", "برق (Barq)", "موبايلي بي", "تيكمو"];
let customPaymentsList = ["بطاقة مدى / فيزا", "Apple Pay"];
let storeTerms = [
  "حالة سوق الانتقالات: يجب أن يكون سوق الانتقالات مفتوحاً ومتاحاً في تطبيق الويب (Web App).",
  "المدة الزمنية: متوسط مدة عملية سحب الكوينز تستغرق من 3 إلى 5 أيام عمل.",
  "أمان الحساب: لا تقم بتسجيل الدخول إلى اللعبة أثناء عملية السحب لضمان إتمام الطلب بنجاح."
];

let pricingConfig = {
  psRate: 200,
  pcRate: 150,
  psMin: 100000,
  psMax: 5000000,
  pcMin: 100000,
  pcMax: 1000000,
  psWithdrawDuration: "3 - 5 أيام عمل",
  psTransferDuration: "24 ساعة",
  pcWithdrawDuration: "2 - 4 أيام عمل",
  pcTransferDuration: "24 ساعة",
  promoActive: false,
  promoRate: 220,
  promoExpiry: "",
  promoText: "🔥 عرض لفترة محدودة!"
};

let ordersData = [];
let adminsData = [];
let auditLogsData = [];
let stockData = { PlayStation: 0, PC: 0 };
let revealedSensitiveOrders = new Set(); // لتتبع حالة إظهار بيانات EA للطلبات

// ==========================================================================
// 2. نظام تسجيل الدخول وحارس الأمان (Firebase Auth & Protection)
// ==========================================================================
function initAuthGuard() {
  if (!auth) return;

  getRedirectResult(auth)
    .then((result) => {
      if (result && result.user) {
        console.log("Google Redirect Login Successful:", result.user.email);
      }
    })
    .catch((err) => {
      console.error("Redirect Result Error:", err);
      showLoginError("فشل الدخول عبر التوجيه المباشر: " + (err.message || ""));
    });

  onAuthStateChanged(auth, async (user) => {
    const loginOverlay = document.getElementById("loginOverlay");
    if (user) {
      try {
        const adminRef = doc(db, "admins", user.uid);
        const adminDoc = await getDoc(adminRef);

        if (adminDoc.exists()) {
          const data = adminDoc.data();
          if (data.active === false) {
            showLoginError("⚠️ هذا الحساب معطل من قبل مالك النظام.");
            await signOut(auth);
            if (loginOverlay) loginOverlay.classList.add("active");
            return;
          }
          currentAdmin = { uid: user.uid, ...data };
          await updateDoc(adminRef, { lastLogin: serverTimestamp() });
        } else {
          currentAdmin = {
            uid: user.uid,
            name: user.displayName || user.email.split('@')[0],
            email: user.email,
            role: "owner",
            active: true
          };
          await setDoc(adminRef, {
            name: currentAdmin.name,
            email: currentAdmin.email,
            role: "owner",
            active: true,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
          });
        }

        if (loginOverlay) loginOverlay.classList.remove("active");
        updateSidebarAdminUI();
        applyRolePermissions();
        await logAuditEvent("تسجيل دخول المشرف", "النظام", `تم الدخول بواسطة: ${currentAdmin.email}`);
      } catch (err) {
        console.error("Auth Guard Firestore Error:", err);
        showLoginError("خطأ أثناء قراءة صلاحيات المستند: " + err.message);
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
  const alertEl = document.getElementById("loginErrorAlert");

  try {
    if (alertEl) alertEl.style.display = "none";
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error("Email Login Error:", err);
    let errMsg = "❌ البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      errMsg = "❌ البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    } else if (err.code === "auth/invalid-email") {
      errMsg = "❌ البريد الإلكتروني المدخل غير صالح.";
    } else if (err.code === "auth/too-many-requests") {
      errMsg = "❌ تم حظر الحساب مؤقتاً لكثرة المحاولات الخاطئة. حاول لاحقاً.";
    } else {
      errMsg = "❌ خطأ في الدخول: " + err.message;
    }
    showLoginError(errMsg);
  }
};

window.handleGoogleLogin = async function () {
  const alertEl = document.getElementById("loginErrorAlert");
  try {
    if (alertEl) alertEl.style.display = "none";
    const provider = new GoogleAuthProvider();
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
      await signInWithRedirect(auth, provider);
    } else {
      try {
        await signInWithPopup(auth, provider);
      } catch (popupErr) {
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/popup-closed-by-user') {
          await signInWithRedirect(auth, provider);
        } else {
          throw popupErr;
        }
      }
    }
  } catch (err) {
    console.error("Google Login Error:", err);
    showLoginError("❌ فشل تسجيل الدخول بواسطة Google: " + (err.message || ""));
  }
};

function updateSidebarAdminUI() {
  const nameEl = document.getElementById("sidebarUserName");
  const roleEl = document.getElementById("sidebarUserRole");
  const avatarEl = document.getElementById("userAvatarText");

  if (nameEl) nameEl.innerText = currentAdmin.name;
  if (avatarEl) avatarEl.innerText = currentAdmin.name ? currentAdmin.name.charAt(0) : "س";
  if (roleEl) {
    const isOwner = currentAdmin.role === "owner";
    roleEl.innerText = isOwner ? "Owner (مالك النظام)" : "Admin (مشرف)";
    roleEl.className = isOwner ? "user-role-badge owner" : "user-role-badge";
  }
}

function applyRolePermissions() {
  const adminTabLink = document.querySelector(".sidebar-menu li:nth-child(8)");
  if (adminTabLink) {
    adminTabLink.style.display = currentAdmin.role === "owner" ? "block" : "none";
  }
}

window.handleLogout = async function () {
  if (confirm("هل ترغب بتسجيل الخروج من لوحة التحكم؟")) {
    await logAuditEvent("تسجيل خروج", "النظام", `تم خروج: ${currentAdmin.email}`);
    if (auth) await signOut(auth);
    window.location.reload();
  }
};

// ==========================================================================
// 3. نظام سجل النظام الأمني التلقائي (Audit Log System)
// ==========================================================================
async function logAuditEvent(action, targetOrder = "عام", details = "") {
  try {
    await addDoc(collection(db, "audit_logs"), {
      timestamp: serverTimestamp(),
      timeString: new Date().toLocaleString("ar-SA"),
      user: currentAdmin.name || "مشرف",
      userId: currentAdmin.uid || "system",
      action: action,
      targetOrder: targetOrder,
      details: details,
      userAgent: navigator.userAgent.substring(0, 50)
    });
  } catch (err) {
    console.error("Audit Logging Error:", err);
  }
}

function initAuditLogsListener() {
  const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(100));
  onSnapshot(q, (snapshot) => {
    auditLogsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderAuditLogsTable();
  }, (err) => console.error("Audit logs listener error:", err));
}

function renderAuditLogsTable(filterText = "") {
  const tbody = document.getElementById("auditLogsTableBody");
  if (!tbody) return;

  let list = auditLogsData;
  if (filterText.trim()) {
    const q = filterText.toLowerCase();
    list = list.filter(l =>
      String(l.user).toLowerCase().includes(q) ||
      String(l.action).toLowerCase().includes(q) ||
      String(l.targetOrder).toLowerCase().includes(q)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد سجلات أمان مسجلة.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(log => `
    <tr>
      <td><span style="font-size:0.78rem; color:var(--text-muted);">${log.timeString || '---'}</span></td>
      <td><b>${log.user || 'مشرف'}</b></td>
      <td><span class="badge badge-review">${log.action}</span></td>
      <td><code style="color:var(--primary);">${log.targetOrder || 'عام'}</code></td>
      <td><span style="font-size:0.75rem; color:var(--text-muted);">${log.details || '---'}</span></td>
    </tr>
  `).join('');
}

window.filterAuditLogs = function (query) {
  renderAuditLogsTable(query);
};

// ==========================================================================
// 4. إدارة المشرفين والصلاحيات (`admins/{uid}` + Firebase Auth)
// ==========================================================================
function initAdminsListener() {
  onSnapshot(collection(db, "admins"), (snapshot) => {
    adminsData = snapshot.docs.map(docSnap => ({ uid: docSnap.id, ...docSnap.data() }));
    renderAdminsTable();
  });
}

function renderAdminsTable() {
  const tbody = document.getElementById("adminsTableBody");
  if (!tbody) return;

  if (adminsData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">لا يوجد مشرفين مسجلين.</td></tr>`;
    return;
  }

  tbody.innerHTML = adminsData.map(admin => {
    const isOwner = admin.role === "owner";
    const statusBadge = admin.active !== false
      ? `<span class="badge badge-success">نشط</span>`
      : `<span class="badge badge-error">معطل</span>`;
    const lastLoginStr = admin.lastLogin?.toDate ? admin.lastLogin.toDate().toLocaleString("ar-SA") : "لم يسجل بعد";

    return `
      <tr>
        <td><b>${admin.name}</b></td>
        <td>${admin.email}</td>
        <td><span class="${isOwner ? 'user-role-badge owner' : 'user-role-badge'}">${isOwner ? 'Owner' : 'Admin'}</span></td>
        <td>${statusBadge}</td>
        <td><span style="font-size:0.78rem; color:var(--text-muted);">${lastLoginStr}</span></td>
        <td>
          ${!isOwner ? `
            <button class="btn-action" style="color:var(--warning);" onclick="toggleAdminStatus('${admin.uid}', ${admin.active})">
              ${admin.active !== false ? 'تعطيل' : 'تفعيل'}
            </button>
            <button class="btn-action" style="color:var(--danger);" onclick="deleteAdminDoc('${admin.uid}', '${admin.name}')">حذف</button>
          ` : '<span style="font-size:0.75rem; color:var(--text-muted);">المالك الرئيسي</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

window.openAddAdminModal = function () {
  const modal = document.getElementById("addAdminModal");
  if (modal) modal.classList.add("active");
};

window.closeAddAdminModal = function () {
  const modal = document.getElementById("addAdminModal");
  if (modal) modal.classList.remove("active");
};

window.handleCreateAdmin = async function (e) {
  e.preventDefault();
  const name = document.getElementById("newAdminName").value.trim();
  const email = document.getElementById("newAdminEmail").value.trim();
  const password = document.getElementById("newAdminPassword").value;
  const role = document.getElementById("newAdminRole").value;

  if (!name || !email || !password) {
    alert("يرجى تعبئة كافة الحقول بما فيها كلمة المرور.");
    return;
  }

  try {
    const secondaryApp = getApps().find(a => a.name === "SecondaryAuthApp") || initializeApp(auth.app.options, "SecondaryAuthApp");
    const secondaryAuth = getAuth(secondaryApp);

    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = userCredential.user.uid;

    await signOut(secondaryAuth);

    await setDoc(doc(db, "admins", newUid), {
      name,
      email,
      role,
      active: true,
      createdAt: serverTimestamp(),
      lastLogin: null
    });

    await logAuditEvent("إضافة مشرف جديد", "المشرفين", `اسم المشرف: ${name} (${role}) - UID: ${newUid}`);
    alert(`✅ تم إنشاء حساب المشرف (${name}) في Firebase Auth و Firestore بالـ UID الحقيقي بنجاح!`);
    window.closeAddAdminModal();
    document.getElementById("addAdminForm")?.reset();
  } catch (err) {
    console.error("Error creating admin:", err);
    let msg = "❌ حدث خطأ أثناء إنشاء المشرف.";
    if (err.code === "auth/email-already-in-use") {
      msg = "❌ البريد الإلكتروني مستخدم بالفعل في Firebase Authentication.";
    } else if (err.code === "auth/weak-password") {
      msg = "❌ كلمة المرور ضعيفة (يجب أن تكون 6 خانات على الأقل).";
    } else if (err.code === "auth/invalid-email") {
      msg = "❌ صيغة البريد الإلكتروني غير صحيحة.";
    }
    alert(msg);
  }
};

window.toggleAdminStatus = async function (uid, currentActive) {
  try {
    await updateDoc(doc(db, "admins", uid), { active: !currentActive });
    await logAuditEvent("تعديل حالة مشرف", "المشرفين", `UID: ${uid} -> Active: ${!currentActive}`);
  } catch (err) {
    console.error("Error updating admin status:", err);
  }
};

window.deleteAdminDoc = async function (uid, name) {
  if (confirm(`هل أنت متأكد من حذف المشرف (${name}) نهائياً؟`)) {
    try {
      await deleteDoc(doc(db, "admins", uid));
      await logAuditEvent("حذف مشرف", "المشرفين", `تم حذف المشرف: ${name}`);
      alert("✅ تم حذف المشرف بنجاح.");
    } catch (err) {
      console.error("Error deleting admin:", err);
    }
  }
};

// ==========================================================================
// 5. المزامنة المباشرة للطلبات وحساب الستوك والعدادات
// ==========================================================================
function initOrdersListener() {
  const ref = collection(db, "orders");
  onSnapshot(ref, (snapshot) => {
    ordersData = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        reference: data.orderId || docSnap.id,
        name: data.customerName || data.name || "عميل",
        phone: data.phone || "",
        platform: data.platform || "PlayStation",
        totalQty: data.quantity !== undefined ? data.quantity : (data.totalQty || 0),
        totalPrice: data.price || data.totalPrice || "0 ر.س",
        status: data.status || "new",
        errorCode: data.errorCode || "none",
        email: data.email || "",
        pass: data.password || data.pass || "",
        backupCodes: data.backupCodes || ["12345678", "87654321", "11223344"],
        paymentMethod: data.paymentMethod || "تحويل بنكي",
        paymentDetails: data.paymentDetails || { bank: "مصرف الراجحي", name: data.customerName || "عميل", iban: "SA0380000000608010123456" },
        withdrawnQty: data.withdrawnQty !== undefined ? data.withdrawnQty : "",
        auditLogs: data.auditLogs || [{ action: "إنشاء الطلب", user: "النظام", time: new Date().toLocaleString() }],
        finishedAt: data.finishedAt || null,
        archived: data.archived || false,
        sensitiveDeleted: data.sensitiveDeleted || false,
        createdAt: data.createdAt || new Date().toISOString(),
        ...data
      };
    });
    calculateDynamicStock();
    updateDashboardStats();
    renderOrdersTables();
  }, (error) => console.error("Error listening to orders:", error));
}

function calculateDynamicStock() {
  let psStock = 0;
  let pcStock = 0;

  ordersData.forEach(o => {
    if (o.status === 'new' || o.status === 'review' || o.status === 'progress') {
      let total = Number(o.totalQty) || 0;
      let withdrawn = Number(o.withdrawnQty) || 0;
      let pending = Math.max(0, total - withdrawn);

      let plat = String(o.platform || "").toLowerCase();
      if (plat.includes('pc') || plat.includes('حاسب')) {
        pcStock += pending;
      } else {
        psStock += pending;
      }
    }
  });

  stockData.PlayStation = psStock;
  stockData.PC = pcStock;
}

function sortOrdersNewestFirst() {
  ordersData.sort((a, b) => {
    let timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    let timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return timeB - timeA;
  });
}

function formatCoinsNumber(num) {
  if (num === "" || num === null || isNaN(num)) return "0";
  return Number(num).toLocaleString('en-US');
}

function updateDashboardStats() {
  sortOrdersNewestFirst();
  let countNew = ordersData.filter(o => o.status === 'new').length;
  let countReview = ordersData.filter(o => o.status === 'review').length;
  let countProgress = ordersData.filter(o => o.status === 'progress').length;
  let countFinished = ordersData.filter(o => o.status === 'finished').length;

  const sbBadge = document.getElementById("sidebarNewOrdersBadge");
  if (sbBadge) {
    if (countNew > 0) {
      sbBadge.style.display = "inline-block";
      sbBadge.innerText = countNew;
    } else {
      sbBadge.style.display = "none";
    }
  }

  let transferNeededList = ordersData.filter(o => o.status === 'finished' || (Number(o.withdrawnQty) >= o.totalQty && o.totalQty > 0 && o.status !== 'transferred' && o.status !== 'completed'));

  const transferBadgeCount = document.getElementById("transferBadgeCount");
  const transferHeaderBadge = document.getElementById("transferHeaderBadge");
  if (transferBadgeCount) transferBadgeCount.innerText = transferNeededList.length;
  if (transferHeaderBadge) transferHeaderBadge.innerText = `${transferNeededList.length} طلبات بحاجة للتحويل`;

  const banner = document.getElementById("urgentTransferBanner");
  const bannerTransferText = document.getElementById("bannerTransferText");
  if (banner && bannerTransferText) {
    if (transferNeededList.length > 0) {
      banner.style.display = "flex";
      bannerTransferText.innerText = `لديك ${transferNeededList.length} طلبات منتهية تحتاج إلى التحويل المالي للعملاء خلال 3-5 أيام عمل من تاريخ الانتهاء.`;
    } else {
      banner.style.display = "none";
    }
  }

  let totalCompletedCoins = ordersData.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.totalQty || 0), 0);
  let totalTransferredMoney = ordersData.filter(o => o.status === 'completed' || o.status === 'transferred').reduce((sum, o) => {
    let p = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 0;
    return sum + p;
  }, 0);

  if (document.getElementById("statNewOrders")) document.getElementById("statNewOrders").innerText = countNew;
  if (document.getElementById("statReviewOrders")) document.getElementById("statReviewOrders").innerText = countReview;
  if (document.getElementById("statProgressOrders")) document.getElementById("statProgressOrders").innerText = countProgress;
  if (document.getElementById("statFinishedOrders")) document.getElementById("statFinishedOrders").innerText = countFinished;
  if (document.getElementById("statCompletedCoins")) document.getElementById("statCompletedCoins").innerText = formatCoinsNumber(totalCompletedCoins);
  if (document.getElementById("statTransferredMoney")) document.getElementById("statTransferredMoney").innerText = totalTransferredMoney.toLocaleString() + " ر.س";

  if (document.getElementById("stockPS")) document.getElementById("stockPS").innerText = formatCoinsNumber(stockData.PlayStation) + " كوينز";
  if (document.getElementById("stockPC")) document.getElementById("stockPC").innerText = formatCoinsNumber(stockData.PC) + " كوينز";

  renderTransferAlertsTable(transferNeededList);
}

// ==========================================================================
// 6. عداد التحويل المالي التنازلي
// ==========================================================================
function getTransferTimeRemaining(finishedAt) {
  if (!finishedAt) return `<span class="countdown-pill"><i class="fa-solid fa-clock"></i> بدأ العد من لحظة الانتهاء</span>`;
  const startDate = new Date(finishedAt);
  const deadlineDate = new Date(startDate.getTime() + (4 * 24 * 60 * 60 * 1000));
  const now = new Date();
  const diff = deadlineDate - now;

  if (diff <= 0) {
    return `<span class="countdown-pill urgent"><i class="fa-solid fa-fire"></i> انتهت المهلة! ينبغي التحويل فوراً</span>`;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `<span class="countdown-pill"><i class="fa-solid fa-clock"></i> متبقي: ${days} يوم و ${hours} ساعة</span>`;
}

function renderTransferAlertsTable(list) {
  const tbody = document.getElementById("transferAlertsTableBody");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات بحاجة للتحويل حالياً.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(order => {
    let actualIndex = ordersData.findIndex(o => o.id === order.id);
    let timeHtml = getTransferTimeRemaining(order.finishedAt);
    let pd = order.paymentDetails || {};
    let bankInfo = pd.bank || pd.wallet || order.paymentMethod || "تحويل بنكي";

    return `
      <tr>
        <td><code style="color:var(--primary);">${order.reference}</code></td>
        <td><b>${order.name}</b></td>
        <td style="direction:ltr; text-align:right;">${order.phone}</td>
        <td style="color:var(--primary); font-weight:900;">${order.totalPrice}</td>
        <td><b>${bankInfo}</b></td>
        <td>${timeHtml}</td>
        <td><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-money-bill-transfer"></i> إتمام التحويل</button></td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// 7. عرض جدول الطلبات الشامل والفلترة
// ==========================================================================
window.renderOrdersTables = function () {
  sortOrdersNewestFirst();
  const dashBody = document.getElementById("dashboardOrdersTableBody");
  const fullBody = document.getElementById("fullOrdersTableBody");
  const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";

  let filteredOrders = ordersData;
  if (statusFilter !== "all") {
    filteredOrders = ordersData.filter(o => o.status === statusFilter);
  }

  if (dashBody) {
    if (ordersData.length === 0) {
      dashBody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات حالياً.</td></tr>`;
    } else {
      let topRecent = ordersData.slice(0, 5);
      dashBody.innerHTML = topRecent.map(order => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        let withdrawn = Number(order.withdrawnQty) || 0;
        let remaining = Math.max(0, (order.totalQty || 0) - withdrawn);
        return `
          <tr>
            <td><code style="color:var(--primary);">${order.reference}</code></td>
            <td><b>${order.name}</b></td>
            <td>${order.platform}</td>
            <td><b>${formatCoinsNumber(order.totalQty)}</b></td>
            <td style="color:var(--primary);">${formatCoinsNumber(withdrawn)}</td>
            <td style="color:var(--warning);">${formatCoinsNumber(remaining)}</td>
            <td style="color:#38bdf8;">${order.totalPrice}</td>
            <td>${getStatusBadge(order.status)} ${getErrorBadge(order.errorCode)}</td>
            <td><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-eye"></i> التفاصيل</button></td>
          </tr>
        `;
      }).join('');
    }
  }

  if (fullBody) {
    if (filteredOrders.length === 0) {
      fullBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات مطابقة للفلتر المحدد.</td></tr>`;
    } else {
      fullBody.innerHTML = filteredOrders.map(order => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        let withdrawn = Number(order.withdrawnQty) || 0;
        let remaining = Math.max(0, (order.totalQty || 0) - withdrawn);
        return `
          <tr>
            <td><code style="color:var(--primary);">${order.reference}</code></td>
            <td><b>${order.name}</b></td>
            <td style="direction:ltr; text-align:right;">${order.phone}</td>
            <td>${order.platform}</td>
            <td><b>${formatCoinsNumber(order.totalQty)}</b></td>
            <td style="color:var(--primary);">${formatCoinsNumber(withdrawn)}</td>
            <td style="color:var(--warning);">${formatCoinsNumber(remaining)}</td>
            <td style="color:#38bdf8;">${order.totalPrice}</td>
            <td>${getStatusBadge(order.status)} ${getErrorBadge(order.errorCode)}</td>
            <td>
              <button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-pen-to-square"></i> التفاصيل</button>
              <button class="btn-action" style="color:var(--warning);" onclick="toggleArchive(${actualIndex})">${order.archived ? 'استرجاع' : 'أرشفة'}</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  updateDashboardStats();
  renderClientsList();
};

function getStatusBadge(status) {
  switch (status) {
    case 'new': return '<span class="badge badge-new">طلب جديد</span>';
    case 'review': return '<span class="badge badge-review">انتظار المراجعة</span>';
    case 'progress': return '<span class="badge badge-progress">قيد التنفيذ</span>';
    case 'finished': return '<span class="badge badge-finished">تم الانتهاء</span>';
    case 'transferred': return '<span class="badge badge-transferred">تم التحويل</span>';
    case 'completed': return '<span class="badge badge-completed">مكتمل</span>';
    case 'archived': return '<span class="badge badge-archived">مؤرشف</span>';
    default: return '<span class="badge badge-new">طلب جديد</span>';
  }
}

function getErrorBadge(code) {
  switch (code) {
    case 'err_pass': return '<span class="badge badge-error">❌ خطأ بالإيميل أو الباسورد</span>';
    case 'err_codes': return '<span class="badge badge-error">❌ الأكواد الاحتياطية خطأ</span>';
    case 'err_login': return '<span class="badge badge-error">❌ العميل مسجل دخول</span>';
    case 'err_market': return '<span class="badge badge-error">❌ سوق الانتقالات مغلق</span>';
    default: return '';
  }
}

// ==========================================================================
// 8. الثيم والألوان الرسمية للمنصات (PlayStation, Xbox, PC)
// ==========================================================================
function getPlatformTheme(platformName) {
  const plat = String(platformName || "").toLowerCase();
  if (plat.includes("playstation") || plat.includes("ps") || plat.includes("بلايستيشن") || plat.includes("سوني")) {
    return {
      bg: "linear-gradient(135deg, rgba(0, 67, 156, 0.3) 0%, rgba(0, 112, 209, 0.18) 100%)",
      border: "#0070D1",
      textColor: "#60A5FA",
      badgeBg: "rgba(0, 112, 209, 0.25)",
      icon: "fa-brands fa-playstation"
    };
  } else if (plat.includes("xbox") || plat.includes("إكس بوكس") || plat.includes("اكس بوكس")) {
    return {
      bg: "linear-gradient(135deg, rgba(16, 124, 16, 0.3) 0%, rgba(18, 146, 18, 0.18) 100%)",
      border: "#107C10",
      textColor: "#4ADE80",
      badgeBg: "rgba(16, 124, 16, 0.25)",
      icon: "fa-brands fa-xbox"
    };
  } else {
    return {
      bg: "linear-gradient(135deg, rgba(184, 46, 46, 0.3) 0%, rgba(232, 17, 35, 0.18) 100%)",
      border: "#E81123",
      textColor: "#F87171",
      badgeBg: "rgba(232, 17, 35, 0.25)",
      icon: "fa-solid fa-desktop"
    };
  }
}

// ==========================================================================
// 9. نافذة عرض الطلب والتفاصيل المعدلة كلياً V2.5
// ==========================================================================
window.openOrderModal = function (index) {
  const order = ordersData[index];
  const modal = document.getElementById("orderDetailModal");
  const body = document.getElementById("modalOrderBody");
  if (!modal || !body) return;

  const rawWithdrawn = order.withdrawnQty !== "" && order.withdrawnQty !== undefined ? Number(order.withdrawnQty) : 0;
  const remaining = Math.max(0, (order.totalQty || 0) - rawWithdrawn);
  const percent = order.totalQty > 0 ? Math.min(100, Math.round((rawWithdrawn / order.totalQty) * 100)) : 0;

  const isRevealed = revealedSensitiveOrders.has(order.id);
  const theme = getPlatformTheme(order.platform);

  // 1. شريط الأزرار العلوي (نسخ بيانات EA - ترحيل الطلب - إتلاف أمني في صف واحد)
  const actionsRowHtml = `
    <div style="display:flex; gap:10px; margin-bottom:16px; flex-wrap:nowrap; align-items:center;">
      <button class="btn-custom" style="flex:1; justify-content:center; background:rgba(56, 189, 248, 0.15); color:var(--blue); border:1.5px solid rgba(56, 189, 248, 0.4);" onclick="copyEaAccountData(${index})">
        <i class="fa-solid fa-copy"></i> نسخ كافة بيانات الحساب
      </button>
      <button class="btn-custom" style="flex:1; justify-content:center; background:rgba(245, 158, 11, 0.15); color:var(--warning); border:1.5px solid rgba(245, 158, 11, 0.4);" onclick="toggleArchive(${index}); openOrderModal(${index});">
        <i class="fa-solid fa-box-archive"></i> ${order.archived ? 'إلغاء الترحيل' : 'ترحيل الطلب'}
      </button>
      <button class="btn-custom" style="flex:1; justify-content:center; background:rgba(239, 68, 68, 0.15); color:var(--danger); border:1.5px solid rgba(239, 68, 68, 0.4);" onclick="destroySensitiveData(${index})">
        <i class="fa-solid fa-fire"></i> إتلاف البيانات الحساسة
      </button>
    </div>
  `;

  // 2. بطاقات هويّة المنصة والمعلومات (صف 1: رقم الطلب/اسم العميل/الجوال - صف 2: المنصة/الكمية/السعر)
  const platformHeaderCardHtml = `
    <div style="background:${theme.bg}; border:2px solid ${theme.border}; border-radius:18px; padding:16px; margin-bottom:16px; box-shadow:0 8px 25px rgba(0,0,0,0.25);">
      <!-- الصف الأول: رقم الطلب + اسم العميل + رقم الجوال -->
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.12); text-align:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">رقم الطلب</span>
          <code style="color:${theme.textColor}; font-size:1.05rem; font-weight:900;">#${order.reference}</code>
        </div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">اسم العميل</span>
          <b style="font-size:1rem; color:#fff;">${order.name}</b>
        </div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">رقم الجوال</span>
          <span style="direction:ltr; font-size:0.95rem; font-weight:900; color:${theme.textColor};">${order.phone}</span>
        </div>
      </div>

      <!-- الصف الثاني: المنصة + الكمية + السعر -->
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; text-align:center; align-items:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">المنصة المستهدفة</span>
          <span style="display:inline-flex; align-items:center; gap:6px; background:${theme.badgeBg}; color:${theme.textColor}; padding:4px 14px; border-radius:20px; font-weight:900; font-size:0.88rem; border:1px solid ${theme.border};">
            <i class="${theme.icon}"></i> ${order.platform}
          </span>
        </div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">الكمية الإجمالية</span>
          <b style="font-size:1.1rem; color:var(--primary); font-weight:900;">${formatCoinsNumber(order.totalQty)} كوينز</b>
        </div>
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">السعر الإجمالي</span>
          <b style="font-size:1.1rem; color:#38bdf8; font-weight:900;">${order.totalPrice}</b>
        </div>
      </div>
    </div>
  `;

  // 3. مربعات حالة عملية السحب الإحصائية (الكمية كم / المسحوب كم / المتبقي كم في صف واحد)
  const withdrawalStatsHtml = `
    <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-bottom:16px;">
      <div style="background:var(--input-bg); border:1.5px solid var(--card-border); padding:14px; border-radius:14px; text-align:center;">
        <span style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:4px;">الكمية المطلوبة</span>
        <h4 style="font-size:1.15rem; font-weight:900; color:var(--primary);">${formatCoinsNumber(order.totalQty)}</h4>
      </div>
      <div style="background:var(--input-bg); border:1.5px solid var(--card-border); padding:14px; border-radius:14px; text-align:center;">
        <span style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:4px;">الكمية المسحوبة</span>
        <h4 style="font-size:1.15rem; font-weight:900; color:#38bdf8;">${formatCoinsNumber(rawWithdrawn)}</h4>
      </div>
      <div style="background:var(--input-bg); border:1.5px solid var(--card-border); padding:14px; border-radius:14px; text-align:center;">
        <span style="font-size:0.78rem; color:var(--text-muted); display:block; margin-bottom:4px;">الكمية المتبقية</span>
        <h4 style="font-size:1.15rem; font-weight:900; color:var(--warning);">${formatCoinsNumber(remaining)}</h4>
      </div>
    </div>
  `;

  // 4. بيانات EA مرتبة بشكل واضح جداً (الإيميل -> تحته كلمة المرور -> تحته الأكواد)
  const emailVal = isRevealed ? order.email : "••••••••••••@gmail.com";
  const passVal = isRevealed ? order.pass : "••••••••••••";
  const codesList = order.backupCodes || [];

  let sensitiveSection = order.sensitiveDeleted ? `
    <div style="background:rgba(239, 68, 68, 0.15); border:1.5px solid var(--danger); color:var(--danger); padding:14px; border-radius:14px; text-align:center; font-weight:900; margin-bottom:16px;">
      🔒 تم إتلاف وحذف بيانات الحساب الحساسة أمنياً.
    </div>
  ` : `
    <div class="ea-sensitive-box" style="margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding-bottom:8px; border-bottom:1px solid var(--card-border);">
        <strong style="color:var(--blue); font-size:1rem; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-shield-halved"></i> بيانات حساب EA الخاصة بالعميل
        </strong>
        <button class="btn-action" style="color:var(--primary);" onclick="toggleRevealSensitive(${index})">
          <i class="fa-solid ${isRevealed ? 'fa-eye-slash' : 'fa-eye'}"></i> ${isRevealed ? 'إخفاء البيانات' : '👁 إظهار البيانات'}
        </button>
      </div>

      <!-- السطر الأول: البريد الإلكتروني -->
      <div style="background:var(--input-bg); padding:12px 14px; border-radius:12px; border:1px solid var(--card-border); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">البريد الإلكتروني (EA Email):</span>
          <code style="font-size:0.95rem; font-weight:800; color:#fff;">${emailVal}</code>
        </div>
        ${isRevealed ? `<button class="copy-btn" onclick="copySensitiveData('${order.email}', 'الإيميل', '${order.reference}')"><i class="fa-regular fa-copy"></i> نسخ البريد</button>` : ''}
      </div>

      <!-- السطر الثاني (تحته): كلمة المرور -->
      <div style="background:var(--input-bg); padding:12px 14px; border-radius:12px; border:1px solid var(--card-border); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">كلمة المرور (EA Password):</span>
          <code style="font-size:0.95rem; font-weight:800; color:var(--warning);">${passVal}</code>
        </div>
        ${isRevealed ? `<button class="copy-btn" onclick="copySensitiveData('${order.pass}', 'كلمة المرور', '${order.reference}')"><i class="fa-regular fa-copy"></i> نسخ كلمة المرور</button>` : ''}
      </div>

      <!-- السطر الثالث (تحته): الأكواد الاحتياطية -->
      <div style="background:var(--input-bg); padding:12px 14px; border-radius:12px; border:1px solid var(--card-border);">
        <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:8px;">الأكواد الاحتياطية (Backup Codes):</span>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap:8px;">
          ${codesList.map((code, cIdx) => `
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--card-border); padding:8px; border-radius:8px; text-align:center;">
              <span style="font-size:0.68rem; color:var(--text-muted); display:block;">كود ${cIdx + 1}</span>
              <strong style="color:var(--primary); font-size:0.92rem;">${isRevealed ? code : '••••••••'}</strong>
              ${isRevealed ? `<button class="copy-btn" style="margin-top:4px; font-size:0.68rem;" onclick="copySensitiveData('${code}', 'كود احتياطي', '${order.reference}')">نسخ</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // 5. تفاصيل الدفع والتحويل مع أزرار نسخ المحفظة/الآيبان المباشرة
  let pd = order.paymentDetails || {};
  let bankOrWallet = pd.bank || pd.wallet || order.paymentMethod || "تحويل بنكي";
  let beneficiaryName = pd.name || order.name || "العميل";
  let payoutAddress = pd.iban || pd.phone || pd.cryptoAddress || "غير مدخل";

  const payoutSectionHtml = `
    <div style="background:var(--input-bg); border:1.5px solid var(--card-border); border-radius:14px; padding:16px; margin-bottom:16px;">
      <strong style="font-size:0.92rem; color:var(--blue); display:flex; align-items:center; gap:8px; margin-bottom:12px;">
        <i class="fa-solid fa-wallet"></i> بيانات الحساب البنكي / المحفظة لاستلام المستحقات
      </strong>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:10px;">
        <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:10px; border:1px solid var(--card-border);">
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">وسيلة الدفع / البنك:</span>
          <b style="font-size:0.9rem; color:#fff;">${bankOrWallet}</b>
        </div>
        <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:10px; border:1px solid var(--card-border);">
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">اسم صاحب الحساب / المستفيد:</span>
          <b style="font-size:0.9rem; color:#fff;">${beneficiaryName}</b>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.02); padding:12px; border-radius:10px; border:1px solid var(--card-border); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">الآيبان / رقم الحساب / المحفظة:</span>
          <code style="color:var(--primary); font-size:1rem; font-weight:900;">${payoutAddress}</code>
        </div>
        <button class="copy-btn" style="padding:6px 14px; font-size:0.8rem;" onclick="copyPayoutInfo('${payoutAddress}', 'بيانات الدفع والتحويل', '${order.reference}')">
          <i class="fa-regular fa-copy"></i> نسخ رقم الحساب / الآيبان
        </button>
      </div>
    </div>
  `;

  // 6. أدوات تحديث حالة الطلب والكمية
  let progressColorClass = percent < 40 ? 'progress-danger' : (percent < 90 ? 'progress-warning' : 'progress-success');

  const controlsHtml = `
    <div class="progress-bar-wrapper">
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; font-weight:900;">
        <span>نسبة إنجاز عملية السحب:</span>
        <span style="color:var(--primary);">${formatCoinsNumber(rawWithdrawn)} / ${formatCoinsNumber(order.totalQty)} كوينز (${percent}%)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${progressColorClass}" style="width: ${percent}%;"></div>
      </div>
    </div>

    <div class="form-grid-2" style="margin-bottom:16px;">
      <div class="form-group">
        <label>تعديل الكمية المسحوبة (كوينز):</label>
        <input type="text" id="modalWithdrawnInput" class="form-control" value="${rawWithdrawn ? formatCoinsNumber(rawWithdrawn) : ''}" placeholder="أدخل الكمية المسحوبة..." oninput="calcRemaining(${index}, this)">
      </div>
      <div class="form-group">
        <label>الكمية المتبقية للسحب:</label>
        <input type="text" id="modalRemainingDisplay" class="form-control" value="${formatCoinsNumber(remaining)}" readonly style="color:var(--warning); background:rgba(0,0,0,0.2);">
      </div>
    </div>

    <div class="form-grid-2" style="margin-bottom:16px;">
      <div class="form-group">
        <label>حالة الطلب:</label>
        <select id="modalStatusSelect" class="form-control">
          <option value="new" ${order.status==='new'?'selected':''}>طلب جديد</option>
          <option value="review" ${order.status==='review'?'selected':''}>انتظار المراجعة</option>
          <option value="progress" ${order.status==='progress'?'selected':''}>قيد التنفيذ</option>
          <option value="finished" ${order.status==='finished'?'selected':''}>تم الانتهاء (تم السحب)</option>
          <option value="transferred" ${order.status==='transferred'?'selected':''}>تم التحويل المالي</option>
          <option value="completed" ${order.status==='completed'?'selected':''}>مكتمل نهائياً</option>
        </select>
      </div>
      <div class="form-group">
        <label>حالة الخطأ (إن وجد):</label>
        <select id="modalErrorSelect" class="form-control">
          <option value="none" ${order.errorCode==='none'?'selected':''}>سليم - لا توجد أخطاء</option>
          <option value="err_pass" ${order.errorCode==='err_pass'?'selected':''}>خطأ بالبريد أو كلمة المرور</option>
          <option value="err_codes" ${order.errorCode==='err_codes'?'selected':''}>خطأ بالأكواد الاحتياطية</option>
          <option value="err_login" ${order.errorCode==='err_login'?'selected':''}>العميل داخل اللعبة</option>
          <option value="err_market" ${order.errorCode==='err_market'?'selected':''}>سوق الانتقالات مغلق</option>
        </select>
      </div>
    </div>

    <div style="display:flex; gap:10px; margin-top:18px;">
      <button class="btn-custom" style="flex:1; justify-content:center; padding:12px;" onclick="saveOrderModalChanges(${index})">
        <i class="fa-solid fa-floppy-disk"></i> حفظ كافة التحديثات
      </button>
    </div>
  `;

  body.innerHTML = actionsRowHtml + platformHeaderCardHtml + withdrawalStatsHtml + sensitiveSection + payoutSectionHtml + controlsHtml;
  modal.classList.add("active");
};

// ==========================================================================
// 10. الدوال المساعدة للنسخ وإدارة الحسابات
// ==========================================================================
window.copyEaAccountData = async function (index) {
  const order = ordersData[index];
  if (!order) return;
  const codesStr = (order.backupCodes || []).join(' - ');
  const formattedText = `بيانات حساب EA للطلب #${order.reference}:
البريد الإلكتروني: ${order.email}
كلمة المرور: ${order.pass}
الأكواد الاحتياطية: ${codesStr}`;

  navigator.clipboard.writeText(formattedText);
  await logAuditEvent("نسخ بيانات EA الكاملة", order.reference, "تم نسخ الإيميل والباسورد والأكواد دفعة واحدة");
  alert("📋 تم نسخ كافة بيانات حساب EA (الإيميل، كلمة المرور، والأكواد الاحتياطية) إلى الحافظة بنجاح!");
};

window.copyPayoutInfo = async function (text, label, orderRef) {
  if (!text || text === "غير مدخل") return;
  navigator.clipboard.writeText(text);
  await logAuditEvent(`نسخ ${label}`, orderRef, `تم نسخ ${label}`);
  alert(`📋 تم نسخ ${label} (${text}) إلى الحافظة بنجاح!`);
};

window.toggleRevealSensitive = async function (index) {
  const order = ordersData[index];
  if (revealedSensitiveOrders.has(order.id)) {
    revealedSensitiveOrders.delete(order.id);
  } else {
    revealedSensitiveOrders.add(order.id);
    await logAuditEvent("إظهار بيانات EA الحساسة", order.reference, `تم إظهار بيانات الحساب بواسطة المشرف`);
  }
  window.openOrderModal(index);
};

window.copySensitiveData = async function (text, label, orderRef) {
  if (!text || text.includes("•••")) return;
  navigator.clipboard.writeText(text);
  await logAuditEvent(`نسخ ${label}`, orderRef, `تم نسخ ${label} إلى الحافظة`);
  alert(`📋 تم نسخ ${label} إلى الحافظة بنجاح.`);
};

window.calcRemaining = function (index, input) {
  let rawVal = input.value.replace(/,/g, '');
  let withdrawn = parseInt(rawVal) || 0;
  const total = ordersData[index].totalQty;
  if (withdrawn > total) withdrawn = total;

  input.value = withdrawn > 0 ? formatCoinsNumber(withdrawn) : '';
  const rem = Math.max(0, total - withdrawn);

  const remDisp = document.getElementById("modalRemainingDisplay");
  if (remDisp) remDisp.value = formatCoinsNumber(rem);
};

window.saveOrderModalChanges = async function (index) {
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

  if (withdrawnInput) {
    let rawVal = withdrawnInput.value.replace(/,/g, '');
    let newWithdrawn = rawVal !== "" ? parseInt(rawVal) || 0 : 0;
    updateData.withdrawnQty = newWithdrawn;
  }

  if (oldStatus !== newStatus) {
    if (newStatus === 'finished' && !order.finishedAt) {
      updateData.finishedAt = new Date().toISOString();
    }
    await logAuditEvent("تحديث حالة طلب", order.reference, `تغيير الحالة من (${oldStatus}) إلى (${newStatus})`);
  }

  try {
    const orderRef = doc(db, "orders", order.id);
    await updateDoc(orderRef, updateData);
    alert("✅ تم حفظ التحديثات وتسجيل الحركة بنجاح!");
    window.closeOrderModal();
  } catch (err) {
    console.error("Error updating order:", err);
    alert("❌ حدث خطأ أثناء التحديث.");
  }
};

window.closeOrderModal = function () {
  const modal = document.getElementById("orderDetailModal");
  if (modal) modal.classList.remove("active");
};

window.destroySensitiveData = async function (index) {
  let order = ordersData[index];
  if (confirm(`هل ترغب بإتلاف ومسح البيانات الحساسة للطلب (${order.reference}) أمنياً؟`)) {
    try {
      const orderRef = doc(db, "orders", order.id);
      await updateDoc(orderRef, {
        email: "[محذوف أمنياً]",
        pass: "[محذوف أمنياً]",
        backupCodes: ["[محذوف]", "[محذوف]", "[محذوف]"],
        sensitiveDeleted: true
      });
      await logAuditEvent("إتلاف بيانات حساسة", order.reference, "تم تدمير بيانات EA من قاعدة البيانات أمنياً");
      alert("🔒 تم إتلاف البيانات أمنياً بنجاح.");
      window.closeOrderModal();
    } catch (err) {
      console.error("Error destroying sensitive data:", err);
    }
  }
};

window.toggleArchive = async function (index) {
  let order = ordersData[index];
  try {
    const orderRef = doc(db, "orders", order.id);
    await updateDoc(orderRef, { archived: !order.archived });
    await logAuditEvent("تغيير أرشفة طلب", order.reference, `حالة الأرشفة: ${!order.archived}`);
  } catch (err) {
    console.error("Error archiving order:", err);
  }
};

// ==========================================================================
// 11. ملفات العملاء وسجل الحركات
// ==========================================================================
function renderClientsList(searchQuery = "") {
  const tbody = document.getElementById("clientsTableBody");
  if (!tbody) return;

  let clientsMap = {};
  ordersData.forEach(o => {
    let phoneKey = o.phone ? o.phone.trim() : "unknown";
    if (!clientsMap[phoneKey]) {
      clientsMap[phoneKey] = { name: o.name, phone: phoneKey, ordersCount: 0, totalCoins: 0, totalPaid: 0, lastOrder: o.createdAt };
    }
    clientsMap[phoneKey].ordersCount += 1;
    clientsMap[phoneKey].totalCoins += (o.totalQty || 0);
    let pVal = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 0;
    clientsMap[phoneKey].totalPaid += pVal;
  });

  let clientsArray = Object.values(clientsMap);
  if (searchQuery.trim() !== "") {
    let q = searchQuery.trim().toLowerCase();
    clientsArray = clientsArray.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }

  if (clientsArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد بيانات عملاء حالياً.</td></tr>`;
    return;
  }

  tbody.innerHTML = clientsArray.map(c => `
    <tr>
      <td><b>${c.name}</b></td>
      <td style="direction:ltr; text-align:right;">${c.phone}</td>
      <td><b>${c.ordersCount}</b></td>
      <td style="color:var(--primary);">${formatCoinsNumber(c.totalCoins)}</td>
      <td style="color:var(--blue);">${c.totalPaid.toLocaleString()} SAR</td>
      <td><span style="font-size:0.78rem; color:var(--text-muted);">${c.lastOrder?.toDate ? c.lastOrder.toDate().toLocaleDateString('en-GB') : 'مؤخراً'}</span></td>
      <td><button class="btn-action" onclick="openClientDetail('${c.phone}')"><i class="fa-solid fa-list"></i> عرض السجل</button></td>
    </tr>
  `).join('');
}

window.filterClients = function (query) {
  renderClientsList(query);
};

window.openClientDetail = function (phone) {
  let clientOrders = ordersData.filter(o => o.phone === phone);
  if (clientOrders.length === 0) return;
  const clientName = clientOrders[0].name;

  const titleEl = document.getElementById("clientModalTitle");
  const body = document.getElementById("clientModalBody");
  if (titleEl) titleEl.innerText = `سجل طلبات العميل: ${clientName} (${phone})`;

  if (body) {
    body.innerHTML = `
      <div class="table-responsive">
        <table>
          <thead>
            <tr><th>المرجع</th><th>المنصة</th><th>الكمية</th><th>السعر</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            ${clientOrders.map(o => `
              <tr>
                <td><code style="color:var(--primary);">${o.reference}</code></td>
                <td>${o.platform}</td>
                <td><b>${formatCoinsNumber(o.totalQty)}</b></td>
                <td>${o.totalPrice}</td>
                <td>${getStatusBadge(o.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const modal = document.getElementById("clientDetailModal");
  if (modal) modal.classList.add("active");
};

window.closeClientModal = function () {
  const modal = document.getElementById("clientDetailModal");
  if (modal) modal.classList.remove("active");
};

// ==========================================================================
// 12. إعدادات المنتجات والأسعار والبنوك والمحافظ العامة
// ==========================================================================
async function saveAllSettingsToFirestore() {
  try {
    const config = {
      storeOpen: isStoreOpen,
      psRate: Number(document.getElementById("psRate")?.value || pricingConfig.psRate),
      pcRate: Number(document.getElementById("pcRate")?.value || pricingConfig.pcRate),
      psMin: Number(String(document.getElementById("psMin")?.value || pricingConfig.psMin).replace(/,/g, "")),
      psMax: Number(String(document.getElementById("psMax")?.value || pricingConfig.psMax).replace(/,/g, "")),
      pcMin: Number(String(document.getElementById("pcMin")?.value || pricingConfig.pcMin).replace(/,/g, "")),
      pcMax: Number(String(document.getElementById("pcMax")?.value || pricingConfig.pcMax).replace(/,/g, "")),
      psWithdrawDuration: document.getElementById("psWithdrawDuration")?.value || pricingConfig.psWithdrawDuration,
      psTransferDuration: document.getElementById("psTransferDuration")?.value || pricingConfig.psTransferDuration,
      pcWithdrawDuration: document.getElementById("pcWithdrawDuration")?.value || pricingConfig.pcWithdrawDuration,
      pcTransferDuration: document.getElementById("pcTransferDuration")?.value || pricingConfig.pcTransferDuration,
      promoActive: document.getElementById("promoActiveSelect")?.value === "true",
      promoRate: Number(document.getElementById("promoRateInput")?.value || pricingConfig.promoRate),
      promoExpiry: document.getElementById("promoExpiryInput")?.value || "",
      promoText: document.getElementById("promoText")?.value || pricingConfig.promoText,
      banks: banksList,
      wallets: walletsList,
      customPayments: customPaymentsList,
      terms: storeTerms,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "system", "settings"), config);
    await logAuditEvent("حفظ إعدادات المنتجات والنظام", "الإعدادات", "تحديث منتجات السحب والمدد والبنوك");
  } catch (err) {
    console.error("Error saving settings:", err);
  }
}

function initSystemSettingsListener() {
  const settingsRef = doc(db, "system", "settings");
  onSnapshot(settingsRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      isStoreOpen = data.storeOpen !== undefined ? data.storeOpen : true;
      banksList = data.banks || banksList;
      walletsList = data.wallets || walletsList;
      customPaymentsList = data.customPayments || customPaymentsList;
      storeTerms = data.terms || storeTerms;

      pricingConfig = { ...pricingConfig, ...data };

      updateStoreStatusUI();
      renderBanks();
      renderWallets();
      renderCustomPayments();
      renderTerms();
      populatePricingUI();
    }
  });
}

function updateStoreStatusUI() {
  const btn = document.getElementById("storeStatusToggleBtn");
  const txt = document.getElementById("storeStatusText");
  if (!btn || !txt) return;

  if (isStoreOpen) {
    btn.className = "store-status-btn";
    txt.innerText = "المتجر مفتوح";
  } else {
    btn.className = "store-status-btn closed";
    txt.innerText = "المتجر مغلق";
  }
}

window.toggleStoreStatus = async function () {
  isStoreOpen = !isStoreOpen;
  updateStoreStatusUI();
  await saveAllSettingsToFirestore();
  alert(isStoreOpen ? "🟢 تم فتح المتجر بنجاح!" : "🔴 تم إغلاق المتجر.");
};

function populatePricingUI() {
  if (document.getElementById("psRate")) document.getElementById("psRate").value = pricingConfig.psRate;
  if (document.getElementById("pcRate")) document.getElementById("pcRate").value = pricingConfig.pcRate;
  if (document.getElementById("psMin")) document.getElementById("psMin").value = formatCoinsNumber(pricingConfig.psMin);
  if (document.getElementById("psMax")) document.getElementById("psMax").value = formatCoinsNumber(pricingConfig.psMax);
  if (document.getElementById("pcMin")) document.getElementById("pcMin").value = formatCoinsNumber(pricingConfig.pcMin);
  if (document.getElementById("pcMax")) document.getElementById("pcMax").value = formatCoinsNumber(pricingConfig.pcMax);

  if (document.getElementById("psWithdrawDuration")) document.getElementById("psWithdrawDuration").value = pricingConfig.psWithdrawDuration || "3 - 5 أيام عمل";
  if (document.getElementById("psTransferDuration")) document.getElementById("psTransferDuration").value = pricingConfig.psTransferDuration || "24 ساعة";
  if (document.getElementById("pcWithdrawDuration")) document.getElementById("pcWithdrawDuration").value = pricingConfig.pcWithdrawDuration || "2 - 4 أيام عمل";
  if (document.getElementById("pcTransferDuration")) document.getElementById("pcTransferDuration").value = pricingConfig.pcTransferDuration || "24 ساعة";

  if (document.getElementById("promoActiveSelect")) document.getElementById("promoActiveSelect").value = pricingConfig.promoActive ? "true" : "false";
  if (document.getElementById("promoRateInput")) document.getElementById("promoRateInput").value = pricingConfig.promoRate;
  if (document.getElementById("promoExpiryInput")) document.getElementById("promoExpiryInput").value = pricingConfig.promoExpiry || "";
  if (document.getElementById("promoText")) document.getElementById("promoText").value = pricingConfig.promoText;
}

window.saveProductsConfig = async function () {
  await saveAllSettingsToFirestore();
  alert("✨ تم حفظ منتجات السحب والمدد ومزامنتها بنجاح!");
};

window.savePricingConfig = async function () {
  await saveAllSettingsToFirestore();
  alert("✨ تم حفظ العروض الترويجية بنجاح!");
};

function renderBanks() {
  const c = document.getElementById("banksListContainer");
  if (!c) return;
  c.innerHTML = banksList.map((b, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span>${b}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteBank(${i})">حذف</button>
    </div>
  `).join('');
}

window.addBank = async function () {
  const input = document.getElementById("newBankInput");
  if (input && input.value.trim()) {
    banksList.push(input.value.trim());
    input.value = "";
    renderBanks();
    await saveAllSettingsToFirestore();
  }
};

window.deleteBank = async function (i) {
  banksList.splice(i, 1);
  renderBanks();
  await saveAllSettingsToFirestore();
};

function renderWallets() {
  const c = document.getElementById("walletsListContainer");
  if (!c) return;
  c.innerHTML = walletsList.map((w, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span>${w}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteWallet(${i})">حذف</button>
    </div>
  `).join('');
}

window.addWallet = async function () {
  const input = document.getElementById("newWalletInput");
  if (input && input.value.trim()) {
    walletsList.push(input.value.trim());
    input.value = "";
    renderWallets();
    await saveAllSettingsToFirestore();
  }
};

window.deleteWallet = async function (i) {
  walletsList.splice(i, 1);
  renderWallets();
  await saveAllSettingsToFirestore();
};

function renderCustomPayments() {
  const c = document.getElementById("customPayMethodsContainer");
  if (!c) return;
  c.innerHTML = customPaymentsList.map((p, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span>${p}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteCustomPayment(${i})">حذف</button>
    </div>
  `).join('');
}

window.addCustomPaymentMethod = async function () {
  const input = document.getElementById("newCustomPaymentInput");
  if (input && input.value.trim()) {
    customPaymentsList.push(input.value.trim());
    input.value = "";
    renderCustomPayments();
    await saveAllSettingsToFirestore();
  }
};

window.deleteCustomPayment = async function (i) {
  customPaymentsList.splice(i, 1);
  renderCustomPayments();
  await saveAllSettingsToFirestore();
};

function renderTerms() {
  const c = document.getElementById("termsListContainer");
  if (!c) return;
  c.innerHTML = storeTerms.map((t, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1px solid var(--card-border); padding:10px; border-radius:10px;">
      <span style="font-size:0.85rem;">${i + 1}. ${t}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteTerm(${i})">حذف</button>
    </div>
  `).join('');
}

window.addNewTerm = async function () {
  const input = document.getElementById("newTermInput");
  if (input && input.value.trim()) {
    storeTerms.push(input.value.trim());
    input.value = "";
    renderTerms();
    await saveAllSettingsToFirestore();
  }
};

window.deleteTerm = async function (i) {
  storeTerms.splice(i, 1);
  renderTerms();
  await saveAllSettingsToFirestore();
};

window.saveStatusMessages = function () {
  const messages = {
    new: document.getElementById("msgNew")?.value,
    review: document.getElementById("msgReview")?.value,
    progress: document.getElementById("msgProgress")?.value,
    finished: document.getElementById("msgFinished")?.value,
    transferred: document.getElementById("msgTransferred")?.value,
    completed: document.getElementById("msgCompleted")?.value
  };
  localStorage.setItem("sami_coins_status_messages", JSON.stringify(messages));
  alert("✨ تم حفظ رسائل حالات الطلب بنجاح!");
};

window.saveGeneralSettings = async function () {
  await saveAllSettingsToFirestore();
  alert("✅ تم حفظ إعدادات المتجر العامة بنجاح!");
};

// ==========================================================================
// 13. التنقل والتصفح والبحث الشامل
// ==========================================================================
function updateLiveDatetime() {
  const now = new Date();
  const el = document.getElementById("liveDatetime");
  if (el) el.innerText = `${now.toLocaleDateString('en-GB')} | ${now.toLocaleTimeString('en-GB', { hour12: false })}`;
}
setInterval(updateLiveDatetime, 1000);
updateLiveDatetime();

window.switchTab = function (tabId, element) {
  document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
  document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add("active");
  if (element) element.classList.add("active");

  const titleHead = document.getElementById("pageTitleHeading");
  const breadcrumbActive = document.getElementById("breadcrumbActive");
  if (titleHead && element) titleHead.innerText = element.innerText.trim();
  if (breadcrumbActive && element) breadcrumbActive.innerText = element.innerText.trim();

  if (window.innerWidth <= 992) {
    const sb = document.getElementById("sidebar");
    if (sb) sb.classList.remove("mobile-open");
  }
};

window.toggleSidebar = function () {
  const s = document.getElementById("sidebar");
  const m = document.getElementById("mainWrapper");
  if (!s || !m) return;
  if (window.innerWidth <= 992) s.classList.toggle("mobile-open");
  else {
    s.classList.toggle("collapsed");
    m.classList.toggle("full-width");
  }
};

window.toggleTheme = function () {
  document.body.classList.toggle("light-mode");
  const isLight = document.body.classList.contains("light-mode");
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) themeBtn.innerHTML = isLight ? '<i class="fa-regular fa-sun"></i>' : '<i class="fa-regular fa-moon"></i>';
};

window.handleGlobalSearch = function (query) {
  if (!query.trim()) {
    window.renderOrdersTables();
    return;
  }
  let q = query.trim().toLowerCase();
  let matched = ordersData.filter(o =>
    String(o.name).toLowerCase().includes(q) ||
    String(o.phone).includes(q) ||
    String(o.reference).toLowerCase().includes(q) ||
    String(o.id).includes(q)
  );

  const fullBody = document.getElementById("fullOrdersTableBody");
  if (!fullBody) return;

  if (matched.length === 0) {
    fullBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px;">لا توجد نتائج مطابقة لـ "${query}".</td></tr>`;
    return;
  }

  fullBody.innerHTML = matched.map(order => {
    let actualIndex = ordersData.findIndex(o => o.id === order.id);
    let withdrawn = Number(order.withdrawnQty) || 0;
    let remaining = Math.max(0, (order.totalQty || 0) - withdrawn);
    return `
      <tr>
        <td><code style="color:var(--primary);">${order.reference}</code></td>
        <td><b>${order.name}</b></td>
        <td style="direction:ltr; text-align:right;">${order.phone}</td>
        <td>${order.platform}</td>
        <td><b>${formatCoinsNumber(order.totalQty)}</b></td>
        <td style="color:var(--primary);">${formatCoinsNumber(withdrawn)}</td>
        <td style="color:var(--warning);">${formatCoinsNumber(remaining)}</td>
        <td style="color:#38bdf8;">${order.totalPrice}</td>
        <td>${getStatusBadge(order.status)}</td>
        <td><button class="btn-action" onclick="openOrderModal(${actualIndex})">التفاصيل</button></td>
      </tr>
    `;
  }).join('');
};

window.filterOrdersByStatus = function (status) {
  window.switchTab('ordersTab', document.querySelector('.sidebar-menu li:nth-child(2) a'));
  const statusFilter = document.getElementById("orderStatusFilter");
  if (statusFilter) statusFilter.value = status;
  renderOrdersTables();
};

// ==========================================================================
// 14. بدء التشغيل والاستماع الفوري
// ==========================================================================
initAuthGuard();
initSystemSettingsListener();
initOrdersListener();
initAdminsListener();
initAuditLogsListener();
