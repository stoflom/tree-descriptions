import { Database } from "https://deno.land/x/sqlite3/mod.ts";
import { MongoClient, ObjectId, Collection, Document } from "npm:mongodb@7.1.0";
import { assertStrictEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Configuration
const TEST_SQLITE_PATH = "./test_trees.db";
const TEST_MONGO_URI = Deno.env.get("MONGO_TEST_URI") || "mongodb://192.168.0.8:27017/test_my_database";
const TEST_DB_NAME = "test_my_database";
const TEST_COLLECTION_NAME = "treecols";
const UPDATE_SCRIPT_PATH = "./update_descriptions.ts";

// ============== Configuration ==============
const SKIP_MONGO_TESTS = Deno.env.get("SKIP_MONGO_TESTS") === "true";
const SCHEMAS = {
  treesTable: `
    CREATE TABLE IF NOT EXISTS trees_table (
      treename        TEXT    PRIMARY KEY,
      treedescription TEXT,
      synced          INTEGER DEFAULT 0
    );
  `,
};

// ============== Test Data Generators ==============
interface TreeRow {
  treename: string;
  treedescription: string;
  synced: number;
}

interface MongoTree {
  _id?: ObjectId;
  scientificname: string;
  treedescription?: string;
}

function generateTestTrees(count: number = 10): TreeRow[] {
  const trees: TreeRow[] = [];
  const prefixes = ["Quercus", "Pinus", "Acer", "Fagus", "Carpinus", "Betula", "Tilia", "Ulmus", "Fraxinus", "Salix"];
  const species = ["robur", "alba", "nigra", "glandulosa", "sylvatica", "saxatilis", "americana", "canadensis", "excelsior", "vulgaris"];
  
  for (let i = 0; i < count; i++) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const speciesName = species[Math.floor(Math.random() * species.length)];
    const treename = `${prefix}_${speciesName}_${i}`;
    
    trees.push({
      treename: treename,
      treedescription: `Description for ${treename}. This is a test tree description.`,
      synced: 0
    });
  }
  return trees;
}

function generateMongoTrees(trees: TreeRow[]): MongoTree[] {
  return trees.map((tree, index) => ({
    scientificname: tree.treename,
    treedescription: `MongoDB description for ${tree.treename} - version ${index}`
  }));
}

function generateDuplicateTrees(trees: TreeRow[]): MongoTree[] {
  const duplicates: MongoTree[] = [];
  const selectedTrees = trees.slice(0, 3);
  
  for (const tree of selectedTrees) {
    for (let i = 0; i < 2; i++) {
      duplicates.push({
        scientificname: tree.treename,
        treedescription: `Duplicate description ${i} for ${tree.treename}`
      });
    }
  }
  return duplicates;
}

function generateMissingTrees(trees: TreeRow[]): MongoTree[] {
  const halfCount = Math.ceil(trees.length / 2);
  return trees.slice(0, halfCount).map((tree, index) => ({
    scientificname: tree.treename,
    treedescription: `MongoDB description for ${tree.treename}`
  }));
}

// ============== Database Setup ==============
class TestDatabase {
  private _db: Database | null = null;
  
  get db(): Database {
    if (!this._db) {
      throw new Error("Database not initialized");
    }
    return this._db;
  }
  
  constructor(sqlitePath: string) {
    this._db = new Database(sqlitePath);
  }
  
  setup(): void {
    this.db.exec("DROP TABLE IF EXISTS trees_table");
    this.db.exec(SCHEMAS.treesTable);
    console.log("✓ SQLite schema created");
  }
  
  insertTrees(trees: TreeRow[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO trees_table (treename, treedescription, synced) VALUES (?, ?, ?)"
    );
    
    for (const tree of trees) {
      stmt.run([tree.treename, tree.treedescription, tree.synced]);
    }
    console.log(`✓ Inserted ${trees.length} trees into SQLite`);
  }
  
  insertSyncedTrees(trees: TreeRow[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO trees_table (treename, treedescription, synced) VALUES (?, ?, ?)"
    );
    
    for (const tree of trees) {
      stmt.run([tree.treename, tree.treedescription, 1]);
    }
    console.log(`✓ Inserted ${trees.length} synced trees into SQLite`);
  }
  
  getTrees(): TreeRow[] {
    return this.db.prepare("SELECT * FROM trees_table").all() as TreeRow[];
  }
  
