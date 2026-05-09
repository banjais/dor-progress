#!/bin/bash

# Post-Deployment Health Check
# Verifies that the deployed application is reachable and returning a 200 OK status.

set -e

# Use APP_URL from environment or default to the production URL
TARGET_URL=${APP_URL:-"https://dor-progress.web.app"}

echo "--------------------------------------------------------"
echo "🔍 Starting Post-Deployment Health Check"
echo "🌍 Target: $TARGET_URL"
echo "--------------------------------------------------------"

# Perform a curl request to check the HTTP status code
STATUS_CODE=$(curl -s -L -o /dev/null -w "%{http_code}" "$TARGET_URL")

if [ "$STATUS_CODE" -eq 200 ]; then
  echo "✅ Primary URL is reachable."
  
  # Verify Service Worker availability
  SW_CODE=$(curl -s -L -o /dev/null -w "%{http_code}" "$TARGET_URL/sw.v2.js")
  if [ "$SW_CODE" -eq 200 ]; then
    echo "✅ Service Worker (sw.v2.js) is active."
    exit 0
  else
    echo "⚠️  Primary URL OK, but Service Worker returned $SW_CODE"
    exit 1
  fi
else
  echo "❌ Health check failed with status: $STATUS_CODE"
  exit 1
fi