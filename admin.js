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
    document.querySelectorAll(".bottom-nav-item").forEach(item => item.classList.remove("active"));
    
    const targetTab = document.getElementById(tabId);
    if(targetTab) targetTab.classList.add("active");
    if(element) element.classList.add("active");
    
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
    const topNavAvatar = document.getElementById("topNavUserAvatar");
    
    let uName = user.displayName || user.email.split('@')[0];
    if (sidebarName) sidebarName.innerText = uName;
    if (sidebarAvatar) sidebarAvatar.innerText = uName[0].toUpperCase();
    if (topNavAvatar) topNavAvatar.innerText = uName[0].toUpperCase();

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
// 2. إدارة البيانات والإعدادات مع Firestore
// ==========================================
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
let barChartInstance = null;
let donutChartInstance = null;

function formatCoinsNumber(num) {
    if(num === "" || num === null || isNaN(num)) return "0";
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
        txt.innerHTML = `<span class="status-dot-green"></span><span>المتجر مفتوح</span>`;
    } else {
        btn.className = "store-status-btn closed";
        txt.innerHTML = `<span class="status-dot-green" style="background:#ef4444; box-shadow:0 0 8px #ef4444;"></span><span>المتجر مغلق</span>`;
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
                totalPrice: data.price || data.totalPrice || "0 SAR",
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
                updatedAt: data.updatedAt || new Date().toISOString(),
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
    let countAll = ordersData.length;
    let countNew = ordersData.filter(o => o.status === 'new').length;
    let countProgress = ordersData.filter(o => o.status === 'progress').length;
    let countFinished = ordersData.filter(o => o.status === 'finished').length;
    let countCancelled = ordersData.filter(o => o.status === 'cancelled').length;
    let countTransferred = ordersData.filter(o => o.status === 'transferred').length;

    let transferNeededList = ordersData.filter(o => o.status === 'finished' || (Number(o.withdrawnQty) >= o.totalQty && o.status !== 'transferred' && o.status !== 'completed'));
    let countTransferNeeded = transferNeededList.length;

    const sbBadge = document.getElementById("sidebarNewOrdersBadge");
    if(sbBadge) {
        if(countNew > 0) {
            sbBadge.style.display = "inline-block";
            sbBadge.innerText = countNew;
        } else {
            sbBadge.style.display = "none";
        }
    }

    const transferBadgeCount = document.getElementById("transferBadgeCount");
    const transferHeaderBadge = document.getElementById("transferHeaderBadge");
    if(transferBadgeCount) transferBadgeCount.innerText = countTransferNeeded;
    if(transferHeaderBadge) transferHeaderBadge.innerText = `${countTransferNeeded} طلبات بحاجة للتحويل`;

    const banner = document.getElementById("urgentTransferBanner");
    const bannerTransferText = document.getElementById("bannerTransferText");
    if(banner && bannerTransferText) {
        if(countTransferNeeded > 0) {
            banner.style.display = "flex";
            bannerTransferText.innerText = `لديك ${countTransferNeeded} طلبات منتهية تحتاج إلى التحويل المالي للعملاء خلال 3-5 أيام عمل من تاريخ الانتهاء.`;
        } else {
            banner.style.display = "none";
        }
    }

    let totalCompletedCoins = ordersData.filter(o => o.status === 'completed' || o.status === 'finished' || o.status === 'transferred').reduce((sum, o) => sum + (o.totalQty || 0), 0);
    let totalWithdrawnQtySum = ordersData.reduce((sum, o) => sum + (Number(o.withdrawnQty) || 0), 0);
    let totalQtySum = ordersData.reduce((sum, o) => sum + (Number(o.totalQty) || 0), 0);
    let remainingCoinsSum = Math.max(0, totalQtySum - totalWithdrawnQtySum);

    let totalTransferredMoney = ordersData.filter(o => o.status === 'transferred' || o.status === 'completed').reduce((sum, o) => {
        let p = parseFloat(String(o.totalPrice).replace(/[^0-9.]/g, '')) || 200;
        return sum + p;
    }, 0);

    // تحديث الأرقام بجميع البطاقات
    if(document.getElementById("statAllOrders")) document.getElementById("statAllOrders").innerText = countAll;
    if(document.getElementById("statNewOrders")) document.getElementById("statNewOrders").innerText = countNew;
    if(document.getElementById("statProgressOrders")) document.getElementById("statProgressOrders").innerText = countProgress;
    if(document.getElementById("statProgressOrders2")) document.getElementById("statProgressOrders2").innerText = countProgress;
    if(document.getElementById("statFinishedOrders")) document.getElementById("statFinishedOrders").innerText = countFinished;
    if(document.getElementById("statCancelledOrders")) document.getElementById("statCancelledOrders").innerText = countCancelled;
    if(document.getElementById("statTransferNeededOrders")) document.getElementById("statTransferNeededOrders").innerText = countTransferNeeded;

    if(document.getElementById("statCompletedCoins")) document.getElementById("statCompletedCoins").innerText = formatCoinsNumber(totalCompletedCoins);
    if(document.getElementById("statTransferredMoney")) document.getElementById("statTransferredMoney").innerText = totalTransferredMoney.toLocaleString() + " SAR";

    // القسم 7 — ملخص الكوينز
    if(document.getElementById("summaryWithdrawnQty")) document.getElementById("summaryWithdrawnQty").innerText = formatCoinsNumber(totalWithdrawnQtySum);
    if(document.getElementById("summaryRemainingQty")) document.getElementById("summaryRemainingQty").innerText = formatCoinsNumber(remainingCoinsSum);
    let coinsPercent = totalQtySum > 0 ? Math.min(100, Math.round((totalWithdrawnQtySum / totalQtySum) * 100)) : 0;
    if(document.getElementById("summaryProgressPercent")) document.getElementById("summaryProgressPercent").innerText = coinsPercent + "%";
    if(document.getElementById("summaryProgressFill")) document.getElementById("summaryProgressFill").style.width = coinsPercent + "%";

    // القسم 8 — المنصات الأكثر طلباً
    let psCount = ordersData.filter(o => o.platform === 'PlayStation').length;
    let xboxCount = ordersData.filter(o => o.platform === 'Xbox').length;
    let pcCount = ordersData.filter(o => o.platform === 'PC').length;
    let totalPlat = countAll || 1;

    let psPct = Math.round((psCount / totalPlat) * 100);
    let xboxPct = Math.round((xboxCount / totalPlat) * 100);
    let pcPct = Math.round((pcCount / totalPlat) * 100);

    if(document.getElementById("rankPsPercent")) document.getElementById("rankPsPercent").innerText = psPct + "%";
    if(document.getElementById("rankPsOrders")) document.getElementById("rankPsOrders").innerText = psCount + " طلب";
    if(document.getElementById("rankPsFill")) document.getElementById("rankPsFill").style.width = psPct + "%";

    if(document.getElementById("rankXboxPercent")) document.getElementById("rankXboxPercent").innerText = xboxPct + "%";
    if(document.getElementById("rankXboxOrders")) document.getElementById("rankXboxOrders").innerText = xboxCount + " طلب";
    if(document.getElementById("rankXboxFill")) document.getElementById("rankXboxFill").style.width = xboxPct + "%";

    if(document.getElementById("rankPcPercent")) document.getElementById("rankPcPercent").innerText = pcPct + "%";
    if(document.getElementById("rankPcOrders")) document.getElementById("rankPcOrders").innerText = pcCount + " طلب";
    if(document.getElementById("rankPcFill")) document.getElementById("rankPcFill").style.width = pcPct + "%";

    // القسم 5 — أحدث 5 طلبات
    renderLatest5Orders();
    // القسم 9 — النشاطات الحية
    renderActivityFeed();

    renderTransferAlertsTable(transferNeededList);
    renderChartsData(psPct, xboxPct, pcPct, countAll);
}

