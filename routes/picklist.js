import express from "express";
import { upload, deleteFile } from "../middlewares/upload.js";
import { parseExcel } from "../services/pythonService.js";
import { generateReport, deleteExport } from "../services/exportService.js";
import Picklist from "../models/Picklist.js";
import CodeMap from "../models/CodeMap.js";
import ScanLog from "../models/ScanLog.js";

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/login");
};

/* ═══ HOME ═══ */
router.get("/", (req, res) => {
  res.render("pages/home", { title: "Picklist Scanner" });
});

/* ═══ UPLOAD ═══ */
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

    const savedMap   = req.user.columnMap;
    const colsInFile = data.columns;
    const barcodeOk  = savedMap?.barcode  && colsInFile.includes(savedMap.barcode);
    const quantityOk = savedMap?.quantity && colsInFile.includes(savedMap.quantity);

    if (barcodeOk && quantityOk) {
      return buildAndRedirectToScan(req, res, savedMap.barcode, savedMap.quantity);
    }

    return res.render("pages/upload", {
      title: "Upload Picklist",
      error: "Column mapping has not been configured for your account. Please contact your admin.",
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

/* ═══ HELPER — build picklist ═══ */
async function buildAndRedirectToScan(req, res, barcode, quantity) {
  const raw = req.session.rawData;
  if (!raw || raw.length === 0) return res.redirect("/upload");

  const majorCols = req.user.columnMap?.major || [];
  const minorCols = req.user.columnMap?.minor || [];
  const firstRow  = raw[0] || {};
  const firstRowData = {};
  [...majorCols, ...minorCols].forEach((col) => {
    if (firstRow[col] !== undefined) firstRowData[col] = String(firstRow[col]);
  });

  const items = raw
    .map((row) => ({
      code:        String(row[barcode] || "").trim(),
      expectedQty: Number(row[quantity]) || 0,
      scannedQty:  0,
    }))
    .filter((item) => item.code && item.expectedQty > 0);

  if (items.length === 0) {
    return res.status(400).render("pages/upload", {
      title: "Upload Picklist",
      error: "No valid items found with the configured columns. Please ask your admin to re-map columns.",
    });
  }

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
    firstRowData,
    columnConfig: { major: majorCols, minor: minorCols },
  });

  req.session.picklistId = picklist._id.toString();
  req.session.rawData    = null;
  req.session.columns    = null;
  res.redirect("/scan");
}

/* ═══ SCAN DASHBOARD ═══ */
router.get("/scan", requireLogin, async (req, res) => {
  try {
    const picklistId = req.session.picklistId;
    if (!picklistId) return res.redirect("/upload");

    const picklist = await Picklist.findOne({
      _id:    picklistId,
      userId: req.user._id.toString(),
    });

    if (!picklist) return res.redirect("/upload");

    const extraObj     = Object.fromEntries(picklist.extraScans || new Map());
    const firstRowData = picklist.firstRowData || {};
    const columnConfig = picklist.columnConfig || { major: [], minor: [] };

    res.render("pages/scan", {
      title:        "Scan Dashboard",
      picklist:     picklist.items,
      extra:        extraObj,
      stats:        picklist.stats,
      picklistId:   picklist._id,
      fileName:     picklist.fileName,
      firstRowData,
      columnConfig,
    });
  } catch (err) {
    console.error("Scan page error:", err);
    res.status(500).render("pages/error", { title: "Error", message: err.message });
  }
});

/* ═══ SCAN API ═══ */
router.post("/scan/api", requireLogin, async (req, res) => {
  try {
    const { code: rawCode, unscan = false } = req.body;
    const picklistId = req.session.picklistId;

    if (!rawCode || !picklistId) {
      return res.status(400).json({ error: "Missing code or session" });
    }

    let parsedCode = rawCode.trim();
    let parsedQty  = 1;

    if (parsedCode.includes("|")) {
      const parts = parsedCode.split("|");
      parsedCode = (parts[1] || "").trim();
      parsedQty  = Math.max(1, parseInt(parts[2]) || 1);
    }

    if (!parsedCode) {
      return res.status(400).json({ error: "Could not extract code from barcode" });
    }

    const resolvedCode = await CodeMap.resolve(parsedCode);
    const isRemapped   = resolvedCode.toUpperCase() !== parsedCode.toUpperCase();

    const picklist = await Picklist.findOne({
      _id:    picklistId,
      userId: req.user._id.toString(),
    });

    if (!picklist) return res.status(404).json({ error: "Picklist not found" });

    let alert    = null;
    let scanType = "unknown";

    const item = picklist.items.find(
      (i) => String(i.code).trim().toUpperCase() === resolvedCode.toUpperCase()
    );

    if (unscan) {
      if (item && item.scannedQty > 0) {
        item.scannedQty = Math.max(0, item.scannedQty - parsedQty);
        scanType = "unscanned";
      } else if (picklist.extraScans.has(resolvedCode)) {
        const current = picklist.extraScans.get(resolvedCode);
        const next    = current - parsedQty;
        if (next <= 0) picklist.extraScans.delete(resolvedCode);
        else           picklist.extraScans.set(resolvedCode, next);
        picklist.markModified("extraScans");
        scanType = "unscanned-extra";
      } else {
        scanType = "nothing-to-unscan";
        alert    = `ℹ️ Nothing to unscan for: ${resolvedCode}`;
      }
    } else {
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
        const current = picklist.extraScans.get(resolvedCode) || 0;
        picklist.extraScans.set(resolvedCode, current + parsedQty);
        picklist.markModified("extraScans");
        alert    = `❌ Extra item: ${resolvedCode}${isRemapped ? ` [was ${parsedCode}]` : ""} (not in picklist)`;
        scanType = "extra";
      }
    }

    await picklist.save();

    if (scanType !== "nothing-to-unscan") {
      await ScanLog.create({
        picklistId:   picklist._id,
        userId:       req.user._id.toString(),
        username:     req.user.displayName || req.user.username || "unknown",
        rawInput:     String(rawCode).trim(),
        parsedCode,
        resolvedCode,
        isRemapped,
        qty:          parsedQty,
        direction:    unscan ? -1 : 1,
        scanType,
        scannedAt:    new Date(),
      });
    }

    const extraObj = Object.fromEntries(picklist.extraScans || new Map());

    res.json({
      success:   true,
      scanType,
      rawCode:   parsedCode,
      code:      resolvedCode,
      qty:       parsedQty,
      isRemapped,
      alert,
      picklist:  picklist.items,
      extra:     extraObj,
      stats:     picklist.stats,
    });
  } catch (err) {
    console.error("Scan API error:", err);
    res.status(500).json({ error: "Scan failed: " + err.message });
  }
});

/* ═══ RESET ═══ */
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

/* ═══ EXPORT ═══ */
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

/* ═══ DEMO ═══ */
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
      sessionId:    req.session.id,
      userId:       req.user._id.toString(),
      fileName:     "demo-picklist.xlsx",
      items:        demoItems,
      extraScans:   {},
      firstRowData: {},
      columnConfig: { major: [], minor: [] },
    });

    req.session.picklistId = picklist._id.toString();
    res.redirect("/scan");
  } catch (err) {
    console.error("Demo error:", err);
    res.redirect("/upload");
  }
});

export default router;
