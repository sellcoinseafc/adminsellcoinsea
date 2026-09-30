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
 * Middleware
 * ============================================================================
 */

app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

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
    res.json({
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
    res.status(404).json({
      success: false,
      message: "API Not Found"
    });
  }
);

/**
 * ============================================================================
 * Global Error Handler
 * ============================================================================
 *
 * لا نرسل stack trace للعميل.
 * ولا نسجل أي بيانات حساسة من الطلب.
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