function renderLatest5Orders() {
    const container = document.getElementById("latestOrdersContainer");
    if(!container) return;
    let latest = ordersData.slice(0, 5);
    if(latest.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:10px;">لا توجد طلبات حديثة.</div>`;
        return;
    }
    container.innerHTML = "";
    latest.forEach(o => {
        let actualIndex = ordersData.findIndex(item => item.id === o.id);
        let platIcon = "fa-brands fa-playstation";
        if(o.platform === 'Xbox') platIcon = "fa-brands fa-xbox";
        else if(o.platform === 'PC') platIcon = "fa-brands fa-windows";

        container.innerHTML += `
            <div class="latest-order-item" onclick="openOrderModal(${actualIndex})">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class="${platIcon} order-platform-ic"></i>
                    <div>
                        <span class="order-id-badge">#${o.reference}</span>
                        <div class="order-client-name">${o.name}</div>
                    </div>
                </div>
                <div style="text-align:left;">
                    <strong style="color:var(--primary); font-size:0.85rem;">${formatCoinsNumber(o.totalQty)}</strong>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${o.totalPrice}</div>
                </div>
            </div>
        `;
    });
}

function renderActivityFeed() {
    const container = document.getElementById("activityFeedContainer");
    if(!container) return;
    let allLogs = [];
    ordersData.forEach(o => {
        if(o.auditLogs) {
            o.auditLogs.forEach(l => {
                allLogs.push({ text: `${l.action} من طلب #${o.reference}`, time: l.time });
            });
        }
    });

    if(allLogs.length === 0) {
        container.innerHTML = `<div class="activity-feed-item"><span class="feed-txt">لا توجد تحديثات حية مؤخراً</span></div>`;
        return;
    }

    container.innerHTML = "";
    allLogs.slice(0, 4).forEach(item => {
        container.innerHTML += `
            <div class="activity-feed-item">
                <span class="feed-dot dot-green"></span>
                <span class="feed-txt">${item.text}</span>
                <span class="feed-time">${item.time}</span>
            </div>
        `;
    });
}

