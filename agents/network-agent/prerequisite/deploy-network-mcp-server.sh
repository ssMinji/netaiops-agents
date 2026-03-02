#!/usr/bin/env bash
set -euo pipefail

# Deploy the AWS Network MCP Server to AgentCore and store its ARN in SSM.
# Usage: ./deploy-network-mcp-server.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/network-mcp-server"

echo "=== Deploying AWS Network MCP Server to AgentCore ==="
agentcore deploy

# Get the runtime ARN from the deployment output
RUNTIME_ARN=$(agentcore describe --output json | jq -r '.runtime_arn')

if [ -z "$RUNTIME_ARN" ] || [ "$RUNTIME_ARN" = "null" ]; then
    echo "ERROR: Failed to get runtime ARN from agentcore describe"
    exit 1
fi

echo "Network MCP Server ARN: $RUNTIME_ARN"

# Store ARN in SSM
aws ssm put-parameter \
    --name "/app/network/agentcore/network_mcp_server_arn" \
    --value "$RUNTIME_ARN" \
    --type String \
    --overwrite

echo "=== Stored ARN in SSM: /app/network/agentcore/network_mcp_server_arn ==="
echo "Done!"
