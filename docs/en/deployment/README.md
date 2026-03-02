# Deployment Guide

This document covers the full deployment procedure for the project. It includes all deployment phases from CDK infrastructure to agent runtimes and Web UI.

## Prerequisites

- AWS CLI configured with a profile
- Node.js 18+ (for CDK)
- Python 3.12+ (for agents)
- AgentCore CLI (`agentcore` in PATH)
- Docker (for Lambda image builds)
- `kubectl` (for EKS RBAC setup)

## Deployment Overview

The full deployment follows 4 phases orchestrated by `deploy.sh`:

```
Phase 1: CDK Infrastructure    →  Cognito, IAM, Lambda, SSM, CloudWatch
Phase 2: EKS RBAC              →  ClusterRole/ClusterRoleBinding
Phase 3: MCP Server Runtimes   →  EKS MCP Server, Network MCP Server
Phase 4: Agent Runtimes        →  agentcore deploy × 4 agents
```

> **Note**: The Web UI (netaiops-hub) is not included in `deploy.sh`. It requires a separate deployment.

### Generic AgentCore Deployment Pattern

Any AgentCore-based agent project follows this deployment sequence regardless of the number of agents:

```
1. Infrastructure (CDK/CloudFormation)  →  Auth, IAM, Tools, Configuration
2. Cluster Access (if needed)           →  RBAC for Kubernetes-based tools
3. MCP Server Runtimes (if needed)      →  Long-running tool servers
4. Agent Runtimes                       →  agentcore deploy per agent
```

**Key insight**: CDK/CloudFormation cannot manage AgentCore-specific resources (Gateway, Runtime, Credential Provider). These require the AgentCore CLI or boto3 API. Plan your deployment pipeline to handle both IaC and CLI steps.

## CDK Build

```bash
cd infra-cdk

# Install dependencies
npm install

# Type check
npx tsc --noEmit

# Synthesize CloudFormation templates (optional, for review)
npx cdk synth

# Deploy all stacks
npx cdk deploy --all --profile <AWS_PROFILE>

# Deploy specific stack
npx cdk deploy IncidentAgentStack --profile <AWS_PROFILE>
```

## CDK Stack Configuration

### Stack Deployment Order

CDK stacks are defined in `bin/netaiops-infra.ts` and deployed in this order:

| Order | Stack | Description | Dependencies |
|-------|-------|-------------|--------------|
| 1 | `K8sAgentStack` | Cognito, Gateway, Runtime config | None (deploys first) |
| 2 | `IncidentAgentStack` | Cognito, 6 Lambda, Gateway, Monitoring | None |
| 3 | `IstioAgentStack` | Cognito, 2 Lambda, Hybrid Gateway | Reads K8s Agent SSM params |
| 4 | `NetworkAgentStack` | Cognito, 2 Lambda, Gateway | None |

**Cross-stack dependency**: IstioAgentStack reads K8s Agent's SSM parameters (`eks_mcp_server_arn`, `eks_mcp_client_id`, etc.) at deploy time. K8sAgentStack must be deployed first.

### Stack Resources

| Stack | Resources Created |
|-------|------------------|
| **K8sAgentStack** | Cognito (Agent Pool + Runtime Pool), IAM Role, MCP Gateway (mcpServer target), Runtime config |
| **IncidentAgentStack** | Cognito, IAM Role, 6 Docker Lambda, MCP Gateway (Lambda targets), Runtime config, SNS + CloudWatch Alarms |
| **IstioAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |
| **NetworkAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |

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

## Agent Deployment: deploy.sh

The `deploy.sh` script orchestrates all 4 deployment phases sequentially.

```bash
# Run full deployment
./deploy.sh
```

### Prerequisites Checked

The script validates the following tools before starting:

- `aws` CLI (with configured profile)
- `npx` (Node.js)
- `docker` (daemon running)
- `kubectl`
- `agentcore` CLI (falls back to `bedrock-agentcore` if not found)

### Phase 1: CDK Infrastructure

```bash
cd infra-cdk
npm install --silent
npm run build
npx cdk deploy --all --profile <AWS_PROFILE> --require-approval never
```

Deploys:
- Cognito User Pools (dual pools per agent)
- IAM Roles (execution, gateway, CodeBuild)
- Docker Lambda functions (6 for Incident, 2 for Istio, 2 for Network)
- SSM Parameters (credentials, ARNs)
- CloudWatch Alarms + SNS (cross-region)

**First deploy note**: Creates placeholder SSM ARNs for EKS MCP Server and Network MCP Server. These are replaced with actual ARNs in Phase 3.

### Phase 2: EKS RBAC

```bash
bash agents/incident-agent/prerequisite/setup-eks-rbac.sh
```

