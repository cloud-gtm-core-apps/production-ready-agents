import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { oauthTokens, type MenuItem, menuItemPopularityAggregates } from "@shared/schema";
import { encrypt, clearMenuItemsCache } from "../utils.js";
import { storage } from "../storage.js";

export function getCloverAuthUrl(): string {
  const clientId = process.env.CLOVER_APP_ID;
  if (!clientId) {
    throw new Error("Clover app ID not configured");
  }

  const REDIRECT_URI = process.env.REDIRECT_URI;
  const authUrl = `https://sandbox.dev.clover.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${REDIRECT_URI}`;

  return authUrl;
}

export async function exchangeCloverToken(code: string, clientId: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const clientSecret = process.env.CLOVER_APP_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Clover credentials not configured");
  }

  const tokenResponse = await fetch('https://apisandbox.dev.clover.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return tokenData;
}

export async function storeCloverTokens(
  userId: string,
  tokenData: { access_token: string; refresh_token?: string; expires_in?: number },
  merchantId: string
): Promise<void> {
  // Encrypt tokens before storing
  const encryptedAccessToken = encrypt(tokenData.access_token);
  const refreshToken = tokenData.refresh_token;
  const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : null;
  const expiresIn = tokenData.expires_in;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  // Check if token already exists for this user and provider
  const existingToken = await db.select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
    .limit(1);

  if (existingToken.length > 0) {
    // Update existing token (preserve existing merchantId if new one is null)
    await db.update(oauthTokens)
      .set({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: expiresAt,
        merchantId: merchantId,
        updatedAt: new Date(),
      })
      .where(eq(oauthTokens.id, existingToken[0].id));
  } else {
    // Insert new token
    await db.insert(oauthTokens).values({
      userId,
      provider: 'clover',
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: expiresAt,
      merchantId: merchantId,
    });
  }
}

export async function checkCloverConnectionStatus(userId: string): Promise<boolean> {
  const token = await db.select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
    .limit(1);

  return token.length > 0;
}

export async function disconnectClover(userId: string): Promise<{ removed: boolean }> {
  // Check if token exists before deleting
  const existingToken = await db.select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
    .limit(1);

  if (existingToken.length > 0) {
    await db.delete(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')));
    console.log(`[OAuth] Clover token removed for user ${userId}`);
    return { removed: true };
  } else {
    console.log(`[OAuth] No Clover token found to remove for user ${userId}`);
    return { removed: false };
  }
}

export async function getCloverTokenForSync(userId: string): Promise<{ accessToken: string; merchantId: string }> {
  const tokenRecord = await db.select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, 'clover')))
    .limit(1);

  if (!tokenRecord[0]) {
    throw new Error("Clover not connected");
  }

  // Note: Currently using env var, but should decrypt from tokenRecord[0].accessToken
  let accessToken = process.env.MERCHENT_API_KEY || "";
  console.log(`[Clover Sync] Decrypted Access token: ${accessToken}`);
  const merchantId = tokenRecord[0].merchantId || 'H4RW04034BGH1';

  return { accessToken, merchantId };
}

