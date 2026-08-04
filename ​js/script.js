const translations = {
    ar: {
        pageTitle: "لوحة التحكم والإدارة | Admin Dashboard",
        brandTitle: "لوحة التحكم",
        adminName: "مدير النظام",
        adminRole: "مدير عام",
        menuDashboard: "لوحة التحكم",
        menuOrders: "الطلبات",
        menuCustomers: "العملاء",
        menuReviews: "التقييمات",
        menuReports: "التقارير",
        menuPrices: "الأسعار",
        menuDevices: "الأجهزة",
        menuPayments: "وسائل الدفع",
        menuStatuses: "حالات الطلب",
        menuTemplates: "قوالب الرسائل",
        menuSettings: "الإعدادات",
        menuLogs: "سجل النشاط",
        searchPlaceholder: "بحث عام...",
        breadcrumbHome: "الرئيسية",
        statTotalOrders: "إجمالي الطلبات",
        statReview: "بانتظار المراجعة",
        statNew: "طلبات جديدة",
        statProgress: "جاري التنفيذ",
        statCoinsPulled: "تم سحب الكوينز",
        statTransferring: "جاري تحويل المبلغ",
        statCompleted: "مكتملة",
        statPaused: "متوقفة",
        statCancelled: "ملغية",
        statTotalCoins: "إجمالي الكوينز",
        statPayments: "المدفوعات",
        statCustomers: "عدد العملاء",
        tableLatestOrders: "آخر الطلبات",
        tableLatestReviews: "آخر التقييمات",
        tableLatestCustomers: "آخر العملاء"
    },
    en: {
        pageTitle: "Admin Dashboard | Management Portal",
        brandTitle: "Control Panel",
        adminName: "System Admin",
        adminRole: "General Manager",
        menuDashboard: "Dashboard",
        menuOrders: "Orders",
        menuCustomers: "Customers",
        menuReviews: "Reviews",
        menuReports: "Reports",
        menuPrices: "Pricing",
        menuDevices: "Devices",
        menuPayments: "Payment Methods",
        menuStatuses: "Order Statuses",
        menuTemplates: "Message Templates",
        menuSettings: "Settings",
        menuLogs: "Activity Logs",
        searchPlaceholder: "General search...",
        breadcrumbHome: "Home",
        statTotalOrders: "Total Orders",
        statReview: "Pending Review",
        statNew: "New Orders",
        statProgress: "In Progress",
        statCoinsPulled: "Coins Pulled",
        statTransferring: "Transferring Cash",
        statCompleted: "Completed",
        statPaused: "Paused",
        statCancelled: "Cancelled",
        statTotalCoins: "Total Coins",
        statPayments: "Payments",
        statCustomers: "Total Customers",
        tableLatestOrders: "Latest Orders",
        tableLatestReviews: "Latest Reviews",
        tableLatestCustomers: "Latest Customers"
    }
};

let currentLang = "ar";

document.addEventListener("DOMContentLoaded", () => {
    updateLiveDatetime();
    setInterval(updateLiveDatetime, 1000);

    const savedTheme = localStorage.getItem("admin_theme");
    if (savedTheme === "light") {
        document.body.classList.add("light-theme");
        const themeBtn = document.getElementById("themeToggleBtn");
        if (themeBtn) themeBtn.innerText = "☀️";
    }

    const savedLang = localStorage.getItem("admin_lang") || "ar";
    currentLang = savedLang;
    applyLanguage(currentLang);
});

function updateLiveDatetime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB'); 
    const timeStr = now.toLocaleTimeString('en-GB', { hour12: false }); 
    const el = document.getElementById("liveDatetime");
    if (el) el.innerText = `${dateStr} | ${timeStr}`;
}

function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const mainWrapper = document.getElementById("mainWrapper");
    if (window.innerWidth <= 992) {
        sidebar.classList.toggle("mobile-open");
    } else {
        sidebar.classList.toggle("collapsed");
        mainWrapper.classList.toggle("full-width");
    }
}

function switchTab(tabId, element) {
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".sidebar-link").forEach(link => link.classList.remove("active"));
    
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add("active");
    element.classList.add("active");

    const activeText = element.querySelector("span:nth-child(2)").innerText;
    const titleHeading = document.getElementById("pageTitleHeading");
    const breadcrumbActive = document.getElementById("breadcrumbActive");
    if (titleHeading) titleHeading.innerText = activeText;
    if (breadcrumbActive) breadcrumbActive.innerText = activeText;

    if (window.innerWidth <= 992) {
        const sidebar = document.getElementById("sidebar");
        if (sidebar) sidebar.classList.remove("mobile-open");
    }
}

function toggleTheme() {
    document.body.classList.toggle("light-theme");
    const isLight = document.body.classList.contains("light-theme");
    localStorage.setItem("admin_theme", isLight ? "light" : "dark");
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) themeBtn.innerText = isLight ? "☀️" : "🌙";
}

function toggleLanguage() {
    currentLang = (currentLang === "ar") ? "en" : "ar";
    localStorage.setItem("admin_lang", currentLang);
    applyLanguage(currentLang);
}

function applyLanguage(lang) {
    const htmlRoot = document.getElementById("htmlRoot");
    if (htmlRoot) {
        htmlRoot.setAttribute("lang", lang);
        htmlRoot.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    }

    const indicator = document.getElementById("langTextIndicator");
    if (indicator) {
        indicator.innerText = (lang === "ar") ? "English" : "العربية";
    }

    const t = translations[lang];
    if (!t) return;

    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (t[key]) el.innerText = t[key];
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (t[key]) el.placeholder = t[key];
    });

    updateLiveDatetime();
}
