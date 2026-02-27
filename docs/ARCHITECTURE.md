# NetAIOps Agent 아키텍처

## 전체 시스템 구성

```
ap-northeast-2 (Seoul)
======================

                         ┌─────────────────────────────────────────────┐
                         │              EKS Cluster                    │
                         │          (netaiops-eks-cluster)             │
                         │                                             │
                         │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
                         │  │ retail-  │ │ istio-   │ │ Istio      │  │
                         │  │ store    │ │ sample   │ │ + ADOT     │  │
                         │  │ (default)│ │ (Bookinfo│ │ + AMP      │  │
                         │  └──────────┘ └──────────┘ └────────────┘  │
                         └──────────┬──────────┬──────────┬───────────┘
                                    │          │          │
                    ┌───────────────┤          │          │
                    │               │          │          │
        ┌───────────▼────────┐  ┌──▼──────────▼──┐  ┌───▼─────────────────┐
        │   K8s Agent        │  │ Incident Agent  │  │   Istio Agent       │
        │                    │  │                 │  │                     │
        │ ┌────────────────┐ │  │ ┌─────────────┐ │  │ ┌────────────────┐  │
        │ │ Agent Runtime  │ │  │ │Agent Runtime│ │  │ │ Agent Runtime  │  │
        │ └───────┬────────┘ │  │ └──────┬──────┘ │  │ └───────┬────────┘  │
        │         │          │  │        │        │  │         │          │
        │ ┌───────▼────────┐ │  │ ┌──────▼──────┐ │  │ ┌───────▼────────┐  │
        │ │ MCP Gateway    │ │  │ │MCP Gateway  │ │  │ │ MCP Gateway    │  │
        │ │ (mcpServer)    │ │  │ │(Lambda x3)  │ │  │ │ (Hybrid)       │  │
        │ └───────┬────────┘ │  │ └──────┬──────┘ │  │ │ mcpServer +    │  │
        │         │          │  │        │        │  │ │ Lambda x1      │  │
        │ ┌───────▼────────┐ │  │   ┌────┴────┐   │  │ └──┬─────┬──────┘  │
        │ │ EKS MCP Server │ │  │   │ Lambda  │   │  │    │     │         │
        │ │ Runtime        │◄├──┼───┼─────────┼───┼──┤    │     │         │
        │ └────────────────┘ │  │   │ x6 총   │   │  │    │     │         │
        │                    │  │   └─────────┘   │  │    │     │         │
        │ ┌────────────────┐ │  │ ┌─────────────┐ │  │    │     │         │
        │ │ Cognito        │ │  │ │ Cognito     │ │  │ ┌──▼──┐ ┌▼──────┐  │
        │ │ (Agent Pool +  │ │  │ │             │ │  │ │EKS  │ │Prom.  │  │
        │ │  Runtime Pool) │ │  │ └─────────────┘ │  │ │MCP  │ │Lambda │  │
        │ └────────────────┘ │  │ ┌─────────────┐ │  │ │재사용│ └───────┘  │
        │                    │  │ │ SNS + Alarm │ │  │ └─────┘            │
        │                    │  │ │ (모니터링)  │ │  │ ┌────────────────┐  │
        │                    │  │ └─────────────┘ │  │ │ Cognito        │  │
        └────────────────────┘  └─────────────────┘  │ └────────────────┘  │
                                                     └─────────────────────┘
```

---

## 1. K8s Agent 아키텍처