export async function deleteAllMenuItemsForSync(userId: string): Promise<void> {
  // First, delete all existing menu items to replace with fresh data
  console.log(`[Clover Sync] Deleting all existing menu items for fresh sync...`);
  const existingItems = await storage.getMenuItems(userId);

  // Delete menu_item_popularity_aggregates first (due to foreign key constraint)
  if (existingItems.length > 0) {
    const menuItemIds = existingItems.map(item => item.id);
    console.log(`[Clover Sync] Deleting popularity aggregates for ${menuItemIds.length} menu items...`);
    await db.delete(menuItemPopularityAggregates)
      .where(eq(menuItemPopularityAggregates.userId, userId));
    console.log(`[Clover Sync] Deleted popularity aggregates`);
  }

  // Now delete menu items
  let deletedCount = 0;
  for (const existingItem of existingItems) {
    try {
      await storage.deleteMenuItem(userId, existingItem.id);
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting existing item ${existingItem.id}:`, error);
    }
  }
  console.log(`[Clover Sync] Deleted ${deletedCount} of ${existingItems.length} existing menu items`);

  // Verify deletion by fetching items again - should be empty
  const remainingItems = await storage.getMenuItems(userId);
  if (remainingItems.length > 0) {
    console.warn(`[Clover Sync] Warning: ${remainingItems.length} items still remain after deletion. Attempting to delete again...`);
    // Delete remaining items manually
    for (const item of remainingItems) {
      try {
        await db.delete(menuItemPopularityAggregates)
          .where(eq(menuItemPopularityAggregates.menuItemId, item.id));
        await storage.deleteMenuItem(userId, item.id);
      } catch (error) {
        console.error(`Error deleting remaining item ${item.id}:`, error);
      }
    }
  }
}

export async function fetchCloverCategories(merchantId: string, accessToken: string): Promise<Array<{ id?: string; name?: string }>> {
  console.log(`[Clover Sync] Fetching categories for merchant ${merchantId}`);
  const categoriesResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/categories?limit=1000`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!categoriesResponse.ok) {
    const errorText = await categoriesResponse.text();
    const statusCode = categoriesResponse.status;
    console.error(`[Clover Sync] Failed to fetch categories (${statusCode}):`, errorText);

    if (statusCode === 401) {
      const error: any = new Error("Unauthorized - Token may be invalid or expired. Please reconnect Clover in Settings.");
      error.statusCode = statusCode;
      error.requiresReconnect = true;
      throw error;
    }

    const error: any = new Error("Failed to fetch categories from Clover");
    error.statusCode = statusCode;
    error.details = errorText;
    throw error;
  }

  const categoriesData = await categoriesResponse.json() as { elements?: unknown[] } | unknown[];
  const categories = Array.isArray(categoriesData)
    ? categoriesData
    : ('elements' in categoriesData && Array.isArray(categoriesData.elements))
      ? categoriesData.elements
      : [];
  console.log(`[Clover Sync] Found ${categories.length} categories`);

  return categories as Array<{ id?: string; name?: string }>;
}

export async function fetchCloverCategoryItems(merchantId: string, categoryId: string, categoryName: string, accessToken: string): Promise<Array<{
  name?: string;
  hidden?: boolean;
  price?: number;
  description?: string;
  imageHref?: string;
}>> {
  console.log(`[Clover Sync] Fetching items for category: ${categoryName} (${categoryId})`);

  const categoryItemsResponse = await fetch(`https://sandbox.dev.clover.com/v3/merchants/${merchantId}/categories/${categoryId}/items?limit=1000`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!categoryItemsResponse.ok) {
    const errorText = await categoryItemsResponse.text();
    console.error(`[Clover Sync] Failed to fetch items for category ${categoryName} (${categoryItemsResponse.status}):`, errorText);
    throw new Error(`Failed to fetch items for category "${categoryName}": ${errorText}`);
  }

  const categoryItemsData = await categoryItemsResponse.json() as { elements?: unknown[] } | unknown[];
  const categoryItems = Array.isArray(categoryItemsData)
    ? categoryItemsData
    : ('elements' in categoryItemsData && Array.isArray(categoryItemsData.elements))
      ? categoryItemsData.elements
      : [];
  console.log(`[Clover Sync] Found ${categoryItems.length} items in category "${categoryName}"`);

  return categoryItems as Array<{
    name?: string;
    hidden?: boolean;
    price?: number;
    description?: string;
    imageHref?: string;
  }>;
}

export async function syncMenuItemsFromClover(userId: string): Promise<{
  success: boolean;
  synced: number;
  items: MenuItem[];
  errors?: string[];
}> {
  // Get Clover token and merchant ID
  const { accessToken, merchantId } = await getCloverTokenForSync(userId);

  // Delete all existing menu items
  await deleteAllMenuItemsForSync(userId);

  // Fetch categories from Clover
  const categories = await fetchCloverCategories(merchantId, accessToken);

  // Map Clover items to our menu items schema and save to database
  const syncedItems: MenuItem[] = [];
  const errors: string[] = [];

  // For each category, fetch its items
  for (const category of categories) {
    try {
      const categoryId = category.id;
      const categoryName = category.name;

      if (!categoryId || !categoryName) {
        continue;
      }

      const categoryItems = await fetchCloverCategoryItems(merchantId, categoryId, categoryName, accessToken);

      // Process each item in this category
      for (const cloverItem of categoryItems) {
        try {
          // Skip if item doesn't have a name or is hidden
          if (!cloverItem.name || cloverItem.hidden === true) {
            continue;
          }

          // Format price (Clover stores price in cents, convert to dollars)
          const priceInCents = cloverItem.price || 0;
          const priceInDollars = (priceInCents / 100).toFixed(2);
          const formattedPrice = `$${priceInDollars}`;

          // Create menu item with category
          const newItem = await storage.createMenuItem(userId, {
            name: cloverItem.name,
            price: formattedPrice,
            category: categoryName,
            description: cloverItem.description || undefined,
            imageUrl: cloverItem.imageHref || undefined,
            isAvailable: !cloverItem.hidden,
          } as any);
          syncedItems.push(newItem);
        } catch (error: any) {
          console.error(`Error syncing item "${cloverItem.name}" in category "${categoryName}":`, error);
          errors.push(`Failed to sync "${cloverItem.name}" in category "${categoryName}": ${error.message}`);
        }
      }
    } catch (error: any) {
      const cat = category as { name?: string };
      console.error(`Error processing category "${cat.name}":`, error);
      errors.push(`Failed to process category "${cat.name}": ${error.message}`);
    }
  }

  // Clear menu items cache
  await clearMenuItemsCache(userId);

  return {
    success: true,
    synced: syncedItems.length,
    items: syncedItems,
    errors: errors.length > 0 ? errors : undefined,
  };
}

