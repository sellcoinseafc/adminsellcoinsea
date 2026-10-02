// admin/admin.js

import { db, auth } from "../shared/firebase.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
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
  subscribeToSettings
} from "../shared/system.js";

// ==========================================================================
// 0) المتغيرات العامة
// ==========================================================================

const ALLOWED_EMAILS = [
  "mt.samicoins@gmail.com",
  "psnsa7@gmail.com"
];

const STATUS_VALUES = [
  "new",
  "review",
  "progress",
  "finished",
  "pending_transfer",
  "transferred",
  "completed"
];

const ISSUE_VALUES = [
  "wrong_credentials",
  "wrong_backup_codes",
  "logged_in_platform",
  "market_closed",
  "wrong_platform",
  "other_issue"
];

const DEFAULT_ISSUE_MESSAGES = {
  wrong_credentials:
    "يرجى إرسال الإيميل والباسورد الصحيح عبر الواتساب",

  wrong_backup_codes:
    "يرجى إرسال أكواد احتياطية جديدة",

  logged_in_platform:
    "يرجى إعلامنا عبر الواتساب",

  market_closed:
    "سوق الانتقالات مغلق في Web App، يرجى التواصل معنا عبر الواتساب",

  wrong_platform:
    "يرجى التواصل معنا عبر الواتساب",

  other_issue:
    "يرجى التواصل معنا عبر الواتساب بشكل عاجل"
};

const DEFAULT_STATUS_MESSAGES = {
  new: "مرحبًا {customerName}، تم استلام طلبك وأصبح في حالة: {status}.",
  review: "مرحبًا {customerName}، أصبحت حالة طلبك: {status}.",
  progress: "مرحبًا {customerName}، أصبحت حالة طلبك: {status}.",
  finished: "مرحبًا {customerName}، تم الانتهاء من سحب الكوين من حسابك.",
  pending_transfer: "مرحبًا {customerName}، أصبحت حالة طلبك: {status}.",
  transferred: "مرحبًا {customerName}، أصبحت حالة طلبك: {status}.",
  completed: "مرحبًا {customerName}، أصبحت حالة طلبك: {status}.",
  archived: "مرحبًا {customerName}، أصبحت حالة طلبك: {status}."
};

const STATUS_LABELS = {
  new: "طلب جديد",
  review: "بانتظار المراجعة",
  progress: "جاري سحب الكوينز من حسابك",
  finished: "تم الانتهاء من سحب الكوينز من حسابك",
  pending_transfer: "قيد التحويل",
  transferred: "قيد التحويل",
  completed: "تم التحويل — مكتمل"
};

const ISSUE_LABELS = {
  wrong_credentials: "الإيميل أو الباسورد غير صحيح",
  wrong_backup_codes: "الأكواد الاحتياطية غير صحيحة",
  logged_in_platform: "تم تسجيل الدخول عبر المنصة يرجى تسجيل الخروج",
  market_closed: "سوق الانتقالات مغلق",
  wrong_platform: "المنصة غير صحيحة",
  other_issue: "مشاكل أخرى"
};

const DECRYPT_WINDOW_MS = 90_000;
const PURGE_DELAY_MS =
  5 * 24 * 60 * 60 * 1000;

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

let decryptTimer = null;
let decryptExpiresAt = null;

let unsubscribeOrders = null;
let unsubscribeReviews = null;
let unsubscribeSettings = null;
let unsubscribeAdmins = null;
let unsubscribeAudit = null;

let liveClockTimer = null;
let ordersRefreshTimer = null;

let lastOrdersCount = null;
let lastReviewsCount = null;

// ==========================================================================
// 1) أدوات API — كل طلبات الإدارة تحمل Firebase ID Token
// ==========================================================================

async function getAdminToken() {
  const user = auth?.currentUser;

  if (!user) {
    throw new Error(
      "جلسة الإدارة غير موجودة."
    );
  }

  return await user.getIdToken();
}

async function adminFetch(
  url,
  options = {}
) {
  const token =
    await getAdminToken();

  const headers = new Headers(
    options.headers || {}
  );

  headers.set(
    "Authorization",
    `Bearer ${token}`
  );

  if (
    options.body &&
    !headers.has(
      "Content-Type"
    )
  ) {
    headers.set(
      "Content-Type",
      "application/json"
    );
  }

  const requestOptions = {
    ...options,
    headers
  };

  if (requestOptions.body && typeof requestOptions.body !== "string") {
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  return fetch(url, requestOptions);
}

async function readJsonResponse(
  response
) {
  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = {
      success: false,
      message:
        "استجابة غير صالحة من الخادم."
    };
  }

  if (
    !response.ok &&
    data?.success !== true
  ) {
    return {
      success: false,
      message:
        data?.message ||
        `فشل الطلب (${response.status})`,
      status:
        response.status
    };
  }

  return data;
}

async function handleAdminAuthFailure(
  response,
  data
) {
  if (
    response?.status !== 401 &&
    response?.status !== 403
  ) {
    return false;
  }

  clearDecryptState();

  const message =
    data?.message ||
    "انتهت صلاحية جلسة الإدارة أو لم تعد الصلاحية متاحة.";

  showLoginError(message);

  try {
    if (auth?.currentUser) {
      await signOut(auth);
    }
  } catch {
    // لا نمنع إظهار شاشة الدخول.
  }

  const overlay =
    document.getElementById(
      "loginOverlay"
    );

  if (overlay) {
    overlay.classList.add(
      "active"
    );
  }

  stopAllListeners();

  return true;
}

// ==========================================================================
async function adminSettingsAction(action, payload = {}) {
  const response = await adminFetch("/api/admin/settings", {
    method: "POST",
    body: JSON.stringify({ action, ...payload })
  });

  const data = await readJsonResponse(response);

  if (await handleAdminAuthFailure(response, data)) {
    throw new Error(data?.message || "انتهت جلسة الإدارة.");
  }

  if (!data?.success) {
    throw new Error(data?.message || "تعذر تنفيذ العملية.");
  }

  return data;
}

// 2) حارس الأمان وتسجيل الدخول
// ==========================================================================

function startAllListeners() {
  if (!unsubscribeOrders) {
    unsubscribeOrders =
      initOrdersListener();
  }

  if (!unsubscribeReviews) {
    unsubscribeReviews =
      initReviewsListener();
  }

  if (!unsubscribeSettings) {
    unsubscribeSettings =
      initSystemSettingsListener();
  }

  if (!unsubscribeAdmins) {
    unsubscribeAdmins =
      initAdminsListener();
  }

  if (!unsubscribeAudit) {
    unsubscribeAudit =
      initAuditLogsListener();
  }

  startLiveClock();
}

function stopAllListeners() {
  const subscriptions = [
    [
      "unsubscribeOrders",
      unsubscribeOrders
    ],
    [
      "unsubscribeReviews",
      unsubscribeReviews
    ],
    [
      "unsubscribeSettings",
      unsubscribeSettings
    ],
    [
      "unsubscribeAdmins",
      unsubscribeAdmins
    ],
    [
      "unsubscribeAudit",
      unsubscribeAudit
    ]
  ];

  subscriptions.forEach(
    ([key, unsubscribe]) => {
      if (
        typeof unsubscribe ===
        "function"
      ) {
        try {
          unsubscribe();
        } catch {
          // لا نوقف بقية الإلغاءات.
        }
      }

      if (
        key ===
        "unsubscribeOrders"
      ) {
        unsubscribeOrders =
          null;
      }

      if (
        key ===
        "unsubscribeReviews"
      ) {
        unsubscribeReviews =
          null;
      }

      if (
        key ===
        "unsubscribeSettings"
      ) {
        unsubscribeSettings =
          null;
      }

      if (
        key ===
        "unsubscribeAdmins"
      ) {
        unsubscribeAdmins =
          null;
      }

      if (
        key ===
        "unsubscribeAudit"
      ) {
        unsubscribeAudit =
          null;
      }
    }
  );

  if (liveClockTimer) {
    clearInterval(
      liveClockTimer
    );

    liveClockTimer =
      null;
  }
}

function initAuthGuard() {
  if (!auth) return;

  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        console.log(
          "Google Redirect Login Successful:",
          result.user.email
        );
      }
    })
    .catch(() => {
      showLoginError(
        "فشل الدخول عبر Google."
      );
    });

  onAuthStateChanged(
    auth,
    async (user) => {
      const loginOverlay =
        document.getElementById(
          "loginOverlay"
        );

      if (!user) {
        clearDecryptState();
        stopAllListeners();

        if (loginOverlay) {
          loginOverlay.classList.add(
            "active"
          );
        }

        return;
      }

      const userEmail =
        String(
          user.email || ""
        )
          .trim()
          .toLowerCase();

      /*
       * هذا الحارس في الواجهة فقط.
       * الحماية الحقيقية دائماً من requireAdmin في backend.
       */
      if (
        ALLOWED_EMAILS.length > 0 &&
        !ALLOWED_EMAILS.includes(
          userEmail
        )
      ) {
        await signOut(auth);

        showToast(
          "غير مصرح لك بدخول لوحة التحكم."
        );

        if (loginOverlay) {
          loginOverlay.classList.add(
            "active"
          );
        }

        return;
      }

      try {
        const response = await adminFetch("/api/admin/session");
        const sessionData = await readJsonResponse(response);

        if (await handleAdminAuthFailure(response, sessionData)) {
          return;
        }

        if (!sessionData?.success || !sessionData?.admin?.uid) {
          throw new Error("ADMIN_SESSION_INVALID");
        }

        currentAdmin = {
          uid: sessionData.admin.uid,
          email: sessionData.admin.email || user.email || "",
          name: sessionData.admin.name || "مشرف النظام",
          role: "admin"
        };

        /*
         * The backend is the authoritative admin gate.
         * The login overlay is hidden only after the protected session
         * endpoint confirms the Firebase ID token and admins/{uid}.
         */
        if (loginOverlay) {
          loginOverlay.classList.remove("active");
        }

        updateSidebarAdminUI();
        startAllListeners();

        await logAuditEvent(
          "تسجيل دخول المشرف",
          "النظام",
          `تم الدخول بواسطة: ${currentAdmin.email}`
        );
      } catch (error) {
        console.error(
          "Admin authentication error:",
          error?.message ||
            error
        );

        showLoginError(
          "⚠️ تعذر التحقق من صلاحيات الإدارة."
        );

        await signOut(auth);

        if (loginOverlay) {
          loginOverlay.classList.add(
            "active"
          );
        }
      }
    }
  );
}

function showLoginError(
  message
) {
  const alertEl =
    document.getElementById(
      "loginErrorAlert"
    );

  if (!alertEl) return;

  alertEl.innerText =
    message;

  alertEl.style.display =
    "block";
}

window.handleEmailLogin =
  async function (event) {
    event.preventDefault();

    const email =
      document
        .getElementById(
          "loginEmail"
        )
        ?.value
        .trim()
        .toLowerCase();

    const password =
      document
        .getElementById(
          "loginPassword"
        )?.value || "";

    if (!email || !password) {
      showLoginError(
        "يرجى إدخال البريد الإلكتروني وكلمة المرور."
      );

      return;
    }

    try {
      const alertEl =
        document.getElementById(
          "loginErrorAlert"
        );

      if (alertEl) {
        alertEl.style.display =
          "none";
      }

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
    } catch {
      showLoginError(
        "❌ البريد الإلكتروني أو كلمة المرور غير صحيحة."
      );
    }
  };

window.handleGoogleLogin =
  async function () {
    const alertEl =
      document.getElementById(
        "loginErrorAlert"
      );

    try {
      if (alertEl) {
        alertEl.style.display =
          "none";
      }

      const provider =
        new GoogleAuthProvider();

      if (
        /Android|iPhone|iPad/i.test(
          navigator.userAgent
        )
      ) {
        await signInWithRedirect(
          auth,
          provider
        );

        return;
      }

      await signInWithPopup(
        auth,
        provider
      );
    } catch {
      showLoginError(
        "❌ تعذر تسجيل الدخول عبر Google."
      );
    }
  };

function updateSidebarAdminUI() {
  const nameEl =
    document.getElementById(
      "sidebarUserName"
    );

  const roleEl =
    document.getElementById(
      "sidebarUserRole"
    );

  const avatarEl =
    document.getElementById(
      "userAvatarText"
    );

  if (nameEl) {
    nameEl.innerText =
      currentAdmin.name ||
      "مشرف النظام";
  }

  if (roleEl) {
    roleEl.innerText =
      "Admin (مشرف)";
  }

  if (avatarEl) {
    avatarEl.innerText =
      (
        currentAdmin.name ||
        "م"
      ).charAt(0);
  }
}

window.handleLogout =
  async function () {
    if (
      !confirm(
        "هل ترغب بتسجيل الخروج؟"
      )
    ) {
      return;
    }

    try {
      await logAuditEvent(
        "تسجيل خروج",
        "النظام",
        `تم خروج: ${currentAdmin.email}`
      );
    } catch {
      // لا نمنع تسجيل الخروج بسبب فشل السجل.
    }

    clearDecryptState();
    stopAllListeners();

    if (auth) {
      await signOut(auth);
    }

    window.location.reload();
  };

// ==========================================================================
// 3) الساعة والإشعارات والسجل
// ==========================================================================

function startLiveClock() {
  const clockEl =
    document.getElementById(
      "liveDatetime"
    );

  if (!clockEl) return;

  if (liveClockTimer) {
    clearInterval(
      liveClockTimer
    );
  }

  const updateClock = () => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Riyadh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const dateText = now.toLocaleDateString("en-GB", {
      timeZone: "Asia/Riyadh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    const weekday = new Intl.DateTimeFormat("ar", {
      timeZone: "Asia/Riyadh",
      weekday: "long"
    }).format(now);
    const { dayClass } = getAdminDateMeta(now);

    clockEl.innerHTML = `
      <span class="clock-stack ${dayClass}">
        <b class="admin-date-box admin-time-box">${time}</b>
        <span class="admin-date-box admin-calendar-box">${dateText}</span>
        <small class="admin-date-box admin-weekday-box">${weekday}</small>
      </span>`;
  };
  updateClock();

  liveClockTimer =
    setInterval(
      updateClock,
      1000
    );
}

function showSystemNotification(
  title,
  text,
  actionCallback = null
) {
  const banner =
    document.getElementById(
      "systemNotificationBanner"
    );

  const titleEl =
    document.getElementById(
      "notificationBannerTitle"
    );

  const textEl =
    document.getElementById(
      "notificationBannerText"
    );

  const actionBtn =
    document.getElementById(
      "notificationBannerAction"
    );

  if (!banner) return;

  if (titleEl) {
    titleEl.innerText =
      title;
  }

  if (textEl) {
    textEl.innerText =
      text;
  }

  if (actionBtn) {
    actionBtn.onclick =
      actionCallback
        ? () => {
            actionCallback();
            banner.style.display =
              "none";
          }
        : null;
  }

  banner.style.display =
    "flex";
}

async function logAuditEvent(
  action,
  targetOrder = "عام",
  details = ""
) {
  try {
    await adminFetch("/api/admin/audit", {
      method: "POST",
      body: {
        action,
        targetOrder,
        details
      }
    });
  } catch (error) {
    console.error(
      "Audit Logging Error:",
      error?.message || error
    );
  }
}

function initAuditLogsListener() {
  const q =
    query(
      collection(
        db,
        "audit_logs"
      ),
      orderBy(
        "timestamp",
        "desc"
      ),
      limit(100)
    );

  return onSnapshot(
    q,
    (snapshot) => {
      auditLogsData =
        snapshot.docs.map(
          (docSnap) => ({
            id:
              docSnap.id,
            ...docSnap.data()
          })
        );

      renderAuditLogsTable();
    },
    (error) => {
      console.error(
        "Audit listener error:",
        error?.message ||
          error
      );
    }
  );
}

function renderAuditLogsTable() {
  const tbody =
    document.getElementById(
      "stockLogsTableBody"
    );

  if (!tbody) return;

  if (
    auditLogsData.length ===
    0
  ) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5"
            style="text-align:center;padding:15px;color:var(--text-muted);">
          لا توجد سجلات حركة مسجلة.
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML =
    auditLogsData
      .map((log) => {
        const refCode =
          log.targetOrder ||
          "عام";

        return `
          <tr>

            <td>
              <span style="font-size:0.78rem;color:var(--text-muted);">
                ${log.timestamp ? formatAdminDate(log.timestamp) : escapeHtml(log.timeString || "---")}
              </span>
            </td>

            <td>
              <b>
                ${escapeHtml(
                  log.user ||
                    "مشرف"
                )}
              </b>
            </td>

            <td>
              <span class="badge badge-review">
                ${escapeHtml(
                  log.action ||
                    "---"
                )}
              </span>
            </td>

            <td>
              <code
                class="copyable-box"
                style="cursor:pointer;"
                onclick="copyTrackingLink('${escapeAttribute(
                  refCode
                )}')">
                #${escapeHtml(
                  refCode
                )}
              </code>
            </td>

            <td>
              <span style="font-size:0.75rem;color:var(--text-muted);">
                ${escapeHtml(
                  log.details ||
                    "---"
                )}
              </span>
            </td>

          </tr>
        `;
      })
      .join("");
}

function initAdminsListener() {
  return onSnapshot(
    collection(
      db,
      "admins"
    ),
    (snapshot) => {
      adminsData =
        snapshot.docs.map(
          (docSnap) => ({
            uid:
              docSnap.id,
            ...docSnap.data()
          })
        );
    },
    (error) => {
      console.error(
        "Admins listener error:",
        error?.message ||
          error
      );
    }
  );
}

window.copyTrackingLink =
  async function (refCode) {
    if (
      !refCode ||
      refCode === "---" ||
      refCode === "عام"
    ) {
      return;
    }

    const url =
      `${window.location.origin}/tracking/?ref=` +
      encodeURIComponent(
        refCode
      );

    try {
      await navigator.clipboard.writeText(
        url
      );

      
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  };

// ==========================================================================
// 4) أدوات عامة
// ==========================================================================

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll(
      "\\",
      "\\\\"
    )
    .replaceAll(
      "'",
      "\\'"
    );
}

function getPlatformMeta(platform) {
  const value = String(platform || "").trim().toUpperCase();
  if (value === "PLAYSTATION") return { label: "PlayStation", icon: "fa-brands fa-playstation", className: "platform-playstation" };
  if (value === "XBOX") return { label: "Xbox", icon: "fa-brands fa-xbox", className: "platform-xbox" };
  return { label: "PC", icon: "fa-solid fa-desktop", className: "platform-pc" };
}

function renderPlatformBadge(platform) {
  const meta = getPlatformMeta(platform);
  return `
    <span class="platform-badge ${meta.className}" title="${escapeAttribute(meta.label)}" aria-label="${escapeAttribute(meta.label)}">
      <i class="${meta.icon}" aria-hidden="true"></i>
    </span>
  `;
}

function getStockTrendMarkup(value) {
  const amount = Number(value) || 0;
  if (amount > 2000000) return '<span class="stock-trend stock-trend-up" title="المخزون أعلى من 2 مليون"><i class="fa-solid fa-arrow-up"></i></span>';
  if (amount < 2000000) return '<span class="stock-trend stock-trend-down" title="المخزون أقل من 2 مليون"><i class="fa-solid fa-arrow-down"></i></span>';
  return '<span class="stock-trend stock-trend-flat" title="المخزون يساوي 2 مليون"><i class="fa-solid fa-minus"></i></span>';
}

function getAdminDateMeta(date) {
  const weekdayKey = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    weekday: "short"
  }).format(date);

  const dayColors = {
    Sat: "day-saturday",
    Sun: "day-sunday",
    Mon: "day-monday",
    Tue: "day-tuesday",
    Wed: "day-wednesday",
    Thu: "day-thursday",
    Fri: "day-friday"
  };

  return { dayClass: dayColors[weekdayKey] || "day-default" };
}

function formatAdminDate(value) {
  const date = parseFirestoreDate(value);
  if (!date) return "---";

  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const dateText = date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const weekday = new Intl.DateTimeFormat("ar", {
    timeZone: "Asia/Riyadh",
    weekday: "long"
  }).format(date);
  const { dayClass } = getAdminDateMeta(date);

  return `<span class="admin-date-stack ${dayClass}">
    <b class="admin-date-box admin-time-box">${time}</b>
    <span class="admin-date-box admin-calendar-box">${dateText}</span>
    <small class="admin-date-box admin-weekday-box">${weekday}</small>
  </span>`;
}

function formatCoinsNumber(
  value
) {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    isNaN(value)
  ) {
    return "0";
  }

  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 0
  });
}


