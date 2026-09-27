import express from "express";
import cors from "cors";

import adminRoutes from "./routes/admin.js";
import orderRoutes from "./routes/orders.js";
import trackingRoutes from "./routes/tracking.js";

const app = express();
const PORT = 3211;

// Middleware
app.use(cors());
app.use(express.json());

// فحص حالة السيرفر
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    port: PORT
  });
});

// Routes
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/tracking", trackingRoutes);

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`SAMI COINS Server running on port ${PORT}`);
});
