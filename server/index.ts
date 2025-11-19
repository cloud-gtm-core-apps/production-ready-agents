import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "./auth.js";
import { registerRoutes, checkForOrderDetection } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { restoreOrderDetectionTimers } from "./utils.js";

const app = express();

// Trust proxy for production (needed if behind reverse proxy/load balancer)
// This must be set BEFORE session middleware
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Webhook verification
declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

// Configure PostgreSQL session store
const PgSession = connectPgSimple(session);
let sessionStore: connectPgSimple.PGStore | undefined;

if (process.env.DATABASE_URL) {
  try {
    // Use connection string directly - connect-pg-simple will create its own pg.Pool
    sessionStore = new PgSession({
      conString: process.env.DATABASE_URL,
      tableName: 'session', // Table name for sessions
      createTableIfMissing: true, // Automatically create the session table if it doesn't exist
      pruneSessionInterval: 60, // Clean up expired sessions every 60 seconds (default)
    });

    // Note: In connect-pg-simple v10+, cleanup is automatic - no need to call startInterval()
    log('PostgreSQL session store initialized');
  } catch (error) {
    log(`Warning: Failed to initialize PostgreSQL session store: ${error}`);
  }
} else {
  log('Warning: DATABASE_URL not set, using in-memory session store (not recommended for production)');
}

// Determine if we should use secure cookies
// Default to false in production (behind proxy) unless explicitly enabled
// Secure cookies require HTTPS end-to-end, which may not be the case behind a proxy
const useSecureCookies = process.env.SESSION_SECURE === 'true';

// Session configuration
export const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid', // Explicitly set cookie name
  cookie: {
    secure: useSecureCookies, // Only use secure in production if explicitly enabled
    httpOnly: true,
    sameSite: (process.env.SESSION_SAME_SITE as 'strict' | 'lax' | 'none' | undefined) || 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    // Don't set domain - let browser use default (current domain)
    // path: '/' is default
  },
  // Ensure session is saved even if not modified
  rolling: false,
});

app.use(sessionMiddleware);

// Session Management
app.use(passport.initialize());
app.use(passport.session());

// Form Data Handling -> Request Body
app.use(express.urlencoded({ extended: false }));

// Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {

  // Restore order detection timers from Redis (if PRODUCTION=true)
  if (process.env.PRODUCTION === 'true') {
    await restoreOrderDetectionTimers(checkForOrderDetection);
  }

  // Register Routes
  const server = await registerRoutes(app);

  // Error Handling Middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Setup Vite in development and serve static files in production
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.platform === 'win32' ? 'localhost' : '0.0.0.0';
  server.listen(port, host, () => {
    log(`serving on port ${port}`);
  });
})();
