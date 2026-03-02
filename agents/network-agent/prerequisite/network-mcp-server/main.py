"""
AWS Network MCP Server - AgentCore Runtime Wrapper

Wraps the official AWS Labs aws-network-mcp-server (awslabs.aws-network-mcp-server)
and runs it with Streamable HTTP transport so it can be registered
as an MCP Gateway target via the mcpServer endpoint type.
"""

import argparse
import logging
import os

import boto3

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    # Override AgentCore's default region
    target_region = os.environ.get("NETWORK_MCP_DEFAULT_REGION", "ap-northeast-2")
    os.environ['AWS_REGION'] = target_region
    os.environ['AWS_DEFAULT_REGION'] = target_region
    boto3.setup_default_session(region_name=target_region)
    logger.info(f"Default AWS region set to {target_region}")

    parser = argparse.ArgumentParser(description="AWS Network MCP Server for AgentCore")
    parser.add_argument(
        "--allow-write",
        action="store_true",
        default=os.environ.get("NETWORK_MCP_ALLOW_WRITE", "false").lower() == "true",
        help="Enable mutating operations",
    )
    args = parser.parse_args()

    logger.info(f"Starting AWS Network MCP Server (write={args.allow_write})")

    # Import the pre-configured awslabs network MCP server instance
    from awslabs.aws_network_mcp_server.server import mcp

    # Run with Streamable HTTP transport for Gateway integration
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
