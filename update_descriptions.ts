import sqlite3 from 'sqlite3';
import { MongoClient } from 'mongodb';

const SQLITE_PATH = process.env.SQLITE_PATH || './trees.db';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'my_database';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'treecols';

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

function promisifyDb(db: sqlite3.Database): sqlite3.Database {
    sqlite3.verbose();
    return db;
}

function runAsync(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function allAsync<T>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all<T>(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function migrateTrees(): Promise<void> {
    const stats: Stats = {
        successCount: 0,
        errorCount: 0,
        missingCount: 0,
        duplicateCount: 0,
        alreadySynced: 0,
    };

    const db = new sqlite3.Database(SQLITE_PATH);
    const client = new MongoClient(MONGO_URI);

    try {
        console.log('Connecting to MongoDB...');
        await client.connect();

        const collection = client.db(DB_NAME).collection<MongoTree>(COLLECTION_NAME);

        console.log('Connected. Fetching trees from SQLite...');
        const rows = await allAsync<TreeRow>(
            db,
            'SELECT treename, treedescription, synced FROM trees_table WHERE synced != 1'
        );

        if (rows.length === 0) {
            console.log('No trees to migrate.');
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
            console.log('Marking trees as synced in SQLite...');
            
            for (const treename of syncedTrees) {
                try {
                    await runAsync(db, 'UPDATE trees_table SET synced = 1 WHERE treename = ?', [treename]);
                } catch (err) {
                    console.error(`[Error] Failed to mark '${treename}' as synced:`, (err as Error).message);
                    stats.errorCount++;
                }
            }
        }

        console.log('\n--- Migration Summary ---');
        console.log(`Total Synced: ${stats.successCount}`);
        console.log(`Total Errors: ${stats.errorCount}`);
        console.log(`Missing Trees: ${stats.missingCount}`);
        console.log(`Duplicates: ${stats.duplicateCount}`);
        console.log('-------------------------');

    } catch (e) {
        console.error('Fatal Error:', e);
        throw e;
    } finally {
        await client.close();
        db.close();
        console.log('Connections closed.');
    }
}

migrateTrees().catch(console.error);
