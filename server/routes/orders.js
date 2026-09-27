import express from "express";
import { db } from "../services/firebase.js";

const router = express.Router();

// فحص المسار
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Orders API Ready"
  });
});

// لاحقًا: جلب الطلبات
router.get("/list", async (req, res) => {
  res.json({
    success: true,
    orders: []
  });
});

export default router;
