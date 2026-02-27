# IAM & RBAC 권한 구조

NetAIOps 플랫폼의 IAM Role, K8s RBAC, AgentCore Token Vault 인증 구조를 정리한 문서.

## 아키텍처 개요

```
                        [AgentCore Token Vault]
                         /                   \
                   (M2M 토큰)           (OAuth2 토큰)
                       /                       \
User → Chat Backend → Agent Runtime → Gateway → MCP Server Runtime
                           |                         ↕
                           +----→ Lambda ----→ EKS K8s API
```

- **Agent Runtime**: LLM 기반 에이전트 (직접 K8s API 호출하지 않음)
- **Gateway**: Runtime의 Tool 요청을 MCP Server 또는 Lambda로 라우팅
- **MCP Server Runtime**: K8s API 읽기 전용 프록시
- **Lambda**: K8s 변경 작업 (chaos, fault injection) 및 외부 도구 (CloudWatch, Datadog, OpenSearch, Prometheus)

---

## 1. IAM Roles

### 1.1 Module 3 - Performance Agent

| 항목 | 값 |
|------|-----|
| **Role Name** | `{StackName}-gateway-execution-role` (예: `performance-gateway-execution-role`) |
| **Assume Role** | `bedrock-agentcore.amazonaws.com`, `lambda.amazonaws.com` |
| **CFN 파일** | `cfn_stack/a2a-performance-agentcore-cognito.yaml` |

**주요 권한:**

| 카테고리 | 권한 | 대상 리소스 |
|----------|------|-------------|
| AgentCore | Control Plane CRUD (Gateway, Runtime, OAuth2 Provider, Memory) | `*` |
| Lambda | `InvokeFunction`, `GetFunction`, `ListFunctions` | `performance-*` |
| EC2/VPC | `Describe*`, Network Insights, Traffic Mirroring, Security Group 수정 | `*` |
| Route 53 | `ListHostedZones`, `ListResourceRecordSets` | `*` |
| SSM | `GetParameter`, `PutParameter` | `/app/netops/*`, `/a2a/app/performance/*` |
| Bedrock | `InvokeModel`, `InvokeModelWithResponseStream` | foundation-model, inference-profile |
| X-Ray | `PutTraceSegments`, `PutTelemetryRecords` | `*` |

> **특이사항**: EC2 Security Group 변경, Traffic Mirroring 생성 등 **쓰기 권한**이 포함됨 (네트워크 진단/수정 에이전트 특성).

---

### 1.2 Module 5 - K8s Diagnostics Agent

| 항목 | 값 |
|------|-----|
| **Role Name** | `{StackName}-gateway-execution-role` (예: `k8s-agentcore-cognito-gateway-execution-role`) |
| **Assume Role** | `bedrock-agentcore.amazonaws.com`, `lambda.amazonaws.com` |
| **CFN 파일** | `workshop-module-5/module-5/agentcore-k8s-agent/prerequisite/k8s-agentcore-cognito.yaml` |

**주요 권한:**

| 카테고리 | 권한 | 대상 리소스 |
|----------|------|-------------|
| AgentCore | `bedrock-agentcore-control:*`, `bedrock-agentcore:*` | `*` |
| EKS | `DescribeCluster`, `ListClusters`, `DescribeNodegroup`, `ListNodegroups`, `DescribeAddon`, `ListAddons`, `ListInsights`, `DescribeInsight`, `AccessKubernetesApi` | `*` |
| CloudWatch | `GetMetricData`, `ListMetrics`, `DescribeAlarms`, Logs 전체 | `*` |
| EC2/VPC | `Describe*` (읽기 전용) | `*` |
| IAM | `GetRole`, `PassRole`, `GetRolePolicy` | `*` |
| SSM | `GetParameter`, `PutParameter` | `/a2a/app/k8s/*` |
| CloudFormation | `DescribeStacks`, `ListStacks` | `*` |
| Secrets Manager | `GetSecretValue`, `DescribeSecret` | `*` |
| Bedrock | `InvokeModel`, `InvokeModelWithResponseStream` | foundation-model, inference-profile |
| Memory | `bedrock-agentcore-memory:*` | `memory/*` |

---

### 1.3 Module 6 - Incident Management Agent

| 항목 | 값 |
|------|-----|
| **Role Name** | `incident-gateway-execution-role` |
| **Assume Role** | `bedrock-agentcore.amazonaws.com`, `lambda.amazonaws.com` |
| **CFN 파일** | `workshop-module-6/module-6/prerequisite/cognito.yaml` |

**주요 권한:**

| 카테고리 | 권한 | 대상 리소스 |
|----------|------|-------------|
| AgentCore | Control Plane CRUD (개별 액션 명시) | `*` |
| Lambda | `InvokeFunction`, `GetFunction`, `ListFunctions` | `incident-*`, `netops-*` |
| CloudWatch | `GetMetricData`, `ListMetrics`, `DescribeAlarms`, Logs 전체 | `*` |
| OpenSearch | `ESHttp*`, `DescribeElasticsearchDomains` | `*` |
| SSM | `GetParameter`, `PutParameter` | `/app/incident/*`, `/app/netops/*` |
| IAM | `GetRole`, `PassRole` | `incident-gateway-execution-role` (자기 자신만) |

