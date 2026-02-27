# NetAIOps Agent 배포 가이드

## 개요

NetAIOps는 3개의 AI Agent로 구성된 EKS 옵저버빌리티 플랫폼입니다.

| Agent | 역할 | Tool (Lambda/MCP Server) |
|-------|------|--------------------------|
| **K8s Agent** | EKS 클러스터 진단, 리소스 관리 | EKS MCP Server (mcpServer) |
| **Incident Agent** | 인시던트 자동 분석, 근본 원인 추적 | Datadog, OpenSearch, Container Insight, Chaos, Alarm Trigger, GitHub (6 Lambda) |
| **Istio Agent** | 서비스 메시 진단, 트래픽 관리 | EKS MCP Server (재사용) + Prometheus, Fault (2 Lambda) |

### 리전 구성

모든 리소스는 `ap-northeast-2` (Seoul) 단일 리전에 배포됩니다.

```
ap-northeast-2 (Seoul)
├── Bedrock AgentCore Runtime
├── Cognito User Pool
├── MCP Gateway
├── Lambda Functions
├── SSM Parameters
├── EKS Cluster (netaiops-eks-cluster)
├── CloudWatch Container Insights
├── CloudWatch Alarms
├── SNS Topic
└── OpenSearch
```

### 의존 관계

```
K8s Agent (독립)
    └── EKS MCP Server Runtime

Incident Agent (독립)
    └── 6 Lambda + SNS/Alarm
    └── EKS RBAC (Chaos Lambda용)

Istio Agent (K8s Agent 의존)
    └── K8s Agent의 EKS MCP Server ARN 참조
    └── Istio 메시 + AMP/ADOT 인프라 필요
```

---

## 사전 요구사항

### 필수 도구

```bash
# AWS CDK
npm install -g aws-cdk

# AgentCore CLI
pip install bedrock-agentcore-starter-toolkit

# Kubernetes
aws eks update-kubeconfig --name netaiops-eks-cluster --region ap-northeast-2 --profile ssminji-wesang

# Docker (Lambda 이미지 빌드용)
docker --version
```

### AWS Profile

```bash
# CDK 배포용 프로필 (infra-cdk/lib/config.ts 에 정의됨)
aws configure --profile ssminji-wesang
# Account: 175678592674
# Region: ap-northeast-2
```

### 외부 서비스 SSM 파라미터 (선택)

Incident Agent의 외부 연동이 필요한 경우 사전에 SSM에 저장합니다.

```bash
PROFILE="ssminji-wesang"
REGION="ap-northeast-2"

# Datadog (선택)
aws ssm put-parameter --name /app/incident/datadog/api_key --value "YOUR_KEY" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/datadog/app_key --value "YOUR_KEY" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/datadog/site --value "us5.datadoghq.com" --type String --profile $PROFILE --region $REGION

# OpenSearch (선택)
aws ssm put-parameter --name /app/incident/opensearch/endpoint --value "YOUR_ENDPOINT" --type String --profile $PROFILE --region $REGION

# GitHub (선택) - 또는 setup-github.sh 스크립트 사용
aws ssm put-parameter --name /app/incident/github/pat --value "YOUR_PAT" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/github/repo --value "owner/repo-name" --type String --profile $PROFILE --region $REGION
```

---

## 빠른 배포 (Phase 1~4 통합)

프로젝트 루트의 `deploy.sh`로 Phase 1~4를 한 번에 실행할 수 있습니다.

```bash
# 기본 (ssminji-wesang 프로필)
./deploy.sh

# 다른 프로필 사용
AWS_PROFILE=my-other-profile ./deploy.sh
```

스크립트가 수행하는 작업:
1. 필수 도구 검증 (aws, npx, docker, kubectl, agentcore)
2. CDK 인프라 배포 (Cognito, Lambda, Gateway, SNS/Alarm)
   - 첫 배포 시 EKS MCP Server ARN placeholder를 SSM에 자동 생성
3. EKS RBAC 설정 (Chaos Lambda용)
4. EKS MCP Server Runtime 배포
   - 첫 배포 시 K8sAgentStack을 실제 ARN으로 자동 재배포
5. K8s Agent + Incident Agent + Istio Agent Runtime 배포

> 각 Phase를 개별 실행하려면 아래 섹션을 참고하세요.

---

## Phase 1: CDK 인프라 배포

CDK가 3개 Agent의 인프라를 한 번에 배포합니다.

### CDK가 생성하는 리소스

