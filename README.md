# Tree Description Migration

Migrates tree descriptions from SQLite to MongoDB.

## Setup

```bash
yarn install
```

## Configuration

Environment variables (with defaults for development):

| Variable | Default | Description |
|----------|---------|-------------|
| `SQLITE_PATH` | `./trees.db` | Path to SQLite database |
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection URI |
| `DB_NAME` | `my_database` | MongoDB database name |
| `COLLECTION_NAME` | `treecols` | MongoDB collection name |

Or edit the constants in `update_descriptions.ts`.

## Usage

```bash
# Development (run directly)
yarn dev

# Production
yarn build
yarn start
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