function formatCoinInput(input) {
  if (!input) return;

  const raw = String(input.value || "");
  const digits = raw.replace(/[^0-9]/g, "");

  if (!digits) {
    input.value = "";
    return;
  }

  const cursor = typeof input.selectionStart === "number"
    ? input.selectionStart
    : raw.length;
  const digitsBeforeCursor = raw
    .slice(0, cursor)
    .replace(/[^0-9]/g, "").length;

  const formatted = Number(digits).toLocaleString("en-US", {
    maximumFractionDigits: 0
  });

  input.value = formatted;

  let newCursor = formatted.length;
  if (digitsBeforeCursor < digits.length) {
    let seen = 0;
    newCursor = 0;
    for (let i = 0; i < formatted.length; i += 1) {
      if (/\d/.test(formatted[i])) seen += 1;
      newCursor = i + 1;
      if (seen >= digitsBeforeCursor) break;
    }
  }

  try {
    input.setSelectionRange(newCursor, newCursor);
  } catch {}
}

window.formatCoinInput = formatCoinInput;

function parseFirestoreDate(
  value
) {
  if (!value) return null;

  if (
    typeof value ===
      "object" &&
    typeof value.seconds ===
      "number"
  ) {
    return new Date(
      value.seconds * 1000
    );
  }

  if (
    typeof value ===
      "object" &&
    typeof value.toDate ===
      "function"
  ) {
    return value.toDate();
  }

  const date =
    new Date(value);

  return isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function getPurgeDueDate(
  order
) {
  const dueDate =
    parseFirestoreDate(
      order?.purgeDueAt
    );

  if (dueDate) {
    return dueDate;
  }

  const completedDate =
    parseFirestoreDate(
      order?.completedAt
    );

  if (!completedDate) {
    return null;
  }

  return new Date(
    completedDate.getTime() +
      PURGE_DELAY_MS
  );
}

function isPurgeDue(
  order
) {
  if (
    !order ||
    order.status !==
      "completed" ||
    order.sensitivePurged ===
      true
  ) {
    return false;
  }

  const dueDate =
    getPurgeDueDate(
      order
    );

  if (!dueDate) {
    return false;
  }

  return (
    Date.now() >=
    dueDate.getTime()
  );
}

function calculatePurgeCountdown(
  order
) {
  if (!order) {
    return `
      <span style="color:var(--text-muted);">
        ---
      </span>
    `;
  }

  if (
    order.sensitivePurged ===
    true
  ) {
    return `
      <span style="color:var(--success);font-weight:900;">
        <i class="fa-solid fa-circle-check"></i>
        تم الإتلاف
      </span>
    `;
  }

  if (
    order.status !==
    "completed"
  ) {
    return `
      <span style="color:var(--text-muted);">
        يبدأ بعد اكتمال الطلب
      </span>
    `;
  }

  const dueDate =
    getPurgeDueDate(
      order
    );

  if (!dueDate) {
    return `
      <span style="color:var(--text-muted);">
        بانتظار تاريخ الإتلاف
      </span>
    `;
  }

  const remaining =
    dueDate.getTime() -
    Date.now();

  if (remaining <= 0) {
    return `
      <span style="color:#ef4444;font-weight:900;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        مستحق للإتلاف
      </span>
    `;
  }

  const totalHours =
    Math.floor(
      remaining /
        (1000 * 60 * 60)
    );

  const daysLeft =
    Math.floor(
      totalHours / 24
    );

  const hoursLeft =
    totalHours % 24;

  let color =
    "var(--success)";

  if (daysLeft <= 1) {
    color = "#ef4444";
  } else if (
    daysLeft <= 3
  ) {
    color = "#f59e0b";
  }

  return `
    <span style="color:${color};font-weight:900;font-size:0.8rem;">
      <i class="fa-solid fa-clock"></i>
      متبقي ${daysLeft} يوم و ${hoursLeft} ساعة
    </span>
  `;
}

function getDisplayPrice(
  order
) {
  if (
    order?.displayTotalPrice
  ) {
    return String(
      order.displayTotalPrice
    );
  }

  if (
    order?.totalPrice
  ) {
    return String(
      order.totalPrice
    );
  }

  if (
    order?.priceCurrency ===
    "USDT"
  ) {
    const usd =
      Number(
        order.totalPriceUsd
      );

    if (
      Number.isFinite(usd)
    ) {
      return `$${usd.toFixed(
        2
      )}`;
    }
  }

  const sar =
    Number(
      order.totalPriceSar
    );

  if (
    Number.isFinite(sar)
  ) {
    return `${sar.toFixed(
      2
    )} ر.س`;
  }

  return "0 ر.س";
}

function getDisplayPriceMarkup(order) {
  const amount = getSarAmount(order);
  return `<span class="order-price-stack"><small>ريال سعودي</small><strong>${amount.toFixed(2)}</strong></span>`;
}

function getSarAmount(
  order
) {
  const sar =
    Number(
      order?.totalPriceSar
    );

  if (
    Number.isFinite(sar)
  ) {
    return sar;
  }

  const parsed =
    parseFloat(
      String(
        getDisplayPrice(order)
      ).replace(
        /[^0-9.]/g,
        ""
      )
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : 0;
}

function getIssueMessages() {
  return {
    ...DEFAULT_ISSUE_MESSAGES,
    ...(currentSettingsData.issueMessages ||
      {})
  };
}

function getIssueLabel(
  issue
) {
  const messages =
    getIssueMessages();

  return (
    messages[issue] ||
    ISSUE_LABELS[issue] ||
    "توجد مشكلة في الطلب"
  );
}

async function sendIssueViaWhatsapp(orderId) {
  const order = ordersData.find((item) => item.id === orderId);
  if (!order || !order.phone || !order.issue) {
    showToast("لا توجد بيانات كافية لإرسال رسالة واتساب.");
    return;
  }

  const message = String(
    order.issueMessage ||
    DEFAULT_ISSUE_MESSAGES[order.issue] ||
    ""
  ).trim();

  if (!message) {
    showToast("لا توجد رسالة مجهزة لهذه المشكلة.");
    return;
  }

  const phone = String(order.phone).replace(/[^0-9]/g, "");
  const textMessage = (
    "مرحباً " + (order.name || "") +
    "\n\n" + message +
    "\n\nرقم الطلب: " + (order.referenceNumber || "--") +
    "\n\nسامي كوينز"
  ).trim();

  localStorage.setItem(
    "samiCoins:lastWhatsApp:" + order.id,
    JSON.stringify({
      phone,
      message: textMessage,
      templateCode: order.issue,
      savedAt: Date.now()
    })
  );

  try {
    await adminFetch("/api/admin/log-whatsapp", {
      method: "POST",
      body: JSON.stringify({
        orderId: order.id,
        referenceNumber: order.referenceNumber || "",
        recipient: phone,
        message: textMessage,
        templateCode: order.issue
      })
    });
  } catch (error) {
    console.warn("WhatsApp log failed:", error);
  }

  window.open(
    "https://wa.me/" + phone + "?text=" + encodeURIComponent(textMessage),
    "_blank",
    "noopener,noreferrer"
  );
}

function resendLastWhatsapp(orderId) {
  const raw = localStorage.getItem(
    "samiCoins:lastWhatsApp:" + orderId
  );

  if (!raw) {
    showToast("لا توجد رسالة واتساب سابقة لهذا الطلب.");
    return;
  }

  try {
    const saved = JSON.parse(raw);

    if (!saved?.phone || !saved?.message) {
      throw new Error("invalid_saved_message");
    }

    window.open(
      "https://wa.me/" +
        saved.phone +
        "?text=" +
        encodeURIComponent(saved.message),
      "_blank",
      "noopener,noreferrer"
    );
  } catch {
    showToast("تعذر إعادة إرسال الرسالة السابقة.");
  }
}

function getIssueBadge(
  issue
) {
  if (!issue) {
    return "";
  }

  return `
    <span
      class="badge"
      style="
        background:rgba(239,68,68,0.12);
        color:#ef4444;
        border:1px solid rgba(239,68,68,0.3);
      ">
      <i class="fa-solid fa-triangle-exclamation"></i>
      ${escapeHtml(
        getIssueLabel(
          issue
        )
      )}
    </span>
  `;
}

function getPaymentPreviewText(
  order
) {
  const preview =
    order?.paymentPreview ||
    {};

  const parts = [];

  if (
    preview.bankName
  ) {
    parts.push(
      preview.bankName
    );
  }

  if (
    preview.ibanMasked
  ) {
    parts.push(
      preview.ibanMasked
    );
  }

  if (
    preview.walletName
  ) {
    parts.push(
      preview.walletName
    );
  }

  if (
    preview.phoneMasked
  ) {
    parts.push(
      preview.phoneMasked
    );
  }

  if (
    preview.usdtWalletMasked
  ) {
    parts.push(
      preview.usdtWalletMasked
    );
  }

  if (
    preview.paypalEmailMasked
  ) {
    parts.push(
      preview.paypalEmailMasked
    );
  }

  if (
    preview.westernName
  ) {
    parts.push(
      preview.westernName
    );
  }

  if (
    preview.westernCountry
  ) {
    parts.push(
      preview.westernCountry
    );
  }

  return parts.join(
    " — "
  );
}

// ==========================================================================
// 5) الطلبات
// ==========================================================================

function initOrdersListener() {
  let stopped = false;
  let controller = null;
  let reconnectTimer = null;

  const connect = async () => {
    if (stopped) return;

    try {
      const token = await getAdminToken();
      if (!token || stopped) return;

      controller = new AbortController();

      const response = await fetch("/api/orders/events", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream"
        },
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok || !response.body) {
        throw new Error(`Orders SSE failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          if (!frame.includes("event: order-update")) continue;

          try {
            await loadOrders();
          } catch (error) {
            console.error("Live orders refresh error:", error);
          }
        }
      }
    } catch (error) {
      if (!stopped && error?.name !== "AbortError") {
        console.error("Orders live stream error:", error);
      }
    } finally {
      controller = null;

      if (!stopped) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 3000);
      }
    }
  };

  loadOrders();
  scheduleOrdersPeriodicRefresh();
  connect();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(ordersRefreshTimer);
    if (controller) {
      try { controller.abort(); } catch {}
    }
  };
}

function scheduleOrdersPeriodicRefresh() {
  clearTimeout(ordersRefreshTimer);
  const minMs = 15 * 60 * 1000;
  const maxMs = 60 * 60 * 1000;
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));

  ordersRefreshTimer = setTimeout(async () => {
    try {
      await loadOrders();
    } catch (error) {
      console.error("Periodic orders refresh error:", error);
    } finally {
      scheduleOrdersPeriodicRefresh();
    }
  }, delay);
}

async function loadOrders() {
  try {
    const response =
      await adminFetch(
        "/api/orders/list"
      );

    const data =
      await readJsonResponse(
        response
      );

    if (
      await handleAdminAuthFailure(
        response,
        data
      )
    ) {
      return;
    }

    if (!data.success) {
      return;
    }

    const previousCount =
      ordersData.length;

    ordersData =
      (data.orders || [])
        .map(
          (order) => ({
            id:
              order.id,

            orderId:
              order.orderId ||
              order.businessOrderId ||
              "",

            referenceNumber:
              order.referenceNumber ||
              order.reference ||
              "",

            internalReference:
              order.internalReference ||
              "",

            name:
              order.customerName ||
              order.name ||
              "",

            phone:
              order.phone ||
              "",

            customerEmail:
              order.customerEmail ||
              "",

            adminNote:
              order.adminNote ||
              "",

            platform:
              order.platform ||
              "",

            totalQty:
              Number(
                order.quantity ??
                order.totalQty ??
                order.totalQtyRequested ??
                order.requestedQuantity ??
                0
              ),

            totalPrice:
              order.displayTotalPrice ??
              order.totalPrice ??
              order.total ??
              "0 ر.س",

            displayTotalPrice:
              order.displayTotalPrice ||
              "",

            totalPriceSar:
              Number(
                order.totalPriceSar
              ) || 0,

            totalPriceUsd:
              Number(
                order.totalPriceUsd
              ) || 0,

            priceCurrency:
              order.priceCurrency ||
              "SAR",

            rate:
              Number(
                order.rate
              ) || 0,

            status:
              order.status ||
              order.orderStatus ||
              "new",

            issue:
              order.issue ||
              null,

            issueMessage:
              order.issueMessage ||
              "",

            issueState:
              order.issueState ||
              (order.issue ? "needs_customer_action" : "resolved"),

            paymentMethod:
              order.paymentPreview
                ?.method ||
              order.payoutDetails
                ?.method ||
              order.paymentMethodType ||
              order.paymentMethod ||
              "",

            paymentType:
              order.paymentPreview
                ?.payoutType ||
              order.payoutDetails
                ?.payoutType ||
              order.paymentMethodType ||
              "",

            paymentPreview:
              order.paymentPreview ||
              {},

            bankName:
              order.paymentPreview
                ?.bankName ||
              order.payoutDetails
                ?.bankName ||
              order.paymentInfoData
                ?.bankName ||
              order.bankName ||
              "",

            accountIban:
              order.paymentPreview
                ?.ibanMasked ||
              "",

            withdrawnQuantity:
              Number(
                order.withdrawnQuantity ??
                order.drawnCoins ??
                0
              ),

            drawnCoins:
              Number(
                order.drawnCoins ??
                order.withdrawnQuantity ??
                0
              ),

            transferData:
              order.transferData ||
              null,

            completedAt:
              order.completedAt ||
              null,

            purgeDueAt:
              order.purgeDueAt ||
              null,

            sensitivePurged:
              order.sensitivePurged ===
              true,

            history:
              Array.isArray(order.history)
                ? order.history
                : [],

            createdAt:
              parseFirestoreDate(
                order.createdAt
              ),

            updatedAt:
              parseFirestoreDate(
                order.updatedAt
              )
          })
        );

    if (
      lastOrdersCount !==
        null &&
      ordersData.length >
        lastOrdersCount
    ) {
      showSystemNotification(
        "طلب جديد",
        "تم استقبال طلب جديد في النظام.",
        () =>
          switchTab(
            "ordersTab",
            document.querySelector(
              ".sidebar-menu .sidebar-link"
            )
          )
      );
    }

    lastOrdersCount =
      ordersData.length ||
      previousCount;

    refreshOrdersDerivedUI();
  } catch (error) {
    console.error(
      "Load Orders Error:",
      error?.message ||
        error
    );
  }
}

function refreshOrdersDerivedUI() {
  sortOrdersByPriority();
  renderInventoryUI(currentSettingsData);
  renderDashboardQuickStats();
  renderStatisticsPage();
  renderOrdersTables();
  renderWithdrawOrdersTable();
  renderRecentOrdersTable();
  renderTransferAlertsTable();
  renderPurgeOrdersTable();
  renderClientsTable(activeSearchQuery);

  const newOrdersBadge =
    document.getElementById("mobileOrdersBadge");

  if (newOrdersBadge) {
    const newOrders =
      ordersData.filter((item) =>
        ["new", "review"].includes(item.status)
      ).length;

    newOrdersBadge.textContent = String(newOrders);
    newOrdersBadge.style.display =
      newOrders > 0 ? "grid" : "none";
  }
}

function sortOrdersByPriority() {
  const priorityMap = {
    progress: 1,
    new: 2,
    pending: 2,
    review: 3,
    finished: 4,
    pending_transfer: 5,
    transferred: 6,
    completed: 7,
    archived: 8
  };

  ordersData.sort(
    (a, b) => {
      const pA =
        priorityMap[
          a.status
        ] || 8;

      const pB =
        priorityMap[
          b.status
        ] || 8;

      if (pA !== pB) {
        return pA - pB;
      }

      const timeA =
        a.createdAt
          ? a.createdAt.getTime()
          : 0;

      const timeB =
        b.createdAt
          ? b.createdAt.getTime()
          : 0;

      return timeB - timeA;
    }
  );
}

function renderDashboardQuickStats() {
  const countNew =
    ordersData.filter(
      (o) =>
        o.status === "new" ||
        o.status === "pending"
    ).length;

  const countProgress =
    ordersData.filter(
      (o) =>
        o.status ===
        "progress"
    ).length;

  const countFinished =
    ordersData.filter(
      (o) =>
        o.status ===
          "finished" ||
        o.status ===
          "transferred" ||
        o.status ===
          "completed"
    ).length;

  const countTransferPending =
    ordersData.filter(
      (o) => o.status === "pending_transfer"
    ).length;

  const purgeCount =
    ordersData.filter(
      (o) =>
        isPurgeDue(o)
    ).length;

  const setText =
    (
      id,
      value
    ) => {
      const element =
        document.getElementById(
          id
        );

      if (element) {
        element.innerText =
          value;
      }
    };

  setText(
    "dashStatNew",
    countNew
  );

  setText(
    "dashStatProgress",
    countProgress
  );

  setText(
    "dashStatCompleted",
    countFinished
  );

  setText(
    "dashStatPendingTransfer",
    countTransferPending
  );

  setText(
    "dashStatPurge",
    purgeCount
  );

  const badge =
    document.getElementById(
      "sidebarNewOrdersBadge"
    );

  if (badge) {
    badge.innerText =
      countNew;

    badge.style.display =
      countNew > 0
        ? "inline-block"
        : "none";
  }

  const inventory = calculateLocalInventory();
  setText("dashStockPS", formatCoinsNumber(inventory.shared.remaining));
  setText("dashStockPC", formatCoinsNumber(inventory.pc.remaining));

  const psTrend = document.getElementById("dashStockPSTrend");
  const pcTrend = document.getElementById("dashStockPCTrend");
  if (psTrend) psTrend.innerHTML = getStockTrendMarkup(inventory.shared.remaining);
  if (pcTrend) pcTrend.innerHTML = getStockTrendMarkup(inventory.pc.remaining);
}

function renderStatisticsPage() {
  let totalCoins = 0;
  let withdrawnCoins = 0;
  let playstationCoins = 0;
  let xboxCoins = 0;
  let pcCoins = 0;
  let transferredMoneySar = 0;
  const clientsSet = new Set();

  ordersData.forEach((order) => {
    const total = Math.max(0, Number(order.totalQty ?? order.quantity ?? 0) || 0);
    const withdrawn = Math.min(
      total,
      Math.max(0, Number(order.withdrawnQuantity ?? order.drawnCoins ?? 0) || 0)
    );
    const platform = String(order.platform || "").trim().toUpperCase();

    totalCoins += total;
    withdrawnCoins += withdrawn;

    if (platform === "PLAYSTATION") playstationCoins += total;
    else if (platform === "XBOX") xboxCoins += total;
    else if (platform === "PC") pcCoins += total;

    if (order.phone) clientsSet.add(order.phone);

    const wasTransferred =
      order.transferCompleted === true ||
      order.status === "transferred" ||
      order.status === "completed";

    if (wasTransferred) transferredMoneySar += getSarAmount(order);
  });

  const remainingCoins = Math.max(0, totalCoins - withdrawnCoins);
  const inventory = calculateLocalInventory();

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  };

  setText("statsTotalOrders", ordersData.length);
  setText("statsTotalClients", clientsSet.size);
  setText("statsTotalCoins", formatCoinsNumber(totalCoins));
  setText("statsWithdrawnCoins", formatCoinsNumber(withdrawnCoins));
  setText("statsRemainingCoins", formatCoinsNumber(remainingCoins));
  setText("statsPlayStationCoins", formatCoinsNumber(playstationCoins));
  setText("statsXboxCoins", formatCoinsNumber(xboxCoins));
  setText("statsPCCoins", formatCoinsNumber(pcCoins));
  setText(
    "statsTransferredMoney",
    transferredMoneySar.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ريال"
  );

  const stockPs = document.getElementById("statsStockPSTrend");
  const stockPc = document.getElementById("statsStockPCTrend");
  setText("statsStockPSValue", formatCoinsNumber(inventory.shared.remaining));
  setText("statsStockPCValue", formatCoinsNumber(inventory.pc.remaining));
  if (stockPs) stockPs.innerHTML = getStockTrendMarkup(inventory.shared.remaining);
  if (stockPc) stockPc.innerHTML = getStockTrendMarkup(inventory.pc.remaining);

  const statsTotalOrdersSub = document.getElementById("statsTotalOrdersSub");
  const statsWithdrawnSub = document.getElementById("statsWithdrawnSub");
  const statsTransferredSub = document.getElementById("statsTransferredSub");

  if (statsTotalOrdersSub) statsTotalOrdersSub.innerText = `${clientsSet.size} عميل`;
  if (statsWithdrawnSub) statsWithdrawnSub.innerText = `من ${formatCoinsNumber(totalCoins)} إجمالي الكمية`;
  if (statsTransferredSub) statsTransferredSub.innerText = "إجمالي المبالغ التي تم تحويلها";
}

window.handleGlobalSearch =
  function (value) {
    activeSearchQuery =
      String(value || "")
        .trim()
        .toLowerCase();

    renderOrdersTables();
    renderWithdrawOrdersTable();
    renderClientsTable(
      activeSearchQuery
    );
  };

// ==========================================================================
// 6) جداول الطلبات
// ==========================================================================

function buildActionButtonsHTML(order) {
  const refNum = order.referenceNumber || order.orderId || order.id;
  return `
    <div class="order-list-actions">
      <button class="btn-action order-details-action" title="التفاصيل"
        onclick="openOrderModal('${escapeAttribute(order.id)}')">
        <i class="fa-solid fa-eye"></i>
      </button>
      <button class="btn-action order-edit-action" title="تعديل الحالة"
        onclick="openOrderStatusEditForm('${escapeAttribute(order.id)}')">
        <i class="fa-solid fa-pen-to-square"></i>
      </button>
      <button class="btn-action order-archive-action" title="أرشفة"
        onclick="handleArchiveOrder('${escapeAttribute(order.id)}','${escapeAttribute(refNum)}')">
        <i class="fa-solid fa-box-archive"></i>
      </button>
      ${order.issue ? `
      <button class="btn-action" style="color:#25D366;border-color:#25D366;" title="إرسال رسالة المشكلة عبر واتساب"
        onclick="sendIssueViaWhatsapp('${escapeAttribute(order.id)}')"><i class="fa-brands fa-whatsapp"></i></button>
      <button class="btn-action" style="color:#25D366;border-color:#25D366;" title="إعادة إرسال آخر رسالة واتساب"
        onclick="resendLastWhatsapp('${escapeAttribute(order.id)}')"><i class="fa-solid fa-rotate-right"></i></button>
      ` : ""}
      <button class="btn-action" style="color:var(--danger);border-color:var(--danger);" title="حذف الطلب"
        onclick="handleDeleteOrder('${escapeAttribute(order.id)}','${escapeAttribute(refNum)}')">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;
}
function getStatusBadge(status) {
  const labels = {
    new: "طلب جديد",
    pending: "طلب جديد",
    review: "بانتظار المراجعة",
    progress: "جاري سحب الكوينز من حسابك",
    finished: "تم الانتهاء من سحب الكوينز من حسابك",
    pending_transfer: "قيد التحويل",
    transferred: "قيد التحويل",
    completed: "تم التحويل — مكتمل"
  };
  const key = status === "pending" ? "new" : status;
  return `<span class="badge status-badge status-${key || "unknown"}">${escapeHtml(labels[key] || status || "---")}</span>`;
}

function getOrderStatusBadge(order) {
  const meta = getPlatformMeta(order?.platform);
  const status = String(order?.status || "").trim().toLowerCase();
  const labels = {
    new: "طلب جديد",
    pending: "طلب جديد",
    review: "طلب بانتظار المراجعة",
    progress: "جاري سحب الكوينز من حسابك",
    finished: "تم الانتهاء من سحب الكوينز من حسابك",
    pending_transfer: "بانتظار التحويل",
    transferred: "تم تحويل المبلغ إلى حسابك",
    completed: "مكتمل",
    archived: "مؤرشف"
  };
  const label = order?.issue
    ? getIssueLabel(order.issue)
    : (labels[status] || status || "---");
  const icon = order?.issue ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : '';
  return `<span class="badge platform-status-badge ${meta.className}" title="${escapeAttribute(label)}">${icon}${escapeHtml(label)}</span>`;
}

window.renderOrdersTables =
  function () {
    const tbody = document.getElementById("fullOrdersTableBody");
    if (!tbody) return;

    const filter = document.getElementById("orderStatusFilter")?.value || "all";
    let filteredData = ordersData;

    if (filter !== "all") {
      filteredData = ordersData.filter((order) => order.status === filter);
    }

    if (activeSearchQuery) {
      filteredData = filteredData.filter((order) => {
        const ref = String(order.referenceNumber || "").toLowerCase();
        const name = String(order.name || "").toLowerCase();
        const phone = String(order.phone || "").toLowerCase();
        const orderId = String(order.orderId || "").toLowerCase();

        return (
          ref.includes(activeSearchQuery) ||
          name.includes(activeSearchQuery) ||
          phone.includes(activeSearchQuery) ||
          orderId.includes(activeSearchQuery)
        );
      });
    }

    if (filteredData.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="8" class="empty-row">لا توجد طلبات مسجلة مطابقة.</td></tr>
      `;
      return;
    }

    tbody.innerHTML = filteredData.map((order) => {
      const ref = order.referenceNumber || "---";
      const internalRef = order.internalReference || order.orderId || order.id || "---";

      return `
        <tr class="full-order-row platform-order-card ${getPlatformMeta(order.platform).className}">
          <td data-label="الطلب" class="order-data-cell">
            <div class="order-ref-stack">
              <span class="table-field-label">الطلب</span>
              <small>${escapeHtml(internalRef)}</small>
              <b class="order-value-box order-reference-value" onclick="copyTrackingLink('${escapeAttribute(ref)}')" title="نسخ رابط التتبع">
                ${escapeHtml(ref)} <i class="fa-solid fa-copy" aria-hidden="true"></i>
              </b>
            </div>
          </td>
          <td data-label="العميل" class="order-data-cell"><span class="table-field-label">العميل</span><strong class="order-value-box table-primary-value">${escapeHtml(order.name || "---")}</strong></td>
          <td data-label="المنصة" class="order-data-cell"><span class="table-field-label">المنصة</span>${renderPlatformBadge(order.platform)}</td>
          <td data-label="الكمية" class="order-data-cell"><span class="table-field-label">الكمية</span><strong class="order-value-box recent-quantity table-large-value">${formatCoinsNumber(order.totalQty)}</strong></td>
          <td data-label="ريال سعودي" class="order-data-cell"><span class="table-field-label">المبلغ</span><strong class="order-value-box recent-price table-large-value">${getDisplayPriceMarkup(order)}</strong></td>
          <td data-label="الحالة" class="order-data-cell"><span class="table-field-label">الحالة</span>${getOrderStatusBadge(order)}</td>
          <td data-label="آخر تحديث"><span class="last-update-value">${formatAdminDate(order.lastUpdate || order.updatedAt || order.createdAt)}</span></td>
          <td data-label="الإجراء" class="recent-actions-cell"><div class="recent-order-actions">${buildActionButtonsHTML(order)}</div></td>
        </tr>
      `;
    }).join("");
  };

window.renderRecentOrdersTable =
  function () {
    const tbody = document.getElementById("recentOrdersTableBody");
    if (!tbody) return;

    const recentOrders = [...ordersData]
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, 5);

    if (recentOrders.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="7" class="empty-row">لا توجد طلبات حديثة.</td></tr>
      `;
      return;
    }

    tbody.innerHTML = recentOrders.map((order) => {
      const ref = order.referenceNumber || "---";
      const internalRef = order.internalReference || order.orderId || order.id || "---";

      return `
        <tr class="recent-order-row platform-order-card ${getPlatformMeta(order.platform).className}">
          <td data-label="الطلب" class="order-data-cell">
            <div class="order-ref-stack">
              <span class="table-field-label">الطلب</span>
              <small>${escapeHtml(internalRef)}</small>
              <b class="order-value-box order-reference-value" onclick="copyTrackingLink('${escapeAttribute(ref)}')" title="نسخ رابط التتبع">
                ${escapeHtml(ref)} <i class="fa-solid fa-copy" aria-hidden="true"></i>
              </b>
            </div>
          </td>
          <td data-label="العميل" class="order-data-cell"><span class="table-field-label">العميل</span><strong class="order-value-box recent-customer-name table-primary-value">${escapeHtml(order.name || "---")}</strong></td>
          <td data-label="المنصة" class="order-data-cell"><span class="table-field-label">المنصة</span>${renderPlatformBadge(order.platform)}</td>
          <td data-label="الكمية" class="order-data-cell"><span class="table-field-label">الكمية</span><strong class="order-value-box recent-quantity table-large-value">${formatCoinsNumber(order.totalQty)}</strong></td>
          <td data-label="ريال سعودي" class="order-data-cell"><span class="table-field-label">المبلغ</span><strong class="order-value-box recent-price table-large-value">${getDisplayPriceMarkup(order)}</strong></td>
          <td data-label="الحالة" class="order-data-cell"><span class="table-field-label">الحالة</span>${getOrderStatusBadge(order)}</td>
          <td data-label="الإجراء" class="recent-actions-cell"><div class="recent-order-actions">${buildActionButtonsHTML(order)}</div></td>
        </tr>
      `;
    }).join("");
  };

window.renderWithdrawOrdersTable =
  function () {
    const tbody = document.getElementById("withdrawOrdersTableBody");
    if (!tbody) return;

    let withdrawOrders = ordersData.filter((order) =>
      ["new", "pending", "review", "progress"].includes(order.status)
    );

    const filter = document.getElementById("withdrawFilter")?.value || "all";
    if (filter !== "all") {
      withdrawOrders = withdrawOrders.filter((order) => order.status === filter);
    }

    const badge = document.getElementById("withdrawBadgeCount");
    if (badge) badge.innerText = String(withdrawOrders.length);

    const headerBadge = document.getElementById("withdrawHeaderBadge");
    if (headerBadge) headerBadge.innerText = `${withdrawOrders.length} طلبات بانتظار الإجراء`;

    if (withdrawOrders.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="8" class="empty-row">لا توجد طلبات سحب مطابقة للفلتر المختار.</td></tr>
      `;
      return;
    }

    tbody.innerHTML = withdrawOrders.map((order) => {
      const total = Math.max(0, Number(order.totalQty) || 0);
      const withdrawn = Math.min(
        total,
        Math.max(0, Number(order.withdrawnQuantity ?? order.drawnCoins ?? 0) || 0)
      );
      const remaining = Math.max(0, total - withdrawn);
      const ref = order.referenceNumber || "---";

      return `
        <tr class="withdraw-order-row platform-order-card ${getPlatformMeta(order.platform).className}">
          <td data-label="الطلب" class="order-data-cell">
            <div class="order-ref-stack">
              <span class="table-field-label">الطلب</span>
              <small>${escapeHtml(order.internalReference || order.orderId || order.id || "---")}</small>
              <b class="order-reference-value" onclick="copyTrackingLink('${escapeAttribute(ref)}')">${escapeHtml(ref)}</b>
            </div>
          </td>
          <td data-label="العميل" class="order-data-cell"><span class="table-field-label">العميل</span><strong class="table-primary-value">${escapeHtml(order.name || "---")}</strong></td>
          <td data-label="المنصة" class="order-data-cell"><span class="table-field-label">المنصة</span>${renderPlatformBadge(order.platform)}</td>
          <td data-label="المطلوب" class="order-data-cell"><span class="table-field-label">الكمية</span><strong class="recent-quantity table-large-value">${formatCoinsNumber(total)}</strong></td>
          <td data-label="المسحوب" class="order-data-cell"><span class="table-field-label">المسحوب</span><strong class="withdrawn-value table-large-value">${formatCoinsNumber(withdrawn)}</strong></td>
          <td data-label="المتبقي" class="order-data-cell"><span class="table-field-label">المتبقي</span><strong class="remaining-value table-large-value">${formatCoinsNumber(remaining)}</strong></td>
          <td data-label="الحالة" class="order-data-cell"><span class="table-field-label">الحالة</span>${getOrderStatusBadge(order)}</td>
          <td data-label="الإجراء" class="recent-actions-cell"><div class="recent-order-actions">${buildActionButtonsHTML(order)}</div></td>
        </tr>
      `;
    }).join("");
  };

window.renderTransferAlertsTable =
  function () {
    const tbody =
      document.getElementById(
        "transferAlertsTableBody"
      );

    const banner =
      document.getElementById(
        "urgentTransferBanner"
      );

    const bannerText =
      document.getElementById(
        "bannerTransferText"
      );

    const transferOrders =
      ordersData.filter(
        (order) =>
          order.status === "pending_transfer"
      );

    const badgeCount =
      document.getElementById(
        "transferBadgeCount"
      );

    if (badgeCount) {
      badgeCount.innerText =
        transferOrders.length;
    }

    const headerBadge =
      document.getElementById(
        "transferHeaderBadge"
      );

    if (headerBadge) {
      headerBadge.innerText =
        `${transferOrders.length} طلبات بحاجة للتحويل`;
    }

    if (banner) {
      banner.style.display =
        transferOrders.length >
        0
          ? "flex"
          : "none";

      if (
        bannerText &&
        transferOrders.length >
          0
      ) {
        bannerText.innerText =
          `لديك (${transferOrders.length}) طلبات مكتملة السحب بانتظار التحويل المالي للعملاء.`;
      }
    }

    if (!tbody) return;

    if (
      transferOrders.length ===
      0
    ) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7"
              style="text-align:center;color:var(--text-muted);padding:20px;">
            لا توجد طلبات بحاجة للتحويل حالياً.
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML =
      transferOrders
        .map(
          (order) => {
            const ref =
              order.referenceNumber ||
              "";

            return `
              <tr>

                <td>
                  <b
                    style="color:var(--primary);font-family:monospace;cursor:pointer;"
                    onclick="copyTrackingLink('${escapeAttribute(
                      ref
                    )}')">
                    ${escapeHtml(
                      ref || "---"
                    )}
                  </b>
                </td>

                <td>
                  ${escapeHtml(
                    order.name ||
                      "---"
                  )}
                </td>

                <td>
                  <span style="font-family:monospace;">
                    ${escapeHtml(
                      order.phone ||
                        "---"
                    )}
                  </span>
                </td>

                <td>
                  <b style="color:#f59e0b;">
                    ${escapeHtml(
                      getDisplayPrice(
                        order
                      )
                    )}
                  </b>
                </td>

                <td>
                  <span class="badge badge-review">
                    ${escapeHtml(
                      order.paymentMethod ||
                        "---"
                    )}
                    ${
                      order.bankName
                        ? " - " +
                          escapeHtml(
                            order.bankName
                          )
                        : ""
                    }
                  </span>
                </td>

                <td>
                  ${escapeHtml(
                    order.createdAt
                      ? order.createdAt.toLocaleString(
                          "en-GB",
                          {
                            timeZone:
                              "Asia/Riyadh"
                          }
                        )
                      : "---"
                  )}
                </td>

                <td>
                  <button
                    class="btn-custom"
                    style="background:#f59e0b;color:#fff;font-size:0.75rem;padding:6px 12px;"
                    onclick="openOrderModal('${escapeAttribute(
                      order.id
                    )}')">
                    معاينة وإتمام التحويل
                  </button>
                </td>

              </tr>
            `;
          }
        )
        .join("");
  };

// ==========================================================================
// 7) قسم الإتلاف — بعد 5 أيام من completedAt
// ==========================================================================

window.renderPurgeOrdersTable =
  function () {
    const tbody =
      document.getElementById(
        "purgeOrdersTableBody"
      );

    const badge =
      document.getElementById(
        "purgeBadgeCount"
      );

    const headerBadge =
      document.getElementById(
        "purgeHeaderBadge"
      );

    const purgeOrders =
      ordersData.filter(
        (order) =>
          order.status ===
            "completed" &&
          order.sensitivePurged !==
            true
      );

    const dueCount =
      purgeOrders.filter(
        (order) =>
          isPurgeDue(order)
      ).length;

    if (badge) {
      badge.innerText =
        dueCount;
    }

    if (headerBadge) {
      headerBadge.innerText =
        `${dueCount} طلبات مستحقة للإتلاف`;
    }

    if (!tbody) return;

    if (
      purgeOrders.length ===
      0
    ) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9"
              style="text-align:center;padding:20px;color:var(--text-muted);">
            لا توجد بيانات حساسة بانتظار الإتلاف.
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML =
      purgeOrders
        .map(
          (order) => {
            const ref =
              order.referenceNumber ||
              order.orderId ||
              order.id;

            const due =
              isPurgeDue(order);

            return `
              <tr
                style="${
                  due
                    ? "background:rgba(239,68,68,0.06);"
                    : ""
                }">

                <td>
                  <b
                    style="color:var(--primary);font-family:monospace;cursor:pointer;"
                    onclick="copyTrackingLink('${escapeAttribute(
                      ref
                    )}')">
                    ${escapeHtml(
                      ref
                    )}
                  </b>
                </td>

                <td>
                  ${escapeHtml(
                    order.name ||
                      "---"
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    order.platform ||
                      "---"
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    order.completedAt
                      ? new Date(
                          parseFirestoreDate(
                            order.completedAt
                          ) ||
                            order.completedAt
                        ).toLocaleString(
                          "en-GB",
                          {
                            timeZone:
                              "Asia/Riyadh"
                          }
                        )
                      : "---"
                  )}
                </td>

                <td>
                  ${calculatePurgeCountdown(
                    order
                  )}
                </td>

                <td>
                  ${
                    due
                      ? `
                        <span
                          class="badge"
                          style="
                            background:rgba(239,68,68,0.12);
                            color:#ef4444;
                            border:1px solid rgba(239,68,68,0.3);
                          ">
                          مستحق للمراجعة
                        </span>
                      `
                      : `
                        <span
                          class="badge badge-review">
                          بانتظار الموعد
                        </span>
                      `
                  }
                </td>

                <td>
                  <button
                    class="btn-custom"
                    style="
                      background:${
                        due
                          ? "#ef4444"
                          : "#64748b"
                      };
                      color:#fff;
                      font-size:0.75rem;
                      padding:6px 12px;
                    "
                    onclick="openPurgeModal('${escapeAttribute(
                      order.id
                    )}')">
                    <i class="fa-solid fa-skull-crossbones"></i>
                    ${
                      due
                        ? "مراجعة وإتلاف"
                        : "عرض الموعد"
                    }
                  </button>
                </td>

              </tr>
            `;
          }
        )
        .join("");
  };

// ==========================================================================
// 8) التقييمات
// ==========================================================================

function initReviewsListener() {
  const q =
    query(
      collection(
        db,
        "reviews"
      )
    );

  return onSnapshot(
    q,
    (snapshot) => {
      reviewsData =
        snapshot.docs.map(
          (docSnap) => {
            const data =
              docSnap.data();

            const rating =
              Math.max(
                1,
                Math.min(
                  5,
                  Number(
                    data.rating ||
                      5
                  )
                )
              );

            return {
              ...data,

              id:
                docSnap.id,

              customerName:
                data.customerName ||
                data.name ||
                "عميل",

              referenceNumber:
                data.referenceNumber ||
                data.orderId ||
                "---",

              rating,

              comment:
                data.comment ||
                data.text ||
                "بدون تعليق",

              createdAt:
                data.createdAt?.toDate
                  ? data.createdAt
                      .toDate()
                      .toLocaleDateString(
                        "en-GB",
                        {
                          timeZone:
                            "Asia/Riyadh"
                        }
                      )
                  : data.createdAt ||
                    "---",

              status:
                data.status ||
                "pending"
            };
          }
        );

      if (
        lastReviewsCount !==
          null &&
        reviewsData.length >
          lastReviewsCount
      ) {
        showSystemNotification(
          "⭐ تقييم جديد من عميل!",
          "تم استقبال تقييم جديد للخدمة، اضغط لاستعراضه.",
          () =>
            switchTab(
              "reviewsTab",
              document.querySelector(
                ".sidebar-menu .sidebar-link:nth-child(5)"
              )
            )
        );
      }

      lastReviewsCount =
        reviewsData.length;

      renderReviewsTable();
    },
    (error) => {
      console.error(
        "Reviews Snapshot Error:",
        error?.message ||
          error
      );
    }
  );
}

function renderReviewsTable() {
  const tbody =
    document.getElementById(
      "reviewsTableBody"
    );

  const emptyState =
    document.getElementById(
      "reviewsEmptyState"
    );

  if (!tbody) return;

  const totalReviews =
    reviewsData.length;

  const fiveStarsCount =
    reviewsData.filter(
      (review) =>
        review.rating ===
        5
    ).length;

  const pendingCount =
    reviewsData.filter(
      (review) =>
        review.status ===
        "pending"
    ).length;

  const avgRating =
    totalReviews > 0
      ? (
          reviewsData.reduce(
            (
              sum,
              review
            ) =>
              sum +
              Number(
                review.rating ||
                  0
              ),
            0
          ) /
          totalReviews
        ).toFixed(1)
      : "0.0";

  const setText =
    (
      id,
      value
    ) => {
      const element =
        document.getElementById(
          id
        );

      if (element) {
        element.innerText =
          value;
      }
    };

  setText(
    "statTotalReviews",
    totalReviews
  );

  setText(
    "statAverageRating",
    `${avgRating} ⭐`
  );

  setText(
    "statFiveStarReviews",
    fiveStarsCount
  );

  setText(
    "statPendingReviews",
    pendingCount
  );

  setText(
    "reviewsBadgeCount",
    `${totalReviews} تقييمات`
  );

  const sidebarBadge =
    document.getElementById(
      "sidebarReviewsBadge"
    );

  if (sidebarBadge) {
    sidebarBadge.innerText =
      pendingCount;

    sidebarBadge.style.display =
      pendingCount > 0
        ? "inline-block"
        : "none";
  }

  const filterVal =
    document.getElementById(
      "reviewStatusFilter"
    )?.value ||
    "all";

  let filtered =
    reviewsData;

  if (
    filterVal !==
    "all"
  ) {
    filtered =
      filtered.filter(
        (review) =>
          review.status ===
          filterVal
      );
  }

  if (
    activeReviewSearchQuery
  ) {
    filtered =
      filtered.filter(
        (review) => {
          const customerName =
            String(
              review.customerName ||
                ""
            ).toLowerCase();

          const reference =
            String(
              review.referenceNumber ||
                ""
            ).toLowerCase();

          return (
            customerName.includes(
              activeReviewSearchQuery
            ) ||
            reference.includes(
              activeReviewSearchQuery
            )
          );
        }
      );
  }

  if (
    filtered.length ===
    0
  ) {
    tbody.innerHTML =
      "";

    if (emptyState) {
      emptyState.style.display =
        "block";
    }

    return;
  }

  if (emptyState) {
    emptyState.style.display =
      "none";
  }

  const statusBadgeMap = {
    published:
      '<span class="badge badge-completed">منشور</span>',

    pending:
      '<span class="badge badge-review">بانتظار المراجعة</span>',

    archived:
      '<span class="badge badge-archived">مؤرشف</span>',

    hidden:
      '<span class="badge badge-archived">مؤرشف</span>'
  };

  tbody.innerHTML =
    filtered
      .map(
        (review) => {
          const rating =
            Math.max(
              1,
              Math.min(
                5,
                Number(
                  review.rating ||
                    0
                )
              )
            );

          const stars =
            "⭐".repeat(
              rating
            );

          return `
            <tr>

              <td>
                <b>
                  ${escapeHtml(
                    review.customerName
                  )}
                </b>
              </td>

              <td>
                <code
                  class="copyable-box"
                  onclick="copyTrackingLink('${escapeAttribute(
                    review.referenceNumber
                  )}')">
                  ${escapeHtml(
                    review.referenceNumber
                  )}
                </code>
              </td>

              <td>
                <span style="font-weight:800;color:#dbe5ef;">
                  ${escapeHtml(review.platform || "---")}
                </span>
              </td>

              <td>
                <span style="font-weight:800;color:var(--primary);">
                  ${escapeHtml(formatNumber(review.quantity || 0))}
                </span>
              </td>

              <td>
                <span style="color:#f59e0b;">
                  ${stars}
                  (${rating})
                </span>
              </td>

              <td>
                <span
                  style="font-size:0.85rem;max-width:250px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${escapeHtml(
                    review.comment
                  )}
                </span>
              </td>

              <td>
                <span style="font-size:0.8rem;color:var(--text-muted);">
                  ${escapeHtml(
                    review.createdAt
                  )}
                </span>
              </td>

              <td>
                ${
                  statusBadgeMap[
                    review.status
                  ] ||
                  escapeHtml(
                    review.status
                  )
                }
              </td>

              <td>
                <div style="display:flex;gap:4px;">

                  <button
                    class="btn-action"
                    title="معاينة التقييم"
                    onclick="openReviewModal('${escapeAttribute(
                      review.id
                    )}')">
                    <i class="fa-solid fa-eye"></i>
                  </button>

                  ${
                    review.status !==
                    "published"
                      ? `
                        <button
                          class="btn-action"
                          style="color:var(--primary);"
                          title="اعتماد التقييم"
                          onclick="updateReviewStatus('${escapeAttribute(
                            review.id
                          )}','published')">
                          <i class="fa-solid fa-check"></i>
                        </button>
                      `
                      : ""
                  }

                  ${
                    review.status !==
                    "archived"
                      ? `
                        <button
                          class="btn-action"
                          style="color:var(--warning);"
                          title="أرشفة التقييم"
                          onclick="updateReviewStatus('${escapeAttribute(
                            review.id
                          )}','archived')">
                          <i class="fa-solid fa-box-archive"></i>
                        </button>
                      `
                      : ""
                  }

                  <button
                    class="btn-action"
                    style="color:var(--danger);"
                    title="حذف التقييم"
                    onclick="deleteReview('${escapeAttribute(
                      review.id
                    )}')">
                    <i class="fa-solid fa-trash"></i>
                  </button>

                </div>
              </td>

            </tr>
          `;
        }
      )
      .join("");
}

document.addEventListener(
  "DOMContentLoaded",
  () => {
    const reviewSearch =
      document.getElementById(
        "reviewSearchInput"
      );

    const reviewFilter =
      document.getElementById(
        "reviewStatusFilter"
      );

    if (reviewSearch) {
      reviewSearch.addEventListener(
        "input",
        (event) => {
          activeReviewSearchQuery =
            event.target.value
              .trim()
              .toLowerCase();

          renderReviewsTable();
        }
      );
    }

    if (reviewFilter) {
      reviewFilter.addEventListener(
        "change",
        () =>
          renderReviewsTable()
      );
    }
  }
);

window.openReviewModal =
  function (reviewId) {
    const modal =
      document.getElementById(
        "reviewModal"
      );

    const modalTitle =
      document.getElementById(
        "reviewModalTitle"
      );

    const modalBody =
      document.getElementById(
        "reviewModalBody"
      );

    if (
      !modal ||
      !modalBody
    ) {
      return;
    }

    const review =
      reviewsData.find(
        (item) =>
          item.id ===
          reviewId
      );

    if (!review) return;

    const rating =
      Math.max(
        1,
        Math.min(
          5,
          Number(
            review.rating ||
              5
          )
        )
      );

    if (modalTitle) {
      modalTitle.innerText =
        `تفاصيل تقييم العميل: ${review.customerName}`;
    }

    modalBody.innerHTML = `
      <div style="background:var(--input-bg);padding:16px;border-radius:12px;border:1px solid var(--card-border);margin-bottom:15px;">

        <p style="margin-bottom:8px;">
          <b>العميل:</b>
          ${escapeHtml(
            review.customerName
          )}
        </p>

        <p style="margin-bottom:8px;">
          <b>رقم المرجع:</b>
          <code style="color:var(--primary);">
            ${escapeHtml(
              review.referenceNumber
            )}
          </code>
        </p>

        <p style="margin-bottom:8px;">
          <b>المنصة:</b>
          ${escapeHtml(
            review.platform || "---"
          )}
        </p>

        <p style="margin-bottom:8px;">
          <b>الكمية:</b>
          ${escapeHtml(
            formatNumber(review.quantity || 0)
          )}
        </p>

        <p style="margin-bottom:8px;">
          <b>التقييم:</b>
          <span style="color:#f59e0b;">
            ${"⭐".repeat(
              rating
            )}
            (${rating} من 5)
          </span>
        </p>

        <p style="margin-bottom:8px;">
          <b>التاريخ:</b>
          ${escapeHtml(
            review.createdAt
          )}
        </p>

        <p style="margin-bottom:8px;">
          <b>الحالة:</b>
          ${escapeHtml(
            review.status
          )}
        </p>

      </div>

      <div style="background:var(--input-bg);padding:16px;border-radius:12px;border:1px solid var(--card-border);margin-bottom:20px;">

        <h4 style="color:var(--primary);margin-bottom:8px;">
          <i class="fa-solid fa-comment-dots"></i>
          نص التقييم:
        </h4>

        <p style="font-size:0.95rem;line-height:1.8;color:var(--text-main);">
          ${escapeHtml(
            review.comment
          )}
        </p>

      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">

        <button
          class="btn-custom"
          style="background:var(--primary);color:#000;"
          onclick="updateReviewStatus('${escapeAttribute(
            review.id
          )}','published');closeReviewModal();">
          نشر التقييم
        </button>

        <button
          class="btn-custom"
          style="background:#f59e0b;color:#fff;"
          onclick="updateReviewStatus('${escapeAttribute(
            review.id
          )}','archived');closeReviewModal();">
          أرشفة
        </button>

        <button
          class="btn-custom"
          style="background:#ef4444;color:#fff;"
          onclick="deleteReview('${escapeAttribute(
            review.id
          )}');closeReviewModal();">
          حذف
        </button>

        <button
          class="btn-custom"
          style="background:var(--input-bg);color:var(--text-main);border:1px solid var(--card-border);"
          onclick="closeReviewModal();">
          إغلاق
        </button>

      </div>
    `;

    modal.classList.add(
      "active"
    );
  };

window.closeReviewModal =
  function () {
    const modal =
      document.getElementById(
        "reviewModal"
      );

    if (modal) {
      modal.classList.remove(
        "active"
      );
    }
  };

window.updateReviewStatus =
  async function (
    reviewId,
    newStatus
  ) {
    const allowed =
      [
        "published",
        "pending",
        "archived"
      ];

    if (
      !allowed.includes(
        newStatus
      )
    ) {
      return;
    }

    try {
      const response = await adminFetch(
        "/api/admin/reviews/status",
        {
          method: "POST",
          body: JSON.stringify({
            reviewId,
            status: newStatus
          })
        }
      );

      await readJsonResponse(response);
    } catch (error) {
      showToast(
        "❌ فشل تحديث حالة التقييم: " +
          (
            error?.message ||
            ""
          )
      );
    }
  };

window.deleteReview =
  async function (
    reviewId
  ) {
    if (
      !confirm(
        "هل أنت متأكد من حذف هذا التقييم نهائياً؟"
      )
    ) {
      return;
    }

    try {
      const response = await adminFetch(
        "/api/admin/reviews/delete",
        {
          method: "POST",
          body: JSON.stringify({
            reviewId
          })
        }
      );

      await readJsonResponse(response);
    } catch (error) {
      showToast(
        "❌ فشل حذف التقييم: " +
          (
            error?.message ||
            ""
          )
      );
    }
  };

// ==========================================================================
// 9) العملاء
// ==========================================================================

window.renderClientsTable =
  function (searchQuery = "") {
    const tbody = document.getElementById("clientsTableBody");
    if (!tbody) return;

    const clientsMap = {};

    ordersData.forEach((order) => {
      const key = order.phone?.trim() || order.name?.trim() || "عميل غير معروف";

      if (!clientsMap[key]) {
        clientsMap[key] = {
          phone: order.phone || "بدون رقم",
          name: order.name || "عميل",
          orderCount: 0,
          totalCoins: 0,
          totalMoneySar: 0
        };
      }

      clientsMap[key].orderCount += 1;
      clientsMap[key].totalCoins += Number(order.totalQty) || 0;
      clientsMap[key].totalMoneySar += getSarAmount(order);
    });

    const search = String(searchQuery || "").trim().toLowerCase();
    let clientsList = Object.values(clientsMap);

    if (search) {
      clientsList = clientsList.filter(
        (client) =>
          client.name.toLowerCase().includes(search) ||
          client.phone.toLowerCase().includes(search)
      );
    }

    if (clientsList.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="6" class="empty-row">لا توجد نتائج مطابقة للبحث.</td></tr>
      `;
      return;
    }

    tbody.innerHTML = clientsList.map((client) => `
      <tr class="client-row">
        <td data-label="العميل"><strong>${escapeHtml(client.name)}</strong></td>
        <td data-label="الجوال"><span class="phone-value" dir="ltr">${escapeHtml(client.phone)}</span></td>
        <td data-label="عدد الطلبات"><span class="badge badge-new">${client.orderCount} طلبات</span></td>
        <td data-label="إجمالي الكمية"><strong>${formatCoinsNumber(client.totalCoins)}</strong></td>
        <td data-label="إجمالي المبلغ"><strong class="recent-price table-large-value">${client.totalMoneySar.toLocaleString("en-US",{maximumFractionDigits:2})} ريال</strong></td>
        <td data-label="الإجراء"><button class="btn-action client-history-btn" onclick="openClientModal('${encodeURIComponent(client.phone)}')">سجل الطلبات</button></td>
      </tr>
    `).join("");
  };