| Stack | 생성 리소스 |
|-------|------------|
| **K8sAgentStack** | Cognito (Agent Pool + Runtime Pool), IAM Role, MCP Gateway (mcpServer 타겟), Runtime 설정 |
| **IncidentAgentStack** | Cognito, IAM Role, 6 Docker Lambda, MCP Gateway (Lambda 타겟), Runtime 설정, SNS + CloudWatch Alarms |
| **IstioAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda 하이브리드 타겟), Runtime 설정 |

### 배포 실행

```bash
cd infra-cdk

# 의존성 설치
npm install

# 빌드
npm run build

# CDK Bootstrap (최초 1회)
npx cdk bootstrap aws://175678592674/ap-northeast-2 --profile ssminji-wesang

# 전체 스택 배포
npx cdk deploy --all --profile ssminji-wesang --require-approval broadening
```

> **첫 배포 시 주의**: K8sAgentStack의 Gateway는 SSM에서 EKS MCP Server ARN을 참조하지만, 이 값은 Phase 3에서 생성됩니다. `deploy.sh`는 이를 자동으로 처리합니다 (placeholder 생성 → CDK 배포 → Phase 3 후 재배포). 개별 Phase를 수동 실행할 경우, Phase 1 전에 placeholder SSM 파라미터를 먼저 생성해야 합니다.
>
> IstioAgentStack은 K8sAgentStack의 SSM 파라미터(EKS MCP Server ARN)를 참조하므로, K8sAgentStack이 먼저 배포되어야 합니다. `--all` 옵션 사용 시 CDK가 의존 순서를 자동으로 처리합니다.

### 배포 확인

```bash
# 생성된 SSM 파라미터 확인
aws ssm get-parameters-by-path --path /a2a/app/k8s/agentcore --recursive --profile ssminji-wesang --region ap-northeast-2
aws ssm get-parameters-by-path --path /app/incident/agentcore --recursive --profile ssminji-wesang --region ap-northeast-2
aws ssm get-parameters-by-path --path /app/istio/agentcore --recursive --profile ssminji-wesang --region ap-northeast-2
```

---

## Phase 2: EKS RBAC 설정

Chaos Lambda가 EKS 클러스터의 Pod/Deployment를 조작하려면 RBAC 권한이 필요합니다.

```bash
cd agents/incident-agent/prerequisite
bash setup-eks-rbac.sh
```

이 스크립트가 수행하는 작업:
- `ClusterRole: chaos-lambda-role` 생성 (pods get/list/create/delete, deployments get/list/patch/update)
- `ClusterRoleBinding: chaos-lambda-binding` 생성
- `aws-auth ConfigMap`에 `incident-tools-lambda-role` IAM Role 매핑

---

## Phase 3: EKS MCP Server Runtime 배포

K8s Agent와 Istio Agent가 사용하는 EKS MCP Server를 AgentCore Runtime으로 배포합니다.

```bash
cd agents/k8s-agent/prerequisite/eks-mcp-server
bash deploy-eks-mcp-server.sh
```

이 스크립트가 수행하는 작업:
1. SSM에서 Runtime Cognito 정보 읽기 (CDK가 생성한 값)
2. `.bedrock_agentcore.yaml`에 JWT Authorizer 설정
3. `agentcore deploy`로 Runtime 배포
4. Runtime ARN을 SSM에 저장 (`/a2a/app/k8s/agentcore/eks_mcp_server_arn`)

### 배포 확인

```bash
cd agents/k8s-agent/prerequisite/eks-mcp-server
agentcore status
```

---

## Phase 4: Agent Runtime 배포

### K8s Agent

```bash
cd agents/k8s-agent/agent
agentcore deploy
```

### Incident Agent

```bash
cd agents/incident-agent/agent
agentcore deploy
```

### Istio Agent

> Istio Agent가 실제로 동작하려면 Phase 5(Istio 인프라 설정)가 완료되어야 합니다. Runtime 배포 자체는 독립적으로 가능합니다.

```bash
cd agents/istio-agent/agent
agentcore deploy
```

---

## Phase 5: 샘플 워크로드 및 Istio 인프라 설정

에이전트의 진단/모니터링 대상이 되는 샘플 워크로드를 배포합니다.

```bash
# EKS 클러스터 + retail-store 앱 + Istio 인프라 + istio-sample 앱 한 번에 배포
./sample-workloads/retail-store/deploy-eks-workload.sh deploy-all

# Istio 인프라만 별도 설정 (클러스터가 이미 존재하는 경우)
./sample-workloads/retail-store/deploy-eks-workload.sh setup-istio
```

각 워크로드의 상세 배포 방법 및 에이전트 의존성은 개별 README를 참조하세요:
- [retail-store README](../sample-workloads/retail-store/README.md) — EKS Retail Store 앱 (K8s/Incident Agent 대상)
- [istio-sample README](../sample-workloads/istio-sample/README.md) — Istio Bookinfo 앱 (Istio Agent 필수)

