import mongoose from "mongoose";

/**
 * CodeMap — shared by all users.
 * Maps a scanned barcode (e.g. "KIT020666") to the real product code
 * (e.g. "BCELZ24PK00001").
 *
 * When scannedCode === realCode the entry is a passthrough
 * (the scanner already emits the real code — no substitution needed).
 */
const CodeMapSchema = new mongoose.Schema(
  {
    scannedCode: {
      type:     String,
      required: true,
      trim:     true,
      unique:   true,   // one mapping per scanned code
      index:    true,
    },
    realCode: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
    },
    addedBy: {
      type: String,    // username of the user who added it
      default: "system",
    },
    note: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Case-insensitive lookup helper
CodeMapSchema.statics.resolve = async function (scannedCode) {
  const entry = await this.findOne({
    scannedCode: { $regex: new RegExp(`^${scannedCode.trim()}$`, "i") },
  }).lean();
  return entry ? entry.realCode : scannedCode.trim();
};

const CodeMap = mongoose.model("CodeMap", CodeMapSchema);
export default CodeMap;