window.filterClients =
  function (value) {
    renderClientsTable(
      value
    );
  };

window.openClientModal =
  function (
    encodedPhone
  ) {
    const phone =
      decodeURIComponent(
        encodedPhone
      );

    const modal =
      document.getElementById(
        "clientDetailModal"
      );

    const modalTitle =
      document.getElementById(
        "clientModalTitle"
      );

    const modalBody =
      document.getElementById(
        "clientModalBody"
      );

    if (
      !modal ||
      !modalBody
    ) {
      return;
    }

    const clientOrders =
      ordersData.filter(
        (order) =>
          order.phone ===
            phone ||
          order.name ===
            phone
      );

    if (modalTitle) {
      modalTitle.innerText =
        `سجل طلبات العميل: ${String(phone || "")}`;
    }

    modalBody.innerHTML = `
      <div style="margin-bottom:15px;background:var(--input-bg);padding:12px;border-radius:12px;border:1px solid var(--card-border);">
        <strong>إجمالي الطلبات:</strong>
        ${clientOrders.length}
        |
        <strong>إجمالي الكمية:</strong>
        ${formatCoinsNumber(
          clientOrders.reduce(
            (
              sum,
              order
            ) =>
              sum +
              (
                order.totalQty ||
                0
              ),
            0
          )
        )}
      </div>

      <div class="table-responsive">
        <table>

          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>المنصة</th>
              <th>الكمية</th>
              <th>السعر</th>
              <th>الحالة</th>
              <th>التاريخ</th>
            </tr>
          </thead>

          <tbody>
            ${clientOrders
              .map(
                (order) => {
                  const ref =
                    order.referenceNumber ||
                    "";

                  return `
                    <tr>

                      <td>
                        <b
                          style="color:var(--primary);cursor:pointer;"
                          onclick="copyTrackingLink('${escapeAttribute(
                            ref
                          )}')">
                          ${escapeHtml(
                            ref
                          )}
                        </b>
                      </td>

                      <td>
                        ${renderPlatformBadge(order.platform)}
                      </td>

                      <td>
                        ${formatCoinsNumber(
                          order.totalQty
                        )}
                      </td>

                      <td>
                        ${escapeHtml(
                          getDisplayPrice(
                            order
                          )
                        )}
                      </td>

                      <td>
                        ${getOrderStatusBadge(
                          order
                        )}
                      </td>

                      <td>
                        ${
                          order.createdAt ? formatAdminDate(order.createdAt) : "---"
                        }
                      </td>

                    </tr>
                  `;
                }
              )
              .join("")}
          </tbody>

        </table>
      </div>
    `;

    modal.classList.add(
      "active"
    );
  };

