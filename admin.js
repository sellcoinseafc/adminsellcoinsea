import { db, auth } from "./firebase.js";
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

// ==========================================================================
// 1) استيراد دوال النظام مع استخدام Aliases لمنع تعارض الأسماء
// ==========================================================================
import {
  subscribeToSettings,
  savePricing,
  addBank as systemAddBank,
  deleteBank as systemDeleteBank,
  addWallet as systemAddWallet,
  deleteWallet as systemDeleteWallet,
  addPaymentMethod as systemAddPaymentMethod,
  deletePaymentMethod as systemDeletePaymentMethod,
  addTerm as systemAddTerm,
  deleteTerm as systemDeleteTerm,
  toggleStore
} from "./system.js";

// ==========================================================================
// 2) قائمة الإيميلات المصرح لها بدخول لوحة التحكم
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

const DEFAULT_STATUS_MESSAGES = {
  new: "مرحباً {name} 👋، تم استلام طلبك رقم #{ref} بنجاح، وسنبدأ بمراجعته والتنفيذ قريباً.",
  review: "مرحباً {name} 👋، طلبك رقم #{ref} حالياً في مرحلة المراجعة والتحقق من بيانات الحساب.",
  progress: "مرحباً {name} 👋، تم البدء بتنفيذ طلبك رقم #{ref} (سحب الكوينز). يُرجى عدم دخول الحساب حالياً لضمان سلامة العملية.",
  finished: "مرحباً {name} 👋، أبشرك! تم الانتهاء من سحب الكوينز لطلبك رقم #{ref} بنجاح 🎉. يرجى تزويدنا برقم الحساب/الآيبان للتحويل.",
  transferred: "مرحباً {name} 👋، تم تحويل المبلغ المستحق لطلبك رقم #{ref} إلى حسابك البنكي/المحفظة بنجاح 💵.",
  completed: "مرحباً {name} 👋، تم إكمال طلبك رقم #{ref} بالكامل. شكراً لثقتك بنا ونتطلع لخدمتك مجدداً! ❤️"
};

let ordersData = [];
let adminsData = [];
let auditLogsData = [];
let stockData = { PlayStation: 0, PC: 0 };
let revealedSensitiveOrders = new Set();

let unsubscribeOrders = null;
let unsubscribeSettings = null;
let unsubscribeAdmins = null;
let unsubscribeAudit = null;

