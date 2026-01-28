import bcrypt from "bcrypt";
import { storage } from "../storage.js";

export async function signupUser(email: string, password: string) {
  // Check if user already exists
  const existingUser = await storage.getUserByEmail(email);
  if (existingUser) {
    throw new Error("User already exists");
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = await storage.createUser({
    email,
    password: hashedPassword,
  });

  return user;
}

