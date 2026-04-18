import Picklist from "../models/Picklist.js";
import ScanLog from "../models/ScanLog.js";

const DEFAULT_RETENTION_DAYS = parseInt(process.env.PICKLIST_RETENTION_DAYS) || 30;

/**
 * Delete picklists older than `days` that are NOT active.
 * Also deletes all ScanLog entries for those picklists.
 * Returns count of deleted picklists.
 */
export async function cleanupOldPicklists(days = DEFAULT_RETENTION_DAYS) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Find IDs first so we can delete their logs too
  const oldPicklists = await Picklist.find(
    { isActive: false, updatedAt: { $lt: cutoff } },
    { _id: 1 }
  ).lean();

  if (oldPicklists.length === 0) return 0;

  const ids = oldPicklists.map((p) => p._id);

  // Delete scan logs for these picklists
  await ScanLog.deleteMany({ picklistId: { $in: ids } });

  // Delete the picklists
  const result = await Picklist.deleteMany({ _id: { $in: ids } });

  return result.deletedCount;
}

/**
 * Start the auto-cleanup scheduler.
 * Runs once at startup, then every 24 hours.
 */
export function startCleanupScheduler(days = DEFAULT_RETENTION_DAYS) {
  const run = async () => {
    try {
      const deleted = await cleanupOldPicklists(days);
      if (deleted > 0) {
        console.log(`🧹 Auto-cleanup: deleted ${deleted} picklist(s) older than ${days} days`);
      }
    } catch (err) {
      console.error("❌ Cleanup error:", err.message);
    }
  };

  // Run immediately on startup (after a short delay so DB is connected)
  setTimeout(run, 5000);

  // Then every 24 hours
  setInterval(run, 1000 * 60 * 60 * 24);

  console.log(`⏰ Cleanup scheduler started — picklists older than ${days} days will be removed`);
}
