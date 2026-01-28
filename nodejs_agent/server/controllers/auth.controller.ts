import type { Request, Response, NextFunction } from "express";
import { insertUserSchema } from "@shared/schema";
import { signupUser } from "../services/auth.service.js";
import passport from "../auth.js";

export async function signupController(req: Request, res: Response, next: NextFunction) {
  try {
    const result = insertUserSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.issues
      });
    }

    const { email, password } = result.data;

    // Call service to create user
    const user = await signupUser(email, password);

    // Log the user in after signup
    req.login(user, (err) => {
      if (err) {
        return next(err);
      }
      // Explicitly save session to ensure it's persisted
      req.session.save((err) => {
        if (err) {
          console.error('[Signup] Error saving session:', err);
          return next(err);
        }
        // Don't send password in response
        const { password: _, ...userWithoutPassword } = user;
        res.status(201).json({ user: userWithoutPassword });
      });
    });
  } catch (error: any) {
    if (error.message === "User already exists") {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
}

export function loginController(req: Request, res: Response, next: NextFunction) {
  passport.authenticate("local", (err: any, user: any, info: any) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ message: info?.message || "Login failed" });
    }
    req.login(user, (err) => {
      if (err) {
        return next(err);
      }
      // Explicitly save session to ensure it's persisted
      req.session.save((err) => {
        if (err) {
          console.error('[Login] Error saving session:', err);
          return next(err);
        }
        // Don't send password in response
        const { password: _, ...userWithoutPassword } = user;
        res.json({ user: userWithoutPassword });
      });
    });
  })(req, res, next);
}

export function logoutController(req: Request, res: Response) {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Session destruction failed" });
      }
      res.clearCookie('connect.sid');
      res.json({ message: "Logged out successfully" });
    });
  });
}

export function getCurrentUserController(req: Request, res: Response) {
  if (req.isAuthenticated()) {
    const { password: _, ...userWithoutPassword } = req.user as any;
    res.json({ user: userWithoutPassword });
  } else {
    res.status(401).json({ message: "Not authenticated" });
  }
}

