import express from "express";
import Picklist from "../models/Picklist.js";
import ScanLog from "../models/ScanLog.js";
import { cleanupOldPicklists } from "../services/cleanupService.js";
import { generateReport, deleteExport } from "../services/exportService.js";

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/login");
};

/* ═══════════════════════════════════════════
   HISTORY — GET /history
   Lists all picklists for the current user
═══════════════════════════════════════════ */
router.get("/", requireLogin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 15;
    const skip  = (page - 1) * limit;

    const [picklists, total] = await Promise.all([
      Picklist.find({ userId: req.user._id.toString() })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),    // virtuals: true so stats compute on .lean()
      Picklist.countDocuments({ userId: req.user._id.toString() }),
    ]);

    // For .lean() virtuals we need to compute stats manually since
    // Mongoose virtuals don't run on plain objects
    const enriched = picklists.map((pl) => {
      const totalExpected = pl.items.reduce((s, i) => s + i.expectedQty, 0);
      const totalScanned  = pl.items.reduce((s, i) => s + i.scannedQty,  0);
      const doneItems     = pl.items.filter((i) => i.scannedQty >= i.expectedQty).length;
      const overItems     = pl.items.filter((i) => i.scannedQty >  i.expectedQty).length;
      const extraEntries  = pl.extraScans ? Object.keys(pl.extraScans).length : 0;
      const alertCount    = overItems + extraEntries;
      const progressPct   = totalExpected
        ? Math.min(100, Math.round((totalScanned / totalExpected) * 100))
        : 0;

      return {
        ...pl,
        stats: {
          totalExpected,
          totalScanned,
          totalRemaining: Math.max(0, totalExpected - totalScanned),
          doneItems,
          overItems,
          alertCount,
          progressPct,
          itemCount: pl.items.length,
        },
      };
    });

    const activeId = req.session.picklistId || null;

    res.render("pages/history", {
      title:      "Scan History",
      picklists:  enriched,
      activeId,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      success:    req.query.success || null,
      error:      req.query.error   || null,
    });
  } catch (err) {
    console.error("History error:", err);
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══════════════════════════════════════════
   RESUME — POST /history/resume/:id
   Loads a past picklist back into session
═══════════════════════════════════════════ */
router.post("/resume/:id", requireLogin, async (req, res) => {
  try {
    const picklist = await Picklist.findOne({
      _id:    req.params.id,
      userId: req.user._id.toString(),
    });

    if (!picklist) {
      return res.redirect("/history?error=Picklist+not+found");
    }

    // Mark all others inactive, activate this one
    await Picklist.updateMany(
      { userId: req.user._id.toString(), _id: { $ne: picklist._id } },
      { $set: { isActive: false } }
    );
    picklist.isActive = true;
    await picklist.save();

    req.session.picklistId = picklist._id.toString();
    res.redirect("/scan");
  } catch (err) {
    console.error("Resume error:", err);
    res.redirect(`/history?error=${encodeURIComponent(err.message)}`);
  }
});

/* ═══════════════════════════════════════════
   DELETE ONE — POST /history/delete/:id
═══════════════════════════════════════════ */
router.post("/delete/:id", requireLogin, async (req, res) => {
  try {
    await Picklist.findOneAndDelete({
      _id:    req.params.id,
      userId: req.user._id.toString(),
    });

    // Clean up scan logs for this picklist
    await ScanLog.deleteMany({ picklistId: req.params.id });

    // If they deleted the active one, clear session
    if (req.session.picklistId === req.params.id) {
      req.session.picklistId = null;
    }

    res.redirect("/history?success=Picklist+deleted");
  } catch (err) {
    console.error("Delete error:", err);
    res.redirect(`/history?error=${encodeURIComponent(err.message)}`);
  }
});

/* ═══════════════════════════════════════════
   DELETE ALL — POST /history/delete-all
   Deletes all inactive picklists for this user
═══════════════════════════════════════════ */
router.post("/delete-all", requireLogin, async (req, res) => {
  try {
    const toDelete = await Picklist.find(
      { userId: req.user._id.toString(), isActive: false },
      { _id: 1 }
    ).lean();

    const ids = toDelete.map((p) => p._id);
    await ScanLog.deleteMany({ picklistId: { $in: ids } });

    const result = await Picklist.deleteMany({
      userId:   req.user._id.toString(),
      isActive: false,
    });

    res.redirect(
      `/history?success=${encodeURIComponent(`Deleted ${result.deletedCount} picklist(s)`)}`
    );
  } catch (err) {
    console.error("Delete-all error:", err);
    res.redirect(`/history?error=${encodeURIComponent(err.message)}`);
  }
});

/* ═══════════════════════════════════════════
   MANUAL CLEANUP — POST /history/cleanup
   Admin-triggered cleanup of old picklists
═══════════════════════════════════════════ */
router.post("/cleanup", requireLogin, async (req, res) => {
  try {
    const days    = parseInt(req.body.days) || 30;
    const deleted = await cleanupOldPicklists(days);

    res.redirect(
      `/history?success=${encodeURIComponent(`Cleaned up ${deleted} picklist(s) older than ${days} days`)}`
    );
  } catch (err) {
    console.error("Cleanup error:", err);
    res.redirect(`/history?error=${encodeURIComponent(err.message)}`);
  }
});

/* ═══════════════════════════════════════════
   EXPORT ANY PICKLIST — GET /history/export/:id
═══════════════════════════════════════════ */
router.get("/export/:id", requireLogin, async (req, res) => {
  let exportPath = null;
  try {
    const picklist = await Picklist.findOne({
      _id:    req.params.id,
      userId: req.user._id.toString(),
    });

    if (!picklist) {
      return res.redirect("/history?error=Picklist+not+found");
    }

    exportPath = await generateReport(picklist);
    const fileName = `picklist-${picklist.fileName || "export"}-${Date.now()}.xlsx`;

    res.download(exportPath, fileName, (err) => {
      if (err) console.error("Download error:", err);
      deleteExport(exportPath);
    });
  } catch (err) {
    console.error("Export error:", err);
    if (exportPath) deleteExport(exportPath);
    res.redirect(`/history?error=${encodeURIComponent(err.message)}`);
  }
});

export default router;