EKS 클러스터 진단 에이전트. **MCP Server Runtime** 방식으로 도구를 제공한다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          K8s Agent Stack                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Cognito                                                     │   │
│  │  ┌────────────────────────┐  ┌─────────────────────────────┐ │   │
│  │  │ K8sAgentPool           │  │ EksMcpServerPool            │ │   │
│  │  │ (Agent 인증)            │  │ (Runtime 인증)              │ │   │
│  │  │                        │  │                             │ │   │
│  │  │ - MachineClient (M2M)  │  │ - MachineClient (M2M)      │ │   │
│  │  │ - WebClient (UI용)     │  │   → Gateway가 사용          │ │   │
│  │  └────────────────────────┘  └─────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  MCP Gateway (k8s-diagnostics-gateway)                       │   │
│  │                                                               │   │
│  │  인증: K8sAgentPool JWT                                       │   │
│  │                                                               │   │
│  │  ┌──────────────────────────────────────────────────────┐     │   │
│  │  │ Target: EksMcpServer (mcpServer 타입)                │     │   │
│  │  │                                                      │     │   │
│  │  │ Endpoint: EKS MCP Server Runtime URL                 │     │   │
│  │  │ Auth: OAuth2 (EksMcpServerPool credentials)          │     │   │
│  │  │                                                      │     │   │
│  │  │ 도구: set_aws_region, list_eks_clusters,             │     │   │
│  │  │       list_k8s_resources, manage_k8s_resource,       │     │   │
│  │  │       get_pod_logs, get_k8s_events, get_eks_insights,│     │   │
│  │  │       get_cloudwatch_logs, get_cloudwatch_metrics,   │     │   │
│  │  │       get_eks_vpc_config, get_policies_for_role,     │     │   │
│  │  │       apply_yaml, manage_eks_stacks, ...             │     │   │
│  │  └──────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Runtimes                                                     │   │
│  │                                                               │   │
│  │  ┌─────────────────────────┐  ┌────────────────────────────┐  │   │
│  │  │ K8s Agent Runtime       │  │ EKS MCP Server Runtime     │  │   │
│  │  │ (agentcore deploy)      │  │ (agentcore deploy)         │  │   │
│  │  │                         │  │                            │  │   │
│  │  │ Strands Agent           │  │ awslabs.eks-mcp-server     │  │   │
│  │  │ + Claude Opus 4.6       │  │ + Streamable HTTP          │  │   │
│  │  │ + MCP Gateway Client    │  │ + 커스텀 리전/클러스터 도구 │  │   │
│  │  │ + Memory (SESSION_SUM.) │  │ + write=false (읽기전용)   │  │   │
│  │  └─────────────────────────┘  └────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  데이터 흐름:                                                        │
│  User → Agent Runtime → MCP Gateway ──OAuth2──→ EKS MCP Server     │
│                                                   ↓                 │
│                                              EKS API (K8s API)      │
│                                              CloudWatch Logs/Metrics │
└─────────────────────────────────────────────────────────────────────┘
```

### K8s Agent 특이사항

- **이중 Cognito Pool**: Agent 인증(K8sAgentPool)과 Runtime 인증(EksMcpServerPool)이 분리
- **Gateway → Runtime OAuth2**: Gateway가 EKS MCP Server를 호출할 때 별도 OAuth2 인증 수행
- **EKS MCP Server는 CLI 배포**: CDK가 아닌 `agentcore deploy`로 배포 → ARN을 SSM에 수동 저장
- **Istio Agent가 EKS MCP Server 재사용**: SSM을 통해 ARN/OAuth 정보 공유

---

## 2. Incident Agent 아키텍처

인시던트 자동 분석 에이전트. **Lambda** 방식으로 도구를 제공한다.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Incident Agent Stack                              │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Cognito (IncidentAnalysisPool)                                   │   │
│  │  - MachineClient (M2M)                                            │   │
│  │  - WebClient (UI용)                                               │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Lambda Functions (6개 Docker Lambda, 공통 IAM Role)              │   │
│  │                                                                   │   │
│  │  ┌─ Gateway 연결 (Agent가 호출) ──────────────────────────────┐   │   │
│  │  │                                                            │   │   │
│  │  │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────┐ │   │   │
│  │  │  │ incident-        │ │ incident-        │ │ incident-  │ │   │   │
│  │  │  │ datadog-tools    │ │ opensearch-tools │ │ container- │ │   │   │
│  │  │  │                  │ │                  │ │ insight-   │ │   │   │
│  │  │  │ 4 tools:         │ │ 3 tools:         │ │ tools      │ │   │   │
│  │  │  │ query-metrics    │ │ search-logs      │ │            │ │   │   │
│  │  │  │ get-events       │ │ anomaly-detection│ │ 3 tools:   │ │   │   │
│  │  │  │ get-traces       │ │ get-error-summary│ │ pod-metrics│ │   │   │
│  │  │  │ get-monitors     │ │                  │ │ node-metric│ │   │   │
│  │  │  │                  │ │                  │ │ cluster-   │ │   │   │
│  │  │  │                  │ │                  │ │ overview   │ │   │   │
│  │  │  └──────────────────┘ └──────────────────┘ └────────────┘ │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                   │   │
│  │  ┌─ Gateway 미연결 (UI/시스템이 직접 호출) ───────────────────┐   │   │
│  │  │                                                            │   │   │
│  │  │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────┐ │   │   │
│  │  │  │ incident-        │ │ incident-        │ │ incident-  │ │   │   │
│  │  │  │ chaos-tools      │ │ alarm-trigger    │ │ github-    │ │   │   │
│  │  │  │                  │ │                  │ │ tools      │ │   │   │
│  │  │  │ UI 버튼 →        │ │ SNS → Lambda    │ │            │ │   │   │
│  │  │  │ FastAPI →        │ │ (자동 트리거)     │ │ Jira 대체  │ │   │   │
│  │  │  │ Lambda invoke    │ │                  │ │ 테스트용   │ │   │   │
│  │  │  └──────────────────┘ └──────────────────┘ └────────────┘ │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  MCP Gateway (incident-analysis-gateway)                          │   │
│  │                                                                   │   │
│  │  인증: IncidentAnalysisPool JWT                                   │   │
│  │                                                                   │   │
│  │  Target 1: DatadogTools (Lambda) ─── 4 tool schemas               │   │
│  │  Target 2: OpenSearchTools (Lambda) ─ 3 tool schemas              │   │
│  │  Target 3: ContainerInsightTools (Lambda) ─ 3 tool schemas        │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Runtime (incident_analysis_agent_runtime)                        │   │
│  │                                                                   │   │
│  │  Strands Agent + Claude Opus 4.6 + MCP Gateway Client             │   │
│  │  Memory: NO_MEMORY                                                │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Monitoring (CloudWatch Alarms + SNS)                             │   │
│  │                                                                   │   │
│  │  CloudWatch Alarm ──→ SNS Topic ──→ alarm-trigger Lambda          │   │
│  │                      (netaiops-incident-alarm-topic)               │   │
│  │                                                                   │   │
│  │  Alarms:                                                          │   │
│  │  - netaiops-cpu-spike      (Pod CPU > 80%)                        │   │
│  │  - netaiops-pod-restarts   (Container restarts > 3/5min)          │   │
│  │  - netaiops-node-cpu-high  (Node CPU > 85%)                       │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  데이터 흐름:                                                             │
│                                                                          │
│  (수동) User → Agent Runtime → Gateway → Lambda → Datadog/OpenSearch/CW  │
│  (자동) CW Alarm → SNS → alarm-trigger Lambda → Agent Runtime (자동분석)  │
│  (UI)   FaultPanel → FastAPI → chaos Lambda → EKS API (장애주입)          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Istio Agent 아키텍처

Istio 서비스 메시 진단 에이전트. **하이브리드**(mcpServer + Lambda) 방식으로 도구를 제공한다.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Istio Agent Stack                               │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Cognito (IstioMeshPool)                                          │   │
│  │  - MachineClient (M2M)                                            │   │
│  │  - WebClient (UI용)                                               │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Lambda Functions (2개 Docker Lambda, 공통 IAM Role)              │   │
│  │                                                                   │   │
│  │  ┌─ Gateway 연결 ──────────────┐  ┌─ Gateway 미연결 ──────────┐  │   │
│  │  │                             │  │                           │  │   │
│  │  │  ┌───────────────────────┐  │  │  ┌─────────────────────┐  │  │   │
│  │  │  │ istio-prometheus-     │  │  │  │ istio-fault-tools   │  │  │   │
│  │  │  │ tools                 │  │  │  │                     │  │  │   │
│  │  │  │                       │  │  │  │ UI 버튼 →            │  │  │   │
│  │  │  │ 5 tools:              │  │  │  │ FastAPI →            │  │  │   │
│  │  │  │ query-workload-metrics│  │  │  │ Lambda invoke        │  │  │   │
│  │  │  │ query-service-topology│  │  │  │                     │  │  │   │
│  │  │  │ query-tcp-metrics     │  │  │  │ 4 tools:             │  │  │   │
│  │  │  │ query-control-plane   │  │  │  │ delay-inject         │  │  │   │
│  │  │  │ query-proxy-resource  │  │  │  │ abort-inject         │  │  │   │
│  │  │  │                       │  │  │  │ circuit-breaker      │  │  │   │
│  │  │  │ (AMP 쿼리)            │  │  │  │ cleanup              │  │  │   │
│  │  │  └───────────────────────┘  │  │  └─────────────────────┘  │  │   │
│  │  └─────────────────────────────┘  └───────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  MCP Gateway (istio-mesh-gateway) — 하이브리드 구성               │   │
│  │                                                                   │   │
│  │  인증: IstioMeshPool JWT                                          │   │
│  │                                                                   │   │
│  │  ┌───────────────────────────────────────────────────────────┐    │   │
│  │  │ Target 1: EksMcpServer (mcpServer 타입)                   │    │   │
│  │  │                                                           │    │   │
│  │  │ K8s Agent의 EKS MCP Server Runtime 재사용                  │    │   │
│  │  │ Auth: OAuth2 (K8s Agent의 EksMcpServerPool credentials)   │    │   │
│  │  │ SSM 크로스 참조: /a2a/app/k8s/agentcore/* 에서 읽음        │    │   │
│  │  │                                                           │    │   │
│  │  │ 도구: list_k8s_resources, get_pod_logs, get_k8s_events,  │    │   │
│  │  │       set_aws_region, list_eks_clusters, ...              │    │   │
│  │  └───────────────────────────────────────────────────────────┘    │   │
│  │                                                                   │   │
│  │  ┌───────────────────────────────────────────────────────────┐    │   │
│  │  │ Target 2: IstioPrometheusTools (Lambda 타입)              │    │   │
│  │  │                                                           │    │   │
│  │  │ Auth: Gateway IAM Role (Lambda invoke 권한)                │    │   │
│  │  │ 5 tool schemas inline                                     │    │   │
│  │  └───────────────────────────────────────────────────────────┘    │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  Runtime (a2a_istio_mesh_agent_runtime)                           │   │
│  │                                                                   │   │
│  │  Strands Agent + Claude Opus 4.6 + MCP Gateway Client             │   │
│  │  읽기 전용 진단 (fault injection은 UI 담당)                        │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  데이터 흐름:                                                             │
│                                                                          │
│  User → Agent Runtime → Gateway ─┬─ OAuth2 → EKS MCP Server → K8s API   │
│                                  └─ IAM   → Prometheus Lambda → AMP      │
│                                                                          │
│  (UI) FaultPanel → FastAPI → fault Lambda → EKS API (VirtualService)     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Istio Agent 크로스 스택 의존관계

```
K8s Agent Stack (먼저 배포)                     Istio Agent Stack (나중 배포)
┌──────────────────────────────┐               ┌──────────────────────────────┐
│                              │   SSM 참조     │                              │
│  EksMcpServerPool            │──────────────→│  Istio Gateway               │
│  ├─ machine_client_id        │               │  ├─ OAuth2Provider           │
│  ├─ machine_client_secret    │               │  │  (K8s Runtime Pool creds)  │
│  ├─ cognito_token_url        │               │  │                            │
│  └─ cognito_auth_scope       │               │  └─ EksMcpServer Target       │
│                              │               │     (EKS MCP Server endpoint) │
│  EKS MCP Server Runtime      │──────────────→│                              │
│  └─ eks_mcp_server_arn       │               │                              │
└──────────────────────────────┘               └──────────────────────────────┘
```

---

## SSM 파라미터 상세

### 공통 패턴

각 Agent의 Cognito, Gateway, Runtime 리소스가 생성 시 SSM에 자동으로 파라미터를 저장한다.
Agent 코드(Python)는 런타임에 SSM에서 값을 읽어 MCP Gateway에 연결한다.

```
{ssmPrefix}/
├── Cognito (CognitoAuth construct)
│   ├── userpool_id                  # Cognito User Pool ID
│   ├── machine_client_id            # M2M 클라이언트 ID
│   ├── machine_client_secret        # M2M 클라이언트 시크릿
│   ├── web_client_id                # Web 클라이언트 ID (있는 경우)
│   ├── cognito_discovery_url        # OIDC Discovery URL
│   ├── cognito_token_url            # OAuth2 토큰 엔드포인트
│   ├── cognito_auth_url             # OAuth2 인가 엔드포인트
│   ├── cognito_domain               # Cognito 도메인 URL
│   ├── cognito_auth_scope           # OAuth2 스코프 문자열
│   └── cognito_provider             # Cognito 도메인 프리픽스
│
├── Gateway (McpGateway construct)
│   ├── gateway_id                   # Gateway ID
│   ├── gateway_name                 # Gateway 이름
│   ├── gateway_arn                  # Gateway ARN
│   └── gateway_url                  # Gateway 엔드포인트 URL ★
│
├── Runtime (runtime-stack)
│   ├── runtime_arn                  # AgentCore Runtime ARN
│   └── runtime_name                 # Runtime 이름
│
└── IAM (cognito-stack)
    └── gateway_iam_role             # Gateway 실행 역할 ARN
