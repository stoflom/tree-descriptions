# Tree Description Migration

Migrates tree descriptions from SQLite to MongoDB.

## Setup

```bash
yarn install
```

## Configuration

Edit `update_descriptions.ts` to set:
- `SQLITE_PATH` - Path to SQLite database
- `MONGO_URI` - MongoDB connection URI
- `DB_NAME` - MongoDB database name
- `COLLECTION_NAME` - MongoDB collection name

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
2. For each row, checks if tree exists in MongoDB (unique match required)
3. Updates the `treedescription` field in MongoDB
4. Marks the row as synced in SQLite
5. Prints summary statistics
