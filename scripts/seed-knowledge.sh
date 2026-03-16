#!/bin/sh
# Seed OpenViking knowledge base with OpenClaw docs
# Usage: seed-knowledge.sh <docs_directory>

DOCS_DIR="${1:?Usage: seed-knowledge.sh <docs_dir>}"
OV_URL="http://localhost:2033/mcp"
MAX_RETRIES=3

# Check OpenViking is reachable (406 = running but needs SSE header, that's fine)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$OV_URL" 2>/dev/null || echo "000")
if [ "$STATUS" = "000" ]; then
  echo "[seed] OpenViking MCP server not reachable at $OV_URL"
  exit 1
fi

# Find all .md files and add them one by one
count=0
failed=0
find "$DOCS_DIR" -name "*.md" -type f | while read -r file; do
  echo "[seed] Adding: $file"
  
  # MCP tools/call for add_resource
  PAYLOAD=$(python3 -c "
import json
print(json.dumps({
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'tools/call',
    'params': {
        'name': 'add_resource',
        'arguments': {'path': '$file'}
    }
}))
")
  
  RESP=$(curl -sf -N --max-time 120 \
    -X POST "$OV_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d "$PAYLOAD" 2>/dev/null || true)
  
  if echo "$RESP" | grep -q "error"; then
    echo "[seed] WARNING: Failed to add $file"
    failed=$((failed + 1))
  else
    count=$((count + 1))
  fi
done

echo "[seed] Done. Added files from $DOCS_DIR"
exit 0
