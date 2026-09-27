import express from "express";

const router = express.Router();

// اختبار لوحة التحكم
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Admin API Ready"
  });
});

export default router;