window.closeClientModal =
  function () {
    const modal =
      document.getElementById(
        "clientDetailModal"
      );

    if (modal) {
      modal.classList.remove(
        "active"
      );
    }
  };

// ==========================================================================
// 10) فك التشفير — 90 ثانية
// ==========================================================================

function clearDecryptState() {
  if (decryptTimer) {
    clearInterval(
      decryptTimer
    );
  }

  decryptTimer =
    null;

  decryptExpiresAt =
    null;

  [
    "securePhone",
    "secureEmail",
    "secureEaEmail",
    "secureEaPass",
    "secureCodes",
    "secureCode1",
    "secureCode2",
    "secureCode3"
  ].forEach(
    (id) => {
      const element =
        document.getElementById(
          id
        );

      if (element) {
        element.textContent =
          "••••••••";
      }
    }
  );

  const paymentDetailsEl =
    document.getElementById(
      "securePaymentDetails"
    );

  if (paymentDetailsEl) {
    paymentDetailsEl.textContent =
      "";
  }

  const timerEl =
    document.getElementById(
      "decryptTimer"
    );

  if (timerEl) {
    timerEl.textContent =
      "مشفرة";
  }
}

function renderDecryptedPayment(payment = {}) {
  const container = document.getElementById("securePaymentDetails");
  if (!container) return;
  const method = String(payment.method || "").toLowerCase();
  const fields = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      fields.push({label, value:String(value)});
    }
  };
  if (method === "bank") {
    add("Bank", payment.bankName);
    add("Full Name", payment.fullName || payment.recipientName);
    add("IBAN", payment.iban);
  } else if (method === "wallet") {
    add("Wallet", payment.walletName);
    add("Phone Number", payment.walletPhone);
  } else if (method === "usdt") {
    add("Wallet Address", payment.walletAddress);
    add("Network", payment.network);
  } else if (method === "paypal") {
    add("PayPal Email", payment.paypalEmail);
  } else if (method === "western") {
    add("Full Name", payment.fullNameEnglish);
    add("Country", payment.country);
  }
  if (!fields.length) {
    container.innerHTML = '<div class="payment-secure-empty">لا توجد بيانات تحويل قابلة للعرض.</div>';
    return;
  }
  container.innerHTML = fields.map((field, index) => `<button class="payment-copy-field" onclick="copyValueByData(this)" data-copy-value="${escapeAttribute(field.value)}"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(field.value)}</strong></button>`).join("");
}
window.copyValueByData = function(el) {
  if (!el) return;
  copyValue(el.getAttribute("data-copy-value") || "");
};

async function decryptOrder(
  orderId
) {
  try {
    const response =
      await adminFetch(
        "/api/admin/decrypt-order",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              orderId
            })
        }
      );

    const data =
      await readJsonResponse(
        response
      );

    if (
      await handleAdminAuthFailure(
        response,
        data
      )
    ) {
      return;
    }

    if (!data.success) {
      showToast(
        data.message ||
          "فشل فك التشفير."
      );

      return;
    }

    const payload =
      data.data || {};

    const account =
      payload.account ||
      {};

    const payment =
      payload.payment ||
      {};

    const phoneEl =
      document.getElementById(
        "securePhone"
      );

    const emailEl =
      document.getElementById(
        "secureEmail"
      );

    const eaEmailEl =
      document.getElementById(
        "secureEaEmail"
      );

    const eaPassEl =
      document.getElementById(
        "secureEaPass"
      );

    const codesEl = document.getElementById("secureCodes");
    const code1El = document.getElementById("secureCode1");
    const code2El = document.getElementById("secureCode2");
    const code3El = document.getElementById("secureCode3");

    if (phoneEl) {
      phoneEl.textContent =
        payload.phone ||
        "-";
    }

    if (emailEl) {
      emailEl.textContent =
        payload.customerEmail ||
        "-";
    }

    if (eaEmailEl) {
      eaEmailEl.textContent =
        account.eaEmail ||
        "-";
    }

    if (eaPassEl) {
      eaPassEl.textContent =
        account.eaPassword ||
        "-";
    }

    if (codesEl) codesEl.textContent = Array.isArray(account.backupCodes) ? account.backupCodes.join(" | ") : account.backupCodes || "-";
    const codes = Array.isArray(account.backupCodes) ? account.backupCodes : [];
    if (code1El) code1El.textContent = codes[0] || "-";
    if (code2El) code2El.textContent = codes[1] || "-";
    if (code3El) code3El.textContent = codes[2] || "-";

    const paymentDetailsEl =
      document.getElementById(
        "securePaymentDetails"
      );

    if (paymentDetailsEl) renderDecryptedPayment(payment);

    startDecryptTimer(
      Number(
        payload.expiresAt
      )
    );

    await logAuditEvent(
      "فك تشفير بيانات حساسة",
      payload.referenceNumber ||
        payload.orderId ||
        orderId,
      "تم كشف بيانات حساسة ضمن نافذة الخادم المحددة"
    );
  } catch (error) {
    console.error(
      "Decrypt order error:",
      error?.message ||
        error
    );

    showToast(
      "❌ تعذر فك تشفير بيانات الطلب."
    );
  }
}

window.decryptOrder =
  decryptOrder;

function startDecryptTimer(
  expiresAt
) {
  clearInterval(
    decryptTimer
  );

  decryptExpiresAt =
    Number(expiresAt);

  const timerEl =
    document.getElementById(
      "decryptTimer"
    );

  if (
    !Number.isFinite(
      decryptExpiresAt
    )
  ) {
    if (timerEl) {
      timerEl.textContent =
        "مشفرة";
    }

    return;
  }

  const updateTimer =
    () => {
      const remaining =
        Math.max(
          0,
          decryptExpiresAt -
            Date.now()
        );

      const seconds =
        Math.ceil(
          remaining /
            1000
        );

      if (timerEl) {
        timerEl.textContent =
          seconds > 0
            ? `${seconds} ثانية`
            : "انتهت نافذة الكشف";
      }

      if (
        remaining <= 0
      ) {
        clearDecryptState();
      }
    };

  updateTimer();

  decryptTimer =
    setInterval(
      updateTimer,
      250
    );
}

// عند إخفاء التبويب، نغلق الكشف فوراً من الواجهة.
// الخادم يبقى هو صاحب القرار النهائي.
document.addEventListener(
  "visibilitychange",
  () => {
    if (
      document.visibilityState ===
      "hidden"
    ) {
      clearDecryptState();
    }
  }
);

// ==========================================================================
// 11) تفاصيل الطلب
// ==========================================================================

