import { db, auth } from "./firebase.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

// ==========================================
// 0. التحكم بالواجهة والقائمة الجانبية للجوال
// ==========================================
window.toggleSidebar = function(forceState) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (!sidebar || !overlay) return;

    if (typeof forceState === "boolean") {
        if (forceState) {
            sidebar.classList.add("mobile-open");
            overlay.classList.add("active");
        } else {
            sidebar.classList.remove("mobile-open");
            overlay.classList.remove("active");
        }
    } else {
        sidebar.classList.toggle("mobile-open");
        overlay.classList.toggle("active");
    }
};

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

    // إغلاق القائمة التلقائي في الجوال عند اختيار قسم
    window.toggleSidebar(false);
};

// ==========================================
// 1. نظام حماية وتسجيل الدخول (Firebase Auth)
// ==========================================
const googleProvider = new GoogleAuthProvider();

onAuthStateChanged(auth, (user) => {
  const loginScreen = document.getElementById("loginScreen");
  const adminAppWrapper = document.getElementById("adminAppWrapper");

  if (user) {
    if (loginScreen) loginScreen.style.display = "none";
    if (adminAppWrapper) adminAppWrapper.style.display = "block";

    const sidebarName = document.getElementById("sidebarUserName");
    const sidebarAvatar = document.getElementById("sidebarUserAvatar");
    if (sidebarName) sidebarName.innerText = user.displayName || user.email.split('@')[0];
    if (sidebarAvatar) sidebarAvatar.innerText = (user.displayName || user.email)[0].toUpperCase();

    initSystemSettingsListener();
    initOrdersListener();
  } else {
    if (loginScreen) loginScreen.style.display = "flex";
    if (adminAppWrapper) adminAppWrapper.style.display = "none";
  }
});

document.getElementById("btnGoogleLogin")?.addEventListener("click", async () => {
  const errorMsg = document.getElementById("loginErrorMsg");
  if (errorMsg) errorMsg.style.display = "none";
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Google Login Error:", error);
    if (errorMsg) {
      errorMsg.innerText = "فشل تسجيل الدخول عبر Google: " + (error.message || "حدث خطأ غير متوقع");
      errorMsg.style.display = "block";
    }
  }
});

document.getElementById("emailLoginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById("loginErrorMsg");
  if (errorMsg) errorMsg.style.display = "none";

  const email = document.getElementById("loginEmail")?.value.trim();
  const password = document.getElementById("loginPassword")?.value.trim();

  if (!email || !password) return;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error("Email Login Error:", error);
    if (errorMsg) {
      errorMsg.innerText = "خطأ في بيانات الدخول: البريد أو كلمة المرور غير صحيحة.";
      errorMsg.style.display = "block";
    }
  }
});

document.getElementById("btnLogout")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout Error:", error);
  }
});

