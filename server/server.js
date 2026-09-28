import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import adminRoutes from "./routes/admin.js";
import orderRoutes from "./routes/orders.js";
import trackingRoutes from "./routes/tracking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3211;

// Middleware
app.use(cors());
app.use(express.json());

// صفحات المشروع
app.use("/admin", express.static(path.join(__dirname, "../admin")));
app.use("/orders", express.static(path.join(__dirname, "../orders")));
app.use("/tracking", express.static(path.join(__dirname, "../tracking")));

// API
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    port: PORT
  });
});

app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/tracking", trackingRoutes);

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.redirect("/orders");
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`SAMI COINS Server running on port ${PORT}`);
});