window.openOrderModal = function (orderId) {
  clearDecryptState();
  const modal=document.getElementById("orderDetailModal");
  const modalTitle=document.getElementById("modalOrderIdTitle");
  const modalBody=document.getElementById("modalOrderBody");
  if(!modal||!modalBody)return;
  const order=ordersData.find((item)=>item.id===orderId||item.referenceNumber===orderId||item.orderId===orderId);
  if(!order){showToast("لم يتم العثور على الطلب.");return;}
  const ref=order.referenceNumber||order.orderId||order.id;
  const total=Math.max(0,Number(order.totalQty||0)||0);
  const withdrawn=Math.min(total,Math.max(0,Number(order.withdrawnQuantity??order.drawnCoins??0)||0));
  const remaining=Math.max(0,total-withdrawn);
  const percent=total>0?Math.min(100,(withdrawn/total)*100):0;
  const locked=["finished","pending_transfer","transferred","completed","archived"].includes(order.status);
  const baseStatusLabel=STATUS_LABELS[order.status]||order.status||"---";
  const statusLabel=order.issue?(ISSUE_LABELS[order.issue]||getIssueLabel(order.issue)):baseStatusLabel;
    const platform=String(order.platform||"").trim();
  const platformClass=platform.toLowerCase().replace(/[^a-z0-9]+/g,"-");
  const platformIcon=platform.toUpperCase()==="PLAYSTATION" ? "fa-brands fa-playstation" : platform.toUpperCase()==="XBOX" ? "fa-brands fa-xbox" : "fa-solid fa-desktop";
  const paymentCode=String(order.paymentMethod||"").toLowerCase();
  const paymentPreview=getPaymentPreviewText(order);
  const paymentMethod = paymentCode === "bank" ? (order.bankName || order.paymentPreview?.bankName || "تحويل بنكي") : paymentCode === "wallet" ? (order.paymentPreview?.walletName || "محفظة رقمية") : paymentCode === "paypal" ? "PayPal" : paymentCode === "usd" || paymentCode === "usdt" ? "USD / USDT" : paymentCode === "western" ? "Western Union" : (order.paymentMethod || "");
  const whatsapp=String(order.phone||"").replace(/[^0-9+]/g,"").replace(/^00/,"+");
  const statusMessage=getStatusMessage(order.status,order);
  const statusBadgeClass = order.issue ? "status-problem" : "status-" + (order.status || "unknown");
  const waUrl=whatsapp?`https://wa.me/${whatsapp.replace(/^\+/,"")}?text=${encodeURIComponent(statusMessage)}`:"#";
  if(modalTitle)modalTitle.innerText=`تفاصيل الطلب #${ref}`;
  const statusOptions=STATUS_VALUES.map((s)=>`<option value="${s}" ${s===order.status?"selected":""}>${escapeHtml(STATUS_LABELS[s])}</option>`).join("");
  modalBody.innerHTML=`
    <div class="order-detail-shell">
      <section class="order-detail-section order-summary-section">
        <div class="order-section-heading"><div><span class="eyebrow">ORDER</span><h4>معلومات الطلب</h4></div><span class="order-status-badge ${statusBadgeClass}">${escapeHtml(statusLabel)}</span></div>
        <div class="order-identity-grid">
          <button class="copy-pill" onclick="copyTrackingLink('${escapeAttribute(ref)}')"><span>رقم المرجع</span><strong>#${escapeHtml(ref)}</strong><small>نسخ رابط التتبع</small></button>
          <button class="copy-pill" onclick="copyValue('${escapeAttribute(order.name||"")}')"><span>اسم العميل</span><strong>${escapeHtml(order.name||"---")}</strong><small>نسخ</small></button>
          <div class="copy-pill"><span>رقم الجوال</span><strong dir="ltr">${escapeHtml(order.phone||"---")}</strong></div>
        </div>
        <div class="order-status-editor">
  <div><span class="field-label">الحالة الحالية</span><strong>${escapeHtml(statusLabel)}</strong>${order.issue?'<small class="base-status-hint">الحالة التشغيلية: '+escapeHtml(baseStatusLabel)+'</small>':''}</div>
  <div class="status-editor-controls"><select id="modalOrderStatusSelect" class="form-control"><option value="">تغيير الحالة</option>${statusOptions}</select><button class="btn-primary" onclick="saveModalOrderStatus('${escapeAttribute(order.id)}')">حفظ الحالة</button></div>
</div>
<div class="order-issue-editor">
  <div class="issue-editor-head">
    <div><span class="field-label">مشكلة الطلب</span><small id="orderIssueSummary">${escapeHtml(order.issue ? (ISSUE_LABELS[order.issue] || order.issue) : "لا توجد مشكلة مسجلة")}</small></div>
    <span class="issue-editor-state ${order.issue ? "has-issue" : ""}">${order.issue ? "موجودة" : "بدون مشكلة"}</span>
  </div>
  <div class="issue-editor-controls">
    <select id="orderIssueSelect" class="form-control" onchange="toggleOrderIssueEditor(this.value)">
      <option value="">لا توجد مشكلة</option>
      ${ISSUE_VALUES.map((value) => `<option value="${value}" ${value===order.issue?"selected":""}>${escapeHtml(ISSUE_LABELS[value] || value)}</option>`).join("")}
    </select>
    <textarea id="orderIssueMessageInput" class="form-control issue-message-input" rows="2" ${order.issue ? "" : "disabled"} placeholder="رسالة المشكلة التي ستظهر للعميل...">${escapeHtml(order.issueMessage || (order.issue ? getIssueLabel(order.issue) : ""))}</textarea>
    <button class="btn-secondary" onclick="saveOrderIssue('${escapeAttribute(order.id)}')">حفظ المشكلة</button>
  </div>
</div>
      </section>

      <section class="order-detail-section">
        <div class="order-section-heading"><div><span class="eyebrow">ORDER DATA</span><h4>المنصة والكمية</h4></div><button class="btn-secondary" onclick="openOrderEditForm('${escapeAttribute(order.id)}')"><i class="fa-solid fa-pen-to-square"></i> تعديل البيانات</button></div>
        <div class="order-platform-row"><div class="platform-pill platform-${escapeAttribute(platformClass)}"><span class="platform-logo"><i class="${platformIcon}"></i></span><strong>${escapeHtml(platform||"---")}</strong></div></div>
        <div class="quantity-grid"><div class="quantity-card"><span>الكمية المباعة</span><strong>${formatCoinsNumber(total)}</strong></div><div class="quantity-card"><span>الكمية المسحوبة</span><strong>${formatCoinsNumber(withdrawn)}</strong></div><div class="quantity-card"><span>الكمية المتبقية</span><strong>${formatCoinsNumber(remaining)}</strong></div></div>
        <div class="withdraw-editor ${locked?"is-locked":""}"><div class="withdraw-editor-top"><div><span class="field-label">تحديث الكمية المسحوبة</span><small>${locked?"مقفلة لأن الطلب وصل إلى مرحلة نهائية.":"أدخل الكمية المسحوبة الفعلية من الحساب."}</small></div><strong>${percent.toFixed(2)}%</strong></div><div class="progress-track"><span style="width:${percent.toFixed(2)}%"></span></div><div class="withdraw-input-row"><input id="modalWithdrawnQuantity" class="form-control" inputmode="numeric" autocomplete="off" value="${formatCoinsNumber(withdrawn)}" oninput="formatCoinInput(this)" ${locked?"disabled":""}><button class="btn-primary" onclick="saveModalWithdrawnQuantity('${escapeAttribute(order.id)}')" ${locked?"disabled":""}>حفظ الكمية المسحوبة</button></div></div>
      </section>

      <section class="order-detail-section secure-section"><div class="order-section-heading"><div><span class="eyebrow">SENSITIVE DATA</span><h4>بيانات الحساب</h4></div><div class="secure-actions"><span id="decryptTimer" class="secure-timer">مشفرة</span><button class="btn-unlock" onclick="decryptOrder('${escapeAttribute(order.id)}')"><i class="fa-solid fa-lock-open"></i> فك التشفير</button></div></div><div class="secure-fields-grid">
        <button class="secure-copy-field" onclick="copyElementValue('secureEaEmail')"><span>EA Email</span><strong id="secureEaEmail">••••••••</strong></button>
        <button class="secure-copy-field" onclick="copyElementValue('secureEaPass')"><span>EA Password</span><strong id="secureEaPass">••••••••</strong></button>
        <button class="secure-copy-field" onclick="copyElementValue('secureCode1')"><span>Backup Code 1</span><strong id="secureCode1">••••••••</strong></button>
        <button class="secure-copy-field" onclick="copyElementValue('secureCode2')"><span>Backup Code 2</span><strong id="secureCode2">••••••••</strong>
        </button><button class="secure-copy-field" onclick="copyElementValue('secureCode3')"><span>Backup Code 3</span><strong id="secureCode3">••••••••</strong></button>
      </div></section>

      <section class="order-detail-section"><div class="order-section-heading"><div><span class="eyebrow">PAYMENT & TRANSFER</span><h4>بيانات الدفع والتحويل</h4></div><span class="payment-method-pill">${escapeHtml(paymentMethod||"---")}</span></div><div id="securePaymentDetails" class="payment-secure-grid"><div class="payment-secure-empty">${escapeHtml(paymentPreview||"اضغط «فك التشفير» لعرض بيانات التحويل القابلة للنسخ.")}</div></div><div class="payment-total-row"><span>المبلغ الإجمالي</span>${getDisplayPriceMarkup(order)}</div></section>

      ${order.issue?`<section class="order-detail-section issue-section"><div class="order-section-heading"><div><span class="eyebrow">ISSUE</span><h4>المشكلة الحالية</h4></div><span class="badge badge-danger">${escapeHtml(ISSUE_LABELS[order.issue]||order.issue)}</span></div><p>${escapeHtml(order.issueMessage||getIssueLabel(order.issue))}</p><div class="issue-actions"><button class="btn-secondary" onclick="sendIssueViaWhatsapp('${escapeAttribute(order.id)}')">WhatsApp</button><button class="btn-secondary" onclick="setIssueState('${escapeAttribute(order.id)}','data_received')">تم استلام البيانات</button><button class="btn-secondary" onclick="setIssueState('${escapeAttribute(order.id)}','resolved')">تم الحل</button></div></section>`:""}

      <section class="order-detail-section message-section"><div class="order-section-heading"><div><span class="eyebrow">WHATSAPP MESSAGE</span><h4>رسالة الحالة</h4></div><span class="message-token-hint">{customerName} · {status}</span></div><div class="status-message-preview" id="modalStatusMessagePreview">${escapeHtml(statusMessage)}</div><div class="message-actions"><button class="btn-secondary" onclick="copyModalStatusMessage('${escapeAttribute(order.id)}')">نسخ الرسالة</button><a class="btn-whatsapp ${whatsapp?"":"disabled"}" href="${whatsapp?waUrl:"#"} target="_blank" rel="noopener" onclick="${whatsapp?"":"return false;"}><i class="fa-brands fa-whatsapp"></i> WhatsApp</a></div></section>
    </div>`;
  modal.classList.add("active");
};

function syncOpenOrderModal(order) {
  if (!order) return;

  const modal = document.getElementById("orderDetailModal");
  if (!modal || !modal.classList.contains("active")) return;

  const baseStatusLabel =
    STATUS_LABELS[order.status] || order.status || "---";
  const statusLabel =
    order.issue
      ? (ISSUE_LABELS[order.issue] || getIssueLabel(order.issue))
      : baseStatusLabel;

  const total =
    Math.max(0, Number(order.totalQty || 0) || 0);

  const withdrawn =
    Math.min(
      total,
      Math.max(
        0,
        Number(
          order.withdrawnQuantity ??
          order.drawnCoins ??
          0
        ) || 0
      )
    );

  const remaining = Math.max(0, total - withdrawn);
  const percent =
    total > 0 ? Math.min(100, (withdrawn / total) * 100) : 0;

  const locked =
    [
      "finished",
      "pending_transfer",
      "transferred",
      "completed",
      "archived"
    ].includes(order.status);

  const badge =
    modal.querySelector(
      ".order-summary-section .order-status-badge"
    );

  if (badge) {
    badge.className = `order-status-badge ${order.issue ? "status-problem" : `status-${order.status || "unknown"}`}`;
    badge.textContent = statusLabel;
  }

  const statusEditorLabel =
    modal.querySelector(
      ".order-status-editor > div:first-child strong"
    );

  if (statusEditorLabel) {
    statusEditorLabel.textContent = statusLabel;
  }

  const statusSelect =
    document.getElementById("modalOrderStatusSelect");

  if (statusSelect) {
    statusSelect.value = order.status || "";
  }

  const quantityValues =
    modal.querySelectorAll(
      ".quantity-grid .quantity-card strong"
    );

  if (quantityValues[0]) {
    quantityValues[0].textContent =
      formatCoinsNumber(total);
  }

  if (quantityValues[1]) {
    quantityValues[1].textContent =
      formatCoinsNumber(withdrawn);
  }

  if (quantityValues[2]) {
    quantityValues[2].textContent =
      formatCoinsNumber(remaining);
  }

  const withdrawEditor =
    modal.querySelector(".withdraw-editor");

  if (withdrawEditor) {
    withdrawEditor.classList.toggle(
      "is-locked",
      locked
    );

    const helper =
      withdrawEditor.querySelector(
        ".withdraw-editor-top small"
      );

    if (helper) {
      helper.textContent =
        locked
          ? "مقفلة لأن الطلب وصل إلى مرحلة نهائية."
          : "أدخل الكمية المسحوبة الفعلية من الحساب.";
    }
  }

  const progress =
    modal.querySelector(
      ".withdraw-editor .progress-track > span"
    );

  if (progress) {
    progress.style.width =
      percent.toFixed(2) + "%";
  }

  const percentLabel =
    modal.querySelector(
      ".withdraw-editor-top > strong"
    );

  if (percentLabel) {
    percentLabel.textContent =
      percent.toFixed(2) + "%";
  }

  const quantityInput =
    document.getElementById("modalWithdrawnQuantity");

  if (quantityInput) {
    quantityInput.value =
      formatCoinsNumber(withdrawn);
    quantityInput.disabled = locked;
  }

  const quantityButton =
    quantityInput?.parentElement?.querySelector("button");

  if (quantityButton) {
    quantityButton.disabled = locked;
  }

  const issueSelect = document.getElementById("orderIssueSelect");
  const issueMessageInput = document.getElementById("orderIssueMessageInput");
  const issueSummary = document.getElementById("orderIssueSummary");
  const issueState = modal.querySelector(".issue-editor-state");

  if (issueSelect) issueSelect.value = order.issue || "";
  if (issueMessageInput) {
    issueMessageInput.value = order.issueMessage || (order.issue ? getIssueLabel(order.issue) : "");
    issueMessageInput.disabled = !order.issue;
  }
  if (issueSummary) {
    issueSummary.textContent = order.issue
      ? (ISSUE_LABELS[order.issue] || order.issue)
      : "لا توجد مشكلة مسجلة";
  }
  if (issueState) {
    issueState.textContent = order.issue ? "موجودة" : "بدون مشكلة";
    issueState.classList.toggle("has-issue", !!order.issue);
  }

  const statusMessage =
    document.getElementById(
      "modalStatusMessagePreview"
    );

  if (statusMessage) {
    statusMessage.textContent =
      getStatusMessage(order.status, order);
  }

  const whatsappNumber =
    String(
      order.whatsapp || order.phone || ""
    ).replace(/^\+/, "");

  const whatsappLink =
    modal.querySelector(
      ".message-actions .btn-whatsapp"
    );

  if (whatsappLink) {
    const message =
      getStatusMessage(order.status, order);

    if (whatsappNumber) {
      whatsappLink.href =
        "https://wa.me/" +
        whatsappNumber +
        "?text=" +
        encodeURIComponent(message);

      whatsappLink.classList.remove("disabled");
      whatsappLink.onclick = null;
    } else {
      whatsappLink.href = "#";
      whatsappLink.classList.add("disabled");
      whatsappLink.onclick = () => false;
    }
  }
}