  getUnsyncedTrees(): TreeRow[] {
    return this.db.prepare("SELECT * FROM trees_table WHERE synced != 1").all() as TreeRow[];
  }
  
  getTreeCount(): number {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM trees_table").get() as { count: number };
    return result.count;
  }
  
  getSyncedTreeCount(): number {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM trees_table WHERE synced = 1").get() as { count: number };
    return result.count;
  }
  
  cleanup(): void {
    this._db?.close();
    try {
      Deno.removeSync(TEST_SQLITE_PATH);
    } catch {
      // File might not exist
    }
  }
}

class TestMongoDB {
  private client: MongoClient | null = null;
  private collection: Collection<Document> | null = null;
  
  getCollection(): Collection<Document> {
    if (!this.collection) {
      throw new Error("MongoDB collection not initialized");
    }
    return this.collection;
  }
  
  async connect(): Promise<void> {
    this.client = new MongoClient(TEST_MONGO_URI);
    await this.client.connect();
    this.collection = this.client.db(TEST_DB_NAME).collection(TEST_COLLECTION_NAME);
    
    try {
      await this.collection.drop();
    } catch {
      // Collection might not exist
    }
    console.log("✓ MongoDB connected and collection prepared");
  }
  
  async insertTrees(trees: MongoTree[]): Promise<void> {
    await this.collection!.insertMany(trees);
    console.log(`✓ Inserted ${trees.length} trees into MongoDB`);
  }
  
  async findTrees(filter: any): Promise<Document[]> {
    return this.collection!.find(filter).toArray();
  }
  
  async findOneTree(filter: any): Promise<Document | null> {
    return this.collection!.findOne(filter);
  }
  
  async getCollectionCount(): Promise<number> {
    return this.collection!.countDocuments();
  }
  
  async dropCollection(): Promise<void> {
    await this.collection!.drop();
  }
  
  async cleanup(): Promise<void> {
    await this.client!.close();
  }
}

async function runUpdateScript(
  sqlitePath: string,
  mongoUri: string,
  dbName: string,
  collectionName: string
): Promise<{ success: boolean; output: string; exitCode: number }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", UPDATE_SCRIPT_PATH],
    env: {
      "SQLITE_PATH": sqlitePath,
      "MONGO_URI": mongoUri,
      "DB_NAME": dbName,
      "COLLECTION_NAME": collectionName,
    },
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  const output = new TextDecoder().decode(stdout);
  const errorOutput = new TextDecoder().decode(stderr);

  return {
    success: code === 0,
    output: output + (errorOutput ? "\n" + errorOutput : ""),
    exitCode: code,
  };
}

// ============== Test Suites ==============

Deno.test("[DATABASE SETUP] Create SQLite database", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  
  const count = db.getTreeCount();
  assertStrictEquals(count, 0, `Expected 0 trees, got ${count}`);
  
  db.cleanup();
});

Deno.test("[DATABASE SETUP] Insert trees into SQLite", async () => {
  const trees = generateTestTrees(5);
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  db.insertTrees(trees);
  
  const allTrees = db.getTrees();
  assertStrictEquals(allTrees.length, 5, `Expected 5 trees, got ${allTrees.length}`);
  
  const unsynced = db.getUnsyncedTrees();
  assertStrictEquals(unsynced.length, 5, `Expected 5 unsynced trees, got ${unsynced.length}`);
  
  db.cleanup();
});

Deno.test("[DATABASE SETUP] Insert synced trees into SQLite", async () => {
  const trees = generateTestTrees(3);
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  db.insertSyncedTrees(trees);
  
  const unsynced = db.getUnsyncedTrees();
  assertStrictEquals(unsynced.length, 0, `Expected 0 unsynced trees, got ${unsynced.length}`);
  
  db.cleanup();
});

Deno.test({ name: "[DATABASE SETUP] Connect to MongoDB", ignore: SKIP_MONGO_TESTS }, async () => {
  const mongo = new TestMongoDB();
  await mongo.connect();
  assert(true, "MongoDB connection successful");
  await mongo.cleanup();
});

