# NetAIOps Agent

AWS Bedrock AgentCore 기반 네트워크/인프라 진단 에이전트 모음 (K8s, Incident, Istio, Network).

## Build

```bash
cd infra-cdk && npx tsc --noEmit
```

## Deploy

```bash
cd infra-cdk
npx cdk deploy --profile netaiops-deploy <StackName>
```

배포는 반드시 `netaiops-deploy` 프로필을 사용한다.

## Project Structure

- `agents/` — 에이전트 소스코드 (k8s-agent, incident-agent, istio-agent, network-agent)
- `app/` — Web UI (NetAIOps Hub)
  - `app/backend/` — FastAPI 백엔드 (main.py, static 서빙)
  - `app/frontend/` — React 프론트엔드 (Vite + TypeScript)
- `infra-cdk/` — CDK 인프라 스택
  - `bin/netaiops-infra.ts` — CDK 앱 엔트리포인트
  - `lib/config.ts` — 공유 설정 (계정, 리전, 에이전트별 config, tool schemas)
  - `lib/constructs/` — 재사용 CDK construct (CognitoAuth, CrossRegionAlarm, DockerLambda, McpGateway)
  - `lib/stacks/{k8s,incident,istio,network}-agent/` — 에이전트별 CDK 스택
  - `agent-src/` — 에이전트 소스 심링크
  - `lambda-src/` — 람다 소스 심링크
- `deploy.sh` — Phase 1~4 통합 배포 스크립트 (CDK → EKS RBAC → MCP Server → Agent Runtime)
- `docs/` — 기술 문서 (PROMPT-CACHING.md 등)

## Deploy — AgentCore CLI

CDK는 Cognito + IAM + Lambda + SSM만 배포한다. BedrockAgentCore 리소스(Gateway, OAuth2CredentialProvider, Runtime)는 **CloudFormation이 지원하지 않으므로** AgentCore CLI 또는 boto3 API로 배포해야 한다.

### 배포 순서

1. **CDK** (`npx cdk deploy`): Cognito Dual Pool, IAM Role, Docker Lambda, SSM Parameter
2. **MCP Server Runtime** (`agentcore deploy`): `agents/<name>/prerequisite/<mcp-server>/` 디렉토리에서 실행
3. **MCP Gateway** (`agentcore gateway create-mcp-gateway`): Agent Pool Cognito authorizer 사용
4. **Gateway Targets**: boto3 `create_gateway_target` API 사용
5. **Agent Runtime** (`agentcore deploy`): `agents/<name>/agent/` 디렉토리에서 실행

### AgentCore CLI 사용법

```bash
# CLI 위치 (이 환경에서)
agentcore  # ~/.local/bin/agentcore -> venv symlink

# 배포 시 반드시 account/region을 .bedrock_agentcore.yaml에 설정
aws:
  account: '175678592674'
  region: us-east-1

# 환경변수도 함께 설정
AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=netaiops-deploy agentcore deploy
```

### .bedrock_agentcore.yaml 필수 설정

- `aws.account`, `aws.region`: 없으면 deploy 실패
- `authorizer_configuration.customJWTAuthorizer`: MCP Server에는 Runtime Pool의 client ID/discovery URL, Agent에는 Agent Pool의 client ID/discovery URL
- `identity.credential_providers`: `agentcore identity create-credential-provider`로 자동 추가됨

### Gateway Target 생성 (boto3)

CLI의 `create-mcp-gateway-target --target-type lambda`는 테스트 Lambda를 자동 생성하므로, 실제 Lambda ARN을 사용하려면 boto3 API를 직접 호출한다.

```python
client = boto3.client('bedrock-agentcore-control', region_name='us-east-1')

# Lambda 타겟
client.create_gateway_target(
    gatewayIdentifier=GW_ID,
    name='ToolName',
    targetConfiguration={'mcp': {'lambda': {
        'lambdaArn': 'arn:aws:lambda:...',
        'toolSchema': {'inlinePayload': [schemas...]}  # enum 필드 사용 불가
    }}},
    credentialProviderConfigurations=[{'credentialProviderType': 'GATEWAY_IAM_ROLE'}]
)

# mcpServer 타겟 (기존 패턴 참조: endpoint URL은 URL-encoded ARN)
client.create_gateway_target(
    gatewayIdentifier=GW_ID,
    name='McpServerName',
    targetConfiguration={'mcp': {'mcpServer': {
        'endpoint': f'https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/{url_encoded_arn}/invocations?qualifier=DEFAULT'
    }}},
    credentialProviderConfigurations=[{
        'credentialProviderType': 'OAUTH',
        'credentialProvider': {'oauthCredentialProvider': {
            'providerArn': 'arn:aws:bedrock-agentcore:...:oauth2credentialprovider/...',
            'scopes': ['resource-server/scope'],
            'grantType': 'CLIENT_CREDENTIALS'
        }}
    }]
)
```

