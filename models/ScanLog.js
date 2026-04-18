import mongoose from "mongoose";

/**
 * ScanLog — one document per scan event.
 * Gives us full audit trail: original barcode string,
 * resolved code, qty per box, timestamp, user.
 */
const ScanLogSchema = new mongoose.Schema(
  {
    picklistId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Picklist",
      required: true,
      index:    true,
    },
    userId: {
      type:  String,
      index: true,
    },
    username: {
      type: String,
      default: "unknown",
    },

    // The raw string exactly as received from the scanner
    // e.g. "520028250507160083|BSRDO16BKRD002|2|U"
    rawInput: {
      type: String,
      default: "",
    },

    // Code as extracted from rawInput (before mapping)
    parsedCode: {
      type: String,
      default: "",
    },

    // Final code after CodeMap resolution
    resolvedCode: {
      type:     String,
      required: true,
      index:    true,
    },

    // Was this code remapped via CodeMap?
    isRemapped: {
      type:    Boolean,
      default: false,
    },

    // Quantity from the scanner string (field[2])
    qty: {
      type:    Number,
      default: 1,
      min:     1,
    },

    // +1 = normal scan (adds a box), -1 = unscan (removes a box)
    direction: {
      type:    Number,
      enum:    [1, -1],
      default: 1,
    },

    // match | complete | over | extra | unscanned | unscanned-extra
    scanType: {
      type: String,
      default: "match",
    },

    scannedAt: {
      type:    Date,
      default: Date.now,
      index:   true,
    },
  },
  {
    // No updatedAt needed — scan logs are immutable
    timestamps: false,
  }
);

const ScanLog = mongoose.model("ScanLog", ScanLogSchema);
export default ScanLog;
