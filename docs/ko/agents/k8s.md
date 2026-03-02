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

## 사전 요구사항

### EKS MCP Server

K8s Agent는 Bedrock AgentCore 런타임으로 배포된 EKS MCP Server가 필요합니다.

```bash
cd agents/k8s-agent/prerequisite/eks-mcp-server
./deploy-eks-mcp-server.sh
```

이 스크립트는 `awslabs/eks-mcp-server`를 AgentCore 런타임으로 배포하며, 에이전트는 MCP Gateway를 통해 `mcpServer` 타겟으로 접근합니다.

### RBAC 구성

에이전트는 대상 EKS 클러스터에 대한 Kubernetes RBAC 권한이 필요합니다.

```bash
# deploy.sh Phase 2를 통해 구성
./agents/incident-agent/prerequisite/setup-eks-rbac.sh
```

이 스크립트는 에이전트에게 클러스터 리소스에 대한 읽기 권한을 부여하는 `ClusterRole` 및 `ClusterRoleBinding`을 생성합니다.
