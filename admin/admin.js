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
// 1) استيراد دوال النظام بالكامل من system.js
// ==========================================================================
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
} from "./system.js";

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

let unsubscribeOrders = null;
let unsubscribeSettings = null;
let unsubscribeAdmins = null;
let unsubscribeAudit = null;

// ==========================================================================
// 2) حارس الأمان والتوثيق
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
  try {
    const alertEl = document.getElementById("loginErrorAlert");
    if (alertEl) alertEl.style.display = "none";
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    showLoginError("❌ فشل تسجيل الدخول بواسطة Google");
  }
};

function updateSidebarAdminUI() {
  const nameEl = document.getElementById("sidebarUserName");
  const roleEl = document.getElementById("sidebarUserRole");
  if (nameEl) nameEl.innerText = currentAdmin.name;
  if (roleEl) roleEl.innerText = currentAdmin.role === "owner" ? "Owner (مالك)" : "Admin (مشرف)";
}

window.handleLogout = async function () {
  if (confirm("هل ترغب بتسجيل الخروج؟")) {
    await logAuditEvent("تسجيل خروج", "النظام", `تم خروج: ${currentAdmin.email}`);
    if (auth) await signOut(auth);
    window.location.reload();
  }
};

// ==========================================================================
// 3) سجل الأمان والمستندات والطلبات
// ==========================================================================
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
  const tbody = document.getElementById("auditLogsTableBody");
  if (!tbody) return;
  tbody.innerHTML = auditLogsData.map(log => `
    <tr>
      <td><span style="font-size:0.78rem; color:var(--text-muted);">${log.timeString || '---'}</span></td>
      <td><b>${log.user || 'مشرف'}</b></td>
      <td><span class="badge badge-review">${log.action}</span></td>
      <td><code class="copyable-box" onclick="copyOrderRef('${log.targetOrder}')">#${log.targetOrder || 'عام'}</code></td>
      <td><span style="font-size:0.75rem; color:var(--text-muted);">${log.details || '---'}</span></td>
    </tr>
  `).join('');
}

function initAdminsListener() {
  return onSnapshot(collection(db, "admins"), (snapshot) => {
    adminsData = snapshot.docs.map(docSnap => ({ uid: docSnap.id, ...docSnap.data() }));
  });
}

function initOrdersListener() {
  const ref = collection(db, "orders");
  return onSnapshot(ref, (snapshot) => {
    ordersData = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        reference: data.orderId || docSnap.id,
        name: data.customerName || data.name || "عميل",
        phone: data.phone || "",
        platform: data.platform || "PlayStation",
        totalQty: Number(data.quantity || data.totalQty || 0),
        totalPrice: data.price || data.totalPrice || "0 ريال",
        status: data.status || "new",
        createdAt: data.createdAt || new Date().toISOString(),
        ...data
      };
    });

    renderDashboardQuickStats();
    renderStatisticsPage();
  });
}

function formatCoinsNumber(num) {
  if (num === "" || num === null || isNaN(num)) return "0";
  return Number(num).toLocaleString('en-US');
}

// ==========================================================================
// 4) الرئيسية المختصرة + صفحة الإحصائيات الشاملة
// ==========================================================================
function renderDashboardQuickStats() {
  const countNew = ordersData.filter(o => o.status === 'new').length;
  const countProgress = ordersData.filter(o => o.status === 'progress').length;
  const countFinished = ordersData.filter(o => o.status === 'completed' || o.status === 'finished').length;
  const countTransferPending = ordersData.filter(o => o.status === 'finished').length;

  if (document.getElementById("dashStatNew")) document.getElementById("dashStatNew").innerText = countNew;
  if (document.getElementById("dashStatProgress")) document.getElementById("dashStatProgress").innerText = countProgress;
  if (document.getElementById("dashStatCompleted")) document.getElementById("dashStatCompleted").innerText = countFinished;
  if (document.getElementById("dashStatPendingTransfer")) document.getElementById("dashStatPendingTransfer").innerText = countTransferPending;

  if (document.getElementById("dashStockPS")) document.getElementById("dashStockPS").innerText = formatCoinsNumber(currentSettingsData.psStock || 0) + " كوينز";
  if (document.getElementById("dashStockPC")) document.getElementById("dashStockPC").innerText = formatCoinsNumber(currentSettingsData.pcStock || 0) + " كوينز";
}