> **EKS 직접 권한 없음**: Incident Agent는 EKS에 직접 접근하지 않음. Chaos/Fault 작업은 Lambda에 위임.

---

### 1.4 Module 6 - Incident Lambda (공유 역할)

| 항목 | 값 |
|------|-----|
| **Role Name** | `incident-tools-lambda-role` |
| **Assume Role** | `lambda.amazonaws.com`, `bedrock-agentcore.amazonaws.com` |
| **생성 스크립트** | `workshop-module-6/module-6/prerequisite/deploy-incident-lambdas.sh` |
| **사용 Lambda** | Datadog, OpenSearch, Container Insight, Chaos, Alarm Trigger, GitHub, **Istio Fault Injection** (Module 7) |

**주요 권한:**

| 카테고리 | 권한 | 대상 리소스 |
|----------|------|-------------|
| CloudWatch | `DescribeAlarms`, `GetMetricData`, `ListMetrics`, Logs 전체 | `*` |
| OpenSearch | `ESHttp*` | `*` |
| SSM | `GetParameter` | `/app/incident/*` |
| EKS | `DescribeCluster`, `ListClusters` | `*` |
| STS | `GetCallerIdentity` | `*` |

> **EKS 접근 방식**: `DescribeCluster`로 endpoint/CA 획득 + STS presigned URL로 K8s API 토큰 생성. 실제 K8s 작업은 RBAC에 의해 제어됨.

---

### 1.5 Module 7 - Istio Mesh Agent

| 항목 | 값 |
|------|-----|
| **Role Name** | `{StackName}-gateway-execution-role` (예: `istio-agentcore-cognito-gateway-execution-role`) |
| **Assume Role** | `bedrock-agentcore.amazonaws.com`, `lambda.amazonaws.com` |
| **CFN 파일** | `workshop-module-7/module-7/prerequisite/istio-agentcore-cognito.yaml` |

**주요 권한 (Module 5 대비 추가분):**

| 카테고리 | 권한 | 대상 리소스 |
|----------|------|-------------|
| AMP (Prometheus) | `QueryMetrics`, `GetMetricData`, `GetSeries`, `GetLabels`, `ListWorkspaces`, `DescribeWorkspace` | `*` |
| Lambda | `InvokeFunction` | `istio-prometheus-tools` |
| SSM | `GetParameter`, `PutParameter` | `/app/istio/*`, `/a2a/app/k8s/*` |

> Module 5의 EKS/CloudWatch/EC2/IAM/Bedrock 권한을 모두 포함하며, AMP 조회 + Prometheus Lambda 호출 권한이 추가됨.

---

### 1.6 ADOT Collector (IRSA)

| 항목 | 값 |
|------|-----|
| **Role Name** | `adot-collector-istio-role` |
| **매핑 방식** | IRSA (EKS OIDC → ServiceAccount `opentelemetry/adot-collector`) |
| **생성 스크립트** | `workshop-module-7/module-7/prerequisite/setup-amp.sh` |

**권한:**

| 카테고리 | 권한 |
|----------|------|
| AMP | `AmazonPrometheusRemoteWriteAccess` (AWS Managed Policy) |

> EKS 클러스터 내부에서 Envoy sidecar/istiod 메트릭을 스크랩하여 AMP로 remote_write하는 역할만 수행.

---

### 1.7 Chat Frontend EC2

| 항목 | 값 |
|------|-----|
| **Role Name** | `netaiops-agent-hub-ec2-role` |
| **인라인 정책** | `AgentHubAccess` |

**Lambda Invoke 대상:**

```
arn:aws:lambda:us-east-1:175678592674:function:incident-chaos-tools
arn:aws:lambda:us-east-1:175678592674:function:istio-fault-injection-tools
```

> Chat Frontend 백엔드(`main.py`)에서 Chaos/Fault Lambda를 직접 invoke하기 위한 권한.

---

## 2. K8s RBAC

EKS 클러스터 내부 권한은 `aws-auth` ConfigMap + ClusterRole/ClusterRoleBinding으로 구성.

### 2.1 Chaos/Fault Lambda RBAC

| 항목 | 값 |
|------|-----|
| **ClusterRole** | `chaos-lambda-role` |
| **ClusterRoleBinding** | `chaos-lambda-binding` |
| **aws-auth 매핑** | `incident-tools-lambda-role` → `chaos-lambda-group` |
| **설정 스크립트** | `workshop-module-6/module-6/prerequisite/setup-eks-rbac.sh` |

**K8s 권한:**

