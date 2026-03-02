# Troubleshooting

These issues are common to any AWS Bedrock AgentCore deployment, not specific to this project. Understanding the root causes helps you prevent them in your own agent architecture.

## Auth and Identity Issues

### 403 Authorization Method Mismatch

**Why this happens**: `agentcore deploy` resets the `authorizer_configuration` to null on every deployment. This is a known AgentCore CLI behavior — it treats each deploy as a fresh configuration.

**Pattern**: Any agent using JWT-based auth (Cognito, custom OIDC) will lose its authorizer after redeployment.

**Prevention**: Automate authorizer restoration as a post-deploy step in your CI/CD pipeline.

**Fix**:

```python
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

### 424 Credential Provider Not Found

**Why this happens**: Agent code references a credential provider name (stored in SSM), but the provider doesn't exist in AgentCore's token vault. This occurs when the agent runtime is redeployed to a different account/region or when the credential provider was never created.

**Pattern**: Any agent that uses OAuth2 to call MCP Gateway needs a credential provider registered in AgentCore.

**Prevention**: Include `agentcore identity create-credential-provider` in your deployment script, and verify with `list-credential-providers` before launching the agent.

**Fix**:

```bash
agentcore identity create-credential-provider \
  --name <PROVIDER_NAME> --type cognito \
  --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
  --discovery-url <COGNITO_DISCOVERY_URL> \
  --cognito-pool-id <POOL_ID>
```

## IAM Permission Issues

### 424 Runtime Start Failure — SSM AccessDeniedException

**Why this happens**: `agentcore deploy` auto-creates an execution role (`AmazonBedrockAgentCoreSDKRuntime-*`) with minimal permissions. If your agent reads configuration from SSM at startup, this role lacks the necessary `ssm:GetParameter` permissions.

**Pattern**: Any agent that reads runtime config from SSM (gateway URL, credentials, feature flags) will fail on first deploy unless the execution role is pre-configured or patched post-deploy.

**Prevention**: Either (a) pre-create the execution role with SSM permissions via CDK and reference it in `.bedrock_agentcore.yaml`, or (b) add SSM permissions as a post-deploy step.

**Fix**:

```bash
aws iam put-role-policy --role-name <ROLE_NAME> \
  --policy-name SSMGetParameterAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:<REGION>:<ACCOUNT_ID>:parameter/app/<agent>/*"
    }]
  }'
```

### 503 Agent ARN Not Found

**Why this happens**: The web backend resolves agent ARN from SSM at invocation time. If the SSM parameter key doesn't match what the backend expects (e.g., `runtime_arn` vs `agent_runtime_arn`), the lookup fails.

**Pattern**: Any system where infrastructure writes ARNs to SSM and application code reads them is vulnerable to key name mismatches, especially when CDK and CLI use different naming conventions.

**Prevention**: Define SSM key names as constants shared between your CDK code and application code. Validate all SSM parameters exist after deployment.

**Fix**:

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite
```

## Build and Container Issues

### Docker Hub Rate Limit (429) in CodeBuild

**Why this happens**: `agentcore deploy` uses CodeBuild to build container images. Anonymous Docker Hub pulls have a rate limit (100 pulls/6 hours per IP). CodeBuild instances share IPs, so limits are hit frequently.

**Pattern**: Any Dockerfile using `FROM python:*` or other Docker Hub images will eventually fail in CodeBuild.

**Prevention**: Always use ECR Public Gallery mirrors in your Dockerfiles from the start.

**Fix**:

```dockerfile
# Before (rate-limited)
FROM python:3.12-slim

# After (no rate limit)
FROM public.ecr.aws/docker/library/python:3.12-slim
```

### Symlinks Not Resolved in CodeBuild

**Why this happens**: `agentcore deploy` zips the source directory for CodeBuild. Symlinks pointing outside the build context are not included in the zip — they become broken references in the container.

**Pattern**: Any project structure using symlinks for code sharing between agents will break during `agentcore deploy`.

**Prevention**: Use file copies instead of symlinks for deployment directories. If you share code between agents, copy the shared modules into each agent's deploy directory as a build step.

## Debugging

### Check Agent Logs

```bash
# Tail runtime logs
aws logs tail /aws/bedrock-agentcore/runtimes/<AGENT_ID>-DEFAULT \
  --log-stream-name-prefix "$(date +%Y/%m/%d)/[runtime-logs]" \
  --follow

# Check recent logs
aws logs tail /aws/bedrock-agentcore/runtimes/<AGENT_ID>-DEFAULT \
  --log-stream-name-prefix "$(date +%Y/%m/%d)/[runtime-logs]" \
  --since 1h
```

### Check Agent Status

```bash
cd agents/<name>/agent
agentcore status
```

### Verify Gateway Target Configuration

```python
client = boto3.client('bedrock-agentcore-control', region_name='us-east-1')
gateways = client.list_gateways()
for gw in gateways['items']:
    targets = client.list_gateway_targets(gatewayIdentifier=gw['gatewayId'])
    for t in targets['items']:
        detail = client.get_gateway_target(
            gatewayIdentifier=gw['gatewayId'],
            targetId=t['targetId']
        )
        print(detail)
```

### Test Agent Directly

```bash
cd agents/<name>/agent
agentcore invoke '{"prompt": "Hello, what tools do you have?"}'
```
