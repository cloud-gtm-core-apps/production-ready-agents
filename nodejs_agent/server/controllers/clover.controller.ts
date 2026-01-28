import type { Request, Response, NextFunction } from "express";
import { getCloverAuthUrl, exchangeCloverToken, storeCloverTokens, checkCloverConnectionStatus, disconnectClover, syncMenuItemsFromClover } from "../services/clover.service.js";

export async function authorizeCloverController(req: Request, res: Response, next: NextFunction) {
  try {
    const authUrl = getCloverAuthUrl();
    res.redirect(authUrl);
  } catch (error: any) {
    console.error('Error initiating Clover OAuth:', error);
    if (error.message === "Clover app ID not configured") {
      return res.status(500).json({ message: error.message });
    }
    res.status(500).json({ message: "Failed to initiate OAuth flow" });
  }
}

export async function cloverOAuthCallbackController(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, error, merchant_id, client_id } = req.query;

    if (error) {
      console.error('OAuth error:', error);
      return res.redirect('/settings?error=oauth_failed');
    }

    if (!code) {
      return res.redirect('/settings?error=no_code');
    }

    // Get user ID from session (user needs to be logged in)
    if (!req.isAuthenticated()) {
      return res.redirect('/login?redirect=/oauth/callback');
    }

    const userId = (req.user as any).id;

    // Exchange code for tokens
    const tokenData = await exchangeCloverToken(code as string, client_id as string);
    console.log(`[OAuth] Full token response:`, JSON.stringify(tokenData, null, 2));

    // Store tokens
    await storeCloverTokens(userId, tokenData, merchant_id as string);

    res.redirect('/settings?success=clover_connected');
  } catch (error: any) {
    console.error('Error in OAuth callback:', error);
    if (error.message === "Clover credentials not configured") {
      return res.redirect('/settings?error=config_error');
    }
    if (error.message?.includes("Token exchange failed")) {
      return res.redirect('/settings?error=token_exchange_failed');
    }
    next(error);
  }
}

export async function checkCloverStatusController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const connected = await checkCloverConnectionStatus(userId);
    res.json({ connected });
  } catch (error) {
    console.error('Error checking Clover status:', error);
    next(error);
  }
}

export async function disconnectCloverController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const { removed } = await disconnectClover(userId);
    res.json({ success: true, message: "Clover disconnected successfully" });
  } catch (error) {
    console.error('Error disconnecting Clover:', error);
    next(error);
  }
}

export async function syncCloverMenuController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;
    const result = await syncMenuItemsFromClover(userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error syncing menu items from Clover:', error);
    if (error.message === "Clover not connected") {
      return res.status(401).json({ message: error.message });
    }
    if (error.requiresReconnect) {
      return res.status(401).json({
        message: error.message,
        requiresReconnect: true,
        statusCode: error.statusCode
      });
    }
    if (error.statusCode) {
      return res.status(500).json({
        message: error.message,
        statusCode: error.statusCode,
        details: error.details
      });
    }
    next(error);
  }
}

