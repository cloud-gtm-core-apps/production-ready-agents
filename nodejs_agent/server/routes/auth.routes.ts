import type { Express } from "express";
import { signupController, loginController, logoutController, getCurrentUserController } from "../controllers/auth.controller.js";

export function registerAuthRoutes(app: Express) {
  // Signup route
  app.post("/api/auth/signup", signupController);

  // Login route
  app.post("/api/auth/login", loginController);

  // Logout route
  app.post("/api/auth/logout", logoutController);

  // Get current user route
  app.get("/api/auth/me", getCurrentUserController);
}

