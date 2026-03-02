# Build & Deploy

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
npx cdk deploy --all --profile netaiops-deploy

# Deploy specific stack
npx cdk deploy IncidentAgentStack --profile netaiops-deploy
```

## Stack Deployment Order

CDK stacks are defined in `bin/netaiops-infra.ts` and deployed in this order:

| Order | Stack | Description | Dependencies |
|-------|-------|-------------|-------------|
| 1 | `K8sAgentStack` | Cognito, Gateway, Runtime config | None (deploys first) |
| 2 | `IncidentAgentStack` | Cognito, 6 Lambda, Gateway, Monitoring | None |
| 3 | `IstioAgentStack` | Cognito, 2 Lambda, Hybrid Gateway | Reads K8s Agent SSM params |
| 4 | `NetworkAgentStack` | Cognito, 2 Lambda, Gateway | None |

**Cross-stack dependency**: IstioAgentStack reads K8s Agent's SSM parameters (`eks_mcp_server_arn`, `eks_mcp_client_id`, etc.) at deploy time. K8sAgentStack must be deployed first.

## Full Deployment: deploy.sh

The `deploy.sh` script orchestrates all 4 deployment phases sequentially.

```bash
# Run full deployment
./deploy.sh
```

### Prerequisites Checked

The script validates the following tools before starting:

- `aws` CLI (with `netaiops-deploy` profile)
- `npx` (Node.js)
- `docker` (daemon running)
- `kubectl`
- `agentcore` CLI (falls back to `bedrock-agentcore` if not found)

### Phase 1: CDK Infrastructure

```bash
cd infra-cdk
npm install --silent
npm run build
npx cdk deploy --all --profile netaiops-deploy --require-approval never
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

Creates Kubernetes RBAC resources (`ClusterRole`, `ClusterRoleBinding`) granting agent access to the EKS cluster. Required for the Chaos Lambda to operate on pods.

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
  AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=netaiops-deploy agentcore deploy
  cd -
done
```

Each agent is deployed as an ARM64 container on Bedrock AgentCore via CodeBuild.

## Post-Deployment Checklist

After `agentcore deploy`, several manual steps are required for each agent:

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

### 2. Register Agent ARN in SSM

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite \
  --profile netaiops-deploy --region us-east-1
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

# 4. Rebuild Docker on target instance
docker build --no-cache -t netaiops-hub /home/ec2-user/app
OLD_ID=$(docker ps -q --filter publish=8000)
if [ -n "$OLD_ID" ]; then docker stop $OLD_ID && docker rm $OLD_ID; fi
docker run -d -p 8000:8000 --restart unless-stopped netaiops-hub

# 5. Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id EO3603OVKIG2I --paths '/*' \
  --profile netaiops-deploy
```

## Lambda Docker Image Update

When CDK doesn't detect Docker changes, manually build and push:

```bash
docker build --no-cache --platform linux/amd64 -t <ECR_REPO>:<TAG> <DOCKER_DIR>
docker push <ECR_REPO>:<TAG>
aws lambda update-function-code --function-name <NAME> --image-uri <ECR_REPO>:<TAG>
```

## Stack Deletion

```bash
# CDK stacks
cd infra-cdk
npx cdk destroy --all --profile netaiops-deploy

# AgentCore Runtimes
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent && agentcore destroy && cd -
done

# EKS MCP Server Runtime
cd agents/k8s-agent/prerequisite/eks-mcp-server && agentcore destroy
```