Deno.test({ name: "[DATABASE SETUP] Insert trees into MongoDB", ignore: SKIP_MONGO_TESTS }, async () => {
  const mongo = new TestMongoDB();
  await mongo.connect();
  
  const trees = generateTestTrees(5);
  await mongo.insertTrees(generateMongoTrees(trees));
  
  const count = await mongo.getCollectionCount();
  assertStrictEquals(count, 5, "Expected 5 trees in MongoDB");
  
  await mongo.cleanup();
});

Deno.test({ name: "[MIGRATION] Basic migration from SQLite to MongoDB", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();
  
  await mongo.connect();
  db.setup();
  
  const sqliteTrees = generateTestTrees(5);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateMongoTrees(sqliteTrees));
  
  const collection = mongo.getCollection();
  const rows = db.getUnsyncedTrees();
  const treenames = rows.map(r => r.treename);
  const mongoTrees = await collection.find({ scientificname: { $in: treenames } }).toArray();
  const mongoTreeMap = new Map<string, Document[]>();
  
  for (const tree of mongoTrees) {
    const existing = mongoTreeMap.get(tree.scientificname) || [];
    existing.push(tree);
    mongoTreeMap.set(tree.scientificname, existing);
  }
  
  const updates: { treename: string; treedescription: string }[] = [];
  
  for (const row of rows) {
    const matches = mongoTreeMap.get(row.treename);
    if (matches && matches.length === 1) {
      updates.push({ treename: row.treename, treedescription: row.treedescription });
    }
  }
  
  assertStrictEquals(updates.length, 5, "Expected 5 updates");
  
  const updateNames = updates.map(u => u.treename);
  for (const tree of sqliteTrees) {
    assert(updateNames.includes(tree.treename), `Tree ${tree.treename} not in updates`);
  }
  
  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[MIGRATION] Skip already synced trees", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();
  
  await mongo.connect();
  db.setup();
  
  const sqliteTrees = generateTestTrees(5);
  db.insertSyncedTrees(sqliteTrees);
  await mongo.insertTrees(generateMongoTrees(sqliteTrees));
  
  const rows = db.getUnsyncedTrees();
  assertStrictEquals(rows.length, 0, "Expected 0 unsynced trees");
  
  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[MIGRATION] Handle missing trees in MongoDB", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();
  
  await mongo.connect();
  db.setup();
  
  const sqliteTrees = generateTestTrees(10);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateMissingTrees(sqliteTrees));
  
  const rows = db.getUnsyncedTrees();
  const treenames = rows.map(r => r.treename);
  const mongoTrees = await mongo.getCollection().find({ scientificname: { $in: treenames } }).toArray();
  
  const foundCount = mongoTrees.length;
  const missingCount = treenames.length - foundCount;
  
  assert(missingCount > 0, "Expected some missing trees");
  
  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[MIGRATION] Handle duplicate trees in MongoDB", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();
  
  await mongo.connect();
  db.setup();
  
  const sqliteTrees = generateTestTrees(5);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateDuplicateTrees(sqliteTrees));
  
  const rows = db.getUnsyncedTrees();
  const treenames = rows.map(r => r.treename);
  const mongoTrees = await mongo.getCollection().find({ scientificname: { $in: treenames } }).toArray();
  
  const mongoTreeMap = new Map<string, Document[]>();
  for (const tree of mongoTrees) {
    const existing = mongoTreeMap.get(tree.scientificname) || [];
    existing.push(tree);
    mongoTreeMap.set(tree.scientificname, existing);
  }
  
  const duplicateCount = Array.from(mongoTreeMap.values()).filter(arr => arr.length > 1).length;
  assert(duplicateCount > 0, "Expected some duplicate trees");
  
  db.cleanup();
  await mongo.cleanup();
});

Deno.test("[EDGE CASE] Empty database", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  
  const rows = db.getUnsyncedTrees();
  assertStrictEquals(rows.length, 0, "Expected empty result set");
  
  db.cleanup();
});

Deno.test("[EDGE CASE] Special characters in tree names", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  
  const specialTrees: TreeRow[] = [
    { treename: "Quercus_robur_123", treedescription: "Test description", synced: 0 },
    { treename: "Quercus.robur.test", treedescription: "Test with dots", synced: 0 },
    { treename: "Quercus robur", treedescription: "Test with spaces", synced: 0 },
  ];
  db.insertTrees(specialTrees);
  
  const rows = db.getUnsyncedTrees();
  assertStrictEquals(rows.length, 3, "Expected 3 trees with special characters");
  
  db.cleanup();
});