// ==========================================
// 2. معالجات الجداول للتوافق مع الجوال (data-label)
// ==========================================
function renderOrdersTables() {
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
                        <td data-label="المرجع"><code style="color:var(--primary);">${order.reference}</code></td>
                        <td data-label="رقم الطلب">#${order.id}</td>
                        <td data-label="اسم العميل"><b>${order.name}</b></td>
                        <td data-label="المنصة">${order.platform}</td>
                        <td data-label="الكمية"><b>${formatCoinsNumber(order.totalQty)}</b></td>
                        <td data-label="السعر" style="color:var(--primary);">${order.totalPrice}</td>
                        <td data-label="الحالة"><div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">${statusBadge} ${errorBadge}</div></td>
                        <td data-label="الإجراء"><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-eye"></i> التفاصيل</button></td>
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
                        <td data-label="المرجع"><code style="color:var(--primary);">${order.reference}</code></td>
                        <td data-label="رقم الطلب">#${order.id}</td>
                        <td data-label="اسم العميل"><b>${order.name}</b></td>
                        <td data-label="المنصة">${order.platform}</td>
                        <td data-label="الكمية"><b>${formatCoinsNumber(order.totalQty)}</b></td>
                        <td data-label="السعر" style="color:var(--primary);">${order.totalPrice}</td>
                        <td data-label="الحالة والأخطاء"><div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${statusBadge} ${errorBadge}</div></td>
                        <td data-label="الإجراءات">
                            <button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-pen-to-square"></i> التفاصيل</button>
                            <button class="btn-action" style="color:#f59e0b;" onclick="toggleArchive(${actualIndex})">${order.archived ? 'استرجاع' : 'أرشفة'}</button>
                        </td>
                    </tr>
                `;
            });
        }
    }

    updateDashboardStats();
    renderClientsList();
}

function renderTransferAlertsTable(list) {
    const tbody = document.getElementById("transferAlertsTableBody");
    if(!tbody) return;
    if(list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد طلبات بحاجة للتحويل حالياً.</td></tr>`;
        return;
    }
    tbody.innerHTML = "";
    list.forEach((order) => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        let finishDateStr = order.finishedAt ? new Date(order.finishedAt).toLocaleDateString('en-GB') : 'عند الانتهاء';
        tbody.innerHTML += `
            <tr>
                <td data-label="المرجع"><code style="color:var(--primary);">${order.reference}</code></td>
                <td data-label="رقم الطلب">#${order.id}</td>
                <td data-label="اسم العميل"><b>${order.name}</b></td>
                <td data-label="رقم الجوال" style="direction:ltr; text-align:right;">${order.phone}</td>
                <td data-label="المبلغ المستحق" style="color:var(--primary);">${order.totalPrice}</td>
                <td data-label="المدة المتبقية"><span class="badge badge-review"><i class="fa-solid fa-clock"></i> بدأ العد من: ${finishDateStr}</span></td>
                <td data-label="الإجراء"><button class="btn-action" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-money-bill-transfer"></i> إتمام التحويل</button></td>
            </tr>
        `;
    });
}

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
                <td data-label="اسم العميل"><b>${client.name}</b></td>
                <td data-label="رقم الجوال" style="direction:ltr; text-align:right;">${client.phone}</td>
                <td data-label="عدد الطلبات">${client.ordersCount}</td>
                <td data-label="إجمالي الكوينز" style="color:#f59e0b;">${formatCoinsNumber(client.totalCoins)}</td>
                <td data-label="إجمالي المدفوعات" style="color:#38bdf8;">${client.totalPaid.toLocaleString()} SAR</td>
                <td data-label="الإجراء"><button class="btn-action" onclick="openClientDetail('${client.phone}')"><i class="fa-solid fa-list-check"></i> عرض السجل</button></td>
            </tr>
        `;
    });
}

// باقي منطق الإعدادات وقاعدة البيانات دون تغيير...
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
    psRate: 200, pcRate: 150,
    psMin: 100000, psMax: 5000000,
    pcMin: 100000, pcMax: 1000000,
    psWithdrawDuration: "3 - 5 أيام عمل",
    psTransferDuration: "24 ساعة",
    pcWithdrawDuration: "2 - 4 أيام عمل",
    pcTransferDuration: "24 ساعة",
    promoActive: false, promoRate: 220, promoExpiry: "", promoText: "🔥 عرض لفترة محدودة!"
};

let ordersData = []; 
let stockData = { PlayStation: 0, PC: 0 };

function formatCoinsNumber(num) {
    if(num === "" || num === null || isNaN(num)) return "";
    return Number(num).toLocaleString('en-US');
}

window.copyDirect = function(text) {
    if(!text || text === "[محذوف أمنياً]") return;
    navigator.clipboard.writeText(text);
};

async function saveAllSettingsToFirestore() {
    try {
        const config = {
            storeOpen: isStoreOpen,
            psRate: Number(document.getElementById("psRate")?.value || pricingConfig.psRate),
            pcRate: Number(document.getElementById("pcRate")?.value || pricingConfig.pcRate),

            psMin: Number(String(document.getElementById("psMin")?.value || pricingConfig.psMin).replace(/,/g,"")),
            psMax: Number(String(document.getElementById("psMax")?.value || pricingConfig.psMax).replace(/,/g,"")),
            pcMin: Number(String(document.getElementById("pcMin")?.value || pricingConfig.pcMin).replace(/,/g,"")),
            pcMax: Number(String(document.getElementById("pcMax")?.value || pricingConfig.pcMax).replace(/,/g,"")),

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

        await setDoc(doc(db, "system", "settings"), config, { merge: true });
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
            
            pricingConfig = {
                psRate: data.psRate !== undefined ? data.psRate : pricingConfig.psRate,
                pcRate: data.pcRate !== undefined ? data.pcRate : pricingConfig.pcRate,
                psMin: data.psMin !== undefined ? data.psMin : pricingConfig.psMin,
                psMax: data.psMax !== undefined ? data.psMax : pricingConfig.psMax,
                pcMin: data.pcMin !== undefined ? data.pcMin : pricingConfig.pcMin,
                pcMax: data.pcMax !== undefined ? data.pcMax : pricingConfig.pcMax,
                
                psWithdrawDuration: data.psWithdrawDuration !== undefined ? data.psWithdrawDuration : pricingConfig.psWithdrawDuration,
                psTransferDuration: data.psTransferDuration !== undefined ? data.psTransferDuration : pricingConfig.psTransferDuration,
                pcWithdrawDuration: data.pcWithdrawDuration !== undefined ? data.pcWithdrawDuration : pricingConfig.pcWithdrawDuration,
                pcTransferDuration: data.pcTransferDuration !== undefined ? data.pcTransferDuration : pricingConfig.pcTransferDuration,
                
                promoActive: data.promoActive !== undefined ? data.promoActive : pricingConfig.promoActive,
                promoRate: data.promoRate !== undefined ? data.promoRate : pricingConfig.promoRate,
                promoExpiry: data.promoExpiry !== undefined ? data.promoExpiry : pricingConfig.promoExpiry,
                promoText: data.promoText !== undefined ? data.promoText : pricingConfig.promoText
            };
            
            updateStoreStatusUI();
            renderBanks();
            renderWallets();
            renderCustomPayments();
            renderTerms();
            populatePricingUI();
        } else {
            setDoc(settingsRef, {
                storeOpen: true,
                ...pricingConfig,
                banks: banksList,
                wallets: walletsList,
                customPayments: customPaymentsList,
                terms: storeTerms,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
    }, (error) => {
        console.error("Error loading settings from Firestore:", error);
    });
}

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
}

window.toggleStoreStatus = async function() {
    isStoreOpen = !isStoreOpen;
    updateStoreStatusUI();
    await saveAllSettingsToFirestore();
    alert(isStoreOpen ? "🟢 تم فتح المتجر وتحديث قاعدة البيانات!" : "🔴 تم إغلاق المتجر وتحديث قاعدة البيانات!");
};

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

    let transferNeededList = ordersData.filter(o => o.status === 'finished' || (Number(o.withdrawnQty) >= o.totalQty && o.status !== 'transferred' && o.status !== 'completed'));
    
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
    if(document.getElementById("statCompletedCoins")) document.getElementById("statCompletedCoins").innerText = formatCoinsNumber(totalCompletedCoins);
    if(document.getElementById("statTransferredMoney")) document.getElementById("statTransferredMoney").innerText = totalTransferredMoney.toLocaleString() + " ر.س";

    if(document.getElementById("stockPS")) document.getElementById("stockPS").innerText = formatCoinsNumber(stockData.PlayStation);
    if(document.getElementById("stockPC")) document.getElementById("stockPC").innerText = formatCoinsNumber(stockData.PC);

    renderTransferAlertsTable(transferNeededList);
}

window.filterOrdersByStatus = function(status) {
    window.switchTab('ordersTab', document.querySelector('.sidebar-menu li:nth-child(2) a'));
    const statusFilter = document.getElementById("orderStatusFilter");
    if(statusFilter) statusFilter.value = status;
    renderOrdersTables();
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

    const rawWithdrawn = order.withdrawnQty !== "" && order.withdrawnQty !== null && !isNaN(order.withdrawnQty) ? Number(order.withdrawnQty) : 0;
    const remaining = Math.max(0, (order.totalQty || 0) - rawWithdrawn);
    const percent = order.totalQty > 0 ? Math.min(100, Math.round((rawWithdrawn / order.totalQty) * 100)) : 0;
    const isCompleted = remaining === 0 && rawWithdrawn > 0;

    let platformClass = "ps-theme";
    let platformIcon = "fa-brands fa-playstation";
    let platformColor = "#0070d1";
    if(order.platform === 'Xbox' || order.platform === 'xbox') { platformClass = "xbox-theme"; platformIcon = "fa-brands fa-xbox"; platformColor = "#107c10"; }
    else if(order.platform === 'PC' || order.platform === 'pc') { platformClass = "pc-theme"; platformIcon = "fa-solid fa-computer"; platformColor = "#e81123"; }

    let codesHtml = (order.backupCodes || []).map(code => `
        <div class="admin-credential-banner" style="flex:1; text-align:center; margin-bottom:0;" onclick="copyDirect('${code}')" title="انقر لنسخ الكود صامتاً">
            <span class="cred-title">كود احتياطي</span>
            <code class="cred-val" style="color:var(--primary); font-size:0.95rem;">${code}</code>
        </div>
    `).join('');

    let showBoxStyle = (order.status === 'progress' || order.status === 'finished' || order.status === 'transferred') ? 'block' : 'none';

    let withdrawnBox = `
        <div id="withdrawnCardBox" style="display: ${showBoxStyle}; padding: 16px; border-radius: 16px; margin-bottom: 18px; background: rgba(0,255,135,0.1); border: 1px solid var(--primary);">
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:12px; text-align:center;">
                <div style="background: rgba(0, 0, 0, 0.25); border: 1.5px solid rgba(255, 255, 255, 0.2); padding: 8px; border-radius: 12px;">
                    <span style="font-size: 0.72rem; color: #ffffff; opacity: 0.8; display: block;">الكمية الإجمالية</span>
                    <b style="font-size: 0.88rem; color: #ffffff; font-weight: 900;">${formatCoinsNumber(order.totalQty)}</b>
                </div>
                <div style="background: rgba(0, 0, 0, 0.25); border: 1.5px solid rgba(255, 255, 255, 0.2); padding: 8px; border-radius: 12px;">
                    <span style="font-size: 0.72rem; color: #ffffff; opacity: 0.8; display: block;">المسحوبة</span>
                    <b style="font-size: 0.88rem; color: #ffffff; font-weight: 900;" id="withdrawnDisplay">${formatCoinsNumber(rawWithdrawn)} (${percent}%)</b>
                </div>
                <div style="background: rgba(0, 0, 0, 0.25); border: 1.5px solid rgba(255, 255, 255, 0.2); padding: 8px; border-radius: 12px;">
                    <span style="font-size: 0.72rem; color: #ffffff; opacity: 0.8; display: block;">المتبقية</span>
                    <b style="font-size: 0.88rem; color: #ffffff; font-weight: 900;" id="remainingDisplay">${formatCoinsNumber(remaining)}</b>
                </div>
            </div>

            <div class="progress-bar-container">
                <div class="progress-bar-fill" id="progressBarFill" style="width: ${percent}%;"></div>
            </div>

            ${isCompleted ? '<div style="background: rgba(16, 185, 129, 0.35); border: 1px solid #10b981; color: #ffffff; padding: 10px; border-radius: 10px; text-align: center; font-weight: 900; margin-bottom: 12px;"><i class="fa-solid fa-circle-check"></i> ✅ تم إنجاز وسحب كامل الكمية بنجاح!</div>' : ''}

            <div class="form-group" style="margin-bottom:0; display:flex; flex-direction:column; align-items:center;">
                <label style="color: #ffffff !important; font-weight: 900; align-self: flex-start; margin-bottom: 6px;">تعديل الكمية المسحوبة:</label>
                <div style="display: flex; align-items: center; gap: 10px; justify-content: center; width: 100%;">
                    <input type="text" id="modalWithdrawnInput" class="form-control" value="${order.withdrawnQty !== "" && order.withdrawnQty !== undefined ? formatCoinsNumber(order.withdrawnQty) : ''}" placeholder="" oninput="calcRemaining(${index}, this)" style="color: #ffffff; background: rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.3); text-align: center; max-width: 200px; font-weight: 900; font-size: 1.1rem;">
                    <span style="color: #ffffff; font-weight: 900; font-size: 1rem; background: rgba(0,0,0,0.4); padding: 10px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2);">كوينز</span>
                </div>
            </div>
        </div>
    `;

    let sensitiveContent = order.sensitiveDeleted ? 
        `<div style="background:rgba(239,68,68,0.1); color:#ef4444; padding:10px; border-radius:10px; text-align:center; font-weight:900; margin-bottom:14px;">⚠️ تم إتلاف وحذف البيانات الحساسة أمنياً.</div>` :
        `<div style="margin-bottom:14px;">
            <div style="font-size:0.95rem; font-weight:900; margin-bottom:10px;"><i class="fa-solid fa-shield-halved" style="color:var(--primary);"></i> بيانات الحساب الحساسة:</div>
            <div class="admin-credential-banner" onclick="copyDirect('${order.email}')" title="انقر لنسخ الإيميل صامتاً">
                <span class="cred-title"><i class="fa-solid fa-envelope"></i> إيميل حساب EA</span>
                <code class="cred-val" style="color:var(--text-main);">${order.email || '---'}</code>
            </div>
            <div class="admin-credential-banner" onclick="copyDirect('${order.pass}')" title="انقر لنسخ كلمة المرور صامتاً">
                <span class="cred-title"><i class="fa-solid fa-key"></i> كلمة المرور</span>
                <code class="cred-val" style="color:#f59e0b; font-weight:900;">${order.pass || '---'}</code>
            </div>
            <div style="margin-bottom:14px;">
                <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:6px;">الأكواد الاحتياطية:</span>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">${codesHtml}</div>
            </div>
        </div>`;

    let pd = order.paymentDetails || {};
    let paymentDetailsHtml = `
        <div style="background:var(--input-bg); border:1.5px solid var(--card-border); border-radius:16px; padding:16px; margin-top:16px;">
            <strong style="font-size:0.9rem; color:#38bdf8; display:block; margin-bottom:10px;"><i class="fa-solid fa-wallet"></i> بيانات التحويل والاستلام (${order.paymentMethod}):</strong>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:var(--text-muted)">البنك / المحفظة:</span> <b>${pd.bank || pd.wallet || '-'}</b></div>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:var(--text-muted)">اسم المستفيد:</span> <b>${pd.name || '-'}</b></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><span style="color:var(--text-muted)">رقم الآيبان أو الحساب:</span> <code onclick="copyDirect('${pd.iban || pd.phone || '-'}')" style="cursor:pointer; color:var(--primary);" title="انقر للنسخ">${pd.iban || pd.phone || '-'}</code></div>
        </div>
    `;

    let logsHtml = (order.auditLogs || []).map(l => `<li style="font-size:0.78rem; color:var(--text-muted);">${l.time} - ${l.action} (${l.user})</li>`).join("");

    body.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:8px; margin-bottom:16px;">
            <button class="btn-custom" style="background:linear-gradient(135deg, #38bdf8 0%, #2563eb 100%); color:#fff; justify-content:center; font-size:0.8rem;" onclick="migrateToGoogleSheets(${index})">
                <i class="fa-solid fa-cloud-arrow-up"></i> الشيت
            </button>
            <button class="btn-custom" style="background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:#fff; justify-content:center; font-size:0.8rem;" onclick="backupOrderData(${index})">
                <i class="fa-solid fa-copy"></i> نسخ
            </button>
            <button class="btn-custom" style="background:linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color:#fff; justify-content:center; font-size:0.8rem;" onclick="destroySensitiveData(${index})">
                <i class="fa-solid fa-shield-halved"></i> إتلاف
            </button>
        </div>

        <div class="admin-summary-banner ${platformClass}">
            <div class="admin-banner-item">
                <i class="${platformIcon}" style="color: ${platformColor};"></i>
                <div class="admin-banner-label">المنصة</div>
                <div class="admin-banner-value">${order.platform}</div>
            </div>
            <div class="admin-banner-item">
                <i class="fa-solid fa-coins" style="color: var(--primary);"></i>
                <div class="admin-banner-label">الكمية</div>
                <div class="admin-banner-value" style="color: var(--primary);">${formatCoinsNumber(order.totalQty)}</div>
            </div>
            <div class="admin-banner-item">
                <i class="fa-solid fa-money-bill-wave" style="color: #38bdf8;"></i>
                <div class="admin-banner-label">المبلغ</div>
                <div class="admin-banner-value" style="color: #38bdf8;">${order.totalPrice}</div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; margin-bottom:18px; background:var(--input-bg); padding:12px; border-radius:16px; border:1.5px solid var(--card-border); text-align:center;">
            <div><span style="font-size:0.72rem; color:var(--text-muted); display:block;">المرجع</span><code style="color:var(--primary); font-size:0.88rem;">${order.reference}</code></div>
            <div><span style="font-size:0.72rem; color:var(--text-muted); display:block;">العميل</span><b style="font-size:0.88rem;">${order.name}</b></div>
            <div><span style="font-size:0.72rem; color:var(--text-muted); display:block;">الجوال</span><span style="direction:ltr; font-size:0.85rem; font-weight:800;">${order.phone}</span></div>
            <div><span style="font-size:0.72rem; color:var(--text-muted); display:block;">رقم الطلب</span><b style="font-size:0.88rem;">#${order.id}</b></div>
        </div>

        ${sensitiveContent}

        <div class="form-grid-2" style="margin-bottom:16px;">
            <div class="form-group" style="margin-bottom:0;">
                <label>حالة الطلب:</label>
                <select id="modalStatusSelect" class="form-control" onchange="toggleStatusBox(this.value)">
                    <option value="new" ${order.status==='new'?'selected':''}>طلب جديد</option>
                    <option value="review" ${order.status==='review'?'selected':''}>انتظار المراجعة</option>
                    <option value="progress" ${order.status==='progress'?'selected':''}>قيد التنفيذ</option>
                    <option value="finished" ${order.status==='finished'?'selected':''}>تم الانتهاء</option>
                    <option value="transferred" ${order.status==='transferred'?'selected':''}>تم التحويل</option>
                    <option value="completed" ${order.status==='completed'?'selected':''}>مكتمل (رقم 6)</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
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

        ${withdrawnBox}

        <div style="margin-top:12px; background:rgba(255,255,255,0.02); padding:10px; border-radius:10px;">
            <strong style="font-size:0.8rem; color:var(--text-muted); display:block; margin-bottom:4px;"><i class="fa-solid fa-history"></i> سجل التغييرات:</strong>
            <ul style="padding-right:15px; max-height:80px; overflow-y:auto;">${logsHtml}</ul>
        </div>

        ${paymentDetailsHtml}

        <button class="btn-custom" style="width:100%; justify-content:center; margin-top:18px; padding:14px;" onclick="saveOrderModalChanges(${index})">
            <i class="fa-solid fa-floppy-disk"></i> حفظ التحديثات
        </button>
    `;
    modal.classList.add("active");
};

