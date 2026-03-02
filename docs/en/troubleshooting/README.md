# Troubleshooting

## Common Issues After Agent Deployment

### 403 Authorization Method Mismatch

**Symptom**: Agent returns 403 when invoked from the UI.

**Cause**: `agentcore deploy` resets the `authorizer_configuration` to null.

**Fix**: Restore the JWT authorizer configuration via API:

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

### 424 Runtime Start Failure — SSM AccessDeniedException

**Symptom**: Agent fails to start with SSM `GetParameter` permission error.

**Cause**: The auto-created execution role lacks SSM permissions.

**Fix**: Add SSM inline policy:

```bash
aws iam put-role-policy --role-name <ROLE_NAME> \
  --policy-name SSMGetParameterAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:us-east-1:175678592674:parameter/app/<agent>/*"
    }]
  }'
```

### 424 Runtime Start Failure — Credential Provider Not Found

**Symptom**: Agent fails to get OAuth2 token for MCP Gateway.

**Cause**: The credential provider referenced in agent config doesn't exist in the token vault.

**Fix**: Create the credential provider:

```bash
agentcore identity create-credential-provider \
  --name <PROVIDER_NAME> --type cognito \
  --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
  --discovery-url <COGNITO_DISCOVERY_URL> \
  --cognito-pool-id <POOL_ID>
```

### 503 Agent ARN Not Found

**Symptom**: Backend returns 503 with "Agent ARN not found" message.

**Cause**: SSM parameter name mismatch. Backend expects `agent_runtime_arn` but the parameter may be stored under a different key.

**Fix**: Verify and create the correct SSM parameter:

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite
```

### Docker Hub Rate Limit (429) in CodeBuild

**Symptom**: CodeBuild fails during `BUILD` phase with Docker pull error.

**Cause**: Anonymous Docker Hub pulls have a rate limit (100 pulls/6 hours per IP).

**Fix**: Use ECR Public Gallery mirror in Dockerfile:

```dockerfile
# Before (rate-limited)
FROM python:3.12-slim

# After (no rate limit)
FROM public.ecr.aws/docker/library/python:3.12-slim
```

### Symlinks Not Resolved in CodeBuild

**Symptom**: `ModuleNotFoundError` in deployed agent container.

**Cause**: `agentcore deploy` uses CodeBuild which zips the source directory. Symlinks pointing outside the build context are not resolved.

**Fix**: Use file copies instead of symlinks for deployment. Create an `agent-cached/` directory with actual files rather than symlinks.

## Debugging Tips

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
