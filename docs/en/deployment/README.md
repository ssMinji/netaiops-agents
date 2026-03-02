# Deployment Guide

## Prerequisites

- AWS CLI configured with `<AWS_PROFILE>` profile
- Node.js 18+ (for CDK)
- Python 3.12+ (for agents)
- AgentCore CLI (`agentcore` in PATH)
- Docker (for Lambda image builds)

## Deployment Overview

The full deployment follows 4 phases orchestrated by `deploy.sh`. For detailed commands, post-deployment checklist, and Web UI deployment, see [Build & Deploy](../infrastructure/build-deploy.md).

```
Phase 1: CDK Infrastructure  →  Cognito, IAM, Lambda, SSM, CloudWatch
Phase 2: EKS RBAC            →  ClusterRole/ClusterRoleBinding
Phase 3: MCP Server Runtimes →  EKS MCP Server, Network MCP Server
Phase 4: Agent Runtimes      →  agentcore deploy × 4 agents
```

## Generic AgentCore Deployment Pattern

Any AgentCore-based agent project follows this deployment sequence regardless of the number of agents:

```
1. Infrastructure (CDK/CloudFormation)  →  Auth, IAM, Tools, Configuration
2. Cluster Access (if needed)           →  RBAC for Kubernetes-based tools
3. MCP Server Runtimes (if needed)      →  Long-running tool servers
4. Agent Runtimes                       →  agentcore deploy per agent
```

**Key insight**: CDK/CloudFormation cannot manage AgentCore-specific resources (Gateway, Runtime, Credential Provider). These require the AgentCore CLI or boto3 API. Plan your deployment pipeline to handle both IaC and CLI steps.

### Placeholder ARN Problem

When an MCP Server runtime must exist before the CDK stack can reference it (e.g., as a Gateway target), but the CDK stack must exist first to create auth resources the MCP Server needs:

1. CDK creates a placeholder SSM parameter for the MCP Server ARN
2. MCP Server is deployed, actual ARN stored in SSM
3. CDK stack is redeployed to replace the placeholder with the real ARN

This circular dependency is inherent to any project where CDK-managed Gateways reference CLI-managed MCP Servers.

## Agent Dependencies

```
K8s Agent (independent)
    └── EKS MCP Server Runtime

Incident Agent (independent)
    └── 6 Lambda + SNS/Alarm
    └── EKS RBAC (for Chaos Lambda)

Istio Agent (depends on K8s Agent)
    └── K8s Agent's EKS MCP Server ARN reference
    └── Istio mesh + AMP/ADOT infrastructure

Network Agent (independent)
    └── Network MCP Server Runtime
    └── 2 Lambda (DNS, Network Metrics)
```

## CDK Stack Resources

| Stack | Resources Created |
|-------|------------------|
| **K8sAgentStack** | Cognito (Agent Pool + Runtime Pool), IAM Role, MCP Gateway (mcpServer target), Runtime config |
| **IncidentAgentStack** | Cognito, IAM Role, 6 Docker Lambda, MCP Gateway (Lambda targets), Runtime config, SNS + CloudWatch Alarms |
| **IstioAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |
| **NetworkAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |

## SSM Dependency and First Deploy Order