window.calcRemaining = function(index, input) {
    let rawVal = input.value.replace(/,/g, '');
    let withdrawn = parseInt(rawVal) || 0;
    const total = ordersData[index].totalQty;
    if(withdrawn > total) withdrawn = total;
    
    input.value = withdrawn > 0 ? formatCoinsNumber(withdrawn) : '';

    const rem = Math.max(0, total - withdrawn);
    const percent = total > 0 ? Math.min(100, Math.round((withdrawn / total) * 100)) : 0;
    
    const wDisp = document.getElementById("withdrawnDisplay");
    const rDisp = document.getElementById("remainingDisplay");
    if(wDisp) wDisp.innerText = formatCoinsNumber(withdrawn) + ` (${percent}%)`;
    if(rDisp) rDisp.innerText = formatCoinsNumber(rem);
    
    const fill = document.getElementById("progressBarFill");
    if(fill) fill.style.width = percent + "%";
};

window.toggleStatusBox = function(status) {
    const wrapper = document.getElementById("withdrawnCardBox");
    if(!wrapper) return;
    if(status === 'progress' || status === 'finished' || status === 'transferred') {
        wrapper.style.display = 'block';
    } else {
        wrapper.style.display = 'none';
    }
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
        let rawVal = withdrawnInput.value.replace(/,/g, '');
        let newWithdrawn = rawVal !== "" ? parseInt(rawVal) || 0 : 0;
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

function populatePricingUI() {
    if(document.getElementById("psRate")) document.getElementById("psRate").value = pricingConfig.psRate;
    if(document.getElementById("pcRate")) document.getElementById("pcRate").value = pricingConfig.pcRate;
    if(document.getElementById("psMin")) document.getElementById("psMin").value = formatCoinsNumber(pricingConfig.psMin);
    if(document.getElementById("psMax")) document.getElementById("psMax").value = formatCoinsNumber(pricingConfig.psMax);
    if(document.getElementById("pcMin")) document.getElementById("pcMin").value = formatCoinsNumber(pricingConfig.pcMin);
    if(document.getElementById("pcMax")) document.getElementById("pcMax").value = formatCoinsNumber(pricingConfig.pcMax);
    
    if(document.getElementById("psWithdrawDuration")) document.getElementById("psWithdrawDuration").value = pricingConfig.psWithdrawDuration;
    if(document.getElementById("psTransferDuration")) document.getElementById("psTransferDuration").value = pricingConfig.psTransferDuration;
    if(document.getElementById("pcWithdrawDuration")) document.getElementById("pcWithdrawDuration").value = pricingConfig.pcWithdrawDuration;
    if(document.getElementById("pcTransferDuration")) document.getElementById("pcTransferDuration").value = pricingConfig.pcTransferDuration;

    if(document.getElementById("promoActiveSelect")) document.getElementById("promoActiveSelect").value = pricingConfig.promoActive ? "true" : "false";
    if(document.getElementById("promoRateInput")) document.getElementById("promoRateInput").value = pricingConfig.promoRate;
    if(document.getElementById("promoExpiryInput")) document.getElementById("promoExpiryInput").value = pricingConfig.promoExpiry || "";
    if(document.getElementById("promoText")) document.getElementById("promoText").value = pricingConfig.promoText;
}

window.savePricingConfig = async function () {
  try {
    const config = {
      storeOpen: isStoreOpen,
      psRate: Number(document.getElementById("psRate").value),
      pcRate: Number(document.getElementById("pcRate").value),

      psMin: Number(document.getElementById("psMin").value.replace(/,/g,"")),
      psMax: Number(document.getElementById("psMax").value.replace(/,/g,"")),
      pcMin: Number(document.getElementById("pcMin").value.replace(/,/g,"")),
      pcMax: Number(document.getElementById("pcMax").value.replace(/,/g,"")),

      psWithdrawDuration: document.getElementById("psWithdrawDuration").value,
      psTransferDuration: document.getElementById("psTransferDuration").value,
      pcWithdrawDuration: document.getElementById("pcWithdrawDuration").value,
      pcTransferDuration: document.getElementById("pcTransferDuration").value,

      promoActive: document.getElementById("promoActiveSelect").value === "true",
      promoRate: Number(document.getElementById("promoRateInput").value),
      promoExpiry: document.getElementById("promoExpiryInput").value,
      promoText: document.getElementById("promoText").value,

      banks: banksList,
      wallets: walletsList,
      customPayments: customPaymentsList,
      terms: storeTerms,
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, "system", "settings"), config, { merge: true });
    alert("تم حفظ الإعدادات بنجاح");
  } catch (err) {
    console.error("Error saving pricing config:", err);
    alert("❌ حدث خطأ أثناء حفظ الإعدادات في قاعدة البيانات.");
  }
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

window.addBank = async function() {
    const i = document.getElementById("newBankInput");
    if(i && i.value.trim()){ 
        banksList.push(i.value.trim()); 
        i.value=""; 
        renderBanks(); 
        await saveAllSettingsToFirestore();
    }
};

window.deleteBank = async function(i) {
    banksList.splice(i, 1);
    renderBanks();
    await saveAllSettingsToFirestore();
};

function renderWallets() {
    const c = document.getElementById("walletsListContainer");
    if(!c) return;
    c.innerHTML = "";
    walletsList.forEach((w, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${w}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteWallet(${i})">حذف</button></div>`);
}

window.addWallet = async function() {
    const i = document.getElementById("newWalletInput");
    if(i && i.value.trim()){ 
        walletsList.push(i.value.trim()); 
        i.value=""; 
        renderWallets(); 
        await saveAllSettingsToFirestore();
    }
};

window.deleteWallet = async function(i) {
    walletsList.splice(i, 1);
    renderWallets();
    await saveAllSettingsToFirestore();
};

function renderCustomPayments() {
    const c = document.getElementById("customPayMethodsContainer");
    if(!c) return;
    c.innerHTML = "";
    customPaymentsList.forEach((p, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--card-bg); border:1.5px solid var(--card-border); padding:8px 12px; border-radius:10px;"><span style="font-size:0.85rem;">${p}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteCustomPayment(${i})">حذف</button></div>`);
}

window.addCustomPaymentMethod = async function() {
    const i = document.getElementById("newCustomPaymentInput");
    if(i && i.value.trim()){ 
        customPaymentsList.push(i.value.trim()); 
        i.value=""; 
        renderCustomPayments(); 
        await saveAllSettingsToFirestore();
    }
};

window.deleteCustomPayment = async function(i) {
    customPaymentsList.splice(i, 1);
    renderCustomPayments();
    await saveAllSettingsToFirestore();
};

function renderTerms() {
    const c = document.getElementById("termsListContainer");
    if(!c) return;
    c.innerHTML = "";
    storeTerms.forEach((t, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1.5px solid var(--card-border); padding:10px; border-radius:12px;"><span style="font-size:0.85rem;">${i+1}. ${t}</span><button class="btn-action" style="color:#ef4444;" onclick="deleteTerm(${i})">حذف</button></div>`);
}

window.addNewTerm = async function() {
    const i = document.getElementById("newTermInput");
    if(i && i.value.trim()){ 
        storeTerms.push(i.value.trim()); 
        i.value=""; 
        renderTerms(); 
        await saveAllSettingsToFirestore();
    }
};

window.deleteTerm = async function(i) {
    storeTerms.splice(i, 1);
    renderTerms();
    await saveAllSettingsToFirestore();
};

function updateLiveDatetime() {
    const now = new Date();
    const el = document.getElementById("liveDatetime");
    if (el) el.innerText = `${now.toLocaleDateString('en-GB')} | ${now.toLocaleTimeString('en-GB', { hour12: false })}`;
}
setInterval(updateLiveDatetime, 1000);
updateLiveDatetime();

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
                <td data-label="المرجع"><code style="color:var(--primary);">${order.reference}</code></td>
                <td data-label="رقم الطلب">#${order.id}</td>
                <td data-label="اسم العميل"><b>${order.name}</b></td>
                <td data-label="المنصة">${order.platform}</td>
                <td data-label="الكمية"><b>${formatCoinsNumber(order.totalQty)}</b></td>
                <td data-label="السعر" style="color:var(--primary);">${order.totalPrice}</td>
                <td data-label="الحالة">${getStatusBadge(order.status)}</td>
                <td data-label="الإجراء"><button class="btn-action" onclick="openOrderModal(${actualIndex})">التفاصيل</button></td>
            </tr>
        `;
    });
};