### 주의사항

- **새 리소스를 만들기 전에, 이미 동작하는 기존 리소스의 실제 설정을 API로 조회해서 패턴을 파악하는 게 가장 빠르다.** 예: `list_gateways` → `get_gateway_target`으로 기존 타겟 구조를 확인한 뒤 동일 패턴으로 생성.
- toolSchema의 `inputSchema.properties`에 `enum` 필드를 넣으면 API 유효성 검사 실패. description에 허용 값을 나열할 것.
- OAuth2 credential provider 생성은 `agentcore identity create-credential-provider --type cognito` CLI 사용이 가장 확실.
- `awslabs.aws-network-mcp-server` 패키지 버전은 `0.0.x`대 (Dockerfile에서 `>=0.1.0` 사용 불가).

## Agent Runtime 배포 후 체크리스트

`agentcore deploy` 후 UI에서 호출하면 반복적으로 발생하는 문제들과 해결법:

### 1. 403 Authorization method mismatch

**원인**: `agentcore deploy`가 `authorizer_configuration`을 매번 초기화(null)한다.
**해결**: 배포 후 반드시 JWT authorizer를 API로 재설정:

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

기존 에이전트의 authorizer 값은 `get_agent_runtime`으로 조회 가능.

### 2. 424 Runtime start failure — AccessDeniedException on SSM

**원인**: `agentcore deploy`가 자동 생성하는 실행 역할(`AmazonBedrockAgentCoreSDKRuntime-*`)에는 SSM 권한이 없다. 에이전트 코드가 SSM에서 config를 읽으면(`get_ssm_parameter`) 실패.
**해결**: 실행 역할에 SSM 인라인 정책 추가:

```bash
aws iam put-role-policy --role-name <ROLE_NAME> \
  --policy-name SSMGetParameterAccess \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ssm:GetParameter","ssm:GetParameters","ssm:GetParametersByPath"],"Resource":"arn:aws:ssm:us-east-1:175678592674:parameter/app/<agent-prefix>/*"}]}'
```

CDK로 생성한 역할(기존 에이전트)에는 이미 포함되어 있으므로, `agentcore deploy`가 새로 생성한 역할에만 해당.

### 3. 424 Runtime start failure — Credential Provider not found

**원인**: 에이전트 코드가 SSM에서 `cognito_provider` 이름을 읽어 `get_resource_oauth2_token`을 호출하는데, 해당 credential provider가 agentcore token vault에 없음.
**해결**: credential provider 생성:

```bash
agentcore identity create-credential-provider \
  --name <PROVIDER_NAME> --type cognito \
  --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
  --discovery-url <COGNITO_DISCOVERY_URL> \
  --cognito-pool-id <POOL_ID>
```

### 4. 심링크가 Docker 빌드에 포함되지 않음

**원인**: `agentcore deploy`는 CodeBuild로 소스를 zip 압축하여 전송. 빌드 컨텍스트 바깥을 가리키는 심링크는 해석되지 않아 `ModuleNotFoundError` 발생.
**해결**: 심링크 대신 실제 파일 복사 사용. `agent-cached/` 등 별도 배포 디렉토리에서는 `cp -r` 사용.

### 5. SSM 파라미터 이름 불일치 (503 Agent ARN not found)

**원인**: 백엔드(`main.py`)는 `{ssm_prefix}/agent_runtime_arn`을 조회하지만, CDK/agentcore가 `runtime_arn` 등 다른 이름으로 저장하는 경우가 있음.
**해결**: 백엔드가 사용하는 키와 실제 SSM 파라미터 이름을 확인하고, 없으면 별도 생성하거나 `arn_ssm_key` 오버라이드 사용.

### 6. Web UI 배포 (netaiops-hub)

프론트엔드는 ALB 뒤의 Docker 컨테이너(`netaiops-hub`)에서 서빙. 업데이트 절차:

