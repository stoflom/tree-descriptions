#!/bin/bash

# Test runner script for SQLite/MongoDB synchronization tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "   SQLite/MongoDB Test Runner"
echo "========================================"
echo ""

# Check if MongoDB is available
check_mongodb() {
  if [ -n "$MONGO_URI" ]; then
    echo -e "${YELLOW}Using provided MongoDB URI: $MONGO_URI${NC}"
    echo -e "${YELLOW}Skipping connectivity check (trusting provided URI)${NC}"
    return 0
  fi

  echo -n "Checking MongoDB connection... "

  if mongosh --eval "db.adminCommand('ping')" --quiet 2>/dev/null; then
    echo -e "${GREEN}✓${NC}"
    return 0
  fi

  echo -e "${RED}✗${NC}"
  echo ""
  echo "MongoDB is not available. Starting MongoDB..."
  echo ""

  if command -v mongod &>/dev/null; then
    mkdir -p /tmp/mongodb-data
    mongod --dbpath /tmp/mongodb-data --port 27017 --fork --logpath /tmp/mongodb.log &
    sleep 2

    if mongosh --eval "db.adminCommand('ping')" --quiet 2>/dev/null; then
      echo -e "${GREEN}MongoDB started successfully${NC}"
      MONGO_STARTED=true
      return 0
    fi
  fi

  echo ""
  echo -e "${YELLOW}MongoDB could not be started automatically.${NC}"
  echo "Please start MongoDB manually and run the tests again."
  echo ""
  echo "Option 1: Start with mongod"
  echo "  mongod --dbpath /data/db --port 27017"
  echo ""
  echo "Option 2: Use Docker"
  echo "  docker run -d -p 27017:27017 --name test-mongo mongo:latest"
  echo ""
  echo "Option 3: Provide connection string via --mongo-uri flag"
  echo "  $0 --mongo-uri \"mongodb://localhost:27017/test\""
  exit 1
}

# Parse arguments
MONGO_ONLY=false
FILTER=""
MONGO_URI=""

while [[ $# -gt 0 ]]; do
  case $1 in
  --only-mongo)
    MONGO_ONLY=true
    shift
    ;;
  --filter)
    FILTER="--filter \"$2\""
    shift 2
    ;;
  --mongo-uri)
    MONGO_URI="$2"
    shift 2
    ;;
  --mongo)
    MONGO_URI="$2"
    shift 2
    ;;
  -h | --help)
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --mongo-uri <uri>   MongoDB connection string (required for MongoDB tests)"
    echo "  --only-mongo        Run only MongoDB-related tests"
    echo "  --filter <name>     Filter tests by name"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  MONGO_TEST_URI      MongoDB connection string (alternative to --mongo-uri)"
    exit 0
    ;;
  *)
    echo "Unknown option: $1"
    echo "Usage: $0 [--mongo-uri <uri>] [--only-mongo] [--filter \"test-name\"]"
    echo "Run '$0 --help' for more information."
    exit 1
    ;;
  esac
done

# Check MongoDB if not skipping
if [ "$MONGO_ONLY" = false ]; then
  check_mongodb
fi

echo ""
echo "Running tests..."
echo ""

# Export MongoDB URI if provided
if [ -n "$MONGO_URI" ]; then
  export MONGO_TEST_URI="$MONGO_URI"
  echo "Using MongoDB URI: $MONGO_URI"
  echo ""
fi

# Run tests
if [ -n "$FILTER" ]; then
  MONGO_TEST_URI="$MONGO_URI" deno test --allow-all $FILTER test/test_harness.ts
else
  MONGO_TEST_URI="$MONGO_URI" deno test --allow-all test/test_harness.ts
fi

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
else
  echo -e "${RED}Some tests failed!${NC}"
fi

exit $EXIT_CODE
