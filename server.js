import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createRateLimiter } from "./server/middleware/rateLimit.js";
import path from "path";
import { fileURLToPath } from "url";

import adminRoutes from "./server/routes/admin.js";
import ordersRouter from "./server/routes/orders.js";
import trackingRouter from "./server/routes/tracking.js";
import { db } from "./server/services/firebase.js";

/**
 * ============================================================================
 * SAMI COINS - MAIN SERVER
 * ============================================================================
 *
 * مسؤول عن:
 * - تشغيل Express.
 * - تحميل environment variables.
 * - خدمة ملفات الواجهة.
 * - تسجيل API routes.
 * - Health check.
 * - API 404 handling.
 * - Central error handling.
 *
 * ملاحظات:
 * - لا توجد أسرار أو مفاتيح Firebase هنا.
 * - لا يتم تسجيل request body.
 * - لا يتم تسجيل Authorization headers.
 * - لا يتم تسجيل بيانات الطلبات الحساسة.
 * ============================================================================
 */

/**
 * ============================================================================
 * Paths
 * ============================================================================
 */

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

/**
 * ============================================================================
 * App
 * ============================================================================
 */

const app = express();
const trustProxy = String(process.env.TRUST_PROXY || "").trim();
if (trustProxy) app.set("trust proxy", trustProxy === "true" ? true : trustProxy);

/**
 * لا نكشف نوع/إصدار Express في response headers.
 */
app.disable("x-powered-by");

const PORT =
  Number(process.env.PORT) ||
  3211;

/**
 * ============================================================================
 * Basic middleware
 * ============================================================================
 */

/**
 * CORS
 *
 * يبقى مفتوحًا للتوافق مع البنية الحالية.
 *
 * بما أن الواجهات تخدم من نفس السيرفر،
 * يمكن لاحقًا تقييده إلى domains محددة
 * إذا احتجنا ذلك.
 */
const allowedOrigins = String(
  process.env.ALLOWED_ORIGINS ||
    "https://samicoins.com,https://www.samicoins.com"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      /*
       * Same-origin requests and non-browser requests may not send Origin.
       */
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(
        null,
        allowedOrigins.includes(origin)
      );
    },
    credentials: false
  })
);

/**
 * JSON body.
 *
 * 256KB كافية للـAPI الحالي
 * وتمنع payloads غير الضرورية.
 */
app.use(
  express.json({
    limit: "256kb"
  })
);

/**
 * URL encoded body.
 */
app.use(
  express.urlencoded({
    extended: true,
    limit: "256kb",
    parameterLimit: 100
  })
);

/**
 * ============================================================================
 * API security headers
 * ============================================================================
 *
 * لا نحتاج package إضافية هنا.
 *
 * مهم:
 * - no-store للـAPI يمنع caching للبيانات الحساسة.
 * - nosniff يمنع MIME sniffing.
 */

const apiRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 180,
  message: "عدد طلبات API مرتفع جدًا. حاول مرة أخرى بعد قليل."
});

/**
 * Admin write limiter.
 *
 * This is intentionally mounted at the server boundary so every
 * administrative mutation is rate-limited, including routes that may
 * be added later and do not yet have a route-local limiter.
 *
 * Existing stricter route-local limiters (for example decrypt/update)
 * remain in place and therefore still take precedence for those flows.
 */
const adminWriteRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) =>
    `admin-write:${String(req.admin?.uid || req.ip || "unknown")}`,
  message: "عدد عمليات الإدارة مرتفع جدًا. حاول مرة أخرى بعد قليل."
});

app.use("/api", apiRateLimit);

app.use(
  "/api",
  (req, res, next) => {
    /*
     * APIs لا يجب أن تدخل في browser/proxy cache.
     * هذا مهم خصوصًا لبيانات الطلبات الحساسة.
     */
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );

    res.setHeader(
      "Expires",
      "0"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    /*
     * منع تحميل API responses داخل frame.
     */
    res.setHeader(
      "X-Frame-Options",
      "DENY"
    );

    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'none';"
    );

    res.setHeader(
      "X-DNS-Prefetch-Control",
      "off"
    );

    /*
     * تقليل تسريب Referer من صفحات API.
     */
    res.setHeader(
      "Referrer-Policy",
      "no-referrer"
    );

    /*
     * SSE يحتاج اتصالًا طويلًا.
     * لا نضع Connection: close هنا.
     */
    next();
  }
);

/**
 * ============================================================================
 * Frontend security headers
 * ============================================================================
 *
 * هذه headers لا تغيّر سلوك التطبيق أو تصميمه.
 * الهدف منها تقليل مخاطر المتصفح الأساسية.
 */