function getStatusMessage(status,order){
  const template=currentSettingsData.statusMessages?.[status]||DEFAULT_STATUS_MESSAGES[status]||"{customerName}، {status}";
  return template.replace(/\{customerName\}/g,order?.name||"").replace(/\{referenceNumber\}/g,order?.referenceNumber||"").replace(/\{status\}/g,STATUS_LABELS[status]||status||"");
}
window.copyValue=async function(value){
  const textValue=String(value||""); if(!textValue)return;
  try{await navigator.clipboard.writeText(textValue);}
  catch{
    const area=document.createElement("textarea");
    area.value=textValue;
    area.setAttribute("readonly","");
    area.style.position="fixed";
    area.style.opacity="0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
};
window.copyElementValue=function(id){const el=document.getElementById(id);if(!el||!el.textContent||/^•+$/.test(el.textContent.trim())){showToast("فك التشفير أولاً.");return;}copyValue(el.textContent.trim());};
window.saveModalOrderStatus=async function(orderId){
  const order =
    ordersData.find((item) => item.id === orderId);

  const select =
    document.getElementById("modalOrderStatusSelect");

  if (!order || !select || !select.value) return;

  const nextStatus = select.value;

  if (nextStatus === order.status) {
    showToast("الحالة لم تتغير.");
    return;
  }

  try {
    const response = await adminFetch(
      "/api/orders/update-status",
      {
        method: "POST",
        body: JSON.stringify({
          orderId,
          status: nextStatus
        })
      }
    );

    const data = await readJsonResponse(response);

    if (await handleAdminAuthFailure(response, data)) return;

    if (!data.success) {
      showToast(
        "❌ " +
        (data.message || "تعذر تحديث حالة الطلب.")
      );
      return;
    }

    order.status = data.status || nextStatus;

    if (data.issue !== undefined) {
      order.issue = data.issue;
    }

    if (data.issueMessage !== undefined) {
      order.issueMessage = data.issueMessage;
    }

    if (data.completedAt) {
      order.completedAt = data.completedAt;
    }

    if (data.purgeDueAt) {
      order.purgeDueAt = data.purgeDueAt;
    }

    if (data.transferredAt) {
      order.transferredAt = data.transferredAt;
    }

    if (data.transferredBy) {
      order.transferredBy = data.transferredBy;
    }

    if (data.transferCompleted !== undefined) {
      order.transferCompleted = data.transferCompleted;
    }

    if (data.lastUpdate) {
      order.lastUpdate = data.lastUpdate;
    }

    refreshOrdersDerivedUI();
    syncOpenOrderModal(order);

    try {
      await logAuditEvent(
        "تعديل حالة الطلب",
        order.referenceNumber,
        "تم تغيير الحالة إلى: " + order.status
      );
    } catch (auditError) {
      console.warn("Status audit logging failed after successful update:", auditError);
    }
    syncOpenOrderModal(order);

    showToast("تم تحديث حالة الطلب.");
  } catch (error) {
    console.error("Modal status update:", error);
    showToast("❌ تعذر تحديث حالة الطلب.");
  }
};

window.saveModalWithdrawnQuantity=async function(orderId){
  const order =
    ordersData.find((item) => item.id === orderId);

  const input =
    document.getElementById("modalWithdrawnQuantity");

  if (!order || !input) return;

  if (
    [
      "finished",
      "pending_transfer",
      "transferred",
      "completed",
      "archived"
    ].includes(order.status)
  ) {
    showToast("هذه الكمية مقفلة لهذه الحالة.");
    return;
  }

  const value =
    Number(
      String(input.value || "")
        .replace(/,/g, "")
        .replace(/[^0-9]/g, "")
    ) || 0;

  const total = Number(order.totalQty) || 0;

  if (value < 0 || value > total) {
    showToast(
      "❌ الكمية المسحوبة يجب أن تكون بين 0 و" +
      formatCoinsNumber(total) +
      "."
    );
    return;
  }

  try {
    const response = await adminFetch(
      "/api/orders/update-drawn",
      {
        method: "POST",
        body: JSON.stringify({
          orderId,
          withdrawnQuantity: value
        })
      }
    );

    const data = await readJsonResponse(response);

    if (await handleAdminAuthFailure(response, data)) return;

    if (!data.success) {
      showToast(
        "❌ " +
        (data.message || "تعذر تحديث الكمية.")
      );
      return;
    }

    order.withdrawnQuantity =
      Number(data.withdrawnQuantity ?? value);

    order.drawnCoins =
      Number(
        data.drawnCoins ??
        order.withdrawnQuantity
      );

    order.remainingQuantity =
      Number(
        data.remainingQuantity ??
        Math.max(
          0,
          total - order.withdrawnQuantity
        )
      );

    if (data.lastUpdate) {
      order.lastUpdate = data.lastUpdate;
    }

    if (data.withdrawnUpdatedAt) {
      order.withdrawnUpdatedAt =
        data.withdrawnUpdatedAt;
    }

    refreshOrdersDerivedUI();
    syncOpenOrderModal(order);

    try {
      await logAuditEvent(
        "تحديث سحب الكوينز",
        order.referenceNumber,
        "تم تحديث الكمية المسحوبة إلى " + order.withdrawnQuantity
      );
    } catch (auditError) {
      console.warn("Withdraw audit logging failed after successful update:", auditError);
    }

    showToast("تم تحديث الكمية المسحوبة.");
  } catch (error) {
    console.error(
      "Withdrawn quantity update:",
      error
    );

    showToast(
      "❌ تعذر تحديث الكمية المسحوبة."
    );
  }
};

window.copyModalStatusMessage=async function(orderId){const order=ordersData.find((item)=>item.id===orderId);if(order)await copyValue(getStatusMessage(order.status,order));};
window.openOrderStatusEditForm=function(orderId){
  const order=ordersData.find((item)=>item.id===orderId);
  if(!order)return;
  const body=document.getElementById("modalOrderBody");
  const modal=document.getElementById("orderDetailModal");
  const title=document.getElementById("modalOrderIdTitle");
  if(!body||!modal)return;

  const statusOptions=STATUS_VALUES.map((s)=>`<option value="${s}" ${s===order.status?"selected":""}>${escapeHtml(STATUS_LABELS[s])}</option>`).join("");
  const locked=["finished","pending_transfer","transferred","completed","archived"].includes(order.status);
  const lockedText=locked
    ? "قسم سحب الكوينز مقفل لأن الطلب وصل إلى مرحلة ما بعد السحب."
    : "يمكن تحديث كمية السحب من داخل التفاصيل ما دام الطلب في مرحلة السحب.";

  if(title) title.innerText=`تعديل حالة الطلب #${escapeHtml(order.referenceNumber||order.orderId||order.id)}`;
  body.innerHTML=`
    <div class="order-status-edit-form">
      <div class="order-section-heading">
        <div><span class="eyebrow">EDIT STATUS</span><h4>تعديل حالة الطلب</h4></div>
        <button class="btn-secondary" onclick="openOrderModal('${escapeAttribute(orderId)}')">فتح التفاصيل</button>
      </div>
      <div class="status-edit-current">
        <span class="field-label">الحالة الحالية</span>
        <strong class="order-status-badge status-${escapeAttribute(order.status||"unknown")}">${escapeHtml(STATUS_LABELS[order.status]||order.status||"---")}</strong>
      </div>
      <div class="status-editor-controls status-editor-controls-large">
        <label class="field"><span>الحالة الجديدة</span>
          <select id="modalOrderStatusSelect" class="form-control">${statusOptions}</select>
        </label>
        <button class="btn-primary" onclick="saveModalOrderStatus('${escapeAttribute(order.id)}')">حفظ الحالة</button>
      </div>
      <div class="status-edit-lock-note ${locked?"is-locked":""}">
        <i class="fa-solid ${locked?"fa-lock":"fa-unlock"}"></i>
        <span>${lockedText}</span>
      </div>
    </div>`;
  modal.classList.add("active");
};

window.openOrderEditForm=function(orderId){
  const order=ordersData.find((item)=>item.id===orderId);if(!order)return;const body=document.getElementById("modalOrderBody");if(!body)return;
  body.innerHTML=`<div class="order-edit-form"><div class="order-section-heading"><div><span class="eyebrow">EDIT ORDER</span><h4>تعديل بيانات الطلب</h4></div><button class="btn-secondary" onclick="openOrderModal('${escapeAttribute(orderId)}')">إلغاء</button></div>
  <div class="form-grid"><label class="field"><span>اسم العميل</span><input id="editCustomerName" class="form-control" value="${escapeAttribute(order.name||"")}"></label><label class="field"><span>البريد الإلكتروني</span><input id="editCustomerEmail" class="form-control" value="${escapeAttribute(order.customerEmail||"")}"></label><label class="field"><span>رقم الجوال</span><input id="editPhone" class="form-control" dir="ltr" value="${escapeAttribute(order.phone||"")}"></label><label class="field"><span>المنصة</span><select id="editPlatform" class="form-control"><option value="PlayStation" ${String(order.platform).toUpperCase()==="PLAYSTATION"?"selected":""}>PlayStation</option><option value="Xbox" ${String(order.platform).toUpperCase()==="XBOX"?"selected":""}>Xbox</option><option value="PC" ${String(order.platform).toUpperCase()==="PC"?"selected":""}>PC</option></select></label><label class="field"><span>الكمية المباعة</span><input id="editQuantity" class="form-control" inputmode="numeric" autocomplete="off" value="${formatCoinsNumber(order.totalQty||0)}" oninput="formatCoinInput(this)"></label></div>
  <div class="edit-sensitive-note">الحقول الحساسة التالية اختيارية. تركها فارغة يعني إبقاء القيمة الحالية. عند حفظها، يرسلها النظام للسيرفر لتشفيرها.</div>
  <div class="form-grid"><label class="field"><span>EA Email</span><input id="editEaEmail" class="form-control" type="email" placeholder="قيمة جديدة فقط"></label><label class="field"><span>EA Password</span><input id="editEaPassword" class="form-control" type="password" placeholder="قيمة جديدة فقط"></label><label class="field"><span>Backup Code 1</span><input id="editCode1" class="form-control" placeholder="قيمة جديدة فقط"></label><label class="field"><span>Backup Code 2</span><input id="editCode2" class="form-control" placeholder="قيمة جديدة فقط"></label><label class="field"><span>Backup Code 3</span><input id="editCode3" class="form-control" placeholder="قيمة جديدة فقط"></label></div>
  <div class="edit-payment-card"><h4>بيانات الدفع — اختياري</h4><div class="form-grid"><label class="field"><span>Payment Method</span><select id="editPaymentMethod" class="form-control"><option value="">بدون تعديل</option><option value="bank">تحويل بنكي</option><option value="wallet">محفظة رقمية</option><option value="usd">USD / USDT</option><option value="paypal">PayPal</option><option value="western">Western Union</option></select></label><label class="field"><span>اسم البنك / المحفظة</span><input id="editPaymentName" class="form-control"></label><label class="field"><span>الاسم الكامل</span><input id="editPaymentFullName" class="form-control"></label><label class="field"><span>IBAN / Wallet Address</span><input id="editPaymentValue" class="form-control" dir="ltr"></label><label class="field"><span>Phone / PayPal Email</span><input id="editPaymentPhoneOrEmail" class="form-control" dir="ltr"></label><label class="field"><span>Country</span><input id="editPaymentCountry" class="form-control"></label></div></div>
  <button class="btn-primary btn-wide" onclick="saveOrderEditForm('${escapeAttribute(orderId)}')">حفظ كل التعديلات</button></div>`;
};
window.saveOrderEditForm=async function(orderId){
  const get=(id)=>document.getElementById(id)?.value??"";
  const data={customerName:get("editCustomerName").trim(),phone:get("editPhone").trim(),customerEmail:get("editCustomerEmail").trim(),platform:get("editPlatform"),quantity:Number(get("editQuantity").replace(/,/g,""))};
  const account={};if(get("editEaEmail").trim())account.eaEmail=get("editEaEmail").trim();if(get("editEaPassword"))account.eaPassword=get("editEaPassword");const codes=[get("editCode1").trim(),get("editCode2").trim(),get("editCode3").trim()].filter(Boolean);if(codes.length){if(codes.length!==3){showToast("❌ أدخل الأكواد الثلاثة كاملة.");return;}account.backupCodes=codes;}if(Object.keys(account).length)data.account=account;
  const method=get("editPaymentMethod").trim();if(method){const payout={method};const n=get("editPaymentName").trim(),full=get("editPaymentFullName").trim(),val=get("editPaymentValue").trim(),extra=get("editPaymentPhoneOrEmail").trim(),country=get("editPaymentCountry").trim();if(method==="bank")Object.assign(payout,{bankName:n,fullName:full,iban:val});else if(method==="wallet")Object.assign(payout,{walletName:n,phone:extra});else if(method==="usdt")Object.assign(payout,{wallet:val,network:"TRC20"});else if(method==="paypal")Object.assign(payout,{email:extra});else if(method==="western")Object.assign(payout,{fullNameEnglish:full,country});data.payout=payout;}
  try{const response=await adminFetch("/api/orders/update",{method:"POST",body:JSON.stringify({orderId,data})});const result=await readJsonResponse(response);if(await handleAdminAuthFailure(response,result))return;if(!result.success){showToast("❌ "+(result.message||"تعذر حفظ التعديلات."));return;}await logAuditEvent("تعديل بيانات الطلب",ordersData.find(o=>o.id===orderId)?.referenceNumber||orderId,"تم تعديل بيانات الطلب من داخل التفاصيل");showToast("تم حفظ التعديلات.");await loadOrders();openOrderModal(orderId);}catch(error){console.error("Order edit:",error);showToast("❌ تعذر حفظ التعديلات.");}
};


window.closeOrderModal =
  function () {
    clearDecryptState();

    const modal =
      document.getElementById(
        "orderDetailModal"
      );

    if (modal) {
      modal.classList.remove(
        "active"
      );
    }
  };

// ==========================================================================
window.editOrderData = async function(orderId) {
  const order = ordersData.find((item) => item.id === orderId);
  if (!order) { showToast("❌ الطلب غير موجود."); return; }

  const customerName = prompt("اسم العميل:", order.name || "");
  if (customerName === null) return;
  const phone = prompt("رقم الجوال:", order.phone || "");
  if (phone === null) return;
  const customerEmail = prompt("البريد الإلكتروني للعميل:", order.customerEmail || "");
  if (customerEmail === null) return;
  const platform = prompt("المنصة (PlayStation / Xbox / PC):", order.platform || "");
  if (platform === null) return;
  const quantityText = prompt("كمية الكوينز:", String(order.totalQty || ""));
  if (quantityText === null) return;

  const data = { customerName, phone, customerEmail, platform, quantity: Number(quantityText) };

  if (confirm("هل تريد أيضًا تعديل بيانات EA أو بيانات الدفع الحساسة؟")) {
    const account = {};
    const eaEmail = prompt("بريد EA الجديد (فارغ = إبقاء الحالي):", "");
    if (eaEmail === null) return;
    if (eaEmail.trim()) account.eaEmail = eaEmail.trim();

    const eaPassword = prompt("كلمة مرور EA الجديدة (فارغ = إبقاء الحالية):", "");
    if (eaPassword === null) return;
    if (eaPassword.trim()) account.eaPassword = eaPassword;

    const backupCodes = prompt("3 أكواد احتياطية جديدة مفصولة بفاصلة (فارغ = إبقاء الحالية):", "");
    if (backupCodes === null) return;
    if (backupCodes.trim()) account.backupCodes = backupCodes.split(/[,\n]+/).map((value) => value.trim()).filter(Boolean);

    if (Object.keys(account).length) data.account = account;

    if (confirm("هل تريد تعديل بيانات الدفع أيضًا؟")) {
      const method = prompt("طريقة الدفع: bank / wallet / usd / paypal / western", order.paymentMethod || "");
      if (method === null) return;
      const normalizedMethod = method.trim().toLowerCase();
      const payout = { method: normalizedMethod };

      if (normalizedMethod === "bank") {
        const bankName = prompt("اسم البنك:", order.bankName || ""); if (bankName === null) return;
        const fullName = prompt("الاسم الكامل لصاحب الحساب:", ""); if (fullName === null) return;
        const iban = prompt("IBAN:", ""); if (iban === null) return;
        Object.assign(payout, { bankName, fullName, iban });
      } else if (normalizedMethod === "wallet") {
        const walletName = prompt("اسم المحفظة:", ""); if (walletName === null) return;
        const walletPhone = prompt("رقم المحفظة:", ""); if (walletPhone === null) return;
        Object.assign(payout, { walletName, phone: walletPhone });
      } else if (normalizedMethod === "usd") {
        const wallet = prompt("عنوان محفظة USDT (TRC20):", ""); if (wallet === null) return;
        Object.assign(payout, { wallet, network: "TRC20" });
      } else if (normalizedMethod === "paypal") {
        const email = prompt("بريد PayPal:", ""); if (email === null) return;
        Object.assign(payout, { email });
      } else if (normalizedMethod === "western") {
        const fullNameEnglish = prompt("الاسم بالإنجليزية:", ""); if (fullNameEnglish === null) return;
        const country = prompt("الدولة:", ""); if (country === null) return;
        Object.assign(payout, { fullNameEnglish, country });
      } else {
        showToast("❌ طريقة الدفع غير صحيحة.");
        return;
      }

      data.payout = payout;
    }
  }

  try {
    const response = await adminFetch("/api/orders/update", {
      method: "POST",
      body: JSON.stringify({ orderId, data })
    });
    const result = await readJsonResponse(response);
    if (await handleAdminAuthFailure(response, result)) return;
    if (!result.success) {
      showToast("❌ " + (result.message || "تعذر تحديث الطلب."));
      return;
    }
    showToast("✅ تم تحديث بيانات الطلب وتوثيق التعديل.");
    await loadOrders();
    openOrderModal(orderId);
  } catch (error) {
    console.error("Edit order error:", error);
    showToast("❌ تعذر تحديث بيانات الطلب.");
  }
};

// 12) المشكلة — مستقلة عن الحالة
// ==========================================================================

window.toggleOrderIssueEditor = function (issue) {
  const value = String(issue || "").trim();
  const input = document.getElementById("orderIssueMessageInput");
  const summary = document.getElementById("orderIssueSummary");
  const state = document.querySelector(".issue-editor-state");

  if (input) {
    input.disabled = !value;
    if (value && !input.value.trim()) input.value = getIssueLabel(value);
  }

  if (summary) {
    summary.textContent = value
      ? (ISSUE_LABELS[value] || value)
      : "لا توجد مشكلة مسجلة";
  }

  if (state) {
    state.textContent = value ? "موجودة" : "بدون مشكلة";
    state.classList.toggle("has-issue", !!value);
  }
};

window.saveOrderIssue =
  async function (orderId) {
    const order = ordersData.find((item) => item.id === orderId);
    if (!order) {
      showToast("الطلب غير موجود.");
      return;
    }

    const select = document.getElementById("orderIssueSelect");
    const messageInput = document.getElementById("orderIssueMessageInput");
    if (!select) return;

    const selectedIssue = String(select.value || "").trim().toLowerCase();
    if (selectedIssue && !ISSUE_VALUES.includes(selectedIssue)) {
      showToast("❌ نوع المشكلة غير صحيح.");
      return;
    }

    const issue = selectedIssue || null;
    const issueMessage = issue
      ? String(messageInput?.value || getIssueLabel(issue)).trim()
      : "";

    if (issue && !issueMessage) {
      showToast("❌ اكتب رسالة المشكلة قبل الحفظ.");
      return;
    }

    try {
      const response = await adminFetch("/api/orders/update-status", {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          status: order.status,
          issue,
          issueMessage
        })
      });

      const data = await readJsonResponse(response);
      if (await handleAdminAuthFailure(response, data)) return;

      if (!data.success) {
        showToast("❌ فشل تحديث المشكلة: " + (data.message || ""));
        return;
      }

      order.issue = data.issue ?? issue;
      order.issueMessage = data.issueMessage ?? issueMessage;
      if (data.lastUpdate) order.lastUpdate = data.lastUpdate;

      refreshOrdersDerivedUI();
      syncOpenOrderModal(order);

      try {
        await logAuditEvent(
          issue ? "تسجيل مشكلة للطلب" : "إزالة مشكلة من الطلب",
          order.referenceNumber || order.id,
          issue ? `المشكلة: ${issue}` : "تم اختيار: لا توجد مشكلة"
        );
      } catch (auditError) {
        console.warn("Issue audit logging failed after successful update:", auditError);
      }

      showToast(issue ? "✅ تم حفظ المشكلة بنجاح." : "✅ تم إزالة المشكلة من الطلب.");
    } catch (error) {
      console.error("Save order issue error:", error?.message || error);
      showToast("❌ تعذر تحديث مشكلة الطلب.");
    }
  };

// 13) الإتلاف اليدوي بعد مرور 5 أيام
// ==========================================================================

window.openPurgeModal =
  function (orderId) {
    const order =
      ordersData.find(
        (item) =>
          item.id ===
          orderId
      );

    if (!order) {
      showToast(
        "الطلب غير موجود."
      );

      return;
    }

    if (
      order.status !==
      "completed"
    ) {
      showToast(
        "لا يمكن إتلاف البيانات إلا بعد اكتمال الطلب."
      );

      return;
    }

    if (
      order.sensitivePurged ===
      true
    ) {
      showToast(
        "تم إتلاف البيانات الحساسة لهذا الطلب مسبقاً."
      );

      return;
    }

    if (
      !isPurgeDue(order)
    ) {
      const dueDate =
        getPurgeDueDate(
          order
        );

      showToast(
        dueDate
          ? `لم يحِن موعد الإتلاف بعد.\nالموعد: ${dueDate.toLocaleString(
              "en-GB",
              {
                timeZone:
                  "Asia/Riyadh"
              }
            )}`
          : "لم يتم تحديد موعد الإتلاف بعد."
      );

      return;
    }

    const modal =
      document.getElementById(
        "purgeConfirmModal"
      );

    const input =
      document.getElementById(
        "purgeTargetOrderId"
      );

    if (input) {
      input.value =
        orderId;
    }

    if (modal) {
      modal.classList.add(
        "active"
      );
    }
  };

window.closePurgeModal =
  function () {
    const modal =
      document.getElementById(
        "purgeConfirmModal"
      );

    if (modal) {
      modal.classList.remove(
        "active"
      );
    }
  };

window.confirmPurgeDataFinal =
  async function () {
    const orderId =
      document.getElementById(
        "purgeTargetOrderId"
      )?.value;

    if (!orderId) {
      return;
    }

    const order =
      ordersData.find(
        (item) =>
          item.id ===
          orderId
      );

    if (!order) {
      showToast(
        "الطلب غير موجود."
      );

      return;
    }

    if (
      order.status !==
      "completed"
    ) {
      showToast(
        "لا يمكن إتلاف البيانات إلا بعد اكتمال الطلب."
      );

      return;
    }

    if (
      !isPurgeDue(order)
    ) {
      showToast(
        "لا يمكن الإتلاف قبل مرور 5 أيام من اكتمال الطلب."
      );

      return;
    }

    if (
      order.sensitivePurged ===
      true
    ) {
      showToast(
        "تم إتلاف البيانات مسبقاً."
      );

      return;
    }

    /*
     * تأكيد ثانٍ صريح قبل العملية النهائية.
     */
    if (
      !confirm(
        "تأكيد نهائي: سيتم حذف بيانات EA وبيانات الدفع الحساسة نهائياً ولا يمكن استعادتها. هل تريد المتابعة؟"
      )
    ) {
      return;
    }

    try {
      const response =
        await adminFetch(
          "/api/admin/destroy-sensitive-data",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                orderId,
                confirm:
                  true
              })
          }
        );

      const data =
        await readJsonResponse(
          response
        );

      if (
        await handleAdminAuthFailure(
          response,
          data
        )
      ) {
        return;
      }

      if (
        data.success
      ) {
        await logAuditEvent(
          "إتلاف بيانات حساسة",
          order.referenceNumber ||
            orderId,
          "تم إتلاف بيانات EA الحساسة نهائياً بعد مرور 5 أيام وتأكيد المشرف"
        );

        showToast(
          "✅ تم إتلاف البيانات الحساسة بنجاح."
        );

        closePurgeModal();
        closeOrderModal();

        await loadOrders();

        return;
      }

      showToast(
        "❌ فشل الإتلاف: " +
          (
            data.message ||
            "حدث خطأ بالخادم"
          )
      );
    } catch (error) {
      showToast(
        "❌ تعذر تنفيذ الإتلاف."
      );

      console.error(
        "Purge error:",
        error?.message ||
          error
      );
    }
  };

// ==========================================================================
// 14) تغيير الحالة — يدوي فقط
// ==========================================================================

window.setIssueState = async function(orderId, state) {
  const order = ordersData.find((item) => item.id === orderId);
  if (!order || !order.issue) return;

  try {
    const response = await adminFetch("/api/orders/update-status", {
      method: "POST",
      body: JSON.stringify({
        orderId: order.id,
        status: order.status,
        issue: order.issue,
        issueMessage: order.issueMessage || "",
        issueState: state
      })
    });

    const data = await readJsonResponse(response);

    if (await handleAdminAuthFailure(response, data)) return;

    if (!data.success) {
      showToast("❌ " + (data.message || "تعذر تحديث حالة المشكلة."));
      return;
    }

    showToast("✅ تم تحديث دورة حياة المشكلة.");
    await loadOrders();
    openOrderModal(order.id);
  } catch (error) {
    console.error("Issue state update error:", error);
    showToast("❌ تعذر تحديث دورة حياة المشكلة.");
  }
};