---

## 선택적 설정

### GitHub 연동 설정

Incident Agent의 GitHub Issues 자동 생성 기능을 사용하려면:

```bash
cd agents/incident-agent/prerequisite
bash setup-github.sh
```

GitHub PAT (`repo` scope)와 리포지토리 이름을 입력하면 SSM에 저장됩니다.

### CloudWatch Alarms 수동 설정

CDK가 자동으로 Alarm을 생성하지만, 수동으로 설정하려면:

```bash
cd agents/incident-agent/prerequisite
bash setup-alarms.sh
```

생성되는 Alarm:

| Alarm | 조건 |
|-------|------|
| `netaiops-cpu-spike` | Pod CPU > 80% (2/3 datapoints, 60s) |
| `netaiops-pod-restarts` | Container restarts > 3 (5분) |
| `netaiops-node-cpu-high` | Node CPU > 85% (2/3 datapoints, 60s) |

---

## 전체 배포 순서 요약

```
[Phase 1] CDK 인프라 배포
  * 첫 배포 시: EKS MCP Server ARN placeholder를 SSM에 자동 생성
  npx cdk deploy --all
  └── K8sAgentStack (Cognito, Gateway, Runtime 설정)
  └── IncidentAgentStack (Cognito, 6 Lambda, Gateway, Runtime 설정, SNS/Alarm)
  └── IstioAgentStack (Cognito, 2 Lambda, Gateway, Runtime 설정)
          │
[Phase 2] EKS RBAC 설정
  bash agents/incident-agent/prerequisite/setup-eks-rbac.sh
          │
[Phase 3] EKS MCP Server Runtime 배포
  bash agents/k8s-agent/prerequisite/eks-mcp-server/deploy-eks-mcp-server.sh
  * 첫 배포 시: K8sAgentStack을 실제 ARN으로 자동 재배포
          │
[Phase 4] Agent Runtime 배포
  cd agents/k8s-agent/agent && agentcore deploy
  cd agents/incident-agent/agent && agentcore deploy
  cd agents/istio-agent/agent && agentcore deploy
          │
[Phase 5] Istio 인프라 설정 (선택)
  ./sample-workloads/retail-store/deploy-eks-workload.sh deploy-all   # EKS + 앱 + Istio 한 번에
  ./sample-workloads/retail-store/deploy-eks-workload.sh setup-istio  # Istio만 별도 설정
```

---

## 배포 검증

### Agent Runtime 상태 확인

```bash
# 각 Agent 디렉토리에서
cd agents/k8s-agent/agent && agentcore status
cd agents/incident-agent/agent && agentcore status
cd agents/istio-agent/agent && agentcore status
```

### Lambda 함수 확인

```bash
# Incident Agent Lambda (6개)
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'incident-')].[FunctionName,State]" --output table --profile ssminji-wesang --region ap-northeast-2

# Istio Agent Lambda (2개)
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'istio-')].[FunctionName,State]" --output table --profile ssminji-wesang --region ap-northeast-2
```

### CloudWatch Alarm 확인

```bash
aws cloudwatch describe-alarms --alarm-name-prefix netaiops --query "MetricAlarms[].[AlarmName,StateValue]" --output table --profile ssminji-wesang --region ap-northeast-2
```

### Lambda 개별 테스트

```bash
# Container Insight Lambda
aws lambda invoke --function-name incident-container-insight-tools \
  --payload '{"name":"container-insight-cluster-overview","arguments":{"cluster_name":"netaiops-eks-cluster"}}' \
  /tmp/out.json --profile ssminji-wesang --region ap-northeast-2
cat /tmp/out.json | python3 -m json.tool

# Istio Prometheus Lambda
aws lambda invoke --function-name istio-prometheus-tools \
  --payload '{"method":"tools/list"}' \
  /tmp/out.json --profile ssminji-wesang --region ap-northeast-2
cat /tmp/out.json | python3 -m json.tool
```

---

## 스택 삭제

```bash
# CDK 스택 전체 삭제
cd infra-cdk
npx cdk destroy --all --profile ssminji-wesang

# AgentCore Runtime 삭제 (각 agent 디렉토리에서)
cd agents/k8s-agent/agent && agentcore destroy
cd agents/incident-agent/agent && agentcore destroy
cd agents/istio-agent/agent && agentcore destroy

# EKS MCP Server Runtime 삭제
cd agents/k8s-agent/prerequisite/eks-mcp-server && agentcore destroy

# Istio 삭제 (설치한 경우)
istioctl uninstall --purge -y
kubectl delete namespace istio-system istio-sample
```