const enableHsts =
  String(process.env.ENABLE_HSTS || "").toLowerCase() === "true";

app.use(
  (req, res, next) => {
    if (enableHsts) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    res.setHeader(
      "Referrer-Policy",
      "strict-origin-when-cross-origin"
    );

    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );

    next();
  }
);

/**
 * ============================================================================
 * Static frontend files
 * ============================================================================
 *
 * المسارات الحالية لا تتغير.
 */

app.use(
  "/shared",
  express.static(
    path.join(
      __dirname,
      "shared"
    )
  )
);

app.use(
  "/admin",
  express.static(
    path.join(
      __dirname,
      "admin"
    )
  )
);

app.use(
  "/orders",
  express.static(
    path.join(
      __dirname,
      "orders"
    )
  )
);

app.use(
  "/tracking",
  express.static(
    path.join(
      __dirname,
      "tracking"
    )
  )
);

/**
 * ============================================================================
 * Health check
 * ============================================================================
 *
 * يستخدم لمعرفة أن Node/PM2 والسيرفر يعملان.
 *
 * لا يعرض:
 * - Firebase credentials
 * - environment variables
 * - server internals
 */

app.get(
  "/api/health",
  async (req, res) => {
    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    try {
      await db
        .collection("system")
        .doc("settings")
        .get();

      return res.json({
        success: true,
        status: "online",
        database: "online",
        service:
          "adminsellcoinsea"
      });
    } catch (error) {
      console.error(
        "Health database check failed:",
        error?.code || "unknown_error"
      );

      return res.status(503).json({
        success: false,
        status: "online",
        database: "offline",
        service:
          "adminsellcoinsea"
      });
    }
  }
);

/**
 * ============================================================================
 * API routes
 * ============================================================================
 */

/**
 * Admin
 *
 * /api/admin/*
 */
app.use(
  "/api/admin",
  (req, res, next) => {
    /*
     * Only state-changing HTTP methods are rate-limited here.
     * GET endpoints remain governed by the global API limiter and any
     * route-specific controls.
     *
     * The limiter is intentionally before the router so new admin
     * mutation endpoints cannot accidentally omit protection.
     */
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return adminWriteRateLimit(req, res, next);
    }

    return next();
  },
  adminRoutes
);

/**
 * Orders
 *
 * /api/orders/*
 */
app.use(
  "/api/orders",
  ordersRouter
);

/**
 * Tracking
 *
 * /api/tracking/*
 */
app.use(
  "/api/tracking",
  trackingRouter
);

/**
 * ============================================================================
 * Home
 * ============================================================================
 */

app.get(
  "/",
  (_, res) => {
    return res.redirect(
      "/admin/"
    );
  }
);

/**
 * ============================================================================
 * API 404
 * ============================================================================
 *
 * أي API غير معروف يرجع JSON موحد.
 */

app.use(
  "/api",
  (req, res) => {
    return res.status(404).json({
      success: false,
      message:
        "API Not Found"
    });
  }
);

/**
 * ============================================================================
 * Global error handler
 * ============================================================================
 *
 * مهم:
 * لا نرسل stack trace أو تفاصيل داخلية للعميل.
 *
 * في production:
 * - العميل يحصل على رسالة عامة.
 * - السيرفر يسجل فقط error code/message.
 *
 * لا نسجل:
 * - request body
 * - Authorization
 * - cookies
 * - payment data
 * - EA credentials
 */

app.use(
  (error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const errorCode =
      String(
        error?.code || ""
      ).trim();

    const errorMessage =
      String(
        error?.message || ""
      ).trim();

    /**
     * JSON body parser errors.
     */
    if (
      error?.type ===
      "entity.too.large"
    ) {
      return res.status(413).json({
        success: false,
        message:
          "حجم البيانات المرسلة كبير جداً."
      });
    }

    if (
      error?.type ===
      "entity.parse.failed"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "صيغة البيانات المرسلة غير صحيحة."
      });
    }

    /**
     * تسجيل آمن فقط.
     */
    console.error(
      "Express server error:",
      errorCode ||
        errorMessage ||
        "unknown_error"
    );

    return res.status(500).json({
      success: false,
      message:
        "حدث خطأ في الخادم، يرجى المحاولة لاحقاً."
    });
  }
);

/**
 * ============================================================================
 * Start server
 * ============================================================================
 */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "=================================="
    );

    console.log(
      "AdminSellCoinsEA Server Started"
    );

    console.log(
      `PORT : ${PORT}`
    );

    console.log(
      "ADMIN : /admin/"
    );

    console.log(
      "ORDERS : /orders/"
    );

    console.log(
      "TRACKING : /tracking/"
    );

    console.log(
      "=================================="
    );
  }
);
