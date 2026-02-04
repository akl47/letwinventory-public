#!/bin/bash
set -e

# Get version from frontend/package.json
VERSION=$(node -p "require('./frontend/package.json').version")

if [ -z "$VERSION" ]; then
    echo "Error: Could not read version from frontend/package.json"
    exit 1
fi

IMAGE="akl47/letwinventory"

echo "Building $IMAGE:$VERSION and $IMAGE:latest..."

docker build \
    -t "$IMAGE:$VERSION" \
    -t "$IMAGE:latest" \
    -f backend/Dockerfile.prod .

echo "Pushing $IMAGE:$VERSION..."
docker push "$IMAGE:$VERSION"

echo "Pushing $IMAGE:latest..."
docker push "$IMAGE:latest"

echo "Done! Deployed version $VERSION"
