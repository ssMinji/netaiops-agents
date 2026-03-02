# 트러블슈팅

이 문제들은 이 프로젝트에만 해당하는 것이 아니라 AWS Bedrock AgentCore 배포에서 공통적으로 발생합니다. 근본 원인을 이해하면 자체 에이전트 아키텍처에서 이를 예방할 수 있습니다.

## 인증 및 ID 문제

### 403 Authorization Method Mismatch

**발생 원인**: `agentcore deploy`는 `.bedrock_agentcore.yaml`에서 `authorizer_configuration`을 읽어 그대로 적용합니다. yaml에 `authorizer_configuration: null`(초기 배포 후 기본값)이 있으면 런타임의 authorizer가 null로 설정되어 JWT 기반 호출이 403을 반환합니다.

**패턴**: `.bedrock_agentcore.yaml`에 `customJWTAuthorizer` 블록이 없는 상태에서 JWT 인증을 사용하는 모든 에이전트에 해당합니다.

**예방**: 배포 전 `.bedrock_agentcore.yaml`에 올바른 authorizer 설정을 포함하세요:

```yaml
authorizer_configuration:
  customJWTAuthorizer:
    allowedClients:
      - <COGNITO_CLIENT_ID>
    discoveryUrl: https://cognito-idp.<REGION>.amazonaws.com/<POOL_ID>/.well-known/openid-configuration
```

**해결** (null 상태로 배포된 경우): 재배포 없이 API로 복원:

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

**발생 원인**: 에이전트 코드가 SSM에 저장된 credential provider 이름을 참조하지만, 해당 provider가 AgentCore의 token vault에 존재하지 않습니다. 에이전트 런타임이 다른 계정/리전에 재배포되거나 credential provider가 생성되지 않은 경우 발생합니다.

**패턴**: OAuth2를 사용하여 MCP Gateway를 호출하는 모든 에이전트에는 AgentCore에 등록된 credential provider가 필요합니다.

**예방**: 배포 스크립트에 `agentcore identity create-credential-provider`를 포함하고, 에이전트 시작 전 `list-credential-providers`로 확인하세요.

**해결**:

```bash
agentcore identity create-credential-provider \
  --name <PROVIDER_NAME> --type cognito \
  --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
  --discovery-url <COGNITO_DISCOVERY_URL> \
  --cognito-pool-id <POOL_ID>
```

## IAM 권한 문제

### 424 Runtime Start Failure — SSM AccessDeniedException

**발생 원인**: `agentcore deploy`는 최소 권한으로 실행 역할(`AmazonBedrockAgentCoreSDKRuntime-*`)을 자동 생성합니다. 에이전트가 시작 시 SSM에서 구성을 읽으면 이 역할에 `ssm:GetParameter` 권한이 없어 실패합니다.

**패턴**: SSM에서 런타임 구성(gateway URL, 자격 증명, 기능 플래그)을 읽는 모든 에이전트는 실행 역할이 사전 구성되거나 배포 후 패치되지 않으면 첫 배포에서 실패합니다.

**예방**: (a) CDK로 SSM 권한이 포함된 실행 역할을 미리 생성하고 `.bedrock_agentcore.yaml`에서 참조하거나, (b) 배포 후 단계로 SSM 권한을 추가하세요.

**해결**:

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

**발생 원인**: 웹 백엔드가 호출 시 SSM에서 에이전트 ARN을 조회합니다. SSM 파라미터 키가 백엔드가 기대하는 것과 일치하지 않으면(예: `runtime_arn` vs `agent_runtime_arn`) 조회가 실패합니다.

**패턴**: 인프라가 SSM에 ARN을 쓰고 애플리케이션 코드가 읽는 모든 시스템은 키 이름 불일치에 취약합니다. 특히 CDK와 CLI가 다른 명명 규칙을 사용할 때 그렇습니다.

**예방**: CDK 코드와 애플리케이션 코드 간에 SSM 키 이름을 상수로 공유하세요. 배포 후 모든 SSM 파라미터가 존재하는지 검증하세요.

**해결**:

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite
```

## 빌드 및 컨테이너 문제

### CodeBuild에서 Docker Hub 속도 제한 (429)

**발생 원인**: `agentcore deploy`는 CodeBuild를 사용하여 컨테이너 이미지를 빌드합니다. 익명 Docker Hub pull은 속도 제한이 있습니다(IP당 6시간에 100회). CodeBuild 인스턴스는 IP를 공유하므로 제한에 자주 도달합니다.

**패턴**: `FROM python:*` 또는 기타 Docker Hub 이미지를 사용하는 모든 Dockerfile은 CodeBuild에서 결국 실패합니다.

**예방**: 처음부터 Dockerfile에서 ECR Public Gallery 미러를 사용하세요.

**해결**:

```dockerfile
# 이전 (속도 제한)
FROM python:3.12-slim

# 이후 (속도 제한 없음)
FROM public.ecr.aws/docker/library/python:3.12-slim
```

### CodeBuild에서 심링크가 해석되지 않음

**발생 원인**: `agentcore deploy`는 CodeBuild를 위해 소스 디렉토리를 zip으로 압축합니다. 빌드 컨텍스트 외부를 가리키는 심링크는 zip에 포함되지 않아 컨테이너에서 깨진 참조가 됩니다.

**패턴**: 에이전트 간 코드 공유를 위해 심링크를 사용하는 모든 프로젝트 구조는 `agentcore deploy` 시 깨집니다.

**예방**: 배포 디렉토리에는 심링크 대신 파일 복사를 사용하세요. 에이전트 간 코드를 공유하는 경우 빌드 단계에서 공유 모듈을 각 에이전트의 배포 디렉토리에 복사하세요.

## 디버깅

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
