# Tree Description Migration

Migrates tree descriptions from SQLite to MongoDB using Deno.

## Setup

Deno is not required to be installed globally - it will download the required dependencies automatically.

## Configuration

Environment variables (with defaults for development):

| Variable | Default | Description |
|----------|---------|-------------|
| `SQLITE_PATH` | `./trees.db` | Path to SQLite database |
| `MONGO_URI` | `mongodb://192.168.0.8:27017/` | MongoDB connection URI |
| `DB_NAME` | `my_database` | MongoDB database name |
| `COLLECTION_NAME` | `treecols` | MongoDB collection name |

Or edit the constants in `update_descriptions.ts`.

## Usage

```bash
# Development (watch for changes)
deno task dev

# Production (run once)
deno task start
```

## How trees are matched

Trees are matched between SQLite and MongoDB using the **`scientificname`** field:

1. **Read from SQLite**: Fetches all rows from `trees_table` where `synced != 1`, retrieving `treename` and `treedescription`

2. **Query MongoDB**: Performs a single `$in` query on MongoDB's `scientificname` field to fetch all trees that match the SQLite `treename` values:
   ```javascript
   { scientificname: { $in: ["treename1", "treename2", ...] } }
   ```

3. **Build match map**: Groups MongoDB results by `scientificname` to detect duplicates

4. **Match validation**:
   - **Missing**: If a `treename` from SQLite has no matching `scientificname` in MongoDB → reported as missing
   - **Duplicate**: If a `treename` matches multiple documents in MongoDB (multiple `scientificname` values) → skipped to prevent data corruption
   - **Valid match**: If exactly one MongoDB document matches → the `treedescription` is updated

5. **Bulk update**: Updates the `treedescription` field in MongoDB using bulk write operations

6. **Mark as synced**: Sets `synced = 1` in SQLite for successfully updated trees

## Matching logic flow

```
SQLite (treename)    MongoDB (scientificname)
─────────────────    ───────────────────────
tree1        ──────→  tree1 (match, update)
tree2        ──────→  [no match] (missing)
tree3        ──────→  tree3a
                   →  tree3b (duplicate, skipped)
tree4        ──────→  tree4 (already has description)
```

## How it works

1. Reads rows from SQLite where `synced != 1`
2. Fetches all matching trees from MongoDB in a single query
3. Checks each tree exists and is unique (not duplicated)
4. Performs bulk update of `treedescription` field in MongoDB
5. Marks rows as synced in SQLite
6. Prints summary statistics

## Statistics

The migration reports:
- **Total Synced**: Number of trees successfully updated
- **Total Errors**: Number of failures during migration
- **Missing Trees**: Trees in SQLite not found in MongoDB
- **Duplicates**: Trees with multiple matches in MongoDB (skipped)

## Dependencies

- Deno: JavaScript/TypeScript runtime
- SQLite3: Local database (via `deno.land/x/sqlite3`)
- MongoDB: Remote database (via `npm:mongodb`)

## Database Schema

The SQLite database schema is defined in `trees.ddl`. This file contains all table definitions and should be used to initialize the SQLite database before running migrations.

## Testing

Run tests with:
```bash
# Run all tests (requires MongoDB)
./test/run_tests.sh --mongo-uri "mongodb://192.168.0.8:27017/test_my_database"

# Run SQLite-only tests (no MongoDB required)
./test/run_tests.sh --sqlite-only

# Run specific test filter
./test/run_tests.sh --mongo-uri "mongodb://192.168.0.8:27017/test_my_database" --filter "MIGRATION"

# Show help
./test/run_tests.sh --help

# Run with coverage (using Deno directly)
deno task test:coverage
deno task coverage:report
# Or generate HTML report
deno coverage --html coverage/html coverage/
```

### Script Validation Tests

The `[SCRIPT]` test suite runs the actual `update_descriptions.ts` script to verify correctness before running on production data. These tests:
- Execute the script in a subprocess with test environment variables
- Verify script output and exit codes
- Check that SQLite/MongoDB state changes are correct
- Validate idempotency (running twice produces same result)
