# 트러블슈팅

## 에이전트 배포 후 일반적인 문제

### 403 Authorization Method Mismatch

**증상**: UI에서 호출 시 에이전트가 403을 반환합니다.

**원인**: `agentcore deploy`가 `authorizer_configuration`을 null로 재설정합니다.

**해결**: API를 통해 JWT authorizer 구성을 복원:

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

**증상**: SSM `GetParameter` 권한 오류로 에이전트 시작 실패.

**원인**: 자동 생성된 실행 역할에 SSM 권한이 없습니다.

**해결**: SSM 인라인 정책 추가:

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

**증상**: MCP Gateway용 OAuth2 토큰 획득 실패.

**원인**: 에이전트 구성에서 참조하는 credential provider가 token vault에 존재하지 않습니다.

**해결**: credential provider 생성:

```bash
agentcore identity create-credential-provider \
  --name <PROVIDER_NAME> --type cognito \
  --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
  --discovery-url <COGNITO_DISCOVERY_URL> \
  --cognito-pool-id <POOL_ID>
```

### 503 Agent ARN Not Found

**증상**: "Agent ARN not found" 메시지와 함께 백엔드가 503 반환.

**원인**: SSM 파라미터 이름 불일치. 백엔드는 `agent_runtime_arn`을 예상하지만 파라미터가 다른 키로 저장되었을 수 있습니다.

**해결**: 올바른 SSM 파라미터 확인 및 생성:

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite
```

### CodeBuild에서 Docker Hub 속도 제한 (429)

**증상**: `BUILD` 단계에서 Docker pull 오류로 CodeBuild 실패.

**원인**: 익명 Docker Hub pull은 속도 제한이 있습니다(IP당 6시간에 100회 pull).

**해결**: Dockerfile에서 ECR Public Gallery 미러 사용:

```dockerfile
# 이전 (속도 제한)
FROM python:3.12-slim

# 이후 (속도 제한 없음)
FROM public.ecr.aws/docker/library/python:3.12-slim
```

### CodeBuild에서 심링크가 해석되지 않음

**증상**: 배포된 에이전트 컨테이너에서 `ModuleNotFoundError` 발생.

**원인**: `agentcore deploy`는 소스 디렉토리를 zip으로 압축하는 CodeBuild를 사용합니다. 빌드 컨텍스트 외부를 가리키는 심링크는 해석되지 않습니다.

**해결**: 배포 시 심링크 대신 파일 복사를 사용합니다. 심링크 대신 실제 파일이 있는 `agent-cached/` 디렉토리를 생성합니다.

## 디버깅 팁

### 에이전트 로그 확인

```bash
# 런타임 로그 tail
aws logs tail /aws/bedrock-agentcore/runtimes/<AGENT_ID>-DEFAULT \
  --log-stream-name-prefix "$(date +%Y/%m/%d)/[runtime-logs]" \
  --follow

# 최근 로그 확인
aws logs tail /aws/bedrock-agentcore/runtimes/<AGENT_ID>-DEFAULT \
  --log-stream-name-prefix "$(date +%Y/%m/%d)/[runtime-logs]" \
  --since 1h
```

### 에이전트 상태 확인

```bash
cd agents/<name>/agent
agentcore status
```

### Gateway Target 구성 확인

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

### 에이전트 직접 테스트

```bash
cd agents/<name>/agent
agentcore invoke '{"prompt": "Hello, what tools do you have?"}'
```
