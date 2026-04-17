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
deno run --allow-all --node-modules-dir=auto --watch update_descriptions.ts

# Production (run once)
deno run --allow-all --node-modules-dir=auto update_descriptions.ts

# Using npm scripts (if you have package.json)
npm run start
npm run dev
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

- SQLite3: Used for the local database (via `deno.land/x/sqlite3`)
- MongoDB: Used for the remote database (via `npm:mongodb`)

## Testing

Test scripts available:
- `test_deno_sqlite.ts` - Tests SQLite functionality
- `test_mongo.ts` - Tests MongoDB connection
- `populate_mongo.ts` - Populates MongoDB with test data