Creates Kubernetes RBAC resources (`ClusterRole`, `ClusterRoleBinding`) granting the **Incident Agent's Chaos Lambda** IAM role access to the EKS cluster. Required for the Chaos Lambda to create/delete pods and scale deployments. This is not for agent runtimes — they access EKS through the MCP Server.

### Phase 3: MCP Server Runtimes

```bash
# EKS MCP Server (used by K8s and Istio agents)
bash agents/k8s-agent/prerequisite/eks-mcp-server/deploy-eks-mcp-server.sh

# Network MCP Server
bash agents/network-agent/prerequisite/deploy-network-mcp-server.sh
```

After deployment, the scripts store the actual runtime ARNs in SSM. If Phase 1 used placeholder ARNs, the script **redeploys K8sAgentStack** to update the gateway target with the real EKS MCP Server ARN.

### Phase 4: Agent Runtimes

```bash
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent
  AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=<AWS_PROFILE> agentcore deploy
  cd -
done
```

Each agent is deployed as an ARM64 container on Bedrock AgentCore via CodeBuild.

### Placeholder ARN Problem

When an MCP Server runtime must exist before the CDK stack can reference it (e.g., as a Gateway target), but the CDK stack must exist first to create auth resources the MCP Server needs:

1. CDK creates a placeholder SSM parameter for the MCP Server ARN
2. MCP Server is deployed, actual ARN stored in SSM
3. CDK stack is redeployed to replace the placeholder with the real ARN

This circular dependency is inherent to any project where CDK-managed Gateways reference CLI-managed MCP Servers.

### SSM Dependency Flow

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

## Post-Deployment Checklist

After `agentcore deploy`, the following steps are required for any AgentCore agent. These are not specific to this project — they apply to any agent using Cognito JWT auth and SSM-based configuration:

### 1. Verify JWT Authorizer

`agentcore deploy` applies the `authorizer_configuration` from `.bedrock_agentcore.yaml`. If the yaml contains the correct `customJWTAuthorizer` block, no action is needed. If the field is `null`, update the yaml before deploying:

```yaml
# .bedrock_agentcore.yaml
authorizer_configuration:
  customJWTAuthorizer:
    allowedClients:
      - <COGNITO_CLIENT_ID>
    discoveryUrl: https://cognito-idp.<REGION>.amazonaws.com/<POOL_ID>/.well-known/openid-configuration
```

If already deployed with `null`, restore via API without redeploying (see [Troubleshooting](../troubleshooting/README.md#403-authorization-method-mismatch)).

### 2. Register Agent ARN in SSM

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite \
  --profile <AWS_PROFILE> --region us-east-1
```

### 3. Add SSM Permissions to Execution Role

If `agentcore deploy` created a new execution role:

```bash
aws iam put-role-policy --role-name <ROLE_NAME> \
  --policy-name SSMGetParameterAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/app/<agent>/*"
    }]
  }'
```

### 4. Verify Credential Provider

```bash
agentcore identity list-credential-providers
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

## Web UI Deployment

The frontend is served from a Docker container on EC2 behind ALB + CloudFront. It is not included in `deploy.sh` and must be deployed separately.

### Update Flow

```bash
# 1. Build frontend
cd app/frontend && npm run build

# 2. Copy build to backend static
cp -r dist/* ../backend/static/

# 3. Transfer to EC2 (via S3 + SSM)
tar czf /tmp/app.tar.gz --exclude='frontend/node_modules' --exclude='frontend/dist' -C app backend/ frontend/
aws s3 cp /tmp/app.tar.gz s3://<DEPLOY_BUCKET>/app.tar.gz

# 4. Rebuild Docker on target instance
docker build --no-cache -t netaiops-hub /home/ec2-user/app
OLD_ID=$(docker ps -q --filter publish=8000)
if [ -n "$OLD_ID" ]; then docker stop $OLD_ID && docker rm $OLD_ID; fi
docker run -d -p 8000:8000 --restart unless-stopped netaiops-hub

# 5. Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> --paths '/*' \
  --profile <AWS_PROFILE>
```

> **Important**: The frontend source (`frontend/src/`) must be included in the tar archive. If only `backend/` is transferred, the Docker build on EC2 uses the old frontend source and changes are not reflected.

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

## Lambda Docker Image Update

When CDK doesn't detect Docker changes, manually build and push:

```bash
docker build --no-cache --platform linux/amd64 -t <ECR_REPO>:<TAG> <DOCKER_DIR>
docker push <ECR_REPO>:<TAG>
aws lambda update-function-code --function-name <NAME> --image-uri <ECR_REPO>:<TAG>
```

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

## Stack Deletion

```bash
# CDK stacks
cd infra-cdk
npx cdk destroy --all --profile <AWS_PROFILE>

# AgentCore Runtimes
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent && agentcore destroy && cd -
done

# EKS MCP Server Runtime
cd agents/k8s-agent/prerequisite/eks-mcp-server && agentcore destroy
```
