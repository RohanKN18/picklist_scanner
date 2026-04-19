import express from "express";
import { upload, deleteFile } from "../middlewares/upload.js";
import { parseExcel } from "../services/pythonService.js";
import { generateReport, deleteExport } from "../services/exportService.js";
import Picklist from "../models/picklist.js";
import CodeMap from "../models/CodeMap.js";
import ScanLog from "../models/ScanLog.js";

const router = express.Router();

/* ─── AUTH GUARD (self-contained so no circular import) ─── */
const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/login");
};

/* ═══════════════════════════════════════════
   HOME
═══════════════════════════════════════════ */
router.get("/", (req, res) => {
  res.render("pages/home", { title: "Picklist Scanner" });
});

/* ═══════════════════════════════════════════
   UPLOAD → COLUMN MAP
═══════════════════════════════════════════ */
router.get("/upload", requireLogin, (req, res) => {
  res.render("pages/upload", { title: "Upload Picklist" });
});

router.post("/upload", requireLogin, upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).render("pages/upload", {
        title: "Upload Picklist",
        error: "Please select an Excel file to upload.",
      });
    }

    const data = await parseExcel(req.file);

    req.session.rawData  = data.rows;
    req.session.columns  = data.columns;
    req.session.fileName = req.file.originalname;

    deleteFile(filePath);

    // ── Smart redirect: if user already has a saved column map, skip colmap ──
    const user = req.user;
    const savedMap = user.columnMap;

    if (savedMap?.barcode && savedMap?.quantity) {
      // Verify the saved columns actually exist in this file
      const colsInFile = data.columns;
      const barcodeOk  = colsInFile.includes(savedMap.barcode);
      const quantityOk = colsInFile.includes(savedMap.quantity);

      if (barcodeOk && quantityOk) {
        // Auto-build picklist using saved mapping → go straight to scan
        return buildAndRedirectToScan(req, res, savedMap.barcode, savedMap.quantity);
      }
    }

    // No saved map (or columns don't match this file) → show colmap
    res.render("pages/colmap", {
      title:       "Map Columns",
      columns:     data.columns,
      previewRows: data.rows.slice(0, 3),
      savedMap:    savedMap || {},
    });
  } catch (err) {
    console.error("Upload error:", err);
    deleteFile(filePath);
    res.status(500).render("pages/upload", {
      title: "Upload Picklist",
      error: err.message || "Failed to process file. Is it a valid Excel file?",
    });
  }
});

/* ── GET /colmap — "Change Column Names" button links here directly ── */
router.get("/colmap", requireLogin, async (req, res) => {
  let columns = req.session.columns || [];
  let rawData = req.session.rawData || [];
  let fileName = req.session.fileName || "Unknown";

  if (columns.length === 0) {
    // Check if we have a picklist to remap
    const picklistId = req.session.picklistId;
    if (picklistId) {
      const picklist = await Picklist.findOne({
        _id: picklistId,
        userId: req.user._id.toString(),
      });
      if (picklist && picklist.rawData && picklist.rawData.length > 0) {
        rawData = picklist.rawData;
        columns = picklist.allColumns || [];
        fileName = picklist.fileName;
        // Restore session data for remapping
        req.session.rawData = rawData;
        req.session.columns = columns;
        req.session.fileName = fileName;
      } else {
        return res.redirect("/upload");
      }
    } else {
      return res.redirect("/upload");
    }
  }

  res.render("pages/colmap", {
    title:       "Map Columns",
    columns,
    previewRows: rawData.slice(0, 3),
    savedMap:    req.user.columnMap || {},
  });
});

/* ═══════════════════════════════════════════
   SHARED HELPER — build picklist from session + redirect
═══════════════════════════════════════════ */
async function buildAndRedirectToScan(req, res, barcode, quantity) {
  const raw = req.session.rawData;

  if (!raw || raw.length === 0) return res.redirect("/upload");

  const items = raw
    .map((row) => ({
      code:        String(row[barcode] || "").trim(),
      expectedQty: Number(row[quantity]) || 0,
      scannedQty:  0,
    }))
    .filter((item) => item.code && item.expectedQty > 0);

  if (items.length === 0) {
    return res.status(400).render("pages/colmap", {
      title:       "Map Columns",
      columns:     req.session.columns || [],
      previewRows: [],
      savedMap:    req.user.columnMap || {},
      error:       "No valid items found with the selected columns. Please re-map.",
    });
  }

  // Deactivate previous picklists for this user
  await Picklist.updateMany(
    { userId: req.user._id.toString() },
    { $set: { isActive: false } }
  );

  const picklist = await Picklist.create({
    sessionId:    req.session.id,
    userId:       req.user._id.toString(),
    fileName:     req.session.fileName || "Unknown",
    items,
    extraScans:   {},
    previewRow:   previewRowObj,
    allColumns:   req.session.columns || [],
    minorColumns,
    minorCount,
    rawData:      req.session.rawData || [],
  });

  req.session.picklistId = picklist._id.toString();
  req.session.rawData    = null;
  req.session.columns    = null;

  res.redirect("/scan");
}