function renderStatisticsPage() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  let totalCoins = 0;
  let totalMoney = 0;
  let todayCoins = 0;
  let todayMoney = 0;

  const clientsSet = new Set();

  ordersData.forEach(o => {
    if (o.phone) clientsSet.add(o.phone);
    const pVal = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 0;

    if (o.status === 'completed' || o.status === 'finished' || o.status === 'transferred') {
      totalCoins += o.totalQty;
      totalMoney += pVal;

      const orderDateStr = new Date(o.createdAt).toISOString().split('T')[0];
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

// ==========================================================================
// 5) صفحة المخزون المخصصة والتعديل اليدوي
// ==========================================================================
function renderInventoryUI(settings) {
  if (document.getElementById("invStockPS")) document.getElementById("invStockPS").innerText = formatCoinsNumber(settings.psStock || 0);
  if (document.getElementById("invStockPC")) document.getElementById("invStockPC").innerText = formatCoinsNumber(settings.pcStock || 0);
  if (document.getElementById("invLastUpdate")) document.getElementById("invLastUpdate").innerText = settings.lastStockUpdate || "لم يحدد بعد";

  const logsTbody = document.getElementById("stockLogsTableBody");
  if (logsTbody && settings.stockLogs) {
    if (settings.stockLogs.length === 0) {
      logsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:15px; color:var(--text-muted);">لا توجد تعديلات مسجلة على المخزون.</td></tr>`;
    } else {
      logsTbody.innerHTML = settings.stockLogs.map(log => `
        <tr>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${log.timestamp}</span></td>
          <td><b>${log.admin}</b></td>
          <td style="color:var(--primary);">${formatCoinsNumber(log.newPs)} (السابق: ${formatCoinsNumber(log.oldPs)})</td>
          <td style="color:#38bdf8;">${formatCoinsNumber(log.newPc)} (السابق: ${formatCoinsNumber(log.oldPc)})</td>
          <td><span style="font-size:0.8rem;">${log.reason}</span></td>
        </tr>
      `).join('');
    }
  }
}

window.handleSaveManualStock = async function () {
  const newPs = document.getElementById("inputManualStockPS")?.value;
  const newPc = document.getElementById("inputManualStockPC")?.value;
  const reason = document.getElementById("inputStockReason")?.value || "تعديل يدوي";

  if (newPs === "" || newPc === "") {
    alert("يرجى إدخال قيم المخزون للـ PS والـ PC.");
    return;
  }

  await updateStock(newPs, newPc, currentAdmin.name, reason);
  await logAuditEvent("تعديل المخزون يدويًا", "المخزون", `PS: ${newPs} | PC: ${newPc} | السبب: ${reason}`);
  alert("✅ تم تحديث المخزون وسجل التعديلات بنجاح!");
};

// ==========================================================================
// 6) المزامنة المباشرة مع system.js للأسعار والبنوك والواجهات
// ==========================================================================
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
  // بيانات PlayStation / Xbox
  if (document.getElementById("psRate")) document.getElementById("psRate").value = config.psRate || 200;
  if (document.getElementById("psMin")) document.getElementById("psMin").value = formatCoinsNumber(config.psMin || 100000);
  if (document.getElementById("psMax")) document.getElementById("psMax").value = formatCoinsNumber(config.psMax || 5000000);
  if (document.getElementById("psWithdrawDuration")) document.getElementById("psWithdrawDuration").value = config.psWithdrawDuration || "3 - 5 أيام عمل";
  if (document.getElementById("psTransferDuration")) document.getElementById("psTransferDuration").value = config.psTransferDuration || "24 ساعة";

  // بيانات PC
  if (document.getElementById("pcRate")) document.getElementById("pcRate").value = config.pcRate || 150;
  if (document.getElementById("pcMin")) document.getElementById("pcMin").value = formatCoinsNumber(config.pcMin || 100000);
  if (document.getElementById("pcMax")) document.getElementById("pcMax").value = formatCoinsNumber(config.pcMax || 1000000);
  if (document.getElementById("pcWithdrawDuration")) document.getElementById("pcWithdrawDuration").value = config.pcWithdrawDuration || "2 - 4 أيام عمل";
  if (document.getElementById("pcTransferDuration")) document.getElementById("pcTransferDuration").value = config.pcTransferDuration || "24 ساعة";

  // إعدادات المتجر العامة
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
  await logAuditEvent("حفظ إعدادات الأسعار المنفصلة", "الإعدادات", "تحديث أسعار ومدد PS و PC بنجاح");
  alert("✅ تم حفظ إعدادات الأسعار والمنصات بنجاح!");
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
  }
};

window.deleteBank = async function (i) {
  await systemDeleteBank(i);
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
  }
};

window.deleteWallet = async function (i) {
  await systemDeleteWallet(i);
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
  }
};

window.deleteCustomPayment = async function (i) {
  await systemDeletePaymentMethod(i);
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
  }
};

window.deleteTerm = async function (i) {
  await systemDeleteTerm(i);
};

// ==========================================================================
// 7) التنقل والبدء
// ==========================================================================
window.switchTab = function (tabId, element) {
  document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
  document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add("active");
  if (element) element.classList.add("active");
};

initAuthGuard();