```yaml
rules:
  # Pod 관리 (stress-ng 등 chaos pod 생성/삭제)
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "create", "delete"]

  # Deployment 관리 (스케일링, 이미지 변경, 리소스 제한)
  - apiGroups: ["apps"]
    resources: ["deployments", "deployments/scale"]
    verbs: ["get", "list", "patch", "update"]

  # ReplicaSet 읽기
  - apiGroups: ["apps"]
    resources: ["replicasets"]
    verbs: ["get", "list"]

  # Istio CRD 관리 (fault injection용, 수동 추가 필요)
  - apiGroups: ["networking.istio.io"]
    resources: ["virtualservices", "destinationrules"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
```

---

### 2.2 ADOT Collector RBAC

| 항목 | 값 |
|------|-----|
| **ClusterRole** | `adot-collector` |
| **ServiceAccount** | `opentelemetry/adot-collector` |

**K8s 권한:**

```yaml
rules:
  - apiGroups: [""]
    resources: [nodes, nodes/proxy, nodes/metrics, services, endpoints, pods]
    verbs: [get, list, watch]
  - apiGroups: ["extensions", "networking.k8s.io"]
    resources: [ingresses]
    verbs: [get, list, watch]
  - nonResourceURLs: ["/metrics", "/metrics/cadvisor"]
    verbs: [get]
```

---

## 3. AgentCore Token Vault (OAuth2 인증)

Agent간 통신을 위한 OAuth2 credential 관리.

### 인증 흐름

```
Agent Runtime ──[a2a-k8s-... 토큰]──→ Gateway ──[eks-mcp-server-oauth 토큰]──→ MCP Server Runtime
```

### Credential Providers

| Provider Name | 용도 | Cognito Pool | 인증 구간 |
|---|---|---|---|
| `a2a-k8s-{account}-{id}` | Runtime → Gateway 호출 시 M2M 토큰 발급 | K8sAgentPool (`UserPool`) | Runtime outbound |
| `eks-mcp-server-oauth` | Gateway → EKS MCP Server 호출 시 OAuth2 토큰 발급 | EksMcpServerPool (`RuntimeUserPool`) | Gateway outbound |
| `istio-eks-mcp-server-oauth` | Module 7 Gateway → EKS MCP Server 호출 시 OAuth2 토큰 발급 | EksMcpServerPool (`RuntimeUserPool`) | Gateway outbound |
| `istio-mesh-{account}-{id}` | Module 7 Runtime → Gateway 호출 시 M2M 토큰 발급 | IstioMeshPool (`UserPool`) | Runtime outbound |

### Cognito User Pools

| Pool | Module | 용도 | CFN 파일 |
|------|--------|------|----------|
| `K8sAgentPool` | 5 | K8s Agent Gateway 인증 | `k8s-agentcore-cognito.yaml` |
| `EksMcpServerPool` | 5 | EKS MCP Server Runtime 인증 | `k8s-agentcore-cognito.yaml` (RuntimeUserPool) |
| `IncidentAgentPool` | 6 | Incident Agent Gateway 인증 | `cognito.yaml` |
| `IstioMeshPool` | 7 | Istio Agent Gateway 인증 | `istio-agentcore-cognito.yaml` |

> Pool이 분리된 이유: 각 서비스가 독립적인 인증 경계를 가짐. MCP Server의 인증 변경이 Gateway 인증에 영향을 주지 않도록 격리.

---

## 4. 모듈별 EKS 접근 방식 요약

| Module | Agent | EKS 접근 방식 | IAM EKS 권한 | K8s RBAC |
|--------|-------|---------------|-------------|----------|
| 3 | Performance Agent | Lambda 위임 | 없음 (EC2/VPC 중심) | 없음 |
| 5 | K8s Agent | Gateway → EKS MCP Server Runtime | `eks:Describe*`, `AccessKubernetesApi` | MCP Server Role (읽기) |
| 6 | Incident Agent | Lambda 위임 (chaos) | 없음 | 없음 |
| 6 | Chaos Lambda | 직접 K8s API 호출 | `eks:DescribeCluster` + STS | `chaos-lambda-role` (쓰기) |
| 7 | Istio Agent | Gateway → EKS MCP Server + Prometheus Lambda | `eks:Describe*`, `AccessKubernetesApi`, `aps:Query*` | MCP Server Role (읽기) |
| 7 | Fault Lambda | 직접 K8s API 호출 (Istio CRD) | `eks:DescribeCluster` + STS (재사용) | `chaos-lambda-role` + Istio CRD 권한 |

---

## 5. 권한 설정 순서

1. **CloudFormation 배포** - Cognito Pool + IAM Execution Role + SSM Parameters
2. **Lambda 배포** - `deploy-incident-lambdas.sh` (공유 IAM Role 생성)
3. **EKS RBAC 설정** - `setup-eks-rbac.sh` (ClusterRole + aws-auth 매핑)
4. **AMP 설정** (Module 7) - `setup-amp.sh` (ADOT IRSA Role)
5. **AgentCore Gateway 생성** - `agentcore_gateway.py` (Token Vault credential provider 자동 생성)
6. **AgentCore Runtime 배포** - `@requires_access_token`으로 Token Vault 연동
