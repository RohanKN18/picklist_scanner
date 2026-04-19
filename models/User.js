import mongoose from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    // Saved column mapping — persists across uploads for this user
    columnMap: {
      barcode:      { type: String, default: null },
      quantity:     { type: String, default: null },
      // Extra columns to show in the info bar on the scan page
      minorColumns: { type: [String], default: [] },
      // How many minor columns to display (user-configurable)
      minorCount:   { type: Number, default: 3 },
    },
  },
  { timestamps: true }
);

UserSchema.plugin(passportLocalMongoose);

const User = mongoose.model("User", UserSchema);
export default User;
