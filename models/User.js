import mongoose from "mongoose";
import pkg from "passport-local-mongoose";

const passportLocalMongoose = pkg.default || pkg;

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
      barcode:  { type: String, default: null },
      quantity: { type: String, default: null },
    },
  },
  { timestamps: true }
);

UserSchema.plugin(passportLocalMongoose);

const User = mongoose.model("User", UserSchema);
export default User;