// ==========================================================================
// 3) حارس الأمان والتوثيق
// ==========================================================================
function startAllListeners() {
  if (!unsubscribeOrders) unsubscribeOrders = initOrdersListener();
  if (!unsubscribeSettings) unsubscribeSettings = initSystemSettingsListener();
  if (!unsubscribeAdmins) unsubscribeAdmins = initAdminsListener();
  if (!unsubscribeAudit) unsubscribeAudit = initAuditLogsListener();
}

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
      if (!ALLOWED_EMAILS.includes(user.email)) {
        await signOut(auth);
        alert("غير مصرح لك بدخول لوحة التحكم");
        if (loginOverlay) loginOverlay.classList.add("active");
        return;
      }

      try {
        const adminRef = doc(db, "admins", user.uid);
        const adminSnap = await getDoc(adminRef);

        if (!adminSnap.exists()) {
          alert("هذا الحساب غير مصرح له بدخول لوحة التحكم");
          await signOut(auth);
          if (loginOverlay) loginOverlay.classList.add("active");
          return;
        }

        const data = adminSnap.data();

        if (data.active === false) {
          alert("هذا الحساب معطل من قبل مالك النظام");
          await signOut(auth);
          if (loginOverlay) loginOverlay.classList.add("active");
          return;
        }

        currentAdmin = { uid: user.uid, ...data };

        await updateDoc(adminRef, { lastLogin: serverTimestamp() });

        if (loginOverlay) loginOverlay.classList.remove("active");
        updateSidebarAdminUI();
        applyRolePermissions();
        startAllListeners();

        await logAuditEvent("تسجيل دخول المشرف", "النظام", `تم الدخول بواسطة: ${currentAdmin.email}`);

      } catch (err) {
        console.error("Auth Guard Error:", err);
        showLoginError("⚠️ خطأ في التحقق من صلاحيات الحساب: " + err.message);
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
  try {
    const alertEl = document.getElementById("loginErrorAlert");
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
    showLoginError("❌ فشل تسجيل الدخول بواسطة Google");
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
// 4) سجل الأمان والمشرفين والطلبات
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
  return onSnapshot(q, (snapshot) => {
    auditLogsData = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderAuditLogsTable();
  });
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
      <td><code class="copyable-box" style="color:var(--primary); cursor:pointer;" onclick="copyOrderRef('${log.targetOrder}')">#${log.targetOrder || 'عام'}</code></td>
      <td><span style="font-size:0.75rem; color:var(--text-muted);">${log.details || '---'}</span></td>
    </tr>
  `).join('');
}

function initAdminsListener() {
  return onSnapshot(collection(db, "admins"), (snapshot) => {
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
            <button class="btn-action" style="color:var(--warning);" onclick="toggleAdminStatus('${admin.uid}',${admin.active})">
              ${admin.active !== false ? 'تعطيل' : 'تفعيل'}
            </button>
            <button class="btn-action" style="color:var(--danger);" onclick="deleteAdminDoc('${admin.uid}', '${admin.name}')">حذف</button>
          ` : '<span style="font-size:0.75rem; color:var(--text-muted);">المالك الرئيسي</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

function initOrdersListener() {
  const ref = collection(db, "orders");
  return onSnapshot(ref, (snapshot) => {
    ordersData = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      let formattedPrice = data.price || data.totalPrice || "0 ريال";
      formattedPrice = String(formattedPrice).replace(/ر\.س|ريال سعودي|SAR/g, "ريال").trim();

      return {
        id: docSnap.id,
        reference: data.orderId || docSnap.id,
        name: data.customerName || data.name || "عميل",
        phone: data.phone || "",
        platform: data.platform || "PlayStation",
        totalQty: data.quantity !== undefined ? data.quantity : (data.totalQty || 0),
        totalPrice: formattedPrice,
        status: data.status || "new",
        errorCode: data.errorCode || "none",
        email: data.email || "",
        pass: data.password || data.pass || "",
        backupCodes: data.backupCodes || ["12345678", "87654321", "11223344"],
        paymentMethod: data.paymentMethod || "تحويل بنكي",
        paymentDetails: data.paymentDetails || { bank: "مصرف الراجحي", name: data.customerName || "عميل", iban: "SA0380000000608010123456" },
        withdrawnQty: data.withdrawnQty !== undefined ? data.withdrawnQty : "",
        finishedAt: data.finishedAt || null,
        createdAt: data.createdAt || new Date().toISOString(),
        ...data
      };
    });
    renderOrdersTables();
  });
}

function formatCoinsNumber(num) {
  if (num === "" || num === null || isNaN(num)) return "0";
  return Number(num).toLocaleString('en-US');
}

window.renderOrdersTables = function () {
  const dashBody = document.getElementById("dashboardOrdersTableBody");
  const fullBody = document.getElementById("fullOrdersTableBody");
  const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";

  let filteredOrders = ordersData;
  if (statusFilter !== "all") {
    filteredOrders = ordersData.filter(o => o.status === statusFilter);
  }

  if (dashBody) {
    if (ordersData.length === 0) {
      dashBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات حالياً.</td></tr>`;
    } else {
      let topRecent = ordersData.slice(0, 5);
      dashBody.innerHTML = topRecent.map(order => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        return `
          <tr>
            <td><code class="copyable-box" style="color:var(--primary); cursor:pointer;" onclick="copyOrderRef('${order.reference}')">#${order.reference}</code></td>
            <td><b>${order.reference}</b></td>
            <td><b>${order.name}</b></td>
            <td>${order.platform}</td>
            <td><b>${formatCoinsNumber(order.totalQty)}</b></td>
            <td style="color:#38bdf8;">${order.totalPrice}</td>
            <td>${getStatusBadge(order.status)}</td>
            <td><button class="btn-action" onclick="openOrderModal(${actualIndex})">التفاصيل</button></td>
          </tr>
        `;
      }).join('');
    }
  }

  if (fullBody) {
    if (filteredOrders.length === 0) {
      fullBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات مطابقة.</td></tr>`;
    } else {
      fullBody.innerHTML = filteredOrders.map(order => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        return `
          <tr>
            <td><code class="copyable-box" style="color:var(--primary); cursor:pointer;" onclick="copyOrderRef('${order.reference}')">#${order.reference}</code></td>
            <td><b>${order.reference}</b></td>
            <td><b>${order.name}</b></td>
            <td>${order.platform}</td>
            <td><b>${formatCoinsNumber(order.totalQty)}</b></td>
            <td style="color:#38bdf8;">${order.totalPrice}</td>
            <td>${getStatusBadge(order.status)}</td>
            <td><button class="btn-action" onclick="openOrderModal(${actualIndex})">التفاصيل</button></td>
          </tr>
        `;
      }).join('');
    }
  }
};

