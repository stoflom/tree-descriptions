# Test Harness

Complete test harness for SQLite and MongoDB synchronization.

## Setup

### MongoDB Setup

Before running tests, ensure MongoDB is running:

```bash
# Start MongoDB locally
mongod --dbpath /data/db --port 27017

# Or use Docker
docker run -d -p 27017:27017 --name test-mongo mongo:latest
```

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

# Run only SQLite tests (skip MongoDB connectivity check)
./test/run_tests.sh --only-mongo

# Run specific test filter
./test/run_tests.sh --mongo-uri "mongodb://192.168.0.8:27017/test_my_database" --filter "MIGRATION"

# Show help
./test/run_tests.sh --help
```

### Using Deno Directly

```bash
# Run all tests (set MONGO_TEST_URI environment variable)
MONGO_TEST_URI="mongodb://192.168.0.8:27017/test_my_database" deno test --allow-all test/test_harness.ts
```

### Run with Coverage

```bash
deno test --allow-all --coverage=coverage test/test_harness.ts
deno coverage --uncovered coverage/coverage --lcov > coverage/lcov.info
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

## Test Results

The test runner outputs:

```
============================================================
                    TEST RUNNER
============================================================

[DATABASE SETUP TESTS]
  ✓ Setup: Create SQLite database
  ✓ Setup: Insert trees into SQLite
  ✓ Setup: Insert synced trees into SQLite
  ✓ Setup: Connect to MongoDB
  ✓ Setup: Insert trees into MongoDB

[MIGRATION TESTS]
  ✓ Migration: Basic migration from SQLite to MongoDB
  ✓ Migration: Skip already synced trees
  ✓ Migration: Handle missing trees in MongoDB
  ✓ Migration: Handle duplicate trees in MongoDB

...

============================================================
                   TEST SUMMARY
============================================================
Total Tests:  22
Passed:       22 ✓
Failed:       0 ✗
Duration:     1234ms
============================================================
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
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
      run: deno test --allow-all test/test_harness.ts
```

## License

MIT
