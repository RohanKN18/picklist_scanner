import express from "express";
import User from "../models/User.js";

const router = express.Router();

/* ─── ADMIN GUARD ─── */
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  res.status(403).render("pages/error", {
    title: "Access Denied",
    message: "This page is for admins only.",
  });
};

/* ═══ ADMIN DASHBOARD — list all users ═══ */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    res.render("pages/admin/index", { title: "Admin — Users", users });
  } catch (err) {
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══ USER COLMAP — GET ═══ */
router.get("/users/:id/colmap", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).render("pages/error", { title: "Not Found", message: "User not found." });

    res.render("pages/admin/colmap", {
      title:   `Column Map — ${user.displayName || user.username}`,
      target:  user,
      saved:   null,
      error:   null,
    });
  } catch (err) {
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══ USER COLMAP — POST (save config) ═══ */
router.post("/users/:id/colmap", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).render("pages/error", { title: "Not Found", message: "User not found." });

    const { barcode, quantity, major, minor } = req.body;

    // Validate required scan cols
    if (!barcode || !quantity) {
      return res.render("pages/admin/colmap", {
        title:  `Column Map — ${user.displayName || user.username}`,
        target: user.toObject(),
        saved:  null,
        error:  "Barcode and Quantity columns are required.",
      });
    }

    // Normalise major (always exactly 2 or fewer)
    const majorArr = Array.isArray(major)
      ? major.filter(Boolean).slice(0, 2)
      : major ? [major] : [];

    // Normalise minor (array of any length)
    const minorArr = Array.isArray(minor)
      ? minor.filter(Boolean)
      : minor ? [minor] : [];

    await user.updateOne({
      $set: {
        "columnMap.barcode":  barcode,
        "columnMap.quantity": quantity,
        "columnMap.major":    majorArr,
        "columnMap.minor":    minorArr,
      },
    });

    const updated = await User.findById(req.params.id).lean();

    res.render("pages/admin/colmap", {
      title:  `Column Map — ${updated.displayName || updated.username}`,
      target: updated,
      saved:  true,
      error:  null,
    });
  } catch (err) {
    console.error("Admin colmap save error:", err);
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══ TOGGLE ADMIN FLAG ═══ */
router.post("/users/:id/toggle-admin", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    // Prevent self-demotion
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot change your own admin status" });
    }
    user.isAdmin = !user.isAdmin;
    await user.save();
    res.json({ success: true, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
