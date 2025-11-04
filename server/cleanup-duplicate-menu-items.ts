import "dotenv/config";
import { db } from "./db";
import { menuItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import postgres from "postgres";

/**
 * Cleanup script to remove duplicate menu items.
 * For each user, if there are multiple items with the same name,
 * this keeps the oldest one (by created_at) and deletes the rest.
 */
async function cleanupDuplicateMenuItems() {
  console.log('Starting cleanup of duplicate menu items...\n');

  try {
    // Get the postgres client directly for raw SQL queries
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    const client = postgres(process.env.DATABASE_URL);

    // Find all duplicate menu items grouped by userId and name
    // This query finds items that have duplicates (same userId and name)
    const duplicateGroups = await client`
      SELECT 
        user_id,
        name,
        COUNT(*) as count,
        ARRAY_AGG(id ORDER BY created_at ASC) as ids
      FROM menu_items
      GROUP BY user_id, name
      HAVING COUNT(*) > 1
      ORDER BY user_id, name
    `;

    if (duplicateGroups.length === 0) {
      console.log('✓ No duplicate menu items found. Database is clean!');
      await client.end();
      return;
    }

    console.log(`Found ${duplicateGroups.length} groups of duplicate items:\n`);

    let totalDeleted = 0;

    for (const group of duplicateGroups) {
      const userId = group.user_id as string;
      const name = group.name as string;
      const count = Number(group.count);
      const ids = group.ids as string[];

      console.log(`  Group: "${name}" (User: ${userId})`);
      console.log(`    - Total duplicates: ${count}`);
      console.log(`    - Keeping oldest: ${ids[0]}`);

      // Keep the first ID (oldest by created_at), delete the rest
      const idsToDelete = ids.slice(1);
      
      console.log(`    - Deleting ${idsToDelete.length} duplicate(s):`);

      for (const idToDelete of idsToDelete) {
        await db.delete(menuItems)
          .where(eq(menuItems.id, idToDelete));
        console.log(`      ✓ Deleted: ${idToDelete}`);
        totalDeleted++;
      }
      console.log('');
    }

    await client.end();

    console.log(`\n✓ Cleanup complete!`);
    console.log(`  - Groups processed: ${duplicateGroups.length}`);
    console.log(`  - Total items deleted: ${totalDeleted}`);
    console.log(`  - Items kept: ${duplicateGroups.length}`);

  } catch (error) {
    console.error('Error during cleanup:', error);
    throw error;
  }
}

// Run the cleanup
cleanupDuplicateMenuItems()
  .then(() => {
    console.log('\nCleanup script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nCleanup script failed:', error);
    process.exit(1);
  });

