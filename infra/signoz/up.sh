#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_NAME="signoz-backend"

echo "🔧 Ensuring shared network '${NETWORK_NAME}' exists..."
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  docker network create "${NETWORK_NAME}"
  echo "✅ Created network '${NETWORK_NAME}'."
else
  echo "ℹ️ Network '${NETWORK_NAME}' already exists."
fi

cd "${SCRIPT_DIR}"
echo "🚀 Starting SigNoz stack..."
docker compose up -d "$@"