window.promptEditOrder =
  async function (
    orderId
  ) {
    const order =
      ordersData.find(
        (item) =>
          item.id ===
          orderId
      );

    if (!order) return;

    const newStatus =
      prompt(
        "أدخل الحالة الجديدة:\n\n" +
          "new = طلب جديد\n" +
          "review = انتظار المراجعة\n" +
          "progress = جاري سحب الكوين\n" +
          "finished = تم الانتهاء من السحب\n" +
          "pending_transfer = بانتظار التحويل\n" +
          "transferred = تم التحويل لحسابك\n" +
          "completed = مكتمل",
        order.status
      );

    if (!newStatus) {
      return;
    }

    const normalizedStatus =
      newStatus
        .trim()
        .toLowerCase();

    if (
      !STATUS_VALUES.includes(
        normalizedStatus
      )
    ) {
      showToast(
        "❌ الحالة المدخلة غير صحيحة."
      );

      return;
    }

    let issue =
      order.issue ||
      null;

    let issueMessage =
      order.issueMessage ||
      "";

    if (
      confirm(
        "هل تريد تحديث حالة المشكلة لهذا الطلب؟"
      )
    ) {
      const issueInput =
        prompt(
          "اكتب كود المشكلة أو اتركه فارغاً لإزالة المشكلة:\n\n" +
            "wrong_credentials\n" +
            "wrong_backup_codes\n" +
            "logged_in_platform\n" +
            "market_closed\n" +
            "wrong_platform\n" +
            "other_issue",
          issue || ""
        );

      if (
        issueInput !==
        null
      ) {
        const normalizedIssue =
          issueInput
            .trim()
            .toLowerCase();

        if (
          normalizedIssue ===
          ""
        ) {
          issue =
            null;

          issueMessage =
            "";
        } else if (
          ISSUE_VALUES.includes(
            normalizedIssue
          )
        ) {
          issue =
            normalizedIssue;

          issueMessage =
            prompt(
              "رسالة المشكلة للعميل:\n\nاتركها فارغة لاستخدام الرسالة المحفوظة في إعدادات النظام.",
              issueMessage ||
                getIssueLabel(
                  issue
                )
            ) || "";
        } else {
          showToast(
            "❌ كود المشكلة غير صحيح."
          );

          return;
        }
      }
    }

    try {
      const response =
        await adminFetch(
          "/api/orders/update-status",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                orderId:
                  order.id,

                status:
                  normalizedStatus,

                issue,

                issueMessage
              })
          }
        );

      const data =
        await readJsonResponse(
          response
        );

      if (
        await handleAdminAuthFailure(
          response,
          data
        )
      ) {
        return;
      }

      if (
        data.success
      ) {
        await logAuditEvent(
          "تعديل حالة الطلب",
          order.referenceNumber,
          `تعديل الحالة إلى: ${normalizedStatus}${
            issue
              ? ` | المشكلة: ${issue}`
              : " | لا توجد مشكلة"
          }`
        );

        showToast(
          "✅ تم تعديل حالة الطلب بنجاح."
        );

        await loadOrders();
      } else {
        showToast(
          "❌ فشل التعديل: " +
            (
              data.message ||
              ""
            )
        );
      }
    } catch (error) {
      showToast(
        "❌ تعذر تعديل الحالة."
      );

      console.error(
        "Status update error:",
        error?.message ||
          error
      );
    }
  };

window.handleArchiveOrder =
  async function (
    orderId,
    refNum
  ) {
    if (
      !confirm(
        `هل تؤكد أرشفة الطلب #${refNum}؟`
      )
    ) {
      return;
    }

    try {
      const response =
        await adminFetch(
          "/api/admin/archive-order",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                orderId
              })
          }
        );

      const data =
        await readJsonResponse(
          response
        );

      if (
        await handleAdminAuthFailure(
          response,
          data
        )
      ) {
        return;
      }

      if (
        data.success
      ) {
        await logAuditEvent(
          "أرشفة طلب",
          refNum,
          "تم تغيير الحالة إلى مؤرشف"
        );

        showToast(
          "✅ تم أرشفة الطلب بنجاح."
        );

        await loadOrders();
      } else {
        showToast(
          "❌ فشل الأرشفة: " +
            (
              data.message ||
              ""
            )
        );
      }
    } catch (error) {
      showToast(
        "❌ تعذر أرشفة الطلب."
      );

      console.error(
        "Archive error:",
        error?.message ||
          error
      );
    }
  };

window.handleDeleteOrder =
  async function (
    orderId,
    refNum
  ) {
    if (
      !confirm(
        `⚠️ تحذير: هل أنت متأكد من حذف الطلب #${refNum} نهائياً؟`
      )
    ) {
      return;
    }

    try {
      const response =
        await adminFetch(
          "/api/orders/delete",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                orderId
              })
          }
        );

      const data =
        await readJsonResponse(
          response
        );

      if (
        await handleAdminAuthFailure(
          response,
          data
        )
      ) {
        return;
      }

      if (
        data.success
      ) {
        await logAuditEvent(
          "حذف طلب",
          refNum,
          "تم حذف الطلب نهائياً من قاعدة البيانات"
        );

        showToast(
          "✅ تم حذف الطلب بنجاح."
        );

        await loadOrders();
      } else {
        showToast(
          "❌ فشل الحذف: " +
            (
              data.message ||
              ""
            )
        );
      }
    } catch (error) {
      showToast(
        "❌ تعذر حذف الطلب."
      );

      console.error(
        "Delete error:",
        error?.message ||
          error
      );
    }
  };

window.handleMarkTransferred =
  async function (
    orderId,
    refNum
  ) {
    if (
      !confirm(
        `هل تؤكد إتمام التحويل المالي للطلب #${refNum} وتغيير حالته إلى (تم التحويل)؟`
      )
    ) {
      return;
    }

    try {
      const response =
        await adminFetch(
          "/api/orders/update-status",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                orderId,

                status:
                  "transferred",

                transferData: {
                  transferredAt:
                    new Date().toISOString(),

                  transferredBy:
                    currentAdmin.name ||
                    "مشرف النظام",

                  transferredByEmail:
                    currentAdmin.email ||
                    ""
                }
              })
          }
        );

      const data =
        await readJsonResponse(
          response
        );

      if (
        await handleAdminAuthFailure(
          response,
          data
        )
      ) {
        return;
      }

      if (
        data.success
      ) {
        await logAuditEvent(
          "تحويل مالي",
          refNum,
          `تم التحويل المالي بواسطة: ${currentAdmin.name}`
        );

        showToast(
          "✅ تم إتمام التحويل المالي وتوثيق البيانات بنجاح."
        );

        closeOrderModal();

        await loadOrders();
      } else {
        showToast(
          "❌ فشل تغيير الحالة: " +
            (
              data.message ||
              ""
            )
        );
      }
    } catch (error) {
      showToast(
        "❌ تعذر إتمام التحويل."
      );

      console.error(
        "Transfer error:",
        error?.message ||
          error
      );
    }
  };

// ==========================================================================
// 15) تحديث الكوينز المسحوبة — بدون أي تغيير تلقائي للحالة
// ==========================================================================

window.updateDrawnCoinsPrompt =
  async function (
    orderId,
    refNum,
    currentDrawn,
    totalQty
  ) {
    const newDrawnStr =
      prompt(
        `تحديث الكوينز المسحوبة للطلب #${refNum}:\nالكمية المطلوبة الكلية: ${formatCoinsNumber(
          totalQty
        )}`,
        currentDrawn
      );

    if (
      newDrawnStr ===
        null ||
      newDrawnStr.trim() ===
        ""
    ) {
      return;
    }

    if (
      isNaN(
        newDrawnStr
      )
    ) {
      showToast(
        "❌ أدخل رقماً صحيحاً."
      );

      return;
    }

    const newDrawn =
      Number(
        newDrawnStr
      );

    if (
      !Number.isFinite(
        newDrawn
      ) ||
      newDrawn < 0
    ) {
      showToast(
        "❌ الكمية غير صحيحة."
      );

      return;
    }

    if (
      newDrawn >
      Number(totalQty)
    ) {
      showToast(
        "❌ الكمية المسحوبة لا يمكن أن تتجاوز الكمية المطلوبة."
      );

      return;
    }

    try {
      const response =
        await adminFetch(
          "/api/orders/update-drawn",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                orderId,
                drawnCoins:
                  newDrawn
              })
          }
        );

      const data =
        await readJsonResponse(
          response
        );

      if (
        await handleAdminAuthFailure(
          response,
          data
        )
      ) {
        return;
      }

      if (
        !data.success
      ) {
        showToast(
          "❌ فشل التحديث: " +
            (
              data.message ||
              ""
            )
        );

        return;
      }

      await logAuditEvent(
        "تحديث سحب الكوينز",
        refNum,
        `تم تحديث المسحوب إلى: ${formatCoinsNumber(
          newDrawn
        )} / ${formatCoinsNumber(
          totalQty
        )}`
      );

      showToast(
        "✅ تم تحديث الكمية المسحوبة بنجاح."
      );

      closeOrderModal();

      await loadOrders();
    } catch (error) {
      showToast(
        "❌ تعذر تحديث الكمية."
      );

      console.error(
        "Drawn coins update error:",
        error?.message ||
          error
      );
    }
  };

// ==========================================================================
// 16) إعدادات النظام والمخزون
// ==========================================================================

function calculateLocalInventory() {
  let sharedOrdered = 0, sharedWithdrawn = 0, pcOrdered = 0, pcWithdrawn = 0;
  const orderedFor = (order) => Math.max(0, Number(order.totalQty ?? order.quantity ?? 0) || 0);
  const withdrawnFor = (order) => Math.min(orderedFor(order), Math.max(0, Number(order.withdrawnQuantity ?? order.drawnCoins ?? 0) || 0));
  ordersData.forEach((order) => {
    const platform = String(order.platform || "").trim().toUpperCase();
    const ordered = orderedFor(order);
    const withdrawn = withdrawnFor(order);
    if (platform === "PC") { pcOrdered += ordered; pcWithdrawn += withdrawn; }
    else if (platform === "PLAYSTATION" || platform === "XBOX") { sharedOrdered += ordered; sharedWithdrawn += withdrawn; }
  });
  return {
    shared:{ordered:sharedOrdered,withdrawn:sharedWithdrawn,remaining:Math.max(0,sharedOrdered-sharedWithdrawn)},
    playstation:{ordered:sharedOrdered,withdrawn:sharedWithdrawn,remaining:Math.max(0,sharedOrdered-sharedWithdrawn)},
    xbox:{ordered:sharedOrdered,withdrawn:sharedWithdrawn,remaining:Math.max(0,sharedOrdered-sharedWithdrawn)},
    pc:{ordered:pcOrdered,withdrawn:pcWithdrawn,remaining:Math.max(0,pcOrdered-pcWithdrawn)}
  };
}

function getInventoryPeriodRange() {
  const value = document.getElementById("inventoryPeriodSelect")?.value || "24h";
  const now = Date.now();
  if (value === "custom") {
    const from = document.getElementById("inventoryPeriodStart")?.value;
    const to = document.getElementById("inventoryPeriodEnd")?.value;
    if (!from || !to) return null;
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
    return { start: start.getTime(), end: end.getTime() };
  }
  const hours = { "24h":24, "48h":48, "72h":72, "7d":168, "30d":720, "90d":2160, "365d":8760 }[value] || 24;
  return { start: now - hours * 60 * 60 * 1000, end: now };
}

function getInventoryMovementByPeriod() {
  const range = getInventoryPeriodRange();
  const result = { sharedAdded:0, sharedWithdrawn:0, pcAdded:0, pcWithdrawn:0 };
  if (!range) return result;
  const groupFor = (platform) => String(platform || "").trim().toUpperCase() === "PC" ? "pc" : "shared";
  const dateOf = (value) => parseFirestoreDate(value) || (value ? new Date(value) : null);
  ordersData.forEach((order) => {
    const group = groupFor(order.platform);
    const created = dateOf(order.createdAt);
    const ordered = Math.max(0, Number(order.totalQty ?? order.quantity ?? 0) || 0);
    if (created && !Number.isNaN(created.getTime()) && created.getTime() >= range.start && created.getTime() <= range.end) {
      if (group === "pc") result.pcAdded += ordered; else result.sharedAdded += ordered;
    }
    const events = (Array.isArray(order.history) ? [...order.history] : [])
      .filter((item) => item && item.type === "withdrawn_quantity")
      .map((item) => ({ value:Math.max(0,Number(item.value)||0), at:dateOf(item.at||item.timestamp||item.createdAt) }))
      .filter((item) => item.at && !Number.isNaN(item.at.getTime()))
      .sort((a,b) => a.at.getTime()-b.at.getTime());
    let previous = 0;
    events.forEach((event) => {
      const delta = Math.max(0, event.value - previous);
      if (event.at.getTime() >= range.start && event.at.getTime() <= range.end) {
        if (group === "pc") result.pcWithdrawn += delta; else result.sharedWithdrawn += delta;
      }
      previous = event.value;
    });
  });
  return result;
}

window.handleInventoryPeriodChange = function() {
  const custom = document.getElementById("inventoryCustomPeriod");
  if (custom) custom.hidden = document.getElementById("inventoryPeriodSelect")?.value !== "custom";
  renderInventoryUI(currentSettingsData);
};

function renderInventoryUI(settings) {
  const inventory = calculateLocalInventory();
  const psStock = document.getElementById("invStockPS");
  const pcStock = document.getElementById("invStockPC");
  const psTrend = document.getElementById("invStockPSTrend");
  const pcTrend = document.getElementById("invStockPCTrend");
  const lastUpdate = document.getElementById("invLastUpdate");

  if (psStock) psStock.innerText = formatCoinsNumber(inventory.shared.remaining);
  if (pcStock) pcStock.innerText = formatCoinsNumber(inventory.pc.remaining);
  if (psTrend) psTrend.innerHTML = getStockTrendMarkup(inventory.shared.remaining);
  if (pcTrend) pcTrend.innerHTML = getStockTrendMarkup(inventory.pc.remaining);

  const movement = getInventoryMovementByPeriod();
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = formatCoinsNumber(value);
  };
  set("inv24hAddedShared", movement.sharedAdded);
  set("inv24hWithdrawnShared", movement.sharedWithdrawn);
  set("inv24hAddedPC", movement.pcAdded);
  set("inv24hWithdrawnPC", movement.pcWithdrawn);

  if (lastUpdate) {
    lastUpdate.innerText = new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Riyadh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
}


/*
 * يحول أي قيمة واردة من Firestore إلى قائمة آمنة.
 *
 * النظام الجديد يستخدم Array:
 * [
 *   "تحويل بنكي",
 *   "المحافظ الرقمية",
 *   ...
 * ]
 *
 * وفي حال وجود بيانات قديمة بصيغة Object يتم استخراج
 * القيم من جميع التصنيفات مؤقتاً حتى لا تختفي البيانات
 * من لوحة الإدارة أثناء الانتقال للنظام الجديد.
 */
function normalizeSettingsList(
  value
) {
  if (Array.isArray(value)) {
    return value
      .map(
        (item) =>
          String(
            item ?? ""
          ).trim()
      )
      .filter(Boolean);
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const flattened = [];

    Object.values(
      value
    ).forEach(
      (categoryValue) => {
        if (
          Array.isArray(
            categoryValue
          )
        ) {
          categoryValue.forEach(
            (item) => {
              const text =
                String(
                  item ?? ""
                ).trim();

              if (text) {
                flattened.push(
                  text
                );
              }
            }
          );
        }
      }
    );

    return [
      ...new Set(
        flattened
      )
    ];
  }

  return [];
}

function renderTermsEnabledUI(
  settings
) {
  const enabled =
    settings?.termsEnabled !==
    false;

  /*
   * دعم أكثر من اسم محتمل للعنصر بدون افتراض
   * أن admin.html يحتوي على عنصر محدد.
   */
  const checkboxIds = [
    "termsEnabled",
    "termsEnabledCheckbox",
    "termsToggle",
    "termsEnabledToggle"
  ];

  let checkbox =
    null;

  for (
    const id of checkboxIds
  ) {
    const element =
      document.getElementById(
        id
      );

    if (
      element &&
      (
        element.type ===
        "checkbox"
      )
    ) {
      checkbox =
        element;
      break;
    }
  }

  if (checkbox) {
    checkbox.checked =
      enabled;
  }

  const statusIds = [
    "termsEnabledText",
    "termsStatusText",
    "termsToggleText"
  ];

  for (
    const id of statusIds
  ) {
    const element =
      document.getElementById(
        id
      );

    if (element) {
      element.innerText =
        enabled
          ? "الشروط والأحكام مفعلة"
          : "الشروط والأحكام غير مفعلة";

      element.dataset.enabled =
        enabled
          ? "true"
          : "false";
    }
  }
}

function initSystemSettingsListener() {
  return subscribeToSettings(
    (settings) => {
      currentSettingsData =
        settings || {};

      const requiredBanks = [
        "مصرف الراجحي",
        "البنك الأهلي السعودي",
        "بنك الرياض",
        "مصرف الإنماء",
        "بنك البلاد",
        "بنك الجزيرة",
        "البنك الأول (SAB)",
        "البنك العربي الوطني",
        "البنك السعودي الفرنسي",
        "البنك السعودي للاستثمار",
        "STC Bank",
        "D360 Bank",
        "بنك الخليج الدولي"
      ];
      const configuredBanks = Array.isArray(settings?.banks) ? settings.banks : [];
      requiredBanks.forEach((bank) => {
        if (!configuredBanks.includes(bank)) {
          adminSettingsAction("add_bank", { value: bank }).catch((error) => {
            console.error("Bank catalog migration error:", error?.message || error);
          });
        }
      });

      const requiredWallets = [
        "STC Pay",
        "Barq",
        "URPay",
        "Mobily Pay",
        "Tiqmo",
        "Alinma Pay"
      ];
      const configuredWallets = Array.isArray(settings?.wallets) ? settings.wallets : [];
      requiredWallets.forEach((wallet) => {
        if (!configuredWallets.includes(wallet)) {
          adminSettingsAction("add_wallet", { value: wallet }).catch((error) => {
            console.error("Wallet catalog migration error:", error?.message || error);
          });
        }
      });

      updateStoreStatusUI(
        settings.storeOpen !==
          false
      );

      populatePricingUI(
        settings
      );

      renderInventoryUI(
        settings
      );

      renderDashboardQuickStats();

      renderBanks(
        normalizeSettingsList(
          settings.banks
        )
      );

      renderWallets(
        normalizeSettingsList(
          settings.wallets
        )
      );

      renderCustomPayments(
        normalizeSettingsList(
          settings.paymentMethods
        )
      );

      renderTerms(
        normalizeSettingsList(
          settings.terms
        )
      );

      renderTermsEnabledUI(
        settings
      );

      renderIssueMessages(settings.issueMessages || {});
      renderStatusMessages(settings);

      renderPurgeOrdersTable();
    }
  );
}

function updateStoreStatusUI(
  isOpen
) {
  const btn =
    document.getElementById(
      "storeStatusToggleBtn"
    );

  const text =
    document.getElementById(
      "storeStatusText"
    );

  if (
    !btn ||
    !text
  ) {
    return;
  }

  btn.className =
    "store-status-control" +
    (isOpen ? " is-open" : " is-closed");
  btn.setAttribute("aria-pressed", isOpen ? "true" : "false");

  text.innerText = isOpen ? "مفتوح" : "مغلق";

  const dashboardState = document.getElementById("dashboardStoreState");
  if (dashboardState) {
    dashboardState.innerText = isOpen ? "مفتوح" : "مغلق";
  }
}

window.toggleStoreStatus =
  async function () {
    try {
      const newStatus =
        (await adminSettingsAction("toggle_store")).result;

      await logAuditEvent(
        "تغيير حالة المتجر",
        "المتجر",
        `الحالة الجديدة: ${
          newStatus
            ? "مفتوح"
            : "مغلق"
        }`
      );
    } catch (error) {
      showToast(
        "❌ تعذر تغيير حالة المتجر."
      );

      console.error(
        "Toggle store error:",
        error?.message ||
          error
      );
    }
  };

function populatePricingUI(
  config = {}
) {
  const setValue =
    (
      id,
      value
    ) => {
      const element =
        document.getElementById(
          id
        );

      if (element) {
        element.value =
          value ?? "";
      }
    };

  setValue(
    "gameVersion",
    config.gameVersion ||
      27
  );

  setValue(
    "gameName",
    config.gameName ||
      "FC"
  );

  setValue(
    "psRate",
    config.psRate ||
      200
  );

  setValue(
    "psMin",
    formatCoinsNumber(
      config.psMin ||
        100000
    )
  );

  setValue(
    "psMax",
    formatCoinsNumber(
      config.psMax ||
        5000000
    )
  );

  setValue(
    "psWithdrawDuration",
    config.psWithdrawDuration ||
      "3 - 5 أيام عمل"
  );

  setValue(
    "psTransferDuration",
    config.psTransferDuration ||
      "24 ساعة"
  );

  setValue(
    "pcRate",
    config.pcRate ||
      150
  );

  setValue(
    "pcMin",
    formatCoinsNumber(
      config.pcMin ||
        100000
    )
  );

  setValue(
    "pcMax",
    formatCoinsNumber(
      config.pcMax ||
        1000000
    )
  );

  setValue(
    "pcWithdrawDuration",
    config.pcWithdrawDuration ||
      "2 - 4 أيام عمل"
  );

  setValue(
    "pcTransferDuration",
    config.pcTransferDuration ||
      "24 ساعة"
  );

  setValue(
    "storeNameInput",
    config.storeName ||
      "SAMI COINS"
  );

  setValue(
    "supportWhatsappInput",
    config.supportWhatsapp ||
      ""
  );

  setValue(
    "promoActiveSelect",
    config.offers
      ? "true"
      : "false"
  );

  setValue(
    "promoText",
    config.offerText ||
      ""
  );
}

