import express from "express";
import passport from "passport";
import User from "../models/User.js";

const router = express.Router();

/* ─── REGISTER ─── */
router.get("/register", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");
  res.render("pages/register", { title: "Create Account", error: null });
});

router.post("/register", async (req, res) => {
  const { username, displayName, password, confirmPassword } = req.body;

  if (!username || !password) {
    return res.render("pages/register", {
      title: "Create Account",
      error: "Username and password are required.",
    });
  }
  if (password !== confirmPassword) {
    return res.render("pages/register", {
      title: "Create Account",
      error: "Passwords do not match.",
    });
  }
  if (password.length < 6) {
    return res.render("pages/register", {
      title: "Create Account",
      error: "Password must be at least 6 characters.",
    });
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) {
      return res.render("pages/register", {
        title: "Create Account",
        error: "That username is already taken.",
      });
    }

    const user = new User({ username, displayName: displayName || username });
    await User.register(user, password);

    req.login(user, (err) => {
      if (err) {
        return res.render("pages/register", {
          title: "Create Account",
          error: "Registered but could not log in automatically.",
        });
      }
      res.redirect("/");
    });
  } catch (err) {
    console.error("Register error:", err);
    res.render("pages/register", {
      title: "Create Account",
      error: err.message || "Registration failed.",
    });
  }
});

/* ─── LOGIN ─── */
router.get("/login", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");
  const messages = req.session.messages || [];
  req.session.messages = [];
  res.render("pages/login", {
    title: "Sign In",
    error: messages[messages.length - 1] || null,
  });
});

router.post(
  "/login",
  (req, res, next) => {
    if (!req.body.username || !req.body.password) {
      return res.render("pages/login", {
        title: "Sign In",
        error: "Please enter your username and password.",
      });
    }
    next();
  },
  passport.authenticate("local", {
    failureRedirect: "/auth/login",
    failureMessage: true,
  }),
  (req, res) => {
    const redirectTo = req.session.returnTo || "/";
    delete req.session.returnTo;
    res.redirect(redirectTo);
  }
);

/* ─── LOGOUT ─── */
router.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect("/auth/login"));
  });
});

export default router;
