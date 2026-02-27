# Cognito User Pool 아키텍처

## 개요

각 에이전트는 Cognito User Pool을 통해 OAuth2 인증을 수행합니다. 총 4개의 User Pool이 사용됩니다.

## User Pool 목록

| User Pool | 에이전트 | Domain Prefix | 용도 |
|-----------|---------|---------------|------|
| `K8sAgentPool` | K8s Agent | `k8sagent` | 에이전트 → Gateway 인증 |
| `EksMcpServerPool` | K8s Agent (Runtime) | `eks-mcp` | Gateway → EKS MCP Server Runtime 인증 |
| `IncidentAnalysisPool` | Incident Agent | `incident-analysis` | 에이전트 → Gateway 인증 |
| `IstioMeshPool` | Istio Agent | `istioagent` | 에이전트 → Gateway 인증 |

## 클라이언트 유형

### Machine Client (M2M)

- **OAuth 플로우**: `client_credentials`
- **인증 방식**: Client ID + Client Secret
- **용도**: 서버 간 통신 (에이전트 런타임, 백엔드 API, 스크립트)
- **현재 사용처**: UI 백엔드(`app/backend/main.py`)에서 AgentCore Runtime 호출 시 사용
- `generateSecret: true`

### Web Client

- **OAuth 플로우**: `authorization_code` (PKCE)
- **인증 방식**: 브라우저 로그인 → 콜백 URL로 토큰 수신
- **용도**: 테스트/개발 환경에서 PKCE 플로우로 에이전트 직접 호출 테스트 (`test_agent.py`)
- **현재 사용처**: `k8s-agent/agent/test/test_agent.py`에서 Web Client ID + PKCE로 에이전트 동작 검증
- `generateSecret: false`

## 인증 흐름

### 전체 E2E 흐름

```
사용자 → React Frontend → FastAPI Backend → Cognito (M2M 토큰) → AgentCore Runtime
                                                                        │
                                                                   MCP Gateway
                                                                   ┌────┴────┐
                                                                   │         │
                                                          mcpServer 타겟  Lambda 타겟
                                                          (OAuth2 인증)  (IAM Role)
                                                                   │         │
                                                          EKS MCP Server  Lambda 함수
```

### 1. UI 백엔드 → AgentCore Runtime (Machine Client)

```
React Frontend ──(인증 없음)──→ FastAPI Backend ──(Bearer 토큰)──→ AgentCore Runtime
                                      │
                                      ├── SSM에서 machine_client_id 조회
                                      ├── SSM에서 machine_client_secret 조회
                                      ├── Cognito에 client_credentials로 토큰 발급
                                      └── Bearer 토큰으로 Runtime API 호출
```

- 프론트엔드는 인증 없이 `/api/chat`으로 요청
- 백엔드가 서버 사이드에서 Machine Client로 Cognito 토큰 발급 후 Runtime 호출

### 2. 테스트 CLI → AgentCore Runtime (Web Client)

```
test_agent.py → 브라우저 Cognito 로그인 (PKCE) → authorization code → access token → Runtime
```

- `test_agent.py`에서 Web Client ID + PKCE로 사용자 인증
- 브라우저에서 로그인 후 리다이렉트 URL의 code를 토큰으로 교환
- UI 백엔드 없이 AgentCore Runtime을 직접 호출하여 에이전트 동작 검증

### 3. MCP Gateway → EKS MCP Server (OAuth2)

```
MCP Gateway → OAuth2CredentialProvider → EksMcpServerPool → EKS MCP Server Runtime
                       │
                       ├── EksMcpServerPool의 Machine Client 자격증명 사용
                       └── scope: eks-mcp-server/invoke
```

- K8s Agent: CDK에서 직접 Runtime Pool 생성 및 OAuth2 Provider 구성
- Istio Agent: K8s Agent의 SSM에 저장된 Runtime Pool 자격증명을 읽어 OAuth2 Provider 구성

### 4. MCP Gateway → Lambda (IAM Role)

```
MCP Gateway → GATEWAY_IAM_ROLE → Lambda Function
```

- OAuth2 인증 없이 Gateway의 IAM 역할로 Lambda를 직접 호출

## 에이전트별 상세

### K8s Agent

- **Agent Pool** (`K8sAgentPool`): scopes `gateway:read`, `gateway:write`, `invoke`
  - Machine Client: `K8sMachineClient` — UI 백엔드에서 Runtime 호출용
  - Web Client: `K8sWebClient` — `test_agent.py`에서 PKCE 테스트용
- **Runtime Pool** (`EksMcpServerPool`): scope `invoke`
  - Machine Client: `EksMcpServerClient`
  - Istio Agent Gateway에서도 이 Pool의 자격증명을 공유 사용

### Incident Agent

- **Auth Pool** (`IncidentAnalysisPool`): scope `invoke`
  - Machine Client: `IncidentAnalysisMachineClient` — UI 백엔드에서 Runtime 호출용
  - Web Client: `IncidentAnalysisWebClient` — 테스트용
- Gateway는 Lambda 타겟만 사용하므로 Runtime Pool 불필요

### Istio Agent

- **Auth Pool** (`IstioMeshPool`): scopes `gateway:read`, `gateway:write`
  - Machine Client: `IstioMachineClient` — UI 백엔드에서 Runtime 호출용
  - Web Client: `IstioWebClient` — 테스트용
- EKS MCP Server 접근 시 K8s Agent의 `EksMcpServerPool` 자격증명을 SSM에서 읽어 사용

## SSM 파라미터

각 Pool의 자격증명은 SSM Parameter Store에 저장됩니다:

| 파라미터 | 설명 |
|---------|------|
| `{prefix}/machine_client_id` | Machine Client ID |
| `{prefix}/machine_client_secret` | Machine Client Secret |
| `{prefix}/cognito_token_url` | OAuth2 토큰 엔드포인트 |
| `{prefix}/cognito_discovery_url` | OIDC Discovery URL |
| `{prefix}/cognito_auth_scope` | 허용된 OAuth2 scope |
| `{prefix}/web_client_id` | Web Client ID (존재 시) |
| `{prefix}/userpool_id` | User Pool ID |

**SSM Prefix:**
- K8s Agent: `/a2a/app/k8s/agentcore`
- K8s Runtime Pool: `/a2a/app/k8s/agentcore` (키 prefix: `eks_mcp_`)
- Incident Agent: `/app/incident/agentcore`
- Istio Agent: `/app/istio/agentcore`
