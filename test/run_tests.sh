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
    echo -n "Checking MongoDB connection... "
    if mongosh --eval "db.adminCommand('ping')" --quiet 2>/dev/null; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗${NC}"
        echo ""
        echo "MongoDB is not available. Starting MongoDB..."
        echo ""
        
        # Try to start MongoDB
        if command -v mongod &> /dev/null; then
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
        exit 1
    fi
}

# Parse arguments
MONGO_ONLY=false
FILTER=""

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
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--only-mongo] [--filter \"test-name\"]"
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

# Run tests
if [ -n "$FILTER" ]; then
    deno test --allow-all $FILTER test/test_harness.ts
else
    deno test --allow-all test/test_harness.ts
fi

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
else
    echo -e "${RED}Some tests failed!${NC}"
fi

exit $EXIT_CODE
