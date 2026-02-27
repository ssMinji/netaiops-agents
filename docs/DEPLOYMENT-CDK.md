# NetAIOps CDK 배포 가이드 (Module 5, 6, 7)

CDK와 수동 스크립트를 조합한 배포 가이드. Module 5, 6은 CDK로 자동화, Module 7은 CloudFormation + Shell 스크립트로 배포.

## 환경 정보

| 항목 | 값 |
|------|-----|
| AWS Profile | `netaiops-deploy` |
| AWS Account | `175678592674` |
| Agent Region | `us-east-1` (Virginia) |
| EKS Region | `us-west-2` (Oregon) |
| EKS Cluster | `netaiops-eks-cluster` |

---

## 전제 조건

### 필수 도구

```bash
# AWS CLI, CDK, Docker, kubectl, agentcore CLI 필요
aws --version          # >= 2.x
npx cdk --version      # >= 2.x
docker --version
kubectl version --client
agentcore --version
```

### EKS 클러스터 연결

```bash
export AWS_PROFILE=netaiops-deploy

aws eks update-kubeconfig \
  --name netaiops-eks-cluster \
  --region us-west-2 \
  --profile netaiops-deploy

# 확인
kubectl get nodes  # → 2 nodes Ready
```

### 외부 서비스 SSM 파라미터 (Module 6용, 선택)

```bash
# Datadog
aws ssm put-parameter --name /app/incident/datadog/api_key --value YOUR_KEY --type SecureString --region us-east-1 --profile netaiops-deploy
aws ssm put-parameter --name /app/incident/datadog/app_key --value YOUR_KEY --type SecureString --region us-east-1 --profile netaiops-deploy

# OpenSearch
aws ssm put-parameter --name /app/incident/opensearch/endpoint --value YOUR_ENDPOINT --type String --region us-east-1 --profile netaiops-deploy

# GitHub PAT
aws ssm put-parameter --name /app/incident/github/pat --value YOUR_TOKEN --type SecureString --region us-east-1 --profile netaiops-deploy
```

---

## 배포 순서 요약

```
Phase 1: CDK (Module 5 + 6)          ← cdk deploy --all
Phase 2: EKS RBAC                     ← kubectl (K8s 내부 권한)
Phase 3: AgentCore Runtime (5, 6)     ← agentcore deploy
Phase 4: Module 7 인프라              ← CloudFormation + Shell
Phase 5: AgentCore Runtime (7)        ← agentcore deploy
Phase 6: Frontend                     ← Docker rebuild
```

---

## Phase 1: CDK 배포 (Module 5 + 6)

CDK가 Cognito, IAM Role, Lambda (Docker 빌드/ECR 푸시 자동), Gateway, SSM Parameters를 한 번에 생성.

```bash
cd infra-cdk

# 의존성 설치 (최초 1회)
npm install

# 배포 전 변경사항 확인 (선택)
npx cdk diff --profile netaiops-deploy

# 전체 배포
npx cdk deploy --all --profile netaiops-deploy --require-approval never
```

### 개별 모듈만 배포

```bash
# Module 5만
npx cdk deploy NetAIOpsInfraStack/Module5 --profile netaiops-deploy

# Module 6만
npx cdk deploy NetAIOpsInfraStack/Module6 --profile netaiops-deploy
```

### 생성되는 리소스

**Module 5** (46 리소스):
- Cognito: K8sAgentPool + EksMcpServerPool (2개 Pool)
- IAM: Gateway Execution Role
- AgentCore: Gateway (mcpServer 타겟) + OAuth2 Credential Provider
- SSM: `/a2a/app/k8s/agentcore/*`

**Module 6** (54 리소스):
- Cognito: IncidentAnalysisPool
- IAM: Gateway Execution Role + Lambda Execution Role
- Lambda: 6개 Docker Lambda (Datadog, OpenSearch, Container Insight, Chaos, Alarm Trigger, GitHub)
- AgentCore: Gateway (Lambda 타겟)
- CloudWatch: us-west-2 SNS + Alarms (Cross-Region Custom Resource)
- SSM: `/app/incident/agentcore/*`

---

## Phase 2: EKS RBAC 설정

CDK로 생성한 Lambda가 K8s API를 호출하려면 클러스터 내부 RBAC 권한이 필요.

```bash
# Chaos Lambda용 ClusterRole + aws-auth 매핑
bash workshop-module-6/module-6/prerequisite/setup-eks-rbac.sh
```

이 스크립트가 수행하는 작업:

