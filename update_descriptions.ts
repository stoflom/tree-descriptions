import { Database } from "https://deno.land/x/sqlite3/mod.ts";
import { MongoClient } from "npm:mongodb@7.1.0";

const SQLITE_PATH = Deno.env.get("SQLITE_PATH") || "./trees.db";
const MONGO_URI = Deno.env.get("MONGO_URI") || "mongodb://192.168.0.8:27017/";
const DB_NAME = Deno.env.get("DB_NAME") || "my_database";
const COLLECTION_NAME = Deno.env.get("COLLECTION_NAME") || "treecols";

interface TreeRow {
  treename: string;
  treedescription: string;
  synced: number;
}

interface MongoTree {
  _id: string;
  scientificname: string;
  treedescription?: string;
}

interface Stats {
  successCount: number;
  errorCount: number;
  missingCount: number;
  duplicateCount: number;
  alreadySynced: number;
}

async function migrateTrees(): Promise<void> {
  const stats: Stats = {
    successCount: 0,
    errorCount: 0,
    missingCount: 0,
    duplicateCount: 0,
    alreadySynced: 0,
  };

  const db = new Database(SQLITE_PATH);
  const client = new MongoClient(MONGO_URI);

  try {
    console.log("Connecting to MongoDB...");
    await client.connect();

    const collection = client.db(DB_NAME).collection<MongoTree>(COLLECTION_NAME);

    console.log("Connected. Fetching trees from SQLite...");
    const rows = db.prepare("SELECT treename, treedescription, synced FROM trees_table WHERE synced != 1").all() as TreeRow[];

    if (rows.length === 0) {
      console.log("No trees to migrate.");
      return;
    }

    console.log(`Found ${rows.length} trees to migrate.`);

    const treenames = rows.map(r => r.treename);
    const mongoTrees = await collection.find({ scientificname: { $in: treenames } }).toArray();
    const mongoTreeMap = new Map<string, MongoTree[]>();

    for (const tree of mongoTrees) {
      const existing = mongoTreeMap.get(tree.scientificname) || [];
      existing.push(tree);
      mongoTreeMap.set(tree.scientificname, existing);
    }

    const updates: { treename: string; treedescription: string }[] = [];

    for (const row of rows) {
      const matches = mongoTreeMap.get(row.treename);

      if (!matches || matches.length === 0) {
        console.log(`[Missing] Tree '${row.treename}' not found in MongoDB.`);
        stats.missingCount++;
      } else if (matches.length > 1) {
        console.log(`[Duplicate] Tree '${row.treename}' found multiple times in MongoDB.`);
        stats.duplicateCount++;
      } else {
        updates.push({ treename: row.treename, treedescription: row.treedescription });
      }
    }

    if (updates.length > 0) {
      console.log(`Performing bulk update for ${updates.length} trees...`);

      const bulkOps = updates.map(({ treename, treedescription }) => ({
        updateOne: {
          filter: { scientificname: treename },
          update: { $set: { treedescription } },
        },
      }));

      const result = await collection.bulkWrite(bulkOps);

      stats.successCount = result.modifiedCount;
      console.log(`[Success] Updated ${result.modifiedCount} trees.`);
    }

    const syncedTrees = updates.map(u => u.treename);
    if (syncedTrees.length > 0) {
      console.log("Marking trees as synced in SQLite...");

      for (const treename of syncedTrees) {
        try {
          const stmt = db.prepare("UPDATE trees_table SET synced = 1 WHERE treename = ?");
          stmt.run([treename]);
        } catch (err) {
          console.error(`[Error] Failed to mark '${treename}' as synced:`, (err as Error).message);
          stats.errorCount++;
        }
      }
    }

    console.log("\n--- Migration Summary ---");
    console.log(`Total Synced: ${stats.successCount}`);
    console.log(`Total Errors: ${stats.errorCount}`);
    console.log(`Missing Trees: ${stats.missingCount}`);
    console.log(`Duplicates: ${stats.duplicateCount}`);
    console.log("-------------------------");

  } catch (e) {
    console.error("Fatal Error:", e);
    throw e;
  } finally {
    await client.close();
    db.close();
    console.log("Connections closed.");
  }
}

await migrateTrees();
