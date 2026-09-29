import express from "express";
import { db } from "../services/firebase.js";

const router = express.Router();

router.get("/:ref", async (req, res) => {
  try {
    const ref = req.params.ref.trim().toUpperCase();

    const snapshot = await db
      .collection("orders")
      .where("referenceNumber", "==", ref)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    const order = snapshot.docs[0].data();

    return res.json({
      success: true,
      order,
      statusMessage: order.statusMessage || "",
      reviewSuggestions: order.reviewSuggestions || []
    });

  } catch (err) {
    console.error("Tracking API:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
});

export default router;