| 리소스 | 내용 |
|--------|------|
| `ClusterRole: chaos-lambda-role` | pods CRUD, deployments 수정, replicasets 읽기 |
| `ClusterRoleBinding: chaos-lambda-binding` | chaos-lambda-group → chaos-lambda-role |
| `aws-auth ConfigMap` | incident-tools-lambda-role → chaos-lambda-group |

### Istio CRD 권한 추가 (Module 7 Fault Injection용)

Module 7의 Fault Injection Lambda도 동일한 `incident-tools-lambda-role`을 사용하므로, ClusterRole에 Istio CRD 권한을 추가:

```bash
kubectl apply -f - <<'EOF'
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: chaos-lambda-role
rules:
  # 기존: Pod/Deployment 관리
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "create", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "deployments/scale"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: ["apps"]
    resources: ["replicasets"]
    verbs: ["get", "list"]
  # 추가: Istio CRD 관리
  - apiGroups: ["networking.istio.io"]
    resources: ["virtualservices", "destinationrules"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
EOF
```

### 확인

```bash
kubectl get clusterrole chaos-lambda-role -o wide
kubectl get clusterrolebinding chaos-lambda-binding -o wide
kubectl get configmap aws-auth -n kube-system -o jsonpath='{.data.mapRoles}' | grep -A3 chaos
```

---

## Phase 3: AgentCore Runtime 배포 (Module 5, 6)

AgentCore Runtime은 CDK 범위 밖 (AgentCore CLI로 배포).

```bash
# Module 5 - EKS MCP Server
cd workshop-module-5/module-5/agentcore-k8s-agent/prerequisite/eks-mcp-server
bash deploy-eks-mcp-server.sh

# Module 5 - K8s Diagnostics Agent
cd workshop-module-5/module-5/agentcore-k8s-agent
agentcore deploy

# Module 6 - Incident Agent
cd workshop-module-6/module-6/agentcore-incident-agent
agentcore deploy
```

### 확인

```bash
# Runtime 상태
agentcore status

# Module 5 Agent 테스트
aws bedrock-agentcore invoke-runtime \
  --name a2a_k8s_agent_runtime \
  --payload '{"prompt": "EKS 클러스터 상태를 확인해줘"}' \
  --region us-east-1

# Module 6 Chaos Lambda 테스트
aws lambda invoke --function-name incident-chaos-tools \
  --payload '{"name":"chaos-cpu-stress","arguments":{}}' \
  --region us-east-1 /dev/stdout
```

---

## Phase 4: Module 7 인프라 (수동)

Module 7은 CDK에 미포함. CloudFormation + Shell 스크립트로 배포.

### Step 1: Cognito + IAM

```bash
aws cloudformation deploy \
  --template-file workshop-module-7/module-7/prerequisite/istio-agentcore-cognito.yaml \
  --stack-name istio-agentcore-cognito \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --profile netaiops-deploy
```

### Step 2: Istio 설치 (Oregon EKS)

```bash
bash workshop-module-7/module-7/prerequisite/setup-istio.sh
```

확인:
```bash
istioctl verify-install
kubectl get pods -n istio-system
```

### Step 3: AMP + ADOT Collector

```bash
bash workshop-module-7/module-7/prerequisite/setup-amp.sh
```

생성 리소스:
- AMP Workspace (`istio-metrics`) in us-east-1
- IRSA Role (`adot-collector-istio-role`)
- ADOT Collector DaemonSet in `opentelemetry` namespace

확인:
```bash
kubectl get pods -n opentelemetry
aws amp list-workspaces --region us-east-1 --profile netaiops-deploy
```

### Step 4: 샘플 워크로드 배포 (BookInfo)

```bash
bash workshop-module-7/module-7/prerequisite/setup-sample-app.sh
```

확인:
```bash
kubectl get pods -n istio-sample
kubectl get virtualservice -n istio-sample
```

### Step 5: Lambda 배포 (Prometheus + Fault Injection)

```bash
# Prometheus 메트릭 조회 Lambda
bash workshop-module-7/module-7/prerequisite/deploy-istio-lambdas.sh

# Fault Injection Lambda
bash workshop-module-7/module-7/prerequisite/deploy-fault-lambda.sh
```

확인:
```bash
# Prometheus Lambda
aws lambda invoke --function-name istio-prometheus-tools \
  --payload '{"method":"tools/list"}' /tmp/prom-tools.json \
  --region us-east-1 --profile netaiops-deploy
cat /tmp/prom-tools.json

# Fault Injection Lambda
aws lambda invoke --function-name istio-fault-injection-tools \
  --payload '{"name":"fault-delay-inject"}' /tmp/fault-test.json \
  --region us-east-1 --profile netaiops-deploy
cat /tmp/fault-test.json
```

---

## Phase 5: AgentCore Runtime 배포 (Module 7)

