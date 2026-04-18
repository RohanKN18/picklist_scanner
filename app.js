import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import expressLayouts from "express-ejs-layouts";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import User from "./models/User.js";
import picklistRouter from "./routes/picklist.js";
import authRouter from "./routes/auth.js";
import codemapRouter from "./routes/codemap.js";
import historyRouter from "./routes/history.js";
import { startCleanupScheduler } from "./services/cleanupService.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ─── DB ─── */
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/picklist_db")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

/* ─── VIEW ENGINE ─── */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/boilerplate");

/* ─── MIDDLEWARE ─── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* ─── SESSION ─── */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "picklist_dev_secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI || "mongodb://localhost:27017/picklist_db",
      ttl: 60 * 60 * 24,
    }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  })
);

/* ─── PASSPORT ─── */
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

/* ─── LOCALS (available in all EJS views) ─── */
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  next();
});

/* ─── AUTH GUARD ─── */
export const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/login");
};

/* ─── ROUTES ─── */
app.use("/auth",    authRouter);
app.use("/codemap", codemapRouter);
app.use("/history", historyRouter);
app.use("/",        picklistRouter);

/* ─── AUTO CLEANUP SCHEDULER ─── */
startCleanupScheduler();

/* ─── 404 ─── */
app.use((req, res) => {
  res.status(404).render("pages/404", { title: "Not Found" });
});

/* ─── ERROR ─── */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render("pages/error", {
    title: "Error",
    message: err.message || "Something went wrong.",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