Deno.test("[EDGE CASE] Very long descriptions", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  
  const longDescription = "A".repeat(10000);
  const trees: TreeRow[] = [
    { treename: "Quercus_long", treedescription: longDescription, synced: 0 },
  ];
  db.insertTrees(trees);
  
  const rows = db.getUnsyncedTrees();
  assertStrictEquals(rows[0].treedescription.length, 10000, "Expected 10000 character description");
  
  db.cleanup();
});

Deno.test("[EDGE CASE] Unicode characters in names and descriptions", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  
  const unicodeTrees: TreeRow[] = [
    { treename: "Quercus_αβγ", treedescription: "希腊字母描述", synced: 0 },
    { treename: "Pinus_中文", treedescription: "中文描述", synced: 0 },
    { treename: "Acer_🌲", treedescription: "Emoji test 🌳", synced: 0 },
  ];
  db.insertTrees(unicodeTrees);
  
  const rows = db.getUnsyncedTrees();
  assertStrictEquals(rows.length, 3, "Expected 3 unicode trees");
  
  db.cleanup();
});

Deno.test("[EDGE CASE] Null/empty descriptions", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  
  const trees: TreeRow[] = [
    { treename: "Quercus_empty", treedescription: "", synced: 0 },
    { treename: "Pinus_null", treedescription: null as any as string, synced: 0 },
  ];
  db.insertTrees(trees);
  
  const rows = db.getUnsyncedTrees();
  assertStrictEquals(rows.length, 2, "Expected 2 trees with empty/null descriptions");
  
  db.cleanup();
});

Deno.test({ name: "[INTEGRATION] Full migration workflow with all scenarios", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();
  
  await mongo.connect();
  db.setup();
  
  const allSqliteTrees = generateTestTrees(23);
  
  const toSync = allSqliteTrees.slice(0, 8);
  const alreadySynced = allSqliteTrees.slice(8, 13);
  const missingInMongo = allSqliteTrees.slice(13, 23);
  
  db.insertTrees(toSync);
  db.insertTrees(missingInMongo);
  db.insertSyncedTrees(alreadySynced);
  
  const matchingMongoTrees = generateMongoTrees(toSync);
  await mongo.insertTrees(matchingMongoTrees);
  
  const unsyncedBefore = db.getUnsyncedTrees();
  assertStrictEquals(unsyncedBefore.length, 18, "Expected 18 unsynced trees (8 syncable + 10 missing)");
  
  const syncedBefore = db.getSyncedTreeCount();
  assertStrictEquals(syncedBefore, 5, "Expected 5 synced trees");
  
  const collection = mongo.getCollection();
  const rows = db.getUnsyncedTrees();
  const treenames = rows.map(r => r.treename);
  const mongoTrees = await collection.find({ scientificname: { $in: treenames } }).toArray();
  const mongoTreeMap = new Map<string, Document[]>();
  
  for (const tree of mongoTrees) {
    const existing = mongoTreeMap.get(tree.scientificname) || [];
    existing.push(tree);
    mongoTreeMap.set(tree.scientificname, existing);
  }
  
  const updates: string[] = [];
  const missing: string[] = [];
  const duplicates: string[] = [];
  
  for (const row of rows) {
    const matches = mongoTreeMap.get(row.treename);
    if (!matches || matches.length === 0) {
      missing.push(row.treename);
    } else if (matches.length > 1) {
      duplicates.push(row.treename);
    } else {
      updates.push(row.treename);
    }
  }
  
  assertStrictEquals(updates.length, 8, "Expected 8 trees to sync");
  assertStrictEquals(missing.length, 10, "Expected 10 missing trees");
  assertStrictEquals(duplicates.length, 0, "Expected 0 duplicates");
  
  for (const treename of updates) {
    const stmt = db.db.prepare("UPDATE trees_table SET synced = 1 WHERE treename = ?");
    stmt.run([treename]);
  }
  
  const unsyncedAfter = db.getUnsyncedTrees();
  assertStrictEquals(unsyncedAfter.length, 10, "Expected 10 remaining unsynced (missing ones)");
  
  const syncedAfter = db.getSyncedTreeCount();
  assertStrictEquals(syncedAfter, 13, "Expected 13 synced trees (5 original + 8 updated)");
  
  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[INTEGRATION] Statistics tracking", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();
  
  await mongo.connect();
  db.setup();
  
  const allTrees = generateTestTrees(20);
  const syncable = allTrees.slice(0, 8);
  const missing = allTrees.slice(8, 18);
  const duplicateBase = allTrees.slice(18, 20);
  
  db.insertTrees(syncable);
  db.insertTrees(missing);
  db.insertTrees(duplicateBase);
  
  const mongoTrees: Document[] = [];
  mongoTrees.push(...generateMongoTrees(syncable));
  mongoTrees.push(...generateMongoTrees(missing.slice(0, 4)));
  
  for (const tree of duplicateBase) {
    mongoTrees.push({ scientificname: tree.treename, treedescription: `Duplicate 1` });
    mongoTrees.push({ scientificname: tree.treename, treedescription: `Duplicate 2` });
  }
  
  await mongo.insertTrees(mongoTrees as MongoTree[]);
  
  const collection = mongo.getCollection();
  const rows = db.getUnsyncedTrees();
  const treenames = rows.map(r => r.treename);
  const mongoTreesFound = await collection.find({ scientificname: { $in: treenames } }).toArray();
  
  const mongoTreeMap = new Map<string, Document[]>();
  for (const tree of mongoTreesFound) {
    const existing = mongoTreeMap.get(tree.scientificname) || [];
    existing.push(tree);
    mongoTreeMap.set(tree.scientificname, existing);
  }
  
  const stats = {
    successCount: 0,
    errorCount: 0,
    missingCount: 0,
    duplicateCount: 0,
    alreadySyncedCount: 0
  };
  
  const updates: string[] = [];
  
  for (const row of rows) {
    const matches = mongoTreeMap.get(row.treename);
    if (!matches || matches.length === 0) {
      stats.missingCount++;
    } else if (matches.length > 1) {
      stats.duplicateCount++;
    } else {
      updates.push(row.treename);
    }
  }
  
  stats.successCount = updates.length;
  
  for (const treename of updates) {
    const stmt = db.db.prepare("UPDATE trees_table SET synced = 1 WHERE treename = ?");
    stmt.run([treename]);
  }
  
  assertStrictEquals(stats.successCount, 12, "Expected 12 successful updates");
  assertStrictEquals(stats.missingCount, 6, "Expected 6 missing trees");
  assertStrictEquals(stats.duplicateCount, 2, "Expected 2 duplicate trees");
  
  db.cleanup();
  await mongo.cleanup();
});