```bash
# Istio Agent 배포
cd workshop-module-7/module-7/agentcore-istio-agent
agentcore deploy

# Gateway 생성 (mcpServer + Prometheus Lambda 하이브리드)
python scripts/agentcore_gateway.py create
```

---

## Phase 6: Frontend 배포

```bash
# 프로덕션 빌드
cd app/frontend && npm run build

# Docker 재빌드 (프로덕션 EC2)
# SSM으로 EC2에 접속하여 빌드
INSTANCE_ID="i-0a7e66310340c519c"
aws ssm start-session --target $INSTANCE_ID --profile netaiops-deploy --region us-east-1
# EC2 내부에서:
cd /home/ec2-user/app && docker compose build && docker compose up -d
```

---

## 전체 배포 검증

### Module 5 - K8s Agent

```bash
# EKS MCP Server 확인
aws ssm get-parameter --name /a2a/app/k8s/agentcore/eks_mcp_server_arn \
  --region us-east-1 --profile netaiops-deploy --query 'Parameter.Value' --output text

# Gateway 확인
aws ssm get-parameter --name /a2a/app/k8s/agentcore/gateway_id \
  --region us-east-1 --profile netaiops-deploy --query 'Parameter.Value' --output text
```

### Module 6 - Incident Agent

```bash
# Lambda 목록
aws lambda list-functions --region us-east-1 --profile netaiops-deploy \
  --query 'Functions[?starts_with(FunctionName, `incident-`)].FunctionName' --output table

# CloudWatch Alarms (Oregon)
aws cloudwatch describe-alarms --region us-west-2 --profile netaiops-deploy \
  --query 'MetricAlarms[].AlarmName' --output table
```

### Module 7 - Istio Agent

```bash
# Istio 설치
istioctl verify-install

# AMP 메트릭
AMP_ENDPOINT=$(aws ssm get-parameter --name /app/istio/agentcore/amp_query_endpoint \
  --query 'Parameter.Value' --output text --region us-east-1 --profile netaiops-deploy)
echo "AMP Query Endpoint: $AMP_ENDPOINT"

# ADOT Collector
kubectl get pods -n opentelemetry

# BookInfo
kubectl get pods -n istio-sample
```

### Frontend

```bash
# 프로덕션 URL
curl -s https://<cloudfront-domain>/api/health | jq .
```

---

## 삭제 (역순)

```bash
# 1. AgentCore Runtime 삭제
cd workshop-module-7/module-7/agentcore-istio-agent && agentcore destroy
cd workshop-module-6/module-6/agentcore-incident-agent && agentcore destroy
cd workshop-module-5/module-5/agentcore-k8s-agent && agentcore destroy

# 2. Module 7 CloudFormation 삭제
aws cloudformation delete-stack --stack-name istio-agentcore-cognito --region us-east-1 --profile netaiops-deploy

# 3. Module 7 Lambda 삭제
aws lambda delete-function --function-name istio-prometheus-tools --region us-east-1 --profile netaiops-deploy
aws lambda delete-function --function-name istio-fault-injection-tools --region us-east-1 --profile netaiops-deploy

# 4. EKS RBAC 삭제
kubectl delete clusterrolebinding chaos-lambda-binding
kubectl delete clusterrole chaos-lambda-role

# 5. CDK 전체 삭제 (Module 5 + 6)
cd infra-cdk && npx cdk destroy --all --profile netaiops-deploy

# 6. K8s 워크로드 삭제 (선택)
kubectl delete namespace istio-sample
kubectl delete namespace opentelemetry
istioctl uninstall --purge
```

---

## Troubleshooting

### CDK 배포 실패

```bash
# 템플릿 검증
npx cdk synth

# CloudFormation 이벤트 확인
aws cloudformation describe-stack-events \
  --stack-name NetAIOpsInfraStack \
  --region us-east-1 --profile netaiops-deploy \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table
```

### Lambda Docker 빌드 실패

```bash
# Docker 실행 확인
docker info

# ECR Public 로그인 (base image 접근용)
aws ecr-public get-login-password --region us-east-1 --profile netaiops-deploy | \
  docker login --username AWS --password-stdin public.ecr.aws
```

### EKS 접근 불가

```bash
# kubeconfig 갱신
aws eks update-kubeconfig --name netaiops-eks-cluster --region us-west-2 --profile netaiops-deploy

# aws-auth 확인
kubectl get configmap aws-auth -n kube-system -o yaml

# 현재 사용자 확인
aws sts get-caller-identity --profile netaiops-deploy
```

### AgentCore Runtime 상태 확인

```bash
agentcore status
agentcore logs --tail 50
```
