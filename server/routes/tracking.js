import express from "express";

const router = express.Router();

// اختبار صفحة التتبع
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Tracking API Ready"
  });
});

export default router;