1. 소스 수정 (`app/backend/`, `app/frontend/`)
2. 타겟 인스턴스(`i-0a7e66310340c519c`)에 파일 전송 (S3 presigned URL + SSM)
3. Docker 이미지 리빌드: `docker build --no-cache -t netaiops-hub /home/ec2-user/app`
4. 컨테이너 교체:
   ```bash
   OLD_ID=$(docker ps -q --filter publish=8000)
   if [ -n "$OLD_ID" ]; then docker stop $OLD_ID && docker rm $OLD_ID; fi
   docker run -d -p 8000:8000 --restart unless-stopped netaiops-hub
   ```
5. CloudFront invalidation: `aws cloudfront create-invalidation --distribution-id EO3603OVKIG2I --paths '/*' --profile netaiops-deploy`

### 7. 프롬프트 캐싱 설정 (performanceConfig vs cache_config)

Bedrock 프롬프트 캐싱과 `performanceConfig`는 **완전히 별개의 기능**이다. 혼동하지 않도록 주의.

#### 실제 프롬프트 캐싱 (Strands SDK → Bedrock `cachePoint` API)

```python
# 올바른 프롬프트 캐싱 설정. Opus 포함 모든 Claude 모델에서 동작.
BedrockModel(
    cache_config=CacheConfig(strategy="auto"),  # 마지막 assistant 메시지에 cachePoint 블록 자동 삽입
    cache_tools="default",                       # 도구 정의 목록 끝에 cachePoint 추가
)
```

- `cache_config`: Strands SDK가 Bedrock API 호출 시 메시지에 `{"cachePoint": {"type": "default"}}` 블록을 자동 삽입
- `cache_tools`: 도구 정의(`toolConfig.tools`) 끝에 `cachePoint` 블록 추가
- 모델 지원 여부: `_supports_caching` → `"claude" in model_id` → **Opus 지원**
- **현재 적용 상태**: 모든 에이전트(K8s, Incident, Istio, Incident-Cached)에 `ENABLE_PROMPT_CACHE` 환경변수와 `CacheConfig` 코드가 포함되어 있음. 기본값 `"false"`(비활성). Incident Agent Cached의 Dockerfile에서만 `ENABLE_PROMPT_CACHE=true`로 설정.

#### performanceConfig (Bedrock API 레이턴시 최적화 — 별도 기능)

프롬프트 캐싱이 아닌 **레이턴시 최적화** 옵션. 혼동의 원인이 됨.

디버깅 과정에서 겪은 3단계 에러:

1. **`additional_request_fields`로 전달** → `Extra inputs are not permitted`
   - 원인: `additional_request_fields`는 `additionalModelRequestFields` (nested)에 매핑됨
   - `performanceConfig`는 top-level 파라미터이므로 `additional_args`를 사용해야 함
2. **`additional_args`로 `promptCache` 전달** → `Unknown parameter "promptCache", must be one of: latency`
   - 원인: `performanceConfig`의 유효한 필드는 `latency`뿐. `promptCache`는 존재하지 않는 필드
3. **`additional_args`로 `latency: "optimized"` 전달** → `Latency performance configuration is not supported for anthropic.claude-opus-4-6-v1`
   - 원인: Opus 모델은 `performanceConfig` 자체를 미지원

**결론**: `performanceConfig`는 사용하지 않는다. 프롬프트 캐싱은 `cache_config` + `cache_tools`만으로 동작한다.

#### Strands SDK의 BedrockModel 파라미터 구분

| 파라미터 | Bedrock API 매핑 | 용도 |
|----------|------------------|------|
| `additional_request_fields` | `additionalModelRequestFields` (nested) | 모델별 추가 필드 (thinking 등) |
| `additional_args` | top-level (unpacked) | API 최상위 파라미터 (`performanceConfig` 등) |
| `cache_config` | 메시지에 `cachePoint` 블록 삽입 | 프롬프트 캐싱 |
| `cache_tools` | 도구 정의에 `cachePoint` 블록 추가 | 도구 정의 캐싱 |

### 8. MCP Gateway Lambda 타겟 — tool name 라우팅

MCP Gateway Lambda 타겟은 `tools/call` 시 **arguments만** Lambda에 전달하고, tool name을 넘기지 않는다. 하나의 Lambda에 여러 도구를 번들링하면 어떤 도구가 호출됐는지 Lambda가 알 수 없다.

**해결**: 모든 tool schema에 `_tool` required 파라미터를 추가하여, 모델이 arguments에 tool name을 포함하도록 한다.

