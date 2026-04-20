import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ScanLog from "../models/ScanLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ── Style constants ── */
const HDR_BLACK  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
const HDR_RED    = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
const HDR_BLUE   = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
const HDR_AMBER  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD97706" } };
const WHITE_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

const FILL = {
  done:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } },
  partial: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } },
  over:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } },
  pending: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } },
  extra:   { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF4FF" } },
};

const BORDER_HAIR = { bottom: { style: "hair", color: { argb: "FFE5E7EB" } } };

function styleHeader(row, fill) {
  row.eachCell((cell) => {
    cell.fill      = fill;
    cell.font      = WHITE_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border    = { bottom: { style: "thin", color: { argb: "FF374151" } } };
  });
  row.height = 28;
}

function fmt(date) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true,
  });
}

function durationStr(ms) {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Generate the full Excel report.
 * Sheets:
 *   1. Picklist Report  — one row per item, with Boxes column
 *   2. Raw Scan Log     — every individual scan with full original string
 *   3. Extra Scans      — items not on picklist
 *   4. Summary          — totals, timing, user info
 */
export async function generateReport(picklist) {
  // ── Fetch all scan logs for this picklist ──
  const logs = await ScanLog.find({ picklistId: picklist._id })
    .sort({ scannedAt: 1 })
    .lean();

  // ── Build per-code box count and raw scan list from logs ──
  // Net boxes = sum of direction (+1 scan, -1 unscan) per code
  const boxCount   = {};   // net boxes per resolvedCode
  const rawScansMap = {};  // forward-scan raw strings only (for "Original Scans" column)

  for (const log of logs) {
    const code = log.resolvedCode;
    const dir  = log.direction ?? 1;   // default to +1 for old logs without direction

    // Net box count: +1 for scan, -1 for unscan, never go below 0
    boxCount[code] = Math.max(0, (boxCount[code] || 0) + dir);

    // Only include forward scans in the "Original Scans" display column
    if (dir === 1 && log.rawInput) {
      rawScansMap[code] = rawScansMap[code] || [];
      rawScansMap[code].push(log.rawInput);
    }
  }

  // Timing stats
  const forwardLogs = logs.filter((l) => (l.direction ?? 1) === 1);
  const firstScan   = forwardLogs.length ? forwardLogs[0].scannedAt : null;
  const lastScan    = forwardLogs.length ? forwardLogs[forwardLogs.length - 1].scannedAt : null;
  const durationMs  = firstScan && lastScan
    ? new Date(lastScan) - new Date(firstScan)
    : null;

  // Unique users who scanned
  const scanners = [...new Set(logs.map((l) => l.username).filter(Boolean))];

  // Net total boxes = sum of all direction values (+1 scan, -1 unscan)
  const totalBoxes = Math.max(
    0,
    logs.reduce((sum, l) => sum + (l.direction ?? 1), 0)
  );
  const totalScans   = logs.filter((l) => (l.direction ?? 1) ===  1).length;
  const totalUnscans = logs.filter((l) => (l.direction ?? 1) === -1).length;

  const wb = new ExcelJS.Workbook();
  wb.creator  = "Picklist Scanner";
  wb.created  = new Date();

  /* ══════════════════════════════════════
     SHEET 1 — PICKLIST REPORT
  ══════════════════════════════════════ */
  const ws1 = wb.addWorksheet("Picklist Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Pull major/minor config and first-row data
  const majorCols   = (picklist.columnConfig && picklist.columnConfig.major) || [];
  const minorCols   = (picklist.columnConfig && picklist.columnConfig.minor) || [];
  const firstRowMap = picklist.firstRowData || {};

  // Build dynamic columns — core first, then major, then minor
  const coreColumns = [
    { header: "Code",           key: "code",       width: 28 },
    { header: "Expected Qty",   key: "expected",   width: 14 },
    { header: "Scanned Qty",    key: "scanned",    width: 14 },
    { header: "Boxes Scanned",  key: "boxes",      width: 15 },
    { header: "Remaining Qty",  key: "remaining",  width: 14 },
    { header: "Status",         key: "status",     width: 12 },
    { header: "Original Scans", key: "originals",  width: 55 },
  ];

  const majorColumns = majorCols.map((col) => ({
    header: col, key: `major__${col}`, width: Math.max(16, col.length + 4),
  }));

  const minorColumns = minorCols.map((col) => ({
    header: col, key: `minor__${col}`, width: Math.max(16, col.length + 4),
  }));

  ws1.columns = [...coreColumns, ...majorColumns, ...minorColumns];

  // Style header — core cols black, major cols blue, minor cols amber
  const headerRow = ws1.getRow(1);
  styleHeader(headerRow, HDR_BLACK);

  // Re-colour major + minor header cells
  const coreCount  = coreColumns.length;
  const majorStart = coreCount + 1;
  const minorStart = majorStart + majorCols.length;

  majorCols.forEach((_, i) => {
    const cell = headerRow.getCell(majorStart + i);
    cell.fill = HDR_BLUE;
  });
  minorCols.forEach((_, i) => {
    const cell = headerRow.getCell(minorStart + i);
    cell.fill = HDR_AMBER;
  });

  for (const item of picklist.items) {
    const remaining = Math.max(0, item.expectedQty - item.scannedQty);
    const status    = item.status || "pending";
    const code      = item.code;
    const boxes     = boxCount[code] || 0;
    const originals = (rawScansMap[code] || []).join("\n");

    const STATUS_LABELS = { pending: "PENDING", partial: "PARTIAL", done: "DONE", over: "OVER" };

    const rowData = {
      code,
      expected:  item.expectedQty,
      scanned:   item.scannedQty,
      boxes,
      remaining,
      status:    STATUS_LABELS[status] || status.toUpperCase(),
      originals,
    };

    // Add major + minor values (same first-row value for every row)
    majorCols.forEach((col) => { rowData[`major__${col}`] = firstRowMap[col] || ""; });
    minorCols.forEach((col) => { rowData[`minor__${col}`] = firstRowMap[col] || ""; });

    const row  = ws1.addRow(rowData);
    const fill = FILL[status] || FILL.pending;

    row.eachCell((cell) => {
      cell.fill      = fill;
      cell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
      cell.border    = BORDER_HAIR;
    });

    row.getCell("code").alignment      = { vertical: "top", horizontal: "left" };
    row.getCell("originals").alignment = { vertical: "top", horizontal: "left", wrapText: true };

    const lineCount = (originals.match(/\n/g) || []).length + 1;
    row.height = Math.max(22, lineCount * 15);
  }

  /* ══════════════════════════════════════
     SHEET 2 — RAW SCAN LOG
  ══════════════════════════════════════ */
  const ws2 = wb.addWorksheet("Raw Scan Log", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws2.columns = [
    { header: "#",               key: "seq",          width: 6  },
    { header: "Scanned At",      key: "scannedAt",    width: 22 },
    { header: "Direction",       key: "direction",    width: 11 },
    { header: "Original String", key: "rawInput",     width: 50 },
    { header: "Parsed Code",     key: "parsedCode",   width: 22 },
    { header: "Resolved Code",   key: "resolvedCode", width: 22 },
    { header: "Remapped?",       key: "remapped",     width: 12 },
    { header: "Qty",             key: "qty",          width: 8  },
    { header: "Type",            key: "scanType",     width: 16 },
    { header: "User",            key: "username",     width: 16 },
  ];

  styleHeader(ws2.getRow(1), HDR_BLUE);

  logs.forEach((log, idx) => {
    const dir    = log.direction ?? 1;
    const isUnscan = dir === -1;
    const isExtra  = log.scanType === "extra";
    const isOver   = log.scanType === "over";

    const row = ws2.addRow({
      seq:          idx + 1,
      scannedAt:    fmt(log.scannedAt),
      direction:    isUnscan ? "↩ UNSCAN" : "↓ SCAN",
      rawInput:     log.rawInput     || "—",
      parsedCode:   log.parsedCode   || log.resolvedCode,
      resolvedCode: log.resolvedCode,
      remapped:     log.isRemapped ? "YES" : "no",
      qty:          log.qty,
      scanType:     (log.scanType || "match").toUpperCase(),
      username:     log.username || "—",
    });

    const rowFill = isUnscan
      ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } }   // amber tint for unscan
      : isExtra ? FILL.extra
      : isOver  ? FILL.over
      : idx % 2 === 0
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } }
        : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };

    row.eachCell((cell) => {
      cell.fill      = rowFill;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border    = BORDER_HAIR;
    });

    // Direction cell — bold red for unscan, green for scan
    const dirCell = row.getCell("direction");
    dirCell.font = {
      bold:  true,
      color: { argb: isUnscan ? "FFDC2626" : "FF16A34A" },
      size:  10,
    };

    row.getCell("rawInput").alignment     = { vertical: "middle", horizontal: "left" };
    row.getCell("resolvedCode").alignment = { vertical: "middle", horizontal: "left" };
    row.height = 20;
  });

  if (logs.length === 0) {
    ws2.addRow({ seq: "—", rawInput: "No scan events recorded for this picklist." });
  }

  /* ══════════════════════════════════════
     SHEET 3 — EXTRA SCANS
  ══════════════════════════════════════ */
  if (picklist.extraScans && picklist.extraScans.size > 0) {
    const ws3 = wb.addWorksheet("Extra Scans");
    ws3.columns = [
      { header: "Code",          key: "code",     width: 28 },
      { header: "Total Qty",     key: "qty",      width: 12 },
      { header: "Boxes",         key: "boxes",    width: 10 },
      { header: "Original Scans",key: "originals",width: 55 },
    ];

    styleHeader(ws3.getRow(1), HDR_RED);

    for (const [code, qty] of picklist.extraScans) {
      const boxes     = boxCount[code] || 0;
      const originals = (rawScansMap[code] || []).join("\n");

      const row = ws3.addRow({ code, qty, boxes, originals });
      row.eachCell((cell) => {
        cell.fill      = FILL.extra;
        cell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
        cell.border    = BORDER_HAIR;
      });
      row.getCell("code").alignment      = { vertical: "top", horizontal: "left" };
      row.getCell("originals").alignment = { vertical: "top", horizontal: "left", wrapText: true };
      const lineCount = (originals.match(/\n/g) || []).length + 1;
      row.height = Math.max(22, lineCount * 15);
    }
  }

  /* ══════════════════════════════════════
     SHEET 4 — SUMMARY
  ══════════════════════════════════════ */
  const ws4 = wb.addWorksheet("Summary");
  ws4.getColumn(1).width = 28;
  ws4.getColumn(2).width = 36;

  const stats = picklist.stats;

  const sections = [
    // [label, value, isHeader]
    ["FILE INFORMATION", null, true],
    ["File Name",          picklist.fileName || "Unknown",  false],
    ["Report Generated",   fmt(new Date()),                 false],
    ["Picklist ID",        picklist._id.toString(),         false],

    ["COLUMN CONFIGURATION", null, true],
    ["Major Columns",      majorCols.length ? majorCols.join(", ") : "— none configured —", false],
    ...majorCols.map((col) => [`  ${col}`, firstRowMap[col] || "—", false]),
    ["Minor Columns",      minorCols.length ? minorCols.join(", ") : "— none configured —", false],
    ...minorCols.map((col) => [`  ${col}`, firstRowMap[col] || "—", false]),

    ["SCAN PERFORMANCE", null, true],
    ["First Scan Time",    fmt(firstScan),                  false],
    ["Last Scan Time",     fmt(lastScan),                   false],
    ["Total Duration",     durationStr(durationMs),         false],
    ["Scanned By",         scanners.join(", ") || "—",      false],
    ["Total Scan Events",  totalScans,                      false],
    ["Total Unscan Events",totalUnscans,                    false],
    ["Net Total Boxes",    totalBoxes,                      false],

    ["QUANTITIES", null, true],
    ["Total Items in List", picklist.items.length,          false],
    ["Total Expected Qty",  stats.totalExpected,            false],
    ["Total Scanned Qty",   stats.totalScanned,             false],
    ["Total Remaining Qty", stats.totalRemaining,           false],
    ["Progress",            `${stats.progressPct}%`,        false],

    ["ALERTS", null, true],
    ["Completed Items",    stats.doneItems,                 false],
    ["Partial Items",      picklist.items.filter(i => i.scannedQty > 0 && i.scannedQty < i.expectedQty).length, false],
    ["Over-scanned Items", stats.overItems,                 false],
    ["Extra Item Types",   picklist.extraScans?.size || 0,  false],
    ["Extra Qty Total",    stats.extraCount,                false],
    ["Alert Count",        stats.alertCount,                false],
  ];

  for (const [label, value, isHeader] of sections) {
    if (isHeader) {
      const hRow = ws4.addRow([label]);
      hRow.height = 24;
      hRow.eachCell((cell) => {
        cell.fill   = HDR_AMBER;
        cell.font   = WHITE_FONT;
        cell.alignment = { vertical: "middle", horizontal: "left" };
      });
      ws4.mergeCells(`A${hRow.number}:B${hRow.number}`);
      // blank spacer before section
      if (hRow.number > 1) ws4.spliceRows(hRow.number - 1 + 1, 0, []);
    } else {
      const dRow = ws4.addRow([label, value]);
      dRow.height = 20;
      dRow.getCell(1).font      = { bold: true, size: 10 };
      dRow.getCell(1).fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      dRow.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
      dRow.getCell(2).font      = { size: 10 };
      dRow.eachCell((cell) => {
        cell.border = BORDER_HAIR;
        cell.alignment = cell.alignment || { vertical: "middle" };
      });
    }
  }

  /* ── SAVE ── */
  const outputDir = path.join(__dirname, "..", "exports");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `picklist-report-${Date.now()}.xlsx`;
  const filePath = path.join(outputDir, fileName);
  await wb.xlsx.writeFile(filePath);

  return filePath;
}

export function deleteExport(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn("⚠️  Could not delete export:", filePath);
  }
}
