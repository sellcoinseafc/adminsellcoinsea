import "dotenv/config";

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import adminRoutes from "./server/routes/admin.js";
import ordersRouter from "./server/routes/orders.js";
import trackingRouter from "./server/routes/tracking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(
  process.env.PORT || 3211
);

/**
 * ============================================================================
 * SAMI COINS - MAIN SERVER
 * ============================================================================
 *
 * التطبيق الرئيسي:
 * - Admin API
 * - Orders API
 * - Tracking API
 * - Static frontend files
 *
 * PM2 يشغل هذا الملف من:
 * /var/www/adminsellcoinsea/server.js
 * ============================================================================
 */

/**
 * ============================================================================
 * Basic Server Security
 * ============================================================================
 */

app.disable("x-powered-by");

/**
 * ============================================================================
 * Security / Cache Headers
 * ============================================================================
 *
 * بيانات الطلبات وخصوصًا أي استجابة مرتبطة ببيانات حساسة
 * لا يجب أن تدخل في browser/proxy cache.
 *
 * ملاحظة:
 * لا نضع Connection: close هنا حتى يبقى SSE ممكنًا.
 */

app.use(
  (req, res, next) => {
    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    res.setHeader(
      "X-Frame-Options",
      "DENY"
    );

    res.setHeader(
      "Referrer-Policy",
      "strict-origin-when-cross-origin"
    );

    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );

    if (
      req.path.startsWith("/api")
    ) {
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
    }

    next();
  }
);

/**
 * ============================================================================
 * CORS
 * ============================================================================
 *
 * يسمح بالـsame-origin بشكل طبيعي.
 *
 * ويمكن تحديد Origins إضافية من:
 *
 * ALLOWED_ORIGINS=https://example.com,https://www.example.com
 *
 * إذا لم يتم تحديد ALLOWED_ORIGINS:
 * - same-origin يعمل.
 * - requests بدون Origin تعمل.
 * - في بيئة التطوير يسمح بالـOrigin المرسل.
 *
 * لا نسمح باستخدام wildcard "*" مع credentials.
 */

const configuredOrigins = String(
  process.env.ALLOWED_ORIGINS || ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,

    origin(origin, callback) {
      /*
       * Requests من نفس السيرفر أو الأدوات التي لا ترسل
       * Origin header.
       */
      if (!origin) {
        return callback(null, true);
      }

      /*
       * Origins محددة صراحة.
       */
      if (
        configuredOrigins.length > 0
      ) {
        return callback(
          null,
          configuredOrigins.includes(origin)
        );
      }

      /*
       * توافق مع بيئة التطوير الحالية.
       *
       * إذا تم الانتقال للإنتاج مع Frontend منفصل،
       * يفضل تحديد ALLOWED_ORIGINS صراحة في .env.
       */
      return callback(null, true);
    }
  })
);

/**
 * ============================================================================
 * Request Body
 * ============================================================================
 */

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb"
  })
);

/**
 * ============================================================================
 * Static Files
 * ============================================================================
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
 * Health Check
 * ============================================================================
 */

app.get(
  "/api/health",
  (_req, res) => {
    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.json({
      success: true,
      status: "online",
      service: "adminsellcoinsea",
      port: PORT
    });
  }
);

/**
 * ============================================================================
 * API Routes
 * ============================================================================
 */

app.use(
  "/api/admin",
  adminRoutes
);

app.use(
  "/api/orders",
  ordersRouter
);

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
  (_req, res) => {
    res.redirect("/admin/");
  }
);

/**
 * ============================================================================
 * API 404
 * ============================================================================
 *
 * أي API غير معروف يرجع JSON بدلاً من HTML.
 */

app.use(
  "/api",
  (req, res) => {
    return res.status(404).json({
      success: false,
      message: "API Not Found"
    });
  }
);

/**
 * ============================================================================
 * Invalid JSON Handler
 * ============================================================================
 *
 * إذا أرسل العميل JSON غير صالح، يرجع 400 بدل 500.
 */

app.use(
  (error, _req, res, next) => {
    if (
      error instanceof SyntaxError &&
      error.status === 400 &&
      "body" in error
    ) {
      return res.status(400).json({
        success: false,
        message: "صيغة البيانات المرسلة غير صحيحة."
      });
    }

    return next(error);
  }
);

/**
 * ============================================================================
 * Global Error Handler
 * ============================================================================
 *
 * لا نرسل stack trace للعميل.
 * ولا نسجل body أو headers أو Authorization.
 */

app.use(
  (error, _req, res, _next) => {
    console.error(
      "Unhandled server error:",
      error?.code ||
        error?.message ||
        "unknown_error"
    );

    if (res.headersSent) {
      return;
    }

    return res.status(500).json({
      success: false,
      message:
        "حدث خطأ في الخادم، يرجى المحاولة لاحقاً."
    });
  }
);

/**
 * ============================================================================
 * Start
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
      "SAMI COINS Server Started"
    );

    console.log(
      `PORT    : ${PORT}`
    );

    console.log(
      "ADMIN   : /admin/"
    );

    console.log(
      "ORDERS  : /orders/"
    );

    console.log(
      "TRACKING: /tracking/"
    );

    console.log(
      "=================================="
    );
  }
);
