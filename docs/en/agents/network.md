# Network Diagnostics Agent

## Purpose

AWS network infrastructure analysis covering VPC topology, DNS resolution, Route 53 health checks, VPC Flow Logs, and load balancer metrics. The Network Agent integrates the AWS Network MCP Server with custom Lambda tools for comprehensive network diagnostics.

## Location

```
agents/network-agent/
├── agent/                         # Agent runtime
└── prerequisite/
    ├── network-mcp-server/        # AWS Network MCP Server runtime
    ├── lambda-dns/                # Route 53 operations Lambda
    ├── lambda-network-metrics/    # CloudWatch network metrics Lambda
    └── deploy-network-mcp-server.sh
```

## MCP Tools

### AWS Network MCP Server (~27 tools)
Comprehensive AWS networking operations:
- VPC topology and connectivity analysis
- Transit Gateway routing inspection
- Cloud WAN diagnostics
- Network Firewall policy analysis
- VPN Site-to-Site troubleshooting
- Security Group and NACL review

### DNS Tools (Lambda)
- `dns-list-hosted-zones` - List Route 53 hosted zones
- `dns-query-records` - Query DNS records in a zone
- `dns-check-health` - Check Route 53 health check status
- `dns-resolve` - Resolve DNS names using public resolvers

### Network Metrics Tools (Lambda)
- `network-list-load-balancers` - List ALB/NLB with details
- `network-list-instances` - List EC2 instances with network info
- `network-get-metrics` - CloudWatch metrics for network resources
- `network-get-flow-logs` - VPC Flow Log analysis

## Scenarios

| Scenario | Description |
|----------|-------------|
| DNS Diagnostics | Validate DNS resolution, check Route 53 health |
| VPC Configuration Analysis | Review VPC topology, subnets, route tables |
| Flow Logs Analysis | Analyze VPC Flow Logs for rejected/accepted traffic |
| Load Balancer Metrics | ALB/NLB health, request counts, error rates |

## AWS Service Permissions

| Component | Required AWS Services | Notes |
|-----------|----------------------|-------|
| **Agent Runtime** | Bedrock, SSM, CloudWatch, EC2/VPC (basic) | Gateway execution role |
| **Network MCP Server** | EC2/VPC (extended), Transit Gateway, Network Firewall, VPN, Network Manager | MCP Server runtime role — handles ~27 networking tools |
| **Lambda (DNS)** | Route 53 (read-only) | Lambda execution role |
| **Lambda (Metrics)** | CloudWatch, EC2, ELB | Lambda execution role |

The agent runtime itself has basic EC2/VPC describe permissions, but the majority of network inspection capabilities come from the **Network MCP Server runtime**, which holds the extended VPC, Transit Gateway, and Network Firewall permissions.

## Prerequisites

### Network MCP Server

Deploy the AWS Network MCP Server as an AgentCore runtime:

```bash
cd agents/network-agent/prerequisite
./deploy-network-mcp-server.sh
```

Uses the `awslabs.aws-network-mcp-server` package (version `0.0.x`).

### Lambda Functions

DNS and Network Metrics Lambda functions are deployed via CDK as Docker-based Lambda functions:

```bash
cd infra-cdk
npx cdk deploy NetworkAgentLambdaStack --profile netaiops-deploy
```
