import mongoose from "mongoose";
import dotenv from "dotenv";
import CodeMap from "./models/CodeMap.js";

dotenv.config();

const codeMaps = [
  { scannedCode: "OLD001", realCode: "SKU-A001", note: "Legacy barcode" },
  { scannedCode: "OLD002", realCode: "SKU-B002", note: "Legacy barcode" },
  // add as many as you want here
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to Atlas");

    await CodeMap.deleteMany({});
    console.log("🗑️  Cleared existing codemaps");

    await CodeMap.insertMany(codeMaps);
    console.log(`✅ Inserted ${codeMaps.length} code maps`);

  } catch (err) {
    console.error("❌ Seed failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected");
    process.exit(0);
  }
}

seed();