```

> ★ `gateway_url`은 Agent Python 코드가 MCP Gateway에 연결할 때 사용하는 핵심 파라미터다.

---

### K8s Agent SSM 파라미터

**Prefix: `/a2a/app/k8s/agentcore`**

| 파라미터 | 생성 주체 | 소비자 | 설명 |
|----------|-----------|--------|------|
| `userpool_id` | CDK (CognitoAuth) | Agent Python | K8sAgentPool User Pool ID |
| `machine_client_id` | CDK (CognitoAuth) | Agent Python | K8sAgentPool M2M 클라이언트 ID |
| `machine_client_secret` | CDK (CognitoAuth) | Agent Python | K8sAgentPool M2M 클라이언트 시크릿 |
| `web_client_id` | CDK (CognitoAuth) | UI (Streamlit) | K8sAgentPool Web 클라이언트 ID |
| `cognito_discovery_url` | CDK (CognitoAuth) | CDK Gateway | OIDC Discovery URL (JWT 검증용) |
| `cognito_token_url` | CDK (CognitoAuth) | Agent Python | OAuth2 토큰 엔드포인트 |
| `cognito_auth_url` | CDK (CognitoAuth) | UI (Streamlit) | OAuth2 인가 엔드포인트 |
| `cognito_domain` | CDK (CognitoAuth) | UI (Streamlit) | Cognito 도메인 |
| `cognito_auth_scope` | CDK (CognitoAuth) | Agent Python | `netops-a2a-server/gateway:read netops-a2a-server/gateway:write netops-a2a-server/invoke` |
| `cognito_provider` | CDK (CognitoAuth) | — | 도메인 프리픽스 |
| `eks_mcp_userpool_id` | CDK (CognitoAuth, prefix=eks_mcp_) | deploy script | EksMcpServerPool User Pool ID |
| `eks_mcp_machine_client_id` | CDK (CognitoAuth, prefix=eks_mcp_) | **Istio Gateway** | EksMcpServerPool M2M 클라이언트 ID |
| `eks_mcp_machine_client_secret` | CDK (CognitoAuth, prefix=eks_mcp_) | **Istio Gateway** | EksMcpServerPool M2M 클라이언트 시크릿 |
| `eks_mcp_cognito_discovery_url` | CDK (CognitoAuth, prefix=eks_mcp_) | deploy script | OIDC Discovery URL |
| `eks_mcp_cognito_token_url` | CDK (CognitoAuth, prefix=eks_mcp_) | **Istio Gateway** | OAuth2 토큰 엔드포인트 |
| `eks_mcp_cognito_auth_url` | CDK (CognitoAuth, prefix=eks_mcp_) | — | OAuth2 인가 엔드포인트 |
| `eks_mcp_cognito_domain` | CDK (CognitoAuth, prefix=eks_mcp_) | — | Cognito 도메인 |
| `eks_mcp_cognito_auth_scope` | CDK (CognitoAuth, prefix=eks_mcp_) | **Istio Gateway** | `eks-mcp-server/invoke` |
| `eks_mcp_cognito_provider` | CDK (CognitoAuth, prefix=eks_mcp_) | — | 도메인 프리픽스 |
| `gateway_id` | CDK (McpGateway) | — | Gateway ID |
| `gateway_name` | CDK (McpGateway) | — | `k8s-diagnostics-gateway` |
| `gateway_arn` | CDK (McpGateway) | — | Gateway ARN |
| `gateway_url` | CDK (McpGateway) | **Agent Python** | Gateway 엔드포인트 URL |
| `gateway_iam_role` | CDK (cognito-stack) | — | Gateway IAM Role ARN |
| `runtime_arn` | CDK (runtime-stack) | — | Agent Runtime ARN |
| `runtime_name` | CDK (runtime-stack) | — | `a2a_k8s_agent_runtime` |
| `eks_mcp_server_arn` | **CLI** (deploy script) | **K8s Gateway, Istio Gateway** | EKS MCP Server Runtime ARN |

> **주의**: `eks_mcp_server_arn`은 CDK가 아닌 `deploy-eks-mcp-server.sh`가 생성한다.
> 첫 배포 시 `deploy.sh`가 placeholder를 미리 생성하고, Phase 3 후 실제 ARN으로 교체 → K8sAgentStack 재배포한다.

---

### Incident Agent SSM 파라미터

**Prefix: `/app/incident/agentcore`**

| 파라미터 | 생성 주체 | 소비자 | 설명 |
|----------|-----------|--------|------|
| `userpool_id` | CDK (CognitoAuth) | Agent Python | IncidentAnalysisPool User Pool ID |
| `machine_client_id` | CDK (CognitoAuth) | Agent Python | M2M 클라이언트 ID |
| `machine_client_secret` | CDK (CognitoAuth) | Agent Python | M2M 클라이언트 시크릿 |
| `web_client_id` | CDK (CognitoAuth) | UI (Streamlit) | Web 클라이언트 ID |
| `cognito_discovery_url` | CDK (CognitoAuth) | CDK Gateway | OIDC Discovery URL |
| `cognito_token_url` | CDK (CognitoAuth) | Agent Python | OAuth2 토큰 엔드포인트 |
| `cognito_auth_url` | CDK (CognitoAuth) | UI | OAuth2 인가 엔드포인트 |
| `cognito_domain` | CDK (CognitoAuth) | UI | Cognito 도메인 |
| `cognito_auth_scope` | CDK (CognitoAuth) | Agent Python | `incident-resource-server/invoke` |
| `cognito_provider` | CDK (CognitoAuth) | — | 도메인 프리픽스 |
| `gateway_id` | CDK (McpGateway) | — | Gateway ID |
| `gateway_name` | CDK (McpGateway) | — | `incident-analysis-gateway` |
| `gateway_arn` | CDK (McpGateway) | — | Gateway ARN |
| `gateway_url` | CDK (McpGateway) | **Agent Python** | Gateway 엔드포인트 URL |
| `gateway_iam_role` | CDK (cognito-stack) | — | Gateway IAM Role ARN |
| `runtime_arn` | CDK (runtime-stack) | — | Agent Runtime ARN |
| `runtime_name` | CDK (runtime-stack) | — | `incident_analysis_agent_runtime` |
| `datadog_lambda_arn` | CDK (lambda-stack) | — | Datadog Lambda ARN |
| `opensearch_lambda_arn` | CDK (lambda-stack) | — | OpenSearch Lambda ARN |
| `container_insight_lambda_arn` | CDK (lambda-stack) | — | Container Insight Lambda ARN |
| `chaos_lambda_arn` | CDK (lambda-stack) | **UI (FastAPI)** | Chaos Lambda ARN |
| `alarm_trigger_lambda_arn` | CDK (lambda-stack) | CDK (monitoring) | Alarm Trigger Lambda ARN |
| `github_lambda_arn` | CDK (lambda-stack) | — | GitHub Lambda ARN |
| `sns_topic_arn` | CDK (CrossRegionAlarm) | — | SNS 토픽 ARN |

**외부 서비스 파라미터** (수동 생성, Prefix: `/app/incident/`):

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `datadog/api_key` | SecureString | Datadog API Key (선택) |
| `datadog/app_key` | SecureString | Datadog App Key (선택) |
| `datadog/site` | String | Datadog 사이트 (예: `us5.datadoghq.com`) |
| `opensearch/endpoint` | String | OpenSearch 도메인 엔드포인트 |
| `github/pat` | SecureString | GitHub Personal Access Token |
| `github/repo` | String | GitHub 리포지토리 (예: `owner/repo`) |

---

### Istio Agent SSM 파라미터

**Prefix: `/app/istio/agentcore`**

| 파라미터 | 생성 주체 | 소비자 | 설명 |
|----------|-----------|--------|------|
| `userpool_id` | CDK (CognitoAuth) | Agent Python | IstioMeshPool User Pool ID |
| `machine_client_id` | CDK (CognitoAuth) | Agent Python | M2M 클라이언트 ID |
| `machine_client_secret` | CDK (CognitoAuth) | Agent Python | M2M 클라이언트 시크릿 |
| `web_client_id` | CDK (CognitoAuth) | UI (Streamlit) | Web 클라이언트 ID |
| `cognito_discovery_url` | CDK (CognitoAuth) | CDK Gateway | OIDC Discovery URL |
| `cognito_token_url` | CDK (CognitoAuth) | Agent Python | OAuth2 토큰 엔드포인트 |
| `cognito_auth_url` | CDK (CognitoAuth) | UI | OAuth2 인가 엔드포인트 |
| `cognito_domain` | CDK (CognitoAuth) | UI | Cognito 도메인 |
| `cognito_auth_scope` | CDK (CognitoAuth) | Agent Python | `istio-mesh-server/gateway:read istio-mesh-server/gateway:write` |
| `cognito_provider` | CDK (CognitoAuth) | — | 도메인 프리픽스 |
| `gateway_id` | CDK (McpGateway) | — | Gateway ID |
| `gateway_name` | CDK (McpGateway) | — | `istio-mesh-gateway` |
| `gateway_arn` | CDK (McpGateway) | — | Gateway ARN |
| `gateway_url` | CDK (McpGateway) | **Agent Python** | Gateway 엔드포인트 URL |
| `gateway_iam_role` | CDK (cognito-stack) | — | Gateway IAM Role ARN |
| `runtime_arn` | CDK (runtime-stack) | — | Agent Runtime ARN |
| `runtime_name` | CDK (runtime-stack) | — | `a2a_istio_mesh_agent_runtime` |
| `prometheus_lambda_arn` | CDK (lambda-stack) | — | Prometheus Lambda ARN |
| `fault_lambda_arn` | CDK (lambda-stack) | **UI (FastAPI)** | Fault Lambda ARN |

**크로스 스택 참조** (Istio Gateway가 K8s Agent SSM에서 읽는 파라미터):

| 참조 파라미터 (K8s Agent 소유) | Istio Gateway에서의 용도 |
|-------------------------------|-------------------------|
| `/a2a/app/k8s/agentcore/eks_mcp_machine_client_id` | OAuth2 Provider 클라이언트 ID |
| `/a2a/app/k8s/agentcore/eks_mcp_machine_client_secret` | OAuth2 Provider 클라이언트 시크릿 |
| `/a2a/app/k8s/agentcore/eks_mcp_cognito_token_url` | OAuth2 토큰 엔드포인트 |
| `/a2a/app/k8s/agentcore/eks_mcp_cognito_auth_scope` | OAuth2 스코프 |
| `/a2a/app/k8s/agentcore/eks_mcp_server_arn` | EKS MCP Server 엔드포인트 URL 구성 |

---

## SSM 파라미터 흐름도

```
                        CDK 배포 시                     런타임 시
                        ═══════════                     ════════════

 ┌─────────────────┐    SSM 쓰기      ┌──────────────┐    SSM 읽기     ┌──────────────┐
 │ CognitoAuth     │ ──────────────→ │              │ ─────────────→ │ Agent Python │
 │ (CDK construct) │   userpool_id   │              │   gateway_url  │ (agent.py)   │
 └─────────────────┘   client_id     │              │   token_url    │              │
                       client_secret  │              │   client_id    │ MCPClient(   │
 ┌─────────────────┐   token_url     │     SSM      │   client_secret│   gateway_url│
 │ McpGateway      │ ──────────────→ │  Parameter   │                │ )            │
 │ (CDK construct) │   gateway_url   │    Store     │                └──────────────┘
 └─────────────────┘   gateway_id    │              │
                       gateway_arn    │              │    SSM 읽기     ┌──────────────┐
 ┌─────────────────┐                 │              │ ─────────────→ │ CDK Gateway  │
 │ deploy-eks-     │   eks_mcp_      │              │  eks_mcp_      │ (deploy 시   │
 │ mcp-server.sh   │ ──server_arn──→ │              │  server_arn    │  resolve)    │
 │ (CLI)           │                 │              │                │              │
 └─────────────────┘                 └──────────────┘                └──────────────┘
                                            ↑
 ┌─────────────────┐                        │
 │ deploy.sh       │   placeholder          │
 │ (첫 배포 시)     │ ──(eks_mcp_server_arn)─┘
 └─────────────────┘