Deno.test("[CLEANUP] SQLite database cleanup", async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  db.setup();
  db.insertTrees(generateTestTrees(5));
  
  const countBefore = db.getTreeCount();
  db.cleanup();
  
  const db2 = new TestDatabase(TEST_SQLITE_PATH);
  db2.setup();
  const countAfter = db2.getTreeCount();
  db2.cleanup();
  
  assert(countBefore > 0, "Expected trees before cleanup");
  assert(countAfter === 0, "Expected empty database after cleanup");
});

Deno.test({ name: "[CLEANUP] MongoDB cleanup", ignore: true }, async () => {
  const mongo = new TestMongoDB();
  await mongo.connect();
  
  const trees = generateTestTrees(5);
  await mongo.insertTrees(generateMongoTrees(trees));
  
  const countBefore = await mongo.getCollectionCount();
  await mongo.dropCollection();
  
  const countAfter = await mongo.getCollectionCount();
  
  await mongo.cleanup();
  
  assertStrictEquals(countBefore, 5, "Expected 5 trees before drop");
  assertStrictEquals(countAfter, 0, "Expected 0 trees after drop");
});



// Export for use as a module
export { TestDatabase, TestMongoDB, generateTestTrees, generateMongoTrees };
export type { TreeRow, MongoTree };

