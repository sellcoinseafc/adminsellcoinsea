import dotenv from "dotenv";
dotenv.config();

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
const PORT = process.env.PORT || 3211;

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Static
app.use("/shared", express.static(path.join(__dirname, "shared")));
app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use("/orders", express.static(path.join(__dirname, "orders")));
app.use("/tracking", express.static(path.join(__dirname, "tracking")));

// Health
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "adminsellcoinsea",
    port: PORT
  });
});

// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/orders", ordersRouter);
app.use("/api/tracking", trackingRouter);

// Home
app.get("/", (_, res) => res.redirect("/admin/"));

// 404 API
app.use("/api/*", (_, res) => {
  res.status(404).json({
    success: false,
    message: "API Not Found"
  });
});

// Start
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================");
  console.log("AdminSellCoinsEA Server Started");
  console.log(`PORT : ${PORT}`);
  console.log(`ADMIN : /admin/`);
  console.log(`ORDERS : /orders/`);
  console.log(`TRACKING : /tracking/`);
  console.log("==================================");
});
