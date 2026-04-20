import mongoose from "mongoose";

const PicklistItemSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    trim: true,
  },
  expectedQty: {
    type: Number,
    required: true,
    min: 0,
  },
  scannedQty: {
    type: Number,
    default: 0,
    min: 0,
  },
});

// Virtual: remaining quantity
PicklistItemSchema.virtual("remainingQty").get(function () {
  return Math.max(0, this.expectedQty - this.scannedQty);
});

// Virtual: status
PicklistItemSchema.virtual("status").get(function () {
  if (this.scannedQty === 0) return "pending";
  if (this.scannedQty < this.expectedQty) return "partial";
  if (this.scannedQty === this.expectedQty) return "done";
  return "over";
});

const PicklistSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: "anonymous",
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },
    fileName: {
      type: String,
      default: "Unknown",
    },
    items: [PicklistItemSchema],
    extraScans: {
      type: Map,
      of: Number,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // First-row values for major+minor columns (same for all rows in the file)
    firstRowData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Snapshot of which columns were major/minor at upload time
    columnConfig: {
      major: { type: [String], default: [] },
      minor: { type: [String], default: [] },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Computed stats
PicklistSchema.virtual("stats").get(function () {
  const totalExpected = this.items.reduce((s, i) => s + i.expectedQty, 0);
  const totalScanned = this.items.reduce((s, i) => s + i.scannedQty, 0);
  const doneItems = this.items.filter((i) => i.scannedQty >= i.expectedQty).length;
  const overItems = this.items.filter((i) => i.scannedQty > i.expectedQty).length;
  const extraCount = [...(this.extraScans?.values() || [])].reduce((s, v) => s + v, 0);
  const alertCount = overItems + (this.extraScans?.size || 0);
  const pct = totalExpected ? Math.round((totalScanned / totalExpected) * 100) : 0;

  return {
    totalExpected,
    totalScanned,
    totalRemaining: Math.max(0, totalExpected - totalScanned),
    doneItems,
    overItems,
    extraCount,
    alertCount,
    progressPct: Math.min(100, pct),
  };
});

const Picklist = mongoose.model("Picklist", PicklistSchema);
export default Picklist;
