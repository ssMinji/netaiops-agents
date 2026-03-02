# 백엔드 API 레퍼런스

## 개요

백엔드는 React 프론트엔드와 Bedrock AgentCore 에이전트 런타임 사이의 게이트웨이 역할을 하는 FastAPI 애플리케이션입니다. 인증, 스트리밍 프록시, chaos/fault 오케스트레이션, 정적 파일 서빙을 처리합니다.

## 위치

```
app/backend/
├── main.py           # FastAPI application
├── Dockerfile        # Docker image definition
├── requirements.txt  # Python dependencies
└── static/           # React build output (served as SPA)
```

## 엔드포인트

### 구성

#### `GET /api/config`

에이전트 정의, 사용 가능한 모델, 리전을 반환합니다.

```json
{
  "agents": {
    "network": {
      "name": "Network Diagnostics Agent",
      "description": "...",
      "icon": "globe",
      "scenarios": [...]
    }
  },
  "models": ["global.anthropic.claude-opus-4-6-v1", ...],
  "region": "us-east-1"
}
```

### 채팅

#### `POST /api/chat`

Server-Sent Events를 사용하는 스트리밍 채팅 엔드포인트.

**요청:**
```json
{
  "agent_id": "k8s",
  "prompt": "Check cluster health",
  "session_id": "uuid-v4",
  "model_id": "global.anthropic.claude-opus-4-6-v1"
}
```

**SSE 이벤트:**
```
data: {"content": "Checking cluster..."}
data: {"content": " health status"}
data: {"metrics": {"ttfb_ms": 245, "total_ms": 3200, "input_tokens": 1234, "output_tokens": 456, "tools_used": ["eks-list-clusters"]}}
```

### 카오스 엔지니어링 (Incident Agent)

#### `POST /api/chaos/trigger`
```json
{ "scenario": "cpu-stress", "params": {"duration": 60} }
```

#### `POST /api/chaos/cleanup`
모든 활성 카오스 시나리오를 정리합니다.

#### `GET /api/chaos/status`
현재 활성 카오스 시나리오 목록을 반환합니다.

### Fault Injection (Istio Agent)

#### `POST /api/fault/apply`
```json
{ "type": "delay", "params": {"delay_seconds": 5, "percentage": 50} }
```

#### `POST /api/fault/remove`
```json
{ "type": "delay" }
```

#### `POST /api/fault/cleanup`
모든 활성 fault injection을 제거합니다.

#### `GET /api/fault/status`
현재 활성 결함 목록을 반환합니다.

### 대시보드

#### `GET /api/dashboard?region=us-east-1`

지정된 리전의 AWS 인프라 개요를 반환합니다.

```json
{
  "vpcs": [...],
  "ec2_instances": [...],
  "load_balancers": [...],
  "nat_gateways": [...]
}
```

데이터는 60초 TTL로 리전별로 캐시됩니다.

## 인증

### M2M 토큰 흐름

```
1. Read client_id, client_secret from SSM Parameter Store
2. POST to Cognito token endpoint (client_credentials grant)
3. Receive Bearer token (3600s expiry)
4. Cache token for 3500s (with safety margin)
5. Include in Authorization header for AgentCore calls
```

### 토큰 캐싱 메커니즘

백엔드는 중복된 Cognito 토큰 교환을 방지하기 위해 에이전트별로 M2M 토큰을 인메모리 캐시합니다.

```python
_token_cache: dict = {}  # {agent_id -> {"token": str, "timestamp": float}}

def ensure_token(agent_id: str) -> Optional[str]:
    cached = _token_cache.get(agent_id)
    if cached and (time.time() - cached["timestamp"]) < 3500:
        return cached["token"]

    token = get_m2m_access_token(AGENTS[agent_id]["ssm_prefix"])
    if token:
        _token_cache[agent_id] = {"token": token, "timestamp": time.time()}
    return token
```

| 파라미터 | 값 | 비고 |
|-----------|-------|-------|
| 캐시 저장소 | 인메모리 `dict` | 프로세스 단위, 워커 간 공유되지 않음 |
| 캐시 키 | `agent_id` | 각 에이전트가 자체 캐시된 토큰 보유 |
| TTL | 3500초 | Cognito의 3600초 만료 전 100초 안전 마진 |
| 갱신 | Lazy | 캐시 미스 또는 만료 시에만 새 토큰 취득 |

`get_m2m_access_token()` 함수는 SSM에서 자격 증명(`machine_client_id`, `machine_client_secret`, `cognito_token_url`, `cognito_auth_scope`)을 읽고 Cognito 토큰 엔드포인트에 `client_credentials` grant POST를 수행합니다.

### 에이전트 ARN 확인

각 에이전트의 런타임 ARN은 SSM에 저장됩니다.

```
/app/incident/agentcore/agent_runtime_arn
/a2a/app/k8s/agentcore/agent_runtime_arn
/app/istio/agentcore/agent_runtime_arn
/app/network/agentcore/agent_runtime_arn
```

## 스트리밍 프로토콜

백엔드는 AgentCore와 프론트엔드 사이의 스트리밍 프록시 역할을 합니다.

1. **수신**: AgentCore로부터 HTTP chunked 응답 수신
2. **파싱**: 인밴드 마커(`__TOOLS_JSON__`, `__METRICS_JSON__`) 파싱
3. **전달**: 텍스트 콘텐츠를 SSE `data` 이벤트로 전달
4. **발신**: 타이밍 + 토큰 + 도구를 결합한 최종 `metrics` SSE 이벤트 발신

## Lambda 통합

Chaos 및 fault 작업은 Lambda 함수를 직접 호출합니다.

```python
lambda_client.invoke(
    FunctionName="incident-chaos-tools",
    InvocationType="RequestResponse",
    Payload=json.dumps({"name": tool_name, "arguments": params})
)
```
