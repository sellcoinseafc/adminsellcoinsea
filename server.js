import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import ordersRouter from "./server/routes/orders.js";
import trackingRouter from "./server/routes/tracking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3211;

app.use(cors());
app.use(express.json());

// نشر مجلد shared لجميع الصفحات
app.use("/shared", express.static(path.join(__dirname, "shared")));

// API
app.use("/api/orders", ordersRouter);
app.use("/api/tracking", trackingRouter);

// الصفحات
app.use("/orders", express.static(path.join(__dirname, "orders")));
app.use("/tracking", express.static(path.join(__dirname, "tracking")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.redirect("/admin/");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin:    http://191.218.164.20:${PORT}/admin/`);
  console.log(`Orders:   http://191.218.164.20:${PORT}/orders/`);
  console.log(`Tracking: http://191.218.164.20:${PORT}/tracking/`);
});