```

### SSM 의존 관계와 첫 배포 순서

```
Phase 1 (CDK deploy --all)
│
├── K8sAgentStack
│   ├── CognitoAuth → SSM 쓰기: userpool_id, client_id, ...
│   ├── CognitoAuth(eks_mcp_) → SSM 쓰기: eks_mcp_client_id, ...
│   ├── Gateway → SSM 읽기: eks_mcp_server_arn ← ★ 이 시점에 placeholder
│   │            SSM 쓰기: gateway_url, gateway_id, ...
│   └── Runtime → SSM 쓰기: runtime_arn, runtime_name
│
├── IncidentAgentStack
│   ├── CognitoAuth → SSM 쓰기
│   ├── Lambda x6 → SSM 쓰기: *_lambda_arn
│   ├── Gateway → SSM 쓰기: gateway_url, ...
│   ├── Runtime → SSM 쓰기: runtime_arn, ...
│   └── Monitoring → SSM 쓰기: sns_topic_arn
│
└── IstioAgentStack (K8sAgentStack 이후)
    ├── CognitoAuth → SSM 쓰기
    ├── Lambda x2 → SSM 쓰기: *_lambda_arn
    ├── Gateway → SSM 읽기: eks_mcp_server_arn, eks_mcp_client_id, ... ← K8s SSM
    │            SSM 쓰기: gateway_url, ...
    └── Runtime → SSM 쓰기: runtime_arn, ...

Phase 2 (EKS RBAC)
│  RBAC만 설정, SSM 관련 없음

Phase 3 (EKS MCP Server deploy)
│  SSM 읽기: eks_mcp_cognito_* (JWT Authorizer 설정)
│  SSM 쓰기: eks_mcp_server_arn ← ★ 실제 ARN으로 교체
│
│  첫 배포 시 → K8sAgentStack 재배포 (실제 ARN 반영)

Phase 4 (Agent deploy)
│  각 Agent가 SSM에서 gateway_url 읽어 MCP Gateway 연결
```
