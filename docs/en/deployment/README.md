# Deployment Guide

## Prerequisites

- AWS CLI configured with `netaiops-deploy` profile
- Node.js 18+ (for CDK)
- Python 3.12+ (for agents)
- AgentCore CLI (`agentcore` in PATH)
- Docker (for Lambda image builds)

## Deployment Phases

The full deployment follows 4 phases, orchestrated by `deploy.sh`:

### Phase 1: CDK Infrastructure

```bash
cd infra-cdk
npm install
npx tsc --noEmit
npx cdk deploy --all --profile netaiops-deploy
```

Deploys:
- Cognito User Pools (dual pools per agent)
- IAM Roles (execution, gateway, CodeBuild)
- Docker Lambda functions (6 for Incident, 2 for Network, etc.)
- SSM Parameters (credentials, ARNs)
- CloudWatch Alarms (cross-region)

### Phase 2: EKS RBAC

```bash
./agents/incident-agent/prerequisite/setup-eks-rbac.sh
```

Creates Kubernetes RBAC resources for agent access to EKS clusters.

### Phase 3: MCP Server Runtimes

```bash
# EKS MCP Server (for K8s and Istio agents)
cd agents/k8s-agent/prerequisite/eks-mcp-server
./deploy-eks-mcp-server.sh

# Network MCP Server
cd agents/network-agent/prerequisite
./deploy-network-mcp-server.sh
```

### Phase 4: Agent Runtimes

```bash
# Deploy each agent
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent
  AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=netaiops-deploy agentcore deploy
  cd -
done
```

## Post-Deployment Checklist

After `agentcore deploy`, several manual steps are required:

### 1. Restore JWT Authorizer

`agentcore deploy` resets the authorizer configuration. Restore it:

```python
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='us-east-1')

resp = client.get_agent_runtime(agentRuntimeId='<AGENT_ID>')
client.update_agent_runtime(
    agentRuntimeId='<AGENT_ID>',
    agentRuntimeArtifact=resp['agentRuntimeArtifact'],
    roleArn=resp['roleArn'],
    networkConfiguration=resp['networkConfiguration'],
    protocolConfiguration=resp['protocolConfiguration'],
    authorizerConfiguration={
        'customJWTAuthorizer': {
            'discoveryUrl': '<COGNITO_DISCOVERY_URL>',
            'allowedClients': ['<COGNITO_CLIENT_ID>']
        }
    }
)
```

### 2. Verify SSM Parameters

Ensure `agent_runtime_arn` exists in SSM:

```bash
aws ssm get-parameter --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --profile netaiops-deploy
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
      "Resource": "arn:aws:ssm:us-east-1:175678592674:parameter/app/<agent>/*"
    }]
  }'
```

### 4. Verify Credential Provider

```bash
agentcore identity list-credential-providers
```

## Web UI Deployment

The frontend is served from a Docker container on EC2 behind ALB + CloudFront.

### Update Flow

```bash
# 1. Build frontend
cd app/frontend && npm run build

# 2. Copy build to backend static
cp -r dist/* ../backend/static/

# 3. Transfer to EC2 (via S3 + SSM)
tar czf /tmp/app.tar.gz -C app .
aws s3 cp /tmp/app.tar.gz s3://netaiops-deploy-175678592674-us-east-1/app.tar.gz
aws ssm send-command --instance-ids i-0a7e66310340c519c \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["<download + docker rebuild>"]'

# 4. Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id EO3603OVKIG2I --paths '/*' \
  --profile netaiops-deploy
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

## CDK Stack Resources

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

## Optional Setup

### External Service SSM Parameters (for Incident Agent)

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

## Stack Deletion

```bash
# CDK stacks
cd infra-cdk
npx cdk destroy --all --profile netaiops-deploy

# AgentCore Runtimes
cd agents/k8s-agent/agent && agentcore destroy
cd agents/incident-agent/agent && agentcore destroy
cd agents/istio-agent/agent && agentcore destroy
cd agents/network-agent/agent && agentcore destroy

# EKS MCP Server Runtime
cd agents/k8s-agent/prerequisite/eks-mcp-server && agentcore destroy
```
