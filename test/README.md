# Test Harness

Complete test harness for SQLite and MongoDB synchronization.

## Setup

### MongoDB Setup

Before running full tests, ensure MongoDB is running:

```bash
# Start MongoDB locally
mongod --dbpath /data/db --port 27017

# Or use Docker
docker run -d -p 27017:27017 --name test-mongo mongo:latest
```

**Note:** SQLite-only tests can run without MongoDB using `--sqlite-only` flag.

### Environment Variables (Optional)

```bash
export MONGO_TEST_URI="mongodb://192.168.0.8:27017/test_my_database"
```

Default: `mongodb://192.168.0.8:27017/test_my_database` (when using `--mongo-uri` flag or `MONGO_TEST_URI` env var)

## Running Tests

### Using the Test Runner Script

The easiest way to run tests is using the provided shell script:

```bash
# Run all tests with a specific MongoDB URI
./test/run_tests.sh --mongo-uri "mongodb://192.168.0.8:27017/test_my_database"

# Run tests with default MongoDB URI (from MONGO_TEST_URI env var)
./test/run_tests.sh

# Run SQLite-only tests (no MongoDB required)
./test/run_tests.sh --sqlite-only

# Run specific test filter
./test/run_tests.sh --mongo-uri "mongodb://192.168.0.8:27017/test_my_database" --filter "MIGRATION"

# Show help
./test/run_tests.sh --help
```

### Using Deno Directly

```bash
# Run all tests (set MONGO_TEST_URI environment variable)
MONGO_TEST_URI="mongodb://192.168.0.8:27017/test_my_database" deno test --allow-all test/test_harness.ts

# Run SQLite-only tests
SKIP_MONGO_TESTS="true" deno test --allow-all test/test_harness.ts
```

### Run with Coverage

```bash
deno test --allow-all --coverage=coverage test/test_harness.ts
deno task coverage:report
# Or generate HTML report
deno coverage --html coverage/html coverage/
```

### Run Specific Test Suite

The test harness organizes tests into suites. Run individual suites by filtering:

```bash
# Run only database setup tests
deno test --allow-all test/test_harness.ts --filter "DATABASE SETUP"

# Run only migration tests
deno test --allow-all test/test_harness.ts --filter "MIGRATION"

# Run only integration tests
deno test --allow-all test/test_harness.ts --filter "INTEGRATION"

# Run only script execution tests
deno test --allow-all test/test_harness.ts --filter "SCRIPT"
```

## Test Suites

### Database Setup Tests
- Create SQLite database
- Insert trees into SQLite
- Insert synced trees into SQLite
- Connect to MongoDB
- Insert trees into MongoDB

### Migration Tests
- Basic migration from SQLite to MongoDB
- Skip already synced trees
- Handle missing trees in MongoDB
- Handle duplicate trees in MongoDB

### Edge Case Tests
- Empty database
- Special characters in tree names
- Very long descriptions
- Unicode characters in names and descriptions
- Null/empty descriptions

### Integration Tests
- Full migration workflow with all scenarios
- Statistics tracking

### Script Execution Tests
- Run update_descriptions.ts on empty database
- Run update_descriptions.ts with trees to migrate
- Run update_descriptions.ts skips already synced trees
- Run update_descriptions.ts handles missing MongoDB entries
- Run update_descriptions.ts handles duplicate MongoDB entries
- Run update_descriptions.ts updates MongoDB with correct descriptions
- Run update_descriptions.ts handles unicode characters
- Run update_descriptions.ts with mixed scenario
- Run update_descriptions.ts twice is idempotent

### Cleanup Tests
- SQLite database cleanup
- MongoDB cleanup

## Test Fixtures

### Test Data Generation

```typescript
// Generate 10 random trees
const trees = generateTestTrees(10);

// Generate MongoDB trees from SQLite trees
const mongoTrees = generateMongoTrees(sqliteTrees);

// Generate duplicate trees
const duplicates = generateDuplicateTrees(sqliteTrees);

// Generate trees that will be "missing" in MongoDB
const missing = generateMissingTrees(sqliteTrees);
```

### Database Classes

```typescript
// SQLite test database
const db = new TestDatabase("./test_trees.db");
db.setup();
db.insertTrees(trees);
const count = db.getTreeCount();
db.cleanup();

// MongoDB test database
const mongo = new TestMongoDB();
await mongo.connect();
mongo.insertTrees(mongoTrees);
await mongo.cleanup();
```

### Script Execution Helper

The test harness includes a `runUpdateScript()` function that spawns the actual `update_descriptions.ts` script with test environment variables:

```typescript
const result = await runUpdateScript(
  sqlitePath,        // Test SQLite database path
  mongoUri,          // MongoDB connection URI
  dbName,            // MongoDB database name
  collectionName     // MongoDB collection name
);

console.log(result.success);    // true if exit code was 0
console.log(result.output);    // stdout + stderr
console.log(result.exitCode);  // exit code
```

This allows tests to verify the actual script behavior, not just the TypeScript logic.

## Test Results

The test runner outputs:

```
========================================
   SQLite/MongoDB Test Runner
========================================

Running tests...

Check test/test_harness.ts
running 27 tests from ./test/test_harness.ts
[DATABASE SETUP] Create SQLite database ... ok
[DATABASE SETUP] Insert trees into SQLite ... ok
[DATABASE SETUP] Insert synced trees into SQLite ... ok
[DATABASE SETUP] Connect to MongoDB ... ignored
[DATABASE SETUP] Insert trees into MongoDB ... ignored
[MIGRATION] Basic migration from SQLite to MongoDB ... ignored
...
[SCRIPT] Run update_descriptions.ts with trees to migrate ... ok
[SCRIPT] Run update_descriptions.ts skips already synced trees ... ok
...

ok | 9 passed | 0 failed | 18 ignored
All tests passed!
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# Full tests with MongoDB
test:
  runs-on: ubuntu-latest
  services:
    mongodb:
      image: mongo:latest
      ports:
        - 27017:27017
  steps:
    - uses: actions/checkout@v3
    - uses: denoland/setup-deno@v1
    - name: Run Tests
      run: ./test/run_tests.sh --mongo-uri "mongodb://localhost:27017/test_my_database"

# SQLite-only tests (no MongoDB required)
test-sqlite:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3
    - uses: denoland/setup-deno@v1
    - name: Run SQLite Tests
      run: ./test/run_tests.sh --sqlite-only
```