// ============== Script Execution Tests ==============

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts on empty database", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);
  assert(result.output.includes("No trees to migrate"), "Expected 'No trees to migrate' message");

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts with trees to migrate", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const sqliteTrees = generateTestTrees(5);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateMongoTrees(sqliteTrees));

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);
  assert(result.output.includes("[Success]"), "Expected success message");

  const syncedAfter = db.getSyncedTreeCount();
  assertStrictEquals(syncedAfter, 5, `Expected 5 synced trees, got ${syncedAfter}`);

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts skips already synced trees", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const sqliteTrees = generateTestTrees(3);
  db.insertSyncedTrees(sqliteTrees);

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);

  const syncedAfter = db.getSyncedTreeCount();
  assertStrictEquals(syncedAfter, 3, "Expected 3 synced trees (unchanged)");

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts handles missing MongoDB entries", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const sqliteTrees = generateTestTrees(10);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateMissingTrees(sqliteTrees));

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);
  assert(result.output.includes("[Missing]"), "Expected missing entries message");

  const syncedAfter = db.getSyncedTreeCount();
  const expectedSynced = Math.ceil(10 / 2);
  assertStrictEquals(syncedAfter, expectedSynced, `Expected ${expectedSynced} synced trees`);

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts handles duplicate MongoDB entries", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const sqliteTrees = generateTestTrees(5);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateDuplicateTrees(sqliteTrees));

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);
  assert(result.output.includes("[Duplicate]"), "Expected duplicate entries message");

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts updates MongoDB with correct descriptions", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const sqliteTrees = generateTestTrees(3);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateMongoTrees(sqliteTrees));

  await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  for (const tree of sqliteTrees) {
    const mongoDoc = await mongo.findOneTree({ scientificname: tree.treename });
    assert(mongoDoc, `Tree ${tree.treename} not found in MongoDB`);
    assertStrictEquals(
      mongoDoc.treedescription,
      tree.treedescription,
      `Description mismatch for ${tree.treename}`
    );
  }

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts handles unicode characters", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const unicodeTrees: TreeRow[] = [
    { treename: "Quercus_αβγ", treedescription: "希腊字母描述", synced: 0 },
    { treename: "Pinus_中文", treedescription: "中文描述", synced: 0 },
    { treename: "Acer_🌲", treedescription: "Emoji test 🌳", synced: 0 },
  ];
  db.insertTrees(unicodeTrees);

  const mongoTrees = unicodeTrees.map((tree, index) => ({
    scientificname: tree.treename,
    treedescription: `Initial ${index}`,
  }));
  await mongo.insertTrees(mongoTrees);

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);

  const syncedAfter = db.getSyncedTreeCount();
  assertStrictEquals(syncedAfter, 3, "Expected 3 synced unicode trees");

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts with mixed scenario (sync, skip, missing)", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const allTrees = generateTestTrees(15);
  const toSync = allTrees.slice(0, 5);
  const alreadySynced = allTrees.slice(5, 8);
  const missingInMongo = allTrees.slice(8, 15);

  db.insertTrees(toSync);
  db.insertSyncedTrees(alreadySynced);
  db.insertTrees(missingInMongo);

  await mongo.insertTrees(generateMongoTrees(toSync));

  const result = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );

  assert(result.success, `Script failed: ${result.output}`);
  assert(result.output.includes("[Missing]"), "Expected missing entries message");

  const syncedAfter = db.getSyncedTreeCount();
  const expectedSynced = 8 + 5;
  assertStrictEquals(syncedAfter, expectedSynced, `Expected ${expectedSynced} synced trees`);

  db.cleanup();
  await mongo.cleanup();
});

Deno.test({ name: "[SCRIPT] Run update_descriptions.ts twice is idempotent", ignore: SKIP_MONGO_TESTS }, async () => {
  const db = new TestDatabase(TEST_SQLITE_PATH);
  const mongo = new TestMongoDB();

  await mongo.connect();
  db.setup();

  const sqliteTrees = generateTestTrees(5);
  db.insertTrees(sqliteTrees);
  await mongo.insertTrees(generateMongoTrees(sqliteTrees));

  const result1 = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );
  assert(result1.success, `First run failed: ${result1.output}`);

  const syncedAfterFirst = db.getSyncedTreeCount();
  assertStrictEquals(syncedAfterFirst, 5, "Expected 5 synced after first run");

  const result2 = await runUpdateScript(
    TEST_SQLITE_PATH,
    TEST_MONGO_URI,
    TEST_DB_NAME,
    TEST_COLLECTION_NAME
  );
  assert(result2.success, `Second run failed: ${result2.output}`);

  const syncedAfterSecond = db.getSyncedTreeCount();
  assertStrictEquals(syncedAfterSecond, 5, "Expected 5 synced after second run (no changes)");

  db.cleanup();
  await mongo.cleanup();
});
