import mongoose from "mongoose";

const ItemSchema = new mongoose.Schema({
  code:        { type: String, required: true },
  expectedQty: { type: Number, required: true, min: 0 },
  scannedQty:  { type: Number, default: 0, min: 0 },
}, { _id: false });

const PicklistSchema = new mongoose.Schema({
  sessionId:    { type: String, required: true },
  userId:       { type: String, required: true },
  fileName:     { type: String, required: true },
  items:        [ItemSchema],
  extraScans:   { type: Object, default: {} },
  previewRow:   { type: Object, default: {} },
  allColumns:   { type: [String], default: [] },
  minorColumns: { type: [String], default: [] },
  minorCount:   { type: Number, default: 3 },
  rawData:      { type: [Object], default: [] },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

// Virtual for stats
PicklistSchema.virtual("stats").get(function() {
  const items = this.items || [];
  const extraScans = this.extraScans || {};

  const totalExpected = items.reduce((sum, i) => sum + (i.expectedQty || 0), 0);
  const totalScanned  = items.reduce((sum, i) => sum + (i.scannedQty || 0), 0) + Object.values(extraScans).reduce((sum, v) => sum + v, 0);
  const totalRemaining = Math.max(0, totalExpected - totalScanned);

  const alertCount = items.filter(i => (i.scannedQty || 0) > i.expectedQty).length;

  const progressPct = totalExpected > 0 ? Math.round((totalScanned / totalExpected) * 100) : 0;

  return {
    totalExpected,
    totalScanned,
    totalRemaining,
    alertCount,
    progressPct,
  };
});

// Ensure virtual fields are serialized
PicklistSchema.set("toJSON", { virtuals: true });
PicklistSchema.set("toObject", { virtuals: true });

const Picklist = mongoose.model("Picklist", PicklistSchema);

export default Picklist;
