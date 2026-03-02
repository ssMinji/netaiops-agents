# Cognito 인증 아키텍처

## 개요

각 에이전트는 OAuth2 인증을 위해 Cognito User Pool을 사용합니다. 시스템 전체에서 총 4개 이상의 User Pool이 사용됩니다.

## 인증 흐름

모든 에이전트-게이트웨이 통신은 Cognito M2M(machine-to-machine) 토큰을 사용합니다:

```
1. Backend reads client_id/secret from SSM Parameter Store
2. Backend exchanges credentials for Bearer token (Cognito client_credentials grant)
3. Token cached for 3500 seconds
4. Bearer token sent in Authorization header to AgentCore Runtime
5. AgentCore validates JWT against Cognito discovery URL
6. Agent uses OAuth2 credential provider for MCP Gateway access
```

### 이중 Cognito 풀 설계

각 에이전트는 두 개의 Cognito User Pool을 사용합니다:

| 풀 | 목적 | 사용처 |
|------|---------|---------|
| Agent Pool | 에이전트 런타임의 JWT 인증 | 백엔드 → 에이전트 |
| Runtime Pool | MCP Gateway의 OAuth2 자격 증명 | 에이전트 → MCP Gateway |

## User Pool 목록

| User Pool | 에이전트 | 도메인 접두사 | 목적 |
|-----------|-------|---------------|---------|
| `K8sAgentPool` | K8s Agent | `k8sagent` | 에이전트 → Gateway 인증 |
| `EksMcpServerPool` | K8s Agent (Runtime) | `eks-mcp` | Gateway → EKS MCP Server Runtime 인증 |
| `IncidentAnalysisPool` | Incident Agent | `incident-analysis` | 에이전트 → Gateway 인증 |
| `IstioMeshPool` | Istio Agent | `istioagent` | 에이전트 → Gateway 인증 |
| `NetworkAgentPool` | Network Agent | `networkagent` | 에이전트 → Gateway 인증 |

## 클라이언트 유형

### Machine Client (M2M)

- **OAuth flow**: `client_credentials`
- **Auth method**: Client ID + Client Secret
- **목적**: 서버 간 통신(에이전트 런타임, 백엔드 API, 스크립트)
- **주 사용처**: UI 백엔드(`app/backend/main.py`)가 AgentCore Runtime 호출
- `generateSecret: true`

## 인증 흐름

### 엔드투엔드 흐름

```
User → React Frontend → FastAPI Backend → Cognito (M2M token) → AgentCore Runtime
                                                                        │
                                                                   MCP Gateway
                                                                   ┌────┴────┐
                                                                   │         │
                                                          mcpServer target  Lambda target
                                                          (OAuth2 auth)    (IAM Role)
                                                                   │         │
                                                          EKS MCP Server  Lambda function
```

### 1. UI Backend → AgentCore Runtime (Machine Client)

```
React Frontend ──(no auth)──→ FastAPI Backend ──(Bearer token)──→ AgentCore Runtime
                                      │
                                      ├── Read machine_client_id from SSM
                                      ├── Read machine_client_secret from SSM
                                      ├── Exchange for token via Cognito client_credentials
                                      └── Call Runtime API with Bearer token
```

- 프론트엔드는 `/api/chat`에 인증 없이 요청 전송
- 백엔드는 서버 측에서 Cognito 토큰 교환을 처리한 후 Runtime 호출

### 2. MCP Gateway → EKS MCP Server (OAuth2)

```
MCP Gateway → OAuth2CredentialProvider → EksMcpServerPool → EKS MCP Server Runtime
                       │
                       ├── Uses EksMcpServerPool Machine Client credentials
                       └── scope: eks-mcp-server/invoke
```

- K8s Agent: CDK가 직접 Runtime Pool을 생성하고 OAuth2 Provider 구성
- Istio Agent: OAuth2 Provider를 위해 SSM에서 K8s Agent의 Runtime Pool 자격 증명을 읽음

### 3. MCP Gateway → Lambda (IAM Role)

```
MCP Gateway → GATEWAY_IAM_ROLE → Lambda Function
```

- OAuth2 인증 없음. Gateway의 IAM 역할이 Lambda를 직접 호출

## 에이전트별 상세

### K8s Agent

- **Agent Pool** (`K8sAgentPool`): 스코프 `gateway:read`, `gateway:write`, `invoke`
  - Machine Client: `K8sMachineClient` — UI 백엔드 Runtime 호출
- **Runtime Pool** (`EksMcpServerPool`): 스코프 `invoke`
  - Machine Client: `EksMcpServerClient`
  - EKS MCP Server 접근을 위해 Istio Agent Gateway가 공유

### Incident Agent

- **Auth Pool** (`IncidentAnalysisPool`): 스코프 `invoke`
  - Machine Client: `IncidentAnalysisMachineClient` — UI 백엔드 Runtime 호출
- Gateway는 Lambda 타겟만 사용하므로 Runtime Pool 불필요

### Istio Agent

- **Auth Pool** (`IstioMeshPool`): 스코프 `gateway:read`, `gateway:write`
  - Machine Client: `IstioMachineClient` — UI 백엔드 Runtime 호출
- EKS MCP Server 접근은 SSM에서 읽은 K8s Agent의 `EksMcpServerPool` 자격 증명 사용

### Network Agent

- **Auth Pool** (`NetworkAgentPool`): 게이트웨이 및 호출용 스코프
  - Machine Client — UI 백엔드 Runtime 호출
- 자체 OAuth2 Provider와 함께 Network MCP Server Runtime 사용

## SSM 파라미터

각 Pool의 자격 증명은 SSM Parameter Store에 저장됩니다.

| 파라미터 | 설명 |
|-----------|-------------|
| `{prefix}/machine_client_id` | Machine Client ID |
| `{prefix}/machine_client_secret` | Machine Client Secret |
| `{prefix}/cognito_token_url` | OAuth2 토큰 엔드포인트 |
| `{prefix}/cognito_discovery_url` | OIDC Discovery URL |
| `{prefix}/cognito_auth_scope` | 허용된 OAuth2 스코프 |
| `{prefix}/userpool_id` | User Pool ID |

**SSM 접두사:**
- K8s Agent: `/a2a/app/k8s/agentcore`
- K8s Runtime Pool: `/a2a/app/k8s/agentcore` (키 접두사: `eks_mcp_`)
- Incident Agent: `/app/incident/agentcore`
- Istio Agent: `/app/istio/agentcore`
- Network Agent: `/app/network/agentcore`
