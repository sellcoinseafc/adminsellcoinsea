import "dotenv/config";

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import adminRoutes from "./routes/admin.js";
import ordersRouter from "./routes/orders.js";
import trackingRouter from "./routes/tracking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ============================================================================
 * SAMI COINS - SERVER ENTRY POINT
 * ============================================================================
 *
 * هذا الملف هو نقطة تشغيل بديلة للسيرفر من داخل مجلد:
 *
 * /server/server.js
 *
 * الملفات الرئيسية للمشروع موجودة في المستوى الأعلى:
 *
 * /admin
 * /orders
 * /tracking
 * /shared
 *
 * لذلك يتم استخدام:
 *
 * path.join(__dirname, "..", ...)
 *
 * للوصول إليها بشكل صحيح.
 * ============================================================================
 */

const app = express();

const PORT = Number(
  process.env.PORT || 3211
);

/**
 * ============================================================================
 * Basic Security
 * ============================================================================
 */

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "X-Frame-Options",
    "SAMEORIGIN"
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
});

/**
 * ============================================================================
 * CORS
 * ============================================================================
 *
 * يسمح فقط بالنطاقات الموجودة في:
 *
 * ALLOWED_ORIGINS
 *
 * مثال:
 *
 * ALLOWED_ORIGINS=https://example.com,https://www.example.com
 *
 * وفي حالة عدم تعريفها، يسمح بالطلبات القادمة من نفس المصدر
 * أو باستخدام إعداد CORS الافتراضي الحالي.
 * ============================================================================
 */

const allowedOrigins = String(
  process.env.ALLOWED_ORIGINS || ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      /**
       * الطلبات التي لا تحتوي Origin مثل:
       * - server-to-server
       * - health checks
       * - بعض الأدوات الداخلية
       */
      if (!origin) {
        return callback(null, true);
      }

      /**
       * إذا لم يتم تحديد قائمة Origins،
       * نحافظ على السلوك المرن السابق.
       */
      if (allowedOrigins.length === 0) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("CORS origin not allowed")
      );
    },

    credentials: true
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
 *
 * هذا الملف موجود داخل /server
 * لذلك نرجع مستوى واحد للوصول إلى جذر المشروع.
 * ============================================================================
 */

const projectRoot = path.join(
  __dirname,
  ".."
);

app.use(
  "/shared",
  express.static(
    path.join(
      projectRoot,
      "shared"
    )
  )
);

app.use(
  "/admin",
  express.static(
    path.join(
      projectRoot,
      "admin"
    )
  )
);

app.use(
  "/orders",
  express.static(
    path.join(
      projectRoot,
      "orders"
    )
  )
);

app.use(
  "/tracking",
  express.static(
    path.join(
      projectRoot,
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
    return res.redirect(
      "/admin/"
    );
  }
);

/**
 * ============================================================================
 * API 404
 * ============================================================================
 */

app.use(
  "/api",
  (req, res) => {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private"
    );

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
 */

app.use(
  (error, _req, res, next) => {
    if (
      error instanceof SyntaxError &&
      error.status === 400 &&
      error.type === "entity.parse.failed"
    ) {
      return res.status(400).json({
        success: false,
        message: "بيانات JSON غير صالحة."
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
 * لا يتم إرسال:
 * - stack trace
 * - مفاتيح Firebase
 * - بيانات الطلب الحساسة
 * - بيانات المستخدم الحساسة
 *
 * إلى العميل.
 * ============================================================================
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
 * Start Server
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
