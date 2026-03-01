import sqlite3 from 'sqlite3';
import { MongoClient } from 'mongodb';

// --- Configuration ---
const SQLITE_PATH = './trees.db';
const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'my_database';
const COLLECTION_NAME = 'treecols';

// --- Types ---
interface TreeRow {
    treename: string;
    treedescription: string;
}

async function migrateTrees(): Promise<void> {
    // Initialize Statistics
    let successCount = 0;
    let errorCount = 0;
    let missingCount = 0;
    let duplicateCount = 0;
    const pendingPromises: Promise<unknown>[] = [];

    // 1. Open SQLite Connection
    const db = new sqlite3.Database(SQLITE_PATH);

    // 2. Connect to MongoDB
    const client = new MongoClient(MONGO_URI);

    console.log("Connecting to MongoDB...");

    await (async () => {
        try {
            await client.connect();
            const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

            console.log("Connected. Starting migration...");

            // 3. Use db.each for cursor-like behavior
            // Filter: SELECT only rows where synced != 1
            db.each(
                "SELECT treename, treedescription FROM trees_table WHERE synced != 1", 
                {}, 
                (err: Error | null, row: TreeRow) => {
                    if (err) {
                        console.error("Error in SQLite loop:", err.message);
                        errorCount++;
                        return;
                    }

                    if (!row.treename) return;

                    // --- Logic per row ---

                    // A. Check if tree exists and is unique
                    const promise = collection.countDocuments({ scientificname: row.treename }).then(count => {
                        if (count === 0) {
                            console.log(`[Missing] Tree '${row.treename}' not found in MongoDB.`);
                            missingCount++;
                            return; 
                        }

                        if (count > 1) {
                            console.log(`[Duplicate] Tree '${row.treename}' found multiple times in MongoDB.`);
                            duplicateCount++;
                            return;
                        }

                        // B. Perform MongoDB Update
                        collection.updateOne(
                            { scientificname: row.treename },
                            { $set: { treedescription: row.treedescription } }
                        )
                            .then(result => {
                                if (result.modifiedCount > 0) {
                                    console.log(`[Success] Updated tree '${row.treename}'.`);

                                    // C. Mark as synced in SQLite ONLY if MongoDB was successful
                                    db.run("UPDATE trees_table SET synced = 1 WHERE treename = ?", [row.treename], (updateErr) => {
                                        if (updateErr) {
                                            console.error(`[Error] Failed to mark '${row.treename}' as synced in SQLite:`, updateErr.message);
                                            errorCount++;
                                        } else {
                                            successCount++;
                                        }
                                    });
                                } else {
                                    // Already up to date
                                    successCount++;
                                }
                            })
                            .catch(updateErr => {
                                console.error(`[Error] Failed to update tree '${row.treename}':`, updateErr.message);
                                errorCount++;
                            });
                    }).catch(countErr => {
                        console.error(`[Error] Failed to count tree '${row.treename}':`, countErr.message);
                        errorCount++;
                    });

                    pendingPromises.push(promise);
                },
                async () => {
                    // 4. Cleanup - runs after all rows are processed
                    // Wait for all pending async operations to complete
                    await Promise.all(pendingPromises);
                    await client.close();
                    db.close();

                    console.log("\n--- Migration Summary ---");
                    console.log(`Total Synced: ${successCount}`);
                    console.log(`Total Errors: ${errorCount}`);
                    console.log(`Missing Trees: ${missingCount}`);
                    console.log(`Duplicates: ${duplicateCount}`);
                    console.log("-------------------------");
                }
            );

        } catch (e) {
            console.error("Fatal Error:", e);
            await client.close();
            db.close();
        }
    })();
}

migrateTrees();