/* ═══════════════════════════════════════════
   COLUMN MAPPING → START SCAN
═══════════════════════════════════════════ */
router.post("/scan/start", requireLogin, async (req, res) => {
  try {
    const { barcode, quantity } = req.body;

    if (!req.session.rawData || req.session.rawData.length === 0) {
      return res.redirect("/upload");
    }

    if (!barcode || !quantity) {
      return res.status(400).render("pages/colmap", {
        title:       "Map Columns",
        columns:     req.session.columns || [],
        previewRows: [],
        savedMap:    req.user.columnMap || {},
        error:       "Please select both barcode and quantity columns.",
      });
    }

    // ── Persist column map to user document ──
    await req.user.updateOne({ $set: { "columnMap.barcode": barcode, "columnMap.quantity": quantity } });

    await buildAndRedirectToScan(req, res, barcode, quantity);
  } catch (err) {
    console.error("Start scan error:", err);
    res.status(500).render("pages/colmap", {
      title:       "Map Columns",
      columns:     req.session.columns || [],
      previewRows: [],
      savedMap:    req.user.columnMap || {},
      error:       "Failed to create picklist: " + err.message,
    });
  }
});

/* ═══════════════════════════════════════════
   SCAN DASHBOARD
═══════════════════════════════════════════ */
router.get("/scan", requireLogin, async (req, res) => {
  try {
    const picklistId = req.session.picklistId;
    if (!picklistId) return res.redirect("/upload");

    const picklist = await Picklist.findOne({
      _id:    picklistId,
      userId: req.user._id.toString(),
    });

    if (!picklist) return res.redirect("/upload");

    const extraObj = picklist.extraScans || {};

    // Serialize previewRow (Object)
    const previewRow = picklist.previewRow || {};

    res.render("pages/scan", {
      title:        "Scan Dashboard",
      picklist:     picklist.items,
      extra:        extraObj,
      stats:        picklist.stats,
      picklistId:   picklist._id,
      fileName:     picklist.fileName,
      previewRow,
      allColumns:   picklist.allColumns   || [],
      minorColumns: picklist.minorColumns || [],
      minorCount:   picklist.minorCount   || 3,
      // major columns are always barcode + quantity (from user's saved map)
      majorBarcode:  req.user?.columnMap?.barcode  || "",
      majorQuantity: req.user?.columnMap?.quantity || "",
    });
  } catch (err) {
    console.error("Scan page error:", err);
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══════════════════════════════════════════
   REAL-TIME SCAN API
═══════════════════════════════════════════ */
router.post("/scan/api", requireLogin, async (req, res) => {
  try {
    const { code: rawCode, unscan = false } = req.body;
    const picklistId = req.session.picklistId;

    if (!rawCode || !picklistId) {
      return res.status(400).json({ error: "Missing code or session" });
    }

    // ── Parse pipe-delimited scanner format ──
    // Format: "72800205253421988|BSNXT26BK00005|1|U"
    //          field[0]=serial  field[1]=code  field[2]=qty  field[3]=flag
    let parsedCode = rawCode.trim();
    let parsedQty  = 1;

    if (parsedCode.includes("|")) {
      const parts = parsedCode.split("|");
      // field[1] is the code, field[2] is qty
      parsedCode = (parts[1] || "").trim();
      parsedQty  = Math.max(1, parseInt(parts[2]) || 1);
    }

    if (!parsedCode) {
      return res.status(400).json({ error: "Could not extract code from barcode" });
    }

    // ── Resolve via CodeMap (case-insensitive) ──
    const resolvedCode = await CodeMap.resolve(parsedCode);
    const isRemapped   = resolvedCode.toUpperCase() !== parsedCode.toUpperCase();

    const picklist = await Picklist.findOne({
      _id:    picklistId,
      userId: req.user._id.toString(),
    });

    if (!picklist) {
      return res.status(404).json({ error: "Picklist not found" });
    }

    let alert    = null;
    let scanType = "unknown";

    const item = picklist.items.find(
      (i) => String(i.code).trim().toUpperCase() === resolvedCode.toUpperCase()
    );

    if (unscan) {
      /* ── UNSCAN MODE ── */
      if (item && item.scannedQty > 0) {
        item.scannedQty = Math.max(0, item.scannedQty - parsedQty);
        scanType = "unscanned";
      } else if (picklist.extraScans[resolvedCode]) {
        const current = picklist.extraScans[resolvedCode];
        const next    = current - parsedQty;
        if (next <= 0) {
          delete picklist.extraScans[resolvedCode];
        } else {
          picklist.extraScans[resolvedCode] = next;
        }
        picklist.markModified("extraScans");
        scanType = "unscanned-extra";
      } else {
        scanType = "nothing-to-unscan";
        alert    = `ℹ️ Nothing to unscan for: ${resolvedCode}`;
      }
    } else {
      /* ── NORMAL SCAN MODE ── */
      if (item) {
        item.scannedQty = (item.scannedQty || 0) + parsedQty;
        scanType = "match";

        if (item.scannedQty > item.expectedQty) {
          alert    = `⚠️ Over-scanned: ${resolvedCode} (${item.scannedQty}/${item.expectedQty})${isRemapped ? ` [was ${parsedCode}]` : ""}`;
          scanType = "over";
        } else if (item.scannedQty === item.expectedQty) {
          scanType = "complete";
        }
      } else {
        const current = picklist.extraScans[resolvedCode] || 0;
        picklist.extraScans[resolvedCode] = current + parsedQty;
        picklist.markModified("extraScans");
        alert    = `❌ Extra item: ${resolvedCode}${isRemapped ? ` [was ${parsedCode}]` : ""} (not in picklist)`;
        scanType = "extra";
      }
    }

    await picklist.save();

    // ── Write scan log for all actionable events ──
    // Skip only "nothing-to-unscan" since no state changed
    if (scanType !== "nothing-to-unscan") {
      const direction = unscan ? -1 : 1;

      await ScanLog.create({
        picklistId:   picklist._id,
        userId:       req.user._id.toString(),
        username:     req.user.displayName || req.user.username || "unknown",
        rawInput:     String(rawCode).trim(),
        parsedCode,
        resolvedCode,
        isRemapped,
        qty:          parsedQty,
        direction,
        scanType,
        scannedAt:    new Date(),
      });
    }

    const extraObj = picklist.extraScans || {};

    res.json({
      success:      true,
      scanType,
      rawCode:      parsedCode,
      code:         resolvedCode,
      qty:          parsedQty,
      isRemapped,
      alert,
      picklist:     picklist.items,
      extra:        extraObj,
      stats:        picklist.stats,
    });
  } catch (err) {
    console.error("Scan API error:", err);
    res.status(500).json({ error: "Scan failed: " + err.message });
  }
});

/* ═══════════════════════════════════════════
   RESET
═══════════════════════════════════════════ */
router.post("/picklist/reset", requireLogin, async (req, res) => {
  try {
    const picklistId = req.session.picklistId;
    if (!picklistId) return res.redirect("/upload");

    await Picklist.findOneAndUpdate(
      { _id: picklistId, userId: req.user._id.toString() },
      { $set: { "items.$[].scannedQty": 0, extraScans: {} } }
    );

    res.redirect("/scan");
  } catch (err) {
    console.error("Reset error:", err);
    res.status(500).render("pages/error", { title: "Error", message: "Reset failed: " + err.message });
  }
});

/* ═══════════════════════════════════════════
   EXPORT
═══════════════════════════════════════════ */
router.get("/picklist/export", requireLogin, async (req, res) => {
  let exportPath = null;
  try {
    const picklistId = req.session.picklistId;
    if (!picklistId) return res.redirect("/upload");

    const picklist = await Picklist.findOne({
      _id:    picklistId,
      userId: req.user._id.toString(),
    });

    if (!picklist) return res.redirect("/upload");

    exportPath = await generateReport(picklist);

    const fileName = `picklist-report-${Date.now()}.xlsx`;
    res.download(exportPath, fileName, (err) => {
      if (err) console.error("Download error:", err);
      deleteExport(exportPath);
    });
  } catch (err) {
    console.error("Export error:", err);
    if (exportPath) deleteExport(exportPath);
    res.status(500).render("pages/error", { title: "Export Failed", message: err.message });
  }
});

/* ═══════════════════════════════════════════
   DEMO MODE
═══════════════════════════════════════════ */
router.get("/demo", requireLogin, async (req, res) => {
  try {
    const demoItems = [
      { code: "SKU-A001", expectedQty: 5  },
      { code: "SKU-B002", expectedQty: 10 },
      { code: "SKU-C003", expectedQty: 3  },
      { code: "SKU-D004", expectedQty: 8  },
      { code: "SKU-E005", expectedQty: 2  },
      { code: "ITEM-XYZ", expectedQty: 6  },
      { code: "PROD-9900", expectedQty: 4 },
    ].map((i) => ({ ...i, scannedQty: 0 }));

    await Picklist.updateMany(
      { userId: req.user._id.toString() },
      { $set: { isActive: false } }
    );

    const picklist = await Picklist.create({
      sessionId:  req.session.id,
      userId:     req.user._id.toString(),
      fileName:   "demo-picklist.xlsx",
      items:      demoItems,
      extraScans: {},
      rawData:    demoItems.map(item => ({ Code: item.code, Quantity: item.expectedQty })),
    });

    req.session.picklistId = picklist._id.toString();
    res.redirect("/scan");
  } catch (err) {
    console.error("Demo error:", err);
    res.redirect("/upload");
  }
});

export default router;
