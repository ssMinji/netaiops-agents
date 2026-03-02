# Deployment Guide

## Prerequisites

- AWS CLI configured with `netaiops-deploy` profile
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

## Agent Configuration (.bedrock_agentcore.yaml)

Key fields:

```yaml
default_agent: <agent_name>
agents:
  <agent_name>:
    platform: linux/arm64
    aws:
      account: '175678592674'
      region: us-east-1
      execution_role: arn:aws:iam::175678592674:role/...
      ecr_repository: 175678592674.dkr.ecr.us-east-1.amazonaws.com/...
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
PROFILE="netaiops-deploy"
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
  --output table --profile netaiops-deploy --region us-east-1
```

### Lambda Direct Test

```bash
aws lambda invoke --function-name incident-container-insight-tools \
  --payload '{"name":"container-insight-cluster-overview","arguments":{"cluster_name":"netaiops-eks-cluster"}}' \
  /tmp/out.json --profile netaiops-deploy --region us-east-1
cat /tmp/out.json | python3 -m json.tool
```
