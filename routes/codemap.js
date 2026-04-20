import express from "express";
import CodeMap from "../models/CodeMap.js";

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/login");
};

const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isAdmin) return next();
  res.status(403).render("pages/error", {
    title: "Access Denied",
    message: "Code Maps are managed by admins only.",
  });
};

/* ═══════════════════════════════════════════
   LIST — GET /codemap
═══════════════════════════════════════════ */
router.get("/", requireAdmin, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const skip  = (page - 1) * limit;

    const filter = q
      ? {
          $or: [
            { scannedCode: { $regex: q, $options: "i" } },
            { realCode:    { $regex: q, $options: "i" } },
          ],
        }
      : {};

    const [mappings, total] = await Promise.all([
      CodeMap.find(filter).sort({ scannedCode: 1 }).skip(skip).limit(limit).lean(),
      CodeMap.countDocuments(filter),
    ]);

    res.render("pages/codemap", {
      title:    "Code Mappings",
      mappings,
      q,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      success:  req.query.success || null,
      error:    req.query.error   || null,
    });
  } catch (err) {
    console.error("Codemap list error:", err);
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══════════════════════════════════════════
   ADD — POST /codemap/add
═══════════════════════════════════════════ */
router.post("/add", requireAdmin, async (req, res) => {
  try {
    const scannedCode = (req.body.scannedCode || "").trim().toUpperCase();
    const realCode    = (req.body.realCode    || "").trim().toUpperCase();
    const note        = (req.body.note        || "").trim();

    if (!scannedCode || !realCode) {
      return res.redirect("/codemap?error=Both+scanned+code+and+real+code+are+required");
    }

    await CodeMap.updateOne(
      { scannedCode },
      { $set: { scannedCode, realCode, addedBy: req.user.username || "user", note } },
      { upsert: true }
    );

    res.redirect(`/codemap?success=${encodeURIComponent(`Mapping saved: ${scannedCode} → ${realCode}`)}`);
  } catch (err) {
    console.error("Codemap add error:", err);
    res.redirect(`/codemap?error=${encodeURIComponent(err.message)}`);
  }
});

/* ═══════════════════════════════════════════
   DELETE — POST /codemap/delete/:id
═══════════════════════════════════════════ */
router.post("/delete/:id", requireAdmin, async (req, res) => {
  try {
    await CodeMap.findByIdAndDelete(req.params.id);
    res.redirect("/codemap?success=Mapping+deleted");
  } catch (err) {
    console.error("Codemap delete error:", err);
    res.redirect(`/codemap?error=${encodeURIComponent(err.message)}`);
  }
});

/* ═══════════════════════════════════════════
   API — GET /codemap/resolve?code=KIT020666
   Used by frontend if needed
═══════════════════════════════════════════ */
router.get("/resolve", requireAdmin, async (req, res) => {
  const code = (req.query.code || "").trim();
  if (!code) return res.json({ code });
  const resolved = await CodeMap.resolve(code);
  res.json({ original: code, resolved });
});

export default router;