```
Phase 1 (CDK deploy --all)
│
├── K8sAgentStack
│   ├── CognitoAuth → SSM write: userpool_id, client_id, ...
│   ├── CognitoAuth(eks_mcp_) → SSM write: eks_mcp_client_id, ...
│   ├── Gateway → SSM read: eks_mcp_server_arn ← ★ placeholder at this point
│   │            SSM write: gateway_url, gateway_id, ...
│   └── Runtime → SSM write: runtime_arn, runtime_name
│
├── IncidentAgentStack
│   ├── CognitoAuth → SSM write
│   ├── Lambda x6 → SSM write: *_lambda_arn
│   ├── Gateway → SSM write: gateway_url, ...
│   ├── Runtime → SSM write: runtime_arn, ...
│   └── Monitoring → SSM write: sns_topic_arn
│
├── IstioAgentStack (after K8sAgentStack)
│   ├── CognitoAuth → SSM write
│   ├── Lambda x2 → SSM write: *_lambda_arn
│   ├── Gateway → SSM read: eks_mcp_server_arn, eks_mcp_client_id, ... ← K8s SSM
│   │            SSM write: gateway_url, ...
│   └── Runtime → SSM write: runtime_arn, ...
│
└── NetworkAgentStack
    ├── CognitoAuth → SSM write
    ├── Lambda x2 → SSM write: *_lambda_arn
    ├── Gateway → SSM write: gateway_url, ...
    └── Runtime → SSM write: runtime_arn, ...

Phase 2 (EKS RBAC)
│  RBAC only, no SSM involved

Phase 3 (MCP Server deploy)
│  SSM read: eks_mcp_cognito_* (JWT Authorizer config)
│  SSM write: eks_mcp_server_arn ← ★ replace with actual ARN
│
│  First deploy → redeploy K8sAgentStack (to use real ARN)

Phase 4 (Agent deploy)
│  Each agent reads gateway_url from SSM to connect to MCP Gateway
```

## Agent Configuration Pattern (.bedrock_agentcore.yaml)

When building your own agent, adapt these fields to match your Cognito pool and IAM configuration:

```yaml
default_agent: <agent_name>
agents:
  <agent_name>:
    platform: linux/arm64
    aws:
      account: '<ACCOUNT_ID>'
      region: us-east-1
      execution_role: arn:aws:iam::<ACCOUNT_ID>:role/...
      ecr_repository: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/...
    authorizer_configuration:
      customJWTAuthorizer:
        discoveryUrl: https://cognito-idp.us-east-1.amazonaws.com/...
        allowedClients: [<client_id>]
    identity:
      credential_providers:
        - name: <provider_name>
          type: cognito
```

## External Service Setup

### SSM Parameters (Incident Agent)

```bash
PROFILE="<AWS_PROFILE>"
REGION="us-east-1"

# Datadog (optional)
aws ssm put-parameter --name /app/incident/datadog/api_key --value "YOUR_KEY" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/datadog/app_key --value "YOUR_KEY" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/datadog/site --value "us5.datadoghq.com" --type String --profile $PROFILE --region $REGION

# OpenSearch (optional)
aws ssm put-parameter --name /app/incident/opensearch/endpoint --value "YOUR_ENDPOINT" --type String --profile $PROFILE --region $REGION

# GitHub (optional)
aws ssm put-parameter --name /app/incident/github/pat --value "YOUR_PAT" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/github/repo --value "owner/repo-name" --type String --profile $PROFILE --region $REGION
```

### GitHub Integration

```bash
cd agents/incident-agent/prerequisite
bash setup-github.sh
```

### CloudWatch Alarms (Manual)

CDK creates alarms automatically, but for manual setup:

```bash
cd agents/incident-agent/prerequisite
bash setup-alarms.sh
```

| Alarm | Condition |
|-------|-----------|
| `netaiops-cpu-spike` | Pod CPU > 80% (2/3 datapoints, 60s) |
| `netaiops-pod-restarts` | Container restarts > 3 (5min) |
| `netaiops-node-cpu-high` | Node CPU > 85% (2/3 datapoints, 60s) |

## Verification

### Agent Runtime Status

```bash
cd agents/<name>/agent && agentcore status
```

### Lambda Functions

```bash
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName,'incident-')].[FunctionName,State]" \
  --output table --profile <AWS_PROFILE> --region us-east-1
```

### Lambda Direct Test

```bash
aws lambda invoke --function-name incident-container-insight-tools \
  --payload '{"name":"container-insight-cluster-overview","arguments":{"cluster_name":"netaiops-eks-cluster"}}' \
  /tmp/out.json --profile <AWS_PROFILE> --region us-east-1
cat /tmp/out.json | python3 -m json.tool
```