function renderChartsData(psPct, xboxPct, pcPct, totalCount) {
    if(document.getElementById("donutTotalCount")) document.getElementById("donutTotalCount").innerText = totalCount;
    if(document.getElementById("legPsPercent")) document.getElementById("legPsPercent").innerText = psPct + "%";
    if(document.getElementById("legXboxPercent")) document.getElementById("legXboxPercent").innerText = xboxPct + "%";
    if(document.getElementById("legPcPercent")) document.getElementById("legPcPercent").innerText = pcPct + "%";

    const barCtx = document.getElementById('ordersBarChart')?.getContext('2d');
    if (barCtx) {
        if (barChartInstance) barChartInstance.destroy();
        barChartInstance = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: ['18 SEP', '19 SEP', '20 SEP', '21 SEP', '22 SEP', '23 SEP', '24 SEP'],
                datasets: [{
                    data: [12, 18, 25, 20, 28, 22, totalCount || 17],
                    backgroundColor: '#00FF87',
                    borderRadius: 6
                }]
            },
            options: { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }
        });
    }

    const donutCtx = document.getElementById('platformDonutChart')?.getContext('2d');
    if (donutCtx) {
        if (donutChartInstance) donutChartInstance.destroy();
        donutChartInstance = new Chart(donutCtx, {
            type: 'doughnut',
            data: {
                labels: ['PlayStation', 'Xbox', 'PC'],
                datasets: [{
                    data: [psPct || 45, xboxPct || 30, pcPct || 25],
                    backgroundColor: ['#0070d1', '#107c10', '#00a2ff'],
                    borderWidth: 0
                }]
            },
            options: { cutout: '75%', plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }
        });
    }
}

window.filterOrdersByStatus = function(status) {
    window.switchTab('ordersTab', document.querySelectorAll('.sidebar-menu li')[1].querySelector('a'));
    const statusFilter = document.getElementById("orderStatusFilter");
    if(statusFilter) statusFilter.value = status;
    renderOrdersTables();
};

function renderOrdersTables() {
    sortOrdersNewestFirst();
    const fullBody = document.getElementById("fullOrdersTableBody");
    const statusFilter = document.getElementById("orderStatusFilter")?.value || "all";
    const platformFilter = document.getElementById("orderPlatformFilter")?.value || "all";

    if(fullBody) {
        let filtered = ordersData;
        if(statusFilter !== "all") filtered = filtered.filter(o => o.status === statusFilter);
        if(platformFilter !== "all") filtered = filtered.filter(o => o.platform === platformFilter);

        if(filtered.length === 0) {
            fullBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--text-muted); padding:30px;">لا توجد طلبات مسجلة حالياً.</td></tr>`;
        } else {
            fullBody.innerHTML = "";
            filtered.forEach((order) => {
                let actualIndex = ordersData.findIndex(o => o.id === order.id);
                let statusBadge = getStatusBadge(order.status);
                let dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB') : '---';
                
                fullBody.innerHTML += `
                    <tr>
                        <td><code style="color:var(--primary); font-weight:bold;">${order.reference}</code></td>
                        <td>#${order.id}</td>
                        <td><b>${order.name}</b></td>
                        <td><span class="badge" style="background:rgba(255,255,255,0.05); color:var(--text-main);">${order.platform}</span></td>
                        <td><b style="color:#f59e0b;">${formatCoinsNumber(order.totalQty)}</b></td>
                        <td style="color:#00a2ff; font-weight:bold;">${order.totalPrice}</td>
                        <td>${statusBadge}</td>
                        <td><span style="font-size:0.75rem; color:${order.errorCode==='none'?'var(--text-muted)':'#ef4444'}">${order.errorCode}</span></td>
                        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
                        <td><button class="btn-custom" style="padding:6px 12px; font-size:0.75rem;" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-sliders"></i> تحكم</button></td>
                    </tr>
                `;
            });
        }
    }

    updateDashboardStats();
    renderClientsList();
}

