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
app.use(express.json());

// Static Files
app.use("/shared", express.static(path.join(__dirname, "shared")));
app.use("/admin", express.static(path.join(__dirname, "admin")));
app.use("/orders", express.static(path.join(__dirname, "orders")));
app.use("/tracking", express.static(path.join(__dirname, "tracking")));

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    port: PORT
  });
});

// API Routes
app.use("/api/admin", adminRoutes);
app.use("/api/orders", ordersRouter);
app.use("/api/tracking", trackingRouter);

// Home
app.get("/", (req, res) => {
  res.redirect("/admin/");
});

// Start Server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin:    http://191.218.164.20:${PORT}/admin/`);
  console.log(`Orders:   http://191.218.164.20:${PORT}/orders/`);
  console.log(`Tracking: http://191.218.164.20:${PORT}/tracking/`);
});
