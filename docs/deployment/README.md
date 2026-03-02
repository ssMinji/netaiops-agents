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