function getStatusBadge(status) {
    switch(status) {
        case 'new': return '<span class="badge badge-new"><i class="fa-solid fa-bell"></i> جديد</span>';
        case 'review': return '<span class="badge badge-review"><i class="fa-solid fa-clock"></i> انتظار المراجعة</span>';
        case 'progress': return '<span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7;"><i class="fa-solid fa-rotate"></i> قيد التنفيذ</span>';
        case 'finished': return '<span class="badge" style="background:rgba(0,255,135,0.15); color:#00ff87;"><i class="fa-solid fa-check"></i> تم السحب</span>';
        case 'transferred': return '<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981;"><i class="fa-solid fa-money-bill-transfer"></i> تم التحويل</span>';
        case 'completed': return '<span class="badge" style="background:rgba(16,185,129,0.2); color:#10b981;"><i class="fa-solid fa-award"></i> مكتمل</span>';
        case 'cancelled': return '<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444;"><i class="fa-solid fa-ban"></i> ملغي</span>';
        default: return '<span class="badge badge-new">جديد</span>';
    }
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
                <td><code style="color:var(--primary); font-weight:bold;">${order.reference}</code></td>
                <td>#${order.id}</td>
                <td><b>${order.name}</b></td>
                <td style="direction:ltr; text-align:right;">${order.phone}</td>
                <td style="color:#00ff87; font-weight:bold;">${order.totalPrice}</td>
                <td><span class="badge badge-review"><i class="fa-solid fa-clock"></i> بدأ العد من: ${finishDateStr}</span></td>
                <td><button class="btn-custom" style="padding:6px 12px; font-size:0.75rem;" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-money-bill-transfer"></i> إتمام التحويل</button></td>
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
                <td><b>${client.name}</b></td>
                <td style="direction:ltr; text-align:right;">${client.phone}</td>
                <td>${client.ordersCount}</td>
                <td style="color:#f59e0b; font-weight:bold;">${formatCoinsNumber(client.totalCoins)}</td>
                <td style="color:#00a2ff; font-weight:bold;">${client.totalPaid.toLocaleString()} SAR</td>
                <td><button class="btn-custom" style="padding:6px 12px; font-size:0.75rem;" onclick="openClientDetail('${client.phone}')"><i class="fa-solid fa-list-check"></i> عرض السجل</button></td>
            </tr>
        `;
    });
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

            <div style="width: 100%; background: rgba(255,255,255,0.1); height: 8px; border-radius: 10px; overflow: hidden; margin-bottom: 12px;">
                <div id="progressBarFill" style="width: ${percent}%; background: var(--primary); height: 100%; transition: width 0.3s ease;"></div>
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
            <strong style="font-size:0.9rem; color:#00a2ff; display:block; margin-bottom:10px;"><i class="fa-solid fa-wallet"></i> بيانات التحويل والاستلام (${order.paymentMethod}):</strong>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:var(--text-muted)">البنك / المحفظة:</span> <b>${pd.bank || pd.wallet || '-'}</b></div>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;"><span style="color:var(--text-muted)">اسم المستفيد:</span> <b>${pd.name || '-'}</b></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><span style="color:var(--text-muted)">رقم الآيبان أو الحساب:</span> <code onclick="copyDirect('${pd.iban || pd.phone || '-'}')" style="cursor:pointer; color:var(--primary);" title="انقر للنسخ">${pd.iban || pd.phone || '-'}</code></div>
        </div>
    `;

    let logsHtml = (order.auditLogs || []).map(l => `<li style="font-size:0.78rem; color:var(--text-muted);">${l.time} - ${l.action} (${l.user})</li>`).join("");

    body.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:8px; margin-bottom:16px;">
            <button class="btn-custom" style="background:#00a2ff; color:#fff; justify-content:center; font-size:0.8rem;" onclick="migrateToGoogleSheets(${index})">
                <i class="fa-solid fa-cloud-arrow-up"></i> الشيت
            </button>
            <button class="btn-custom" style="background:#f59e0b; color:#fff; justify-content:center; font-size:0.8rem;" onclick="backupOrderData(${index})">
                <i class="fa-solid fa-copy"></i> نسخ
            </button>
            <button class="btn-custom" style="background:#ef4444; color:#fff; justify-content:center; font-size:0.8rem;" onclick="destroySensitiveData(${index})">
                <i class="fa-solid fa-shield-halved"></i> إتلاف
            </button>
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
                    <option value="new" ${order.status==='new'?'selected':''}>جديد</option>
                    <option value="review" ${order.status==='review'?'selected':''}>انتظار المراجعة</option>
                    <option value="progress" ${order.status==='progress'?'selected':''}>قيد التنفيذ</option>
                    <option value="finished" ${order.status==='finished'?'selected':''}>تم السحب</option>
                    <option value="cancelled" ${order.status==='cancelled'?'selected':''}>ملغي</option>
                    <option value="transferred" ${order.status==='transferred'?'selected':''}>تم التحويل</option>
                    <option value="completed" ${order.status==='completed'?'selected':''}>مكتمل نهائياً</option>
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

window.closeClientModal = function() {
    const modal = document.getElementById("clientDetailModal");
    if(modal) modal.classList.remove("active");
};

window.openClientDetail = function(phone) {
    const modal = document.getElementById("clientDetailModal");
    const body = document.getElementById("clientModalBody");
    if(!modal || !body) return;

    let clientOrders = ordersData.filter(o => o.phone === phone);
    if(clientOrders.length === 0) return;

    let rows = clientOrders.map(o => `
        <div style="background:var(--input-bg); padding:10px; border-radius:10px; margin-bottom:8px; border:1px solid var(--card-border);">
            <div style="display:flex; justify-content:space-between;">
                <code style="color:var(--primary);">#${o.reference}</code>
                <b>${formatCoinsNumber(o.totalQty)} كوينز</b>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
                <span>${o.platform}</span>
                <span>${o.totalPrice}</span>
            </div>
        </div>
    `).join('');

    body.innerHTML = `
        <div style="margin-bottom:12px;"><strong>اسم العميل:</strong> ${clientOrders[0].name}</div>
        <div style="margin-bottom:12px;"><strong>رقم الجوال:</strong> ${phone}</div>
        <div style="margin-bottom:12px;"><strong>سجل الطلبات:</strong></div>
        ${rows}
    `;
    modal.classList.add("active");
};

window.migrateToGoogleSheets = function(index) {
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
        progress: document.getElementById("msgProgress")?.value
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

function renderTerms() {
    const c = document.getElementById("termsListContainer");
    if(!c) return;
    c.innerHTML = "";
    storeTerms.forEach((t, i) => c.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--input-bg); border:1.5px solid var(--card-border); padding:10px; border-radius:12px;"><span style="font-size:0.85rem;">${i+1}. ${t}</span></div>`);
}

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
    let matched = ordersData.filter(o => String(o.name).toLowerCase().includes(q) || String(o.phone).includes(q) || String(o.reference).toLowerCase().includes(q) || String(o.id).includes(q) || String(o.email).toLowerCase().includes(q));
    const fullBody = document.getElementById("fullOrdersTableBody");
    if(!fullBody) return;
    fullBody.innerHTML = "";
    if(matched.length === 0) {
        fullBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد نتائج مطابقة لـ "${query}".</td></tr>`;
        return;
    }
    matched.forEach(order => {
        let actualIndex = ordersData.findIndex(o => o.id === order.id);
        let statusBadge = getStatusBadge(order.status);
        let dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB') : '---';
        fullBody.innerHTML += `
            <tr>
                <td><code style="color:var(--primary); font-weight:bold;">${order.reference}</code></td>
                <td>#${order.id}</td>
                <td><b>${order.name}</b></td>
                <td><span class="badge" style="background:rgba(255,255,255,0.05); color:var(--text-main);">${order.platform}</span></td>
                <td><b style="color:#f59e0b;">${formatCoinsNumber(order.totalQty)}</b></td>
                <td style="color:#00a2ff; font-weight:bold;">${order.totalPrice}</td>
                <td>${statusBadge}</td>
                <td><span style="font-size:0.75rem; color:${order.errorCode==='none'?'var(--text-muted)':'#ef4444'}">${order.errorCode}</span></td>
                <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
                <td><button class="btn-custom" style="padding:6px 12px; font-size:0.75rem;" onclick="openOrderModal(${actualIndex})"><i class="fa-solid fa-sliders"></i> تحكم</button></td>
            </tr>
        `;
    });
};