window.saveProductsConfig =
  async function () {
    const pricingData = {
      storeName:
        document.getElementById(
          "storeNameInput"
        )?.value ||
        "",

      gameName:
        document.getElementById(
          "gameName"
        )?.value ||
        "FC",

      gameVersion:
        Number(
          document.getElementById(
            "gameVersion"
          )?.value
        ) || 27,

      supportWhatsapp:
        document.getElementById(
          "supportWhatsappInput"
        )?.value ||
        "",

      psRate:
        Number(
          document.getElementById(
            "psRate"
          )?.value
        ),

      psMin:
        Number(
          String(
            document.getElementById(
              "psMin"
            )?.value ||
              ""
          ).replace(
            /,/g,
            ""
          )
        ),

      psMax:
        Number(
          String(
            document.getElementById(
              "psMax"
            )?.value ||
              ""
          ).replace(
            /,/g,
            ""
          )
        ),

      psWithdrawDuration:
        document.getElementById(
          "psWithdrawDuration"
        )?.value ||
        "",

      psTransferDuration:
        document.getElementById(
          "psTransferDuration"
        )?.value ||
        "",

      pcRate:
        Number(
          document.getElementById(
            "pcRate"
          )?.value
        ),

      pcMin:
        Number(
          String(
            document.getElementById(
              "pcMin"
            )?.value ||
              ""
          ).replace(
            /,/g,
            ""
          )
        ),

      pcMax:
        Number(
          String(
            document.getElementById(
              "pcMax"
            )?.value ||
              ""
          ).replace(
            /,/g,
            ""
          )
        ),

      pcWithdrawDuration:
        document.getElementById(
          "pcWithdrawDuration"
        )?.value ||
        "",

      pcTransferDuration:
        document.getElementById(
          "pcTransferDuration"
        )?.value ||
        "",

      offers:
        document.getElementById(
          "promoActiveSelect"
        )?.value ===
        "true",

      offerText:
        document.getElementById(
          "promoText"
        )?.value ||
        ""
    };

    try {
      await adminSettingsAction("update_pricing", { data: pricingData });

      await logAuditEvent(
        "حفظ إعدادات الأسعار",
        "الإعدادات",
        "تحديث الأسعار وإعدادات المنصات بنجاح"
      );

      showToast(
        "✅ تم حفظ إعدادات الأسعار والمنصات بنجاح!"
      );
    } catch (error) {
      showToast(
        "❌ تعذر حفظ الإعدادات."
      );

      console.error(
        "Save pricing error:",
        error?.message ||
          error
      );
    }
  };

// ==========================================================================
// 16-A) البنوك
// ==========================================================================

function renderBanks(
  banksArray = []
) {
  const container =
    document.getElementById(
      "banksListContainer"
    );

  if (!container) return;

  const banks =
    normalizeSettingsList(
      banksArray
    );

  if (banks.length === 0) {
    container.innerHTML = `
      <div
        style="
          padding:12px;
          border:1px dashed var(--card-border);
          border-radius:10px;
          color:var(--text-muted);
          text-align:center;
        ">
        لا توجد بنوك مضافة حالياً.
      </div>
    `;

    return;
  }

  container.innerHTML =
    banks
      .map(
        (
          bank,
          index
        ) => `
          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--card-bg);border:1px solid var(--card-border);padding:8px 12px;border-radius:10px;">

            <span style="font-size:0.88rem;font-weight:800;">
              ${index + 1}.
              ${escapeHtml(
                bank
              )}
            </span>

            <button
              class="btn-action"
              style="color:var(--danger);"
              title="حذف البنك"
              onclick="deleteBank(${index})">
              <i class="fa-solid fa-trash"></i>
            </button>

          </div>
        `
      )
      .join("");
}

window.addBank =
  async function () {
    const input =
      document.getElementById(
        "newBankInput"
      );

    if (!input) {
      return;
    }

    const value =
      input.value.trim();

    if (!value) {
      return;
    }

    try {
      await adminSettingsAction("add_bank", { value });

      input.value =
        "";

      await logAuditEvent(
        "إضافة بنك",
        "الإعدادات",
        `تمت إضافة البنك: ${value}`
      );
    } catch (error) {
      console.error(
        "Add bank error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر إضافة البنك."
      );
    }
  };

window.deleteBank =
  async function (
    index
  ) {
    try {
      const banks =
        normalizeSettingsList(
          currentSettingsData.banks
        );

      const bankName =
        banks[index] ||
        "";

      if (
        !bankName
      ) {
        return;
      }

      if (
        !confirm(
          `هل أنت متأكد من حذف البنك:\n\n${bankName}`
        )
      ) {
        return;
      }

      await adminSettingsAction("delete_bank", { index });

      await logAuditEvent(
        "حذف بنك",
        "الإعدادات",
        `تم حذف البنك: ${bankName}`
      );
    } catch (error) {
      console.error(
        "Delete bank error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر حذف البنك."
      );
    }
  };

// ==========================================================================
// 16-B) المحافظ الرقمية
// ==========================================================================

function renderWallets(
  walletsArray = []
) {
  const container =
    document.getElementById(
      "walletsListContainer"
    );

  if (!container) return;

  const wallets =
    normalizeSettingsList(
      walletsArray
    );

  if (wallets.length === 0) {
    container.innerHTML = `
      <div
        style="
          padding:12px;
          border:1px dashed var(--card-border);
          border-radius:10px;
          color:var(--text-muted);
          text-align:center;
        ">
        لا توجد محافظ رقمية مضافة حالياً.
      </div>
    `;

    return;
  }

  container.innerHTML =
    wallets
      .map(
        (
          wallet,
          index
        ) => `
          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--card-bg);border:1px solid var(--card-border);padding:8px 12px;border-radius:10px;">

            <span style="font-size:0.88rem;font-weight:800;">
              ${index + 1}.
              ${escapeHtml(
                wallet
              )}
            </span>

            <button
              class="btn-action"
              style="color:var(--danger);"
              title="حذف المحفظة"
              onclick="deleteWallet(${index})">
              <i class="fa-solid fa-trash"></i>
            </button>

          </div>
        `
      )
      .join("");
}

window.addWallet =
  async function () {
    const input =
      document.getElementById(
        "newWalletInput"
      );

    if (!input) {
      return;
    }

    const value =
      input.value.trim();

    if (!value) {
      return;
    }

    try {
      await adminSettingsAction("add_wallet", { value });

      input.value =
        "";

      await logAuditEvent(
        "إضافة محفظة رقمية",
        "الإعدادات",
        `تمت إضافة المحفظة: ${value}`
      );
    } catch (error) {
      console.error(
        "Add wallet error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر إضافة المحفظة."
      );
    }
  };

window.deleteWallet =
  async function (
    index
  ) {
    try {
      const wallets =
        normalizeSettingsList(
          currentSettingsData.wallets
        );

      const walletName =
        wallets[index] ||
        "";

      if (
        !walletName
      ) {
        return;
      }

      if (
        !confirm(
          `هل أنت متأكد من حذف المحفظة:\n\n${walletName}`
        )
      ) {
        return;
      }

      await adminSettingsAction("delete_wallet", { index });

      await logAuditEvent(
        "حذف محفظة رقمية",
        "الإعدادات",
        `تم حذف المحفظة: ${walletName}`
      );
    } catch (error) {
      console.error(
        "Delete wallet error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر حذف المحفظة."
      );
    }
  };

// ==========================================================================
// 16-C) طرق الدفع
// ==========================================================================

function renderCustomPayments(
  methodsArray = []
) {
  const container =
    document.getElementById(
      "customPayMethodsContainer"
    );

  if (!container) return;

  const methods = [
    ...new Set(
      normalizeSettingsList(
        methodsArray
      )
    )
  ];

  if (methods.length === 0) {
    container.innerHTML = `
      <div
        style="
          padding:12px;
          border:1px dashed var(--card-border);
          border-radius:10px;
          color:var(--text-muted);
          text-align:center;
        ">
        لا توجد طرق دفع مضافة حالياً.
      </div>
    `;

    return;
  }

  container.innerHTML =
    methods
      .map(
        (
          method,
          index
        ) => `
          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--card-bg);border:1px solid var(--card-border);padding:8px 12px;border-radius:10px;">

            <span style="font-size:0.88rem;font-weight:800;">
              ${index + 1}.
              ${escapeHtml(
                method
              )}
            </span>

            <button
              class="btn-action"
              style="color:var(--danger);"
              title="حذف طريقة الدفع"
              onclick="deleteCustomPayment(${index})">
              <i class="fa-solid fa-trash"></i>
            </button>

          </div>
        `
      )
      .join("");
}

window.addCustomPaymentMethod =
  async function () {
    const input =
      document.getElementById(
        "newCustomPaymentInput"
      );

    if (!input) {
      return;
    }

    const value =
      input.value.trim();

    if (!value) {
      return;
    }

    try {
      const existing =
        normalizeSettingsList(
          currentSettingsData.paymentMethods
        );

      const exists =
        existing.some(
          (method) =>
            method.toLowerCase() ===
            value.toLowerCase()
        );

      if (exists) {
        showToast(
          "⚠️ طريقة الدفع موجودة بالفعل."
        );

        return;
      }

      await adminSettingsAction("add_payment_method", { value });

      input.value =
        "";

      await logAuditEvent(
        "إضافة طريقة دفع",
        "الإعدادات",
        `تمت إضافة طريقة الدفع: ${value}`
      );
    } catch (error) {
      console.error(
        "Add payment method error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر إضافة طريقة الدفع."
      );
    }
  };

window.deleteCustomPayment =
  async function (
    index
  ) {
    try {
      const methods =
        normalizeSettingsList(
          currentSettingsData.paymentMethods
        );

      const methodName =
        methods[index] ||
        "";

      if (
        !methodName
      ) {
        return;
      }

      if (
        !confirm(
          `هل أنت متأكد من حذف طريقة الدفع:\n\n${methodName}`
        )
      ) {
        return;
      }

      await adminSettingsAction("delete_payment_method", { index });

      await logAuditEvent(
        "حذف طريقة دفع",
        "الإعدادات",
        `تم حذف طريقة الدفع: ${methodName}`
      );
    } catch (error) {
      console.error(
        "Delete payment method error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر حذف طريقة الدفع."
      );
    }
  };

// ==========================================================================
// 16-D) الشروط والأحكام
// ==========================================================================

function renderTerms(
  termsArray = []
) {
  const container =
    document.getElementById(
      "termsListContainer"
    );

  if (!container) return;

  const terms =
    normalizeSettingsList(
      termsArray
    );

  if (terms.length === 0) {
    container.innerHTML = `
      <div
        style="
          padding:12px;
          border:1px dashed var(--card-border);
          border-radius:10px;
          color:var(--text-muted);
          text-align:center;
        ">
        لا توجد شروط وأحكام مضافة حالياً.
      </div>
    `;

    return;
  }

  container.innerHTML =
    terms
      .map(
        (
          term,
          index
        ) => `
          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--input-bg);border:1px solid var(--card-border);padding:10px;border-radius:10px;gap:10px;">

            <span style="font-size:0.85rem;line-height:1.7;flex:1;">
              ${index + 1}.
              ${escapeHtml(
                term
              )}
            </span>

            <button
              class="btn-action"
              style="color:var(--danger);flex-shrink:0;"
              title="حذف الشرط"
              onclick="deleteTerm(${index})">
              <i class="fa-solid fa-trash"></i>
            </button>

          </div>
        `
      )
      .join("");
}

window.addNewTerm =
  async function () {
    const input =
      document.getElementById(
        "newTermInput"
      );

    if (!input) {
      return;
    }

    const value =
      input.value.trim();

    if (!value) {
      return;
    }

    try {
      const existingTerms =
        normalizeSettingsList(
          currentSettingsData.terms
        );

      const exists =
        existingTerms.some(
          (term) =>
            term.toLowerCase() ===
            value.toLowerCase()
        );

      if (exists) {
        showToast(
          "⚠️ هذا الشرط موجود بالفعل."
        );

        return;
      }

      await adminSettingsAction("add_term", { value });

      input.value =
        "";

      await logAuditEvent(
        "إضافة شرط وأحكام",
        "الإعدادات",
        `تمت إضافة شرط: ${value}`
      );
    } catch (error) {
      console.error(
        "Add term error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر إضافة الشرط."
      );
    }
  };

window.deleteTerm =
  async function (
    index
  ) {
    try {
      const terms =
        normalizeSettingsList(
          currentSettingsData.terms
        );

      const termText =
        terms[index] ||
        "";

      if (
        !termText
      ) {
        return;
      }

      if (
        !confirm(
          `هل أنت متأكد من حذف هذا الشرط؟\n\n${termText}`
        )
      ) {
        return;
      }

      await adminSettingsAction("delete_term", { index });

      await logAuditEvent(
        "حذف شرط وأحكام",
        "الإعدادات",
        `تم حذف الشرط: ${termText}`
      );
    } catch (error) {
      console.error(
        "Delete term error:",
        error?.message ||
          error
      );

      showToast(
        "❌ تعذر حذف الشرط."
      );
    }
  };

/*
 * تفعيل / تعطيل ظهور الشروط والأحكام في صفحة العميل.
 *
 * هذه الدالة لا تفترض وجود عنصر معين في admin.html.
 * إذا كان لدينا checkbox بأحد الأسماء المدعومة، يمكن
 * للواجهة استدعاؤها مباشرة.
 */
window.toggleTermsEnabled =
  async function (enabled) {
    const normalized = Boolean(enabled);
    try {
      await adminSettingsAction("toggle_terms_enabled", { enabled: normalized });
      currentSettingsData = { ...currentSettingsData, termsEnabled: normalized };
      renderTermsEnabledUI(currentSettingsData);
      await logAuditEvent(
        normalized ? "تفعيل الشروط والأحكام" : "تعطيل الشروط والأحكام",
        "الإعدادات",
        normalized
          ? "تم تفعيل ظهور الشروط والأحكام للعملاء"
          : "تم تعطيل ظهور الشروط والأحكام للعملاء"
      );
    } catch (error) {
      console.error("Toggle terms enabled error:", error?.message || error);
      showToast("❌ تعذر تحديث حالة الشروط والأحكام.");
      renderTermsEnabledUI(currentSettingsData);
    }
  };


function renderStatusMessages(settings = {}) {
  const container = document.getElementById("statusMessagesContainer");
  if (!container) return;
  const messages = { ...DEFAULT_STATUS_MESSAGES, ...(settings.statusMessages || {}) };
  container.innerHTML = STATUS_VALUES.map((status) => `<div class="status-message-card"><div><span class="status-template-icon" aria-hidden="true"><i class="fa-solid fa-pen"></i></span><span class="eyebrow">${escapeHtml(status)}</span><h4>${escapeHtml(STATUS_LABELS[status])}</h4></div><textarea id="statusMessage_${status}" class="form-control status-message-input" rows="4">${escapeHtml(messages[status] || "")}</textarea><div class="status-message-tokens">{customerName} · {referenceNumber} · {status}</div></div>`).join("");
}
window.saveStatusMessages = async function() {
  const messages = {};
  STATUS_VALUES.forEach((status) => { const el = document.getElementById(`statusMessage_${status}`); if (el) messages[status] = el.value.trim(); });
  try {
    await adminSettingsAction("update_status_messages", { messages });
    currentSettingsData = { ...currentSettingsData, statusMessages: messages };
    showToast("تم حفظ رسائل الحالات.");
    await logAuditEvent("تحديث رسائل الحالات", "الإعدادات", "تم تحديث قوالب رسائل حالات الطلبات");
  } catch (error) { console.error("Save status messages:", error); showToast("❌ تعذر حفظ رسائل الحالات."); }
};

function renderIssueMessages(settings = {}) {
  const container = document.getElementById("issueMessagesContainer");
  if (!container) return;

  const messages = {
    ...DEFAULT_ISSUE_MESSAGES,
    ...(settings.issueMessages || {})
  };

  container.innerHTML = ISSUE_VALUES.map((issue) => `
    <div class="status-message-card issue-message-card">
      <div>
        <span class="eyebrow">ISSUE</span>
        <h4>${escapeHtml(ISSUE_LABELS[issue] || issue)}</h4>
      </div>
      <textarea
        id="issueMessage_${issue}"
        class="form-control status-message-input"
        rows="3"
        placeholder="اكتب الرسالة الداخلية التي تستخدمها عند ظهور هذه المشكلة..."
      >${escapeHtml(messages[issue] || "")}</textarea>
      <div class="status-message-tokens">رسالة داخلية فقط — لا يتم إرسالها تلقائيًا</div>
    </div>
  `).join("");
}

window.saveIssueMessages =
  async function () {
    const messages = {};
    ISSUE_VALUES.forEach((issue) => {
      const element = document.getElementById(`issueMessage_${issue}`);
      if (element) messages[issue] = element.value.trim();
    });

    if (Object.keys(messages).length === 0) {
      showToast("لم يتم العثور على حقول رسائل المشاكل في الصفحة.");
      return;
    }

    try {
      await adminSettingsAction("update_issue_messages", { messages });
      currentSettingsData = { ...currentSettingsData, issueMessages: messages };
      await logAuditEvent(
        "تحديث رسائل الحالات",
        "الإعدادات",
        "تم تحديث رسائل المشاكل الخاصة بالطلبات"
      );
      showToast("✅ تم حفظ رسائل الحالات بنجاح.");
    } catch (error) {
      console.error("Save issue messages error:", error?.message || error);
      showToast("❌ تعذر حفظ رسائل الحالات.");
    }
  };


// ==========================================================================
// 18) التنقل
// ==========================================================================

window.switchTab =
  function (
    tabId,
    element
  ) {
    document
      .querySelectorAll(
        ".tab-content"
      )
      .forEach(
        (tab) =>
          tab.classList.remove(
            "active"
          )
      );

    document
      .querySelectorAll(
        ".sidebar-link"
      )
      .forEach(
        (link) =>
          link.classList.remove(
            "active"
          )
      );

    const targetTab =
      document.getElementById(
        tabId
      );

    if (targetTab) {
      targetTab.classList.add(
        "active"
      );
    }

    if (element) {
      element.classList.add(
        "active"
      );
    }

    closeSidebar();

    document
      .querySelectorAll(".mobile-app-nav-item")
      .forEach((item) => {
        item.classList.toggle(
          "active",
          item.dataset.tab === tabId
        );
      });

    const pageHeading =
      document.getElementById(
        "pageTitleHeading"
      );

    const breadcrumbActive =
      document.getElementById(
        "breadcrumbActive"
      );

    if (
      element &&
      pageHeading &&
      breadcrumbActive
    ) {
      const titleText =
        element.innerText.trim();

      pageHeading.innerText =
        titleText;

      breadcrumbActive.innerText =
        titleText;
    }
  };

window.closeSidebar =
  function () {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const menuButton = document.getElementById("sidebarMenuToggle");
    const menuIcon = menuButton?.querySelector("i");

    if (sidebar) sidebar.classList.remove("mobile-open");
    if (overlay) {
      overlay.classList.remove("is-visible");
      overlay.setAttribute("aria-hidden", "true");
    }
    if (menuButton) {
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "فتح القائمة");
    }
    if (menuIcon) menuIcon.className = "fa-solid fa-bars";
  };

window.toggleSidebar =
  function () {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    const isOpen = sidebar.classList.contains("mobile-open");
    if (isOpen) {
      closeSidebar();
      return;
    }

    const overlay = document.getElementById("sidebarOverlay");
    const menuButton = document.getElementById("sidebarMenuToggle");
    const menuIcon = menuButton?.querySelector("i");

    sidebar.classList.add("mobile-open");
    if (overlay) {
      overlay.classList.add("is-visible");
      overlay.setAttribute("aria-hidden", "false");
    }
    if (menuButton) {
      menuButton.setAttribute("aria-expanded", "true");
      menuButton.setAttribute("aria-label", "إغلاق القائمة");
    }
    if (menuIcon) menuIcon.className = "fa-solid fa-xmark";
  };

window.toggleTheme =
  function () {
    const light =
      !document.body.classList.contains("light-mode");

    document.body.classList.toggle("light-mode", light);

    try {
      localStorage.setItem(
        "samiCoinsTheme",
        light ? "light" : "dark"
      );
    } catch (_) {}

    const themeIcon =
      document.querySelector("#themeToggleBtn i");

    if (!themeIcon) return;

    themeIcon.className =
      light
        ? "fa-regular fa-sun"
        : "fa-regular fa-moon";
  };

(function initThemePreference(){
  try {
    const saved = localStorage.getItem("samiCoinsTheme");
    const light = saved === "light";
    document.body.classList.toggle("light-mode", light);
    const icon = document.querySelector("#themeToggleBtn i");
    if (icon) {
      icon.className =
        light ? "fa-regular fa-sun" : "fa-regular fa-moon";
    }
  } catch (_) {}
})();

// ==========================================================================
// 19) التشغيل
// ==========================================================================

initAuthGuard();