function getStatusBadge(status) {
  switch (status) {
    case 'new': return '<span class="badge badge-new">طلب جديد</span>';
    case 'review': return '<span class="badge badge-review">انتظار المراجعة</span>';
    case 'progress': return '<span class="badge badge-progress">قيد التنفيذ</span>';
    case 'finished': return '<span class="badge badge-finished">تم الانتهاء</span>';
    case 'transferred': return '<span class="badge badge-transferred">تم التحويل</span>';
    case 'completed': return '<span class="badge badge-completed">مكتمل</span>';
    default: return '<span class="badge badge-new">طلب جديد</span>';
  }
}

// ==========================================================================
// 5) المزامنة المباشرة مع system.js لقراءة وتحديث الإعدادات
// ==========================================================================

function initSystemSettingsListener() {
  return subscribeToSettings((settings) => {
    updateStoreStatusUI(settings.storeOpen !== false);
    populatePricingUI(settings);
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

  if (isOpen) {
    btn.className = "store-status-btn";
    txt.innerText = "المتجر مفتوح";
  } else {
    btn.className = "store-status-btn closed";
    txt.innerText = "المتجر مغلق";
  }
}

window.toggleStoreStatus = async function () {
  const newStatus = await toggleStore();
  await logAuditEvent("تغيير حالة المتجر", "المتجر", `الحالة الجديدة: ${newStatus ? 'مفتوح' : 'مغلق'}`);
};

function populatePricingUI(config = {}) {
  if (document.getElementById("psRate")) document.getElementById("psRate").value = config.psRate || 200;
  if (document.getElementById("pcRate")) document.getElementById("pcRate").value = config.pcRate || 100;
  if (document.getElementById("psMin")) document.getElementById("psMin").value = formatCoinsNumber(config.minLimit || 100000);
  if (document.getElementById("psMax")) document.getElementById("psMax").value = formatCoinsNumber(config.maxLimit || 5000000);

  if (document.getElementById("psWithdrawDuration")) document.getElementById("psWithdrawDuration").value = config.withdrawalDuration || "3 - 5 أيام عمل";
  if (document.getElementById("psTransferDuration")) document.getElementById("psTransferDuration").value = config.transferDuration || "24 ساعة";

  if (document.getElementById("promoActiveSelect")) document.getElementById("promoActiveSelect").value = config.offers ? "true" : "false";
  if (document.getElementById("promoText")) document.getElementById("promoText").value = config.offerText || "";
}

window.saveProductsConfig = async function () {
  const pricingData = {
    psRate: Number(document.getElementById("psRate")?.value || 200),
    pcRate: Number(document.getElementById("pcRate")?.value || 100),
    minLimit: Number(String(document.getElementById("psMin")?.value || "100000").replace(/,/g, "")),
    maxLimit: Number(String(document.getElementById("psMax")?.value || "5000000").replace(/,/g, "")),
    withdrawalDuration: document.getElementById("psWithdrawDuration")?.value || "3 - 5 أيام عمل",
    transferDuration: document.getElementById("psTransferDuration")?.value || "24 ساعة",
    offers: document.getElementById("promoActiveSelect")?.value === "true",
    offerText: document.getElementById("promoText")?.value || ""
  };

  await savePricing(pricingData);
  await logAuditEvent("حفظ إعدادات المنتجات والأسعار", "الإعدادات", "تحديث الأسعار والمدد والعروض عبر system.js");
  alert("✅ تم حفظ إعدادات الأسعار والمنتجات بنجاح!");
};

window.savePricingConfig = async function () {
  await window.saveProductsConfig();
};

function renderBanks(banksArray = []) {
  const c = document.getElementById("banksListContainer");
  if (!c) return;
  c.innerHTML = banksArray.map((b, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span style="font-size:0.88rem; font-weight:800;">${i + 1}. ${b}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteBank(${i})">حذف</button>
    </div>
  `).join('');
}

window.addBank = async function () {
  const input = document.getElementById("newBankInput");
  if (input && input.value.trim()) {
    await systemAddBank(input.value.trim());
    input.value = "";
    await logAuditEvent("إضافة بنك", "البنوك", "تمت إضافة بنك جديد عبر system.js");
  }
};

window.deleteBank = async function (i) {
  await systemDeleteBank(i);
  await logAuditEvent("حذف بنك", "البنوك", "تم حذف بنك عبر system.js");
};

function renderWallets(walletsArray = []) {
  const c = document.getElementById("walletsListContainer");
  if (!c) return;
  c.innerHTML = walletsArray.map((w, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span style="font-size:0.88rem; font-weight:800;">${i + 1}. ${w}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteWallet(${i})">حذف</button>
    </div>
  `).join('');
}

window.addWallet = async function () {
  const input = document.getElementById("newWalletInput");
  if (input && input.value.trim()) {
    await systemAddWallet(input.value.trim());
    input.value = "";
    await logAuditEvent("إضافة محفظة", "المحافظ", "تمت إضافة محفظة عبر system.js");
  }
};

window.deleteWallet = async function (i) {
  await systemDeleteWallet(i);
  await logAuditEvent("حذف محفظة", "المحافظ", "تم حذف محفظة عبر system.js");
};

function renderCustomPayments(methodsArray = []) {
  const c = document.getElementById("customPayMethodsContainer");
  if (!c) return;
  c.innerHTML = methodsArray.map((p, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1px solid var(--card-border); padding:8px 12px; border-radius:10px;">
      <span style="font-size:0.88rem; font-weight:800;">${i + 1}. ${p}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteCustomPayment(${i})">حذف</button>
    </div>
  `).join('');
}

window.addCustomPaymentMethod = async function () {
  const input = document.getElementById("newCustomPaymentInput");
  if (input && input.value.trim()) {
    await systemAddPaymentMethod(input.value.trim());
    input.value = "";
    await logAuditEvent("إضافة طريقة دفع", "طرق الدفع", "تمت إضافة طريقة دفع عبر system.js");
  }
};

window.deleteCustomPayment = async function (i) {
  await systemDeletePaymentMethod(i);
  await logAuditEvent("حذف طريقة دفع", "طرق الدفع", "تم حذف طريقة دفع عبر system.js");
};

function renderTerms(termsArray = []) {
  const c = document.getElementById("termsListContainer");
  if (!c) return;
  c.innerHTML = termsArray.map((t, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1px solid var(--card-border); padding:10px; border-radius:10px;">
      <span style="font-size:0.85rem;">${i + 1}. ${t}</span>
      <button class="btn-action" style="color:var(--danger);" onclick="deleteTerm(${i})">حذف</button>
    </div>
  `).join('');
}

window.addNewTerm = async function () {
  const input = document.getElementById("newTermInput");
  if (input && input.value.trim()) {
    await systemAddTerm(input.value.trim());
    input.value = "";
    await logAuditEvent("إضافة شرط", "الشروط والأحكام", "تمت إضافة شرط جديد عبر system.js");
  }
};

window.deleteTerm = async function (i) {
  await systemDeleteTerm(i);
  await logAuditEvent("حذف شرط", "الشروط والأحكام", "تم حذف شرط عبر system.js");
};

// ==========================================================================
// 6) التنقل والتصفح والبدء
// ==========================================================================
window.switchTab = function (tabId, element) {
  document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
  document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add("active");
  if (element) element.classList.add("active");
};

initAuthGuard();