```typescript
// config.ts — tool schema 예시
{
  name: 'dns-check-health',
  inputSchema: {
    type: 'object',
    properties: {
      _tool: { type: 'string', description: 'Tool identifier. Must be "dns-check-health".' },
      health_check_id: { ... },
    },
    required: ['_tool'],  // 모델이 반드시 _tool을 포함
  },
}
```

```python
# Lambda handler — _tool 우선, argument 키 패턴 fallback
if "_tool" in event:
    tool_name = event["_tool"]
elif "hostname" in event:
    tool_name = "dns-resolve"
# ...
```

**Gateway 타겟 스키마 업데이트**: CDK deploy만으로는 Gateway 타겟 스키마가 업데이트되지 않는 경우가 있다. `update-gateway-target` API로 직접 업데이트:

```bash
aws bedrock-agentcore-control update-gateway-target \
  --gateway-identifier <GW_ID> --target-id <TARGET_ID> --name <NAME> \
  --target-configuration '{"mcp":{"lambda":{"lambdaArn":"...","toolSchema":{"inlinePayload":[...]}}}}' \
  --credential-provider-configurations '[{"credentialProviderType":"GATEWAY_IAM_ROLE"}]'
```

**Lambda Docker 이미지 업데이트**: CDK가 Docker 변경을 감지하지 못하면 직접 빌드+푸시:

```bash
docker build --no-cache --platform linux/amd64 -t <ECR_REPO>:<TAG> <DOCKER_DIR>
docker push <ECR_REPO>:<TAG>
aws lambda update-function-code --function-name <NAME> --image-uri <ECR_REPO>:<TAG>
```

### 9. 토큰 메트릭 전송 프로토콜 (`__METRICS_JSON__`)

에이전트에서 백엔드로 토큰 사용량을 전달하기 위한 in-band 마커 프로토콜.

**에이전트 측** (`agent.py`의 `stream()` 메서드):
- `stream_async`의 `{"result": AgentResult}` 이벤트에서 `result.metrics.accumulated_usage` 추출
- `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`를 JSON으로 직렬화
- 스트림 마지막에 `__METRICS_JSON__{"input_tokens":..., "output_tokens":...}` 형태로 yield

**백엔드 측** (`main.py`의 `event_stream()`):
- 청크에서 `__METRICS_JSON__` 마커 감지 → JSON 파싱 → `token_metrics`에 저장
- 마커 앞의 텍스트는 정상 content 청크로 전송, 마커 이후 JSON은 제거
- 스트림 종료 시 서버 타이밍(`ttfb_ms`, `total_ms`)과 토큰 메트릭을 병합하여 `{"metrics": {...}}` SSE 이벤트 전송

**현재 적용 상태**:
- Incident Agent (`agents/incident-agent/agent/`) — 적용
- Incident Agent Cached (`agents/incident-agent/agent-cached/`) — 적용
- K8s Agent, Istio Agent, Network Agent — 미적용 (UI에서 토큰 사용량 미표시)

### 배포 완전 체크리스트 (새 에이전트)

1. `agentcore deploy` — 런타임 배포
2. SSM에 ARN 저장 — `{ssm_prefix}/agent_runtime_arn`
3. JWT authorizer 설정 — `update_agent_runtime` API
4. 실행 역할 SSM 권한 확인 — `put-role-policy`
5. Credential provider 존재 확인 — `list_oauth2_credential_providers`
6. 백엔드 `main.py`에 에이전트 엔트리 추가
7. 프론트엔드 업데이트 + Docker 리빌드 + CloudFront invalidation

## Conventions

- CDK 스택 구성 순서: Cognito → Lambda → Gateway → Runtime
- 설정은 `lib/config.ts`에 중앙 집중
- 심링크로 `agents/` 소스를 `infra-cdk/` 하위에서 참조
- 스택 파일은 `lib/stacks/<agent-name>/` 디렉토리에 배치
- CDK로 배포하는 것: Cognito, IAM Role, Lambda, SSM Parameter
- AgentCore CLI로 배포하는 것: MCP Server Runtime, Agent Runtime
- boto3 API로 배포하는 것: MCP Gateway, Gateway Target
- AgentCore CLI로 배포하는 것 (권장): OAuth2 Credential Provider (`agentcore identity create-credential-provider`)

## Git

커밋 메시지에 footer를 작성하지 않는다.
