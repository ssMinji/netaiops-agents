# K8s 진단 에이전트

## 목적

EKS 클러스터 진단 및 Kubernetes 리소스 관리. K8s Agent는 AWS Labs EKS MCP Server를 통해 종합적인 클러스터 상태 모니터링, 파드/노드 분석, 리소스 CRUD 작업, 매니페스트 생성을 제공합니다.

## 위치

```
agents/k8s-agent/
├── agent/                        # Agent runtime
└── prerequisite/eks-mcp-server/  # EKS MCP Server deployment
```

## MCP 도구

K8s Agent는 포괄적인 Kubernetes 작업 세트를 제공하는 **AWS Labs EKS MCP Server**를 사용합니다.

- 클러스터 검색(다중 리전)
- Pod/Node/Deployment/Service CRUD
- 로그 검색 및 필터링
- 메트릭 수집
- 네임스페이스 기반 워크로드 분석
- 매니페스트 생성 및 YAML 적용

### 리전 인식 작업

에이전트는 작업 전 클러스터 존재 여부를 확인하도록 구성되어 존재하지 않는 클러스터의 환각을 방지합니다. 다중 리전 EKS 배포를 위한 동적 리전 전환을 지원합니다.

## 시나리오

| 시나리오 | 설명 |
|----------|-------------|
| Cluster Health Check | 종합적인 EKS 클러스터 상태 검토 |
| Abnormal Pod Diagnosis | CrashLoopBackOff, Pending, Error 상태의 파드 조사 |
| Resource Usage Analysis | 네임스페이스별 CPU/메모리 활용도 |
| Workload Overview | 배포, 서비스 및 해당 상태 목록 |

## AWS 서비스 권한

| 구성요소 | 필요 AWS 서비스 | 비고 |
|-----------|----------------------|-------|
| **Agent 런타임** | Bedrock, SSM, CloudWatch | Gateway 실행 역할 |
| **EKS MCP Server** | EKS, Kubernetes API, CloudWatch Logs, EC2/VPC, IAM (읽기 전용) | MCP Server 런타임 역할 — 모든 K8s 작업이 여기서 실행 |

Agent 런타임은 EKS에 직접 접근하지 않습니다. 모든 Kubernetes 작업은 EKS 및 Kubernetes API 권한을 보유한 **EKS MCP Server 런타임**에서 수행됩니다. 에이전트는 MCP Gateway를 통해 MCP Server와 통신합니다.

## 사전 요구사항

### EKS MCP Server

K8s Agent는 Bedrock AgentCore 런타임으로 배포된 EKS MCP Server가 필요합니다.

```bash
cd agents/k8s-agent/prerequisite/eks-mcp-server
./deploy-eks-mcp-server.sh
```

이 스크립트는 `awslabs/eks-mcp-server`를 AgentCore 런타임으로 배포하며, 에이전트는 MCP Gateway를 통해 `mcpServer` 타겟으로 접근합니다.

### EKS MCP Server RBAC

K8s Agent 자체에는 RBAC가 필요하지 않습니다. **EKS MCP Server 런타임의 IAM 역할**이 `aws-auth` ConfigMap을 통해 Kubernetes RBAC 역할에 매핑되어야 합니다. MCP Server는 자체 EKS 접근 구성을 통해 이를 자동으로 처리합니다.

> **참고**: `agents/incident-agent/prerequisite/`의 `setup-eks-rbac.sh` 스크립트는 K8s Agent용이 아니라 **Incident Agent의 Chaos Lambda**용입니다. 이 스크립트는 Chaos Lambda의 IAM 역할에 파드 생성/삭제 및 디플로이먼트 스케일링 권한을 부여합니다.
