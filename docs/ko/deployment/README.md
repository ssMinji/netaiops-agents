# 배포 가이드

이 문서는 프로젝트의 전체 배포 절차를 다룹니다. CDK 인프라부터 에이전트 런타임, Web UI까지 모든 배포 단계를 포함합니다.

## 사전 요구사항

- 구성된 AWS CLI 프로필
- Node.js 18+ (CDK용)
- Python 3.12+ (에이전트용)
- AgentCore CLI (PATH에 `agentcore` 존재)
- Docker (Lambda 이미지 빌드용)
- `kubectl` (EKS RBAC 설정용)

## 배포 개요

전체 배포는 `deploy.sh`로 오케스트레이션되는 4단계를 따릅니다:

```
Phase 1: CDK 인프라         →  Cognito, IAM, Lambda, SSM, CloudWatch
Phase 2: EKS RBAC           →  ClusterRole/ClusterRoleBinding
Phase 3: MCP Server 런타임  →  EKS MCP Server, Network MCP Server
Phase 4: Agent 런타임       →  agentcore deploy × 4 에이전트
```

> **참고**: Web UI(netaiops-hub)는 `deploy.sh`에 포함되지 않습니다. 별도 배포가 필요합니다.

### 일반적인 AgentCore 배포 패턴

AgentCore 기반 에이전트 프로젝트는 에이전트 수에 관계없이 다음 배포 순서를 따릅니다:

```
1. 인프라 (CDK/CloudFormation)  →  인증, IAM, 도구, 구성
2. 클러스터 접근 (필요 시)       →  Kubernetes 기반 도구를 위한 RBAC
3. MCP Server 런타임 (필요 시)   →  장기 실행 도구 서버
4. Agent 런타임                  →  에이전트별 agentcore deploy
```

**핵심 포인트**: CDK/CloudFormation은 AgentCore 전용 리소스(Gateway, Runtime, Credential Provider)를 관리할 수 없습니다. 이러한 리소스는 AgentCore CLI 또는 boto3 API가 필요합니다. 배포 파이프라인 설계 시 IaC와 CLI 단계를 모두 고려하세요.

## CDK 단독 빌드/배포

`deploy.sh`를 사용하지 않고 CDK 스택만 개별적으로 빌드하거나 배포할 때 사용합니다. `deploy.sh`를 실행하는 경우 Phase 1에서 이 단계가 자동 수행되므로 별도로 실행할 필요가 없습니다.

```bash
cd infra-cdk

# 의존성 설치
npm install

# 타입 체크
npx tsc --noEmit

# CloudFormation 템플릿 합성 (선택, 검토용)
npx cdk synth

# 전체 스택 배포
npx cdk deploy --all --profile <AWS_PROFILE>

# 특정 스택 배포
npx cdk deploy IncidentAgentStack --profile <AWS_PROFILE>
```

## CDK 스택 구성

### 스택 배포 순서

CDK 스택은 `bin/netaiops-infra.ts`에 정의되며 다음 순서로 배포됩니다:

| 순서 | 스택 | 설명 | 의존성 |
|------|------|------|--------|
| 1 | `K8sAgentStack` | Cognito, Gateway, Runtime 설정 | 없음 (먼저 배포) |
| 2 | `IncidentAgentStack` | Cognito, 6 Lambda, Gateway, Monitoring | 없음 |
| 3 | `IstioAgentStack` | Cognito, 2 Lambda, Hybrid Gateway | K8s Agent SSM 파라미터 참조 |
| 4 | `NetworkAgentStack` | Cognito, 2 Lambda, Gateway | 없음 |

**교차 스택 의존성**: IstioAgentStack은 배포 시 K8s Agent의 SSM 파라미터(`eks_mcp_server_arn`, `eks_mcp_client_id` 등)를 읽습니다. K8sAgentStack이 먼저 배포되어야 합니다.

### 스택별 리소스

| 스택 | 생성된 리소스 |
|------|-------------|
| **K8sAgentStack** | Cognito (Agent Pool + Runtime Pool), IAM Role, MCP Gateway (mcpServer target), Runtime config |
| **IncidentAgentStack** | Cognito, IAM Role, 6 Docker Lambda, MCP Gateway (Lambda targets), Runtime config, SNS + CloudWatch Alarms |
| **IstioAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |
| **NetworkAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |

## 에이전트 종속성

```
K8s Agent (독립)
    └── EKS MCP Server Runtime

Incident Agent (독립)
    └── 6 Lambda + SNS/Alarm
    └── EKS RBAC (Chaos Lambda용)

Istio Agent (K8s Agent에 의존)
    └── K8s Agent의 EKS MCP Server ARN 참조
    └── Istio mesh + AMP/ADOT 인프라

Network Agent (독립)
    └── Network MCP Server Runtime
    └── 2 Lambda (DNS, Network Metrics)
```

## 에이전트 전체 배포: deploy.sh

`deploy.sh` 스크립트는 4개의 배포 단계를 순차적으로 오케스트레이션합니다.

```bash
# 전체 배포 실행
./deploy.sh
```

### 사전 요구사항 검증

스크립트는 시작 전에 다음 도구를 검증합니다:

- `aws` CLI (구성된 프로필 포함)
- `npx` (Node.js)
- `docker` (데몬 실행 중)
- `kubectl`
- `agentcore` CLI (`bedrock-agentcore`가 없으면 대체)

### Phase 1: CDK 인프라

```bash
cd infra-cdk
npm install --silent
npm run build
npx cdk deploy --all --profile <AWS_PROFILE> --require-approval never
```

배포 대상:
- Cognito User Pool (에이전트당 이중 풀)
- IAM Role (실행, 게이트웨이, CodeBuild)
- Docker Lambda 함수 (Incident 6개, Istio 2개, Network 2개)
- SSM Parameter (자격 증명, ARN)
- CloudWatch Alarm + SNS (교차 리전)

**첫 배포 참고사항**: EKS MCP Server 및 Network MCP Server에 대한 플레이스홀더 SSM ARN을 생성합니다. 이는 Phase 3에서 실제 ARN으로 교체됩니다.

### Phase 2: EKS RBAC

```bash
bash agents/incident-agent/prerequisite/setup-eks-rbac.sh
```

**Incident Agent의 Chaos Lambda** IAM 역할에 EKS 클러스터 접근 권한을 부여하는 Kubernetes RBAC 리소스(`ClusterRole`, `ClusterRoleBinding`)를 생성합니다. Chaos Lambda가 파드 생성/삭제 및 디플로이먼트 스케일링을 수행하는 데 필요합니다. 에이전트 런타임용이 아닙니다 — 에이전트는 MCP Server를 통해 EKS에 접근합니다.

### Phase 3: MCP Server 런타임

```bash
# EKS MCP Server (K8s 및 Istio 에이전트에서 사용)
bash agents/k8s-agent/prerequisite/eks-mcp-server/deploy-eks-mcp-server.sh

# Network MCP Server
bash agents/network-agent/prerequisite/deploy-network-mcp-server.sh
```

배포 후, 스크립트는 실제 런타임 ARN을 SSM에 저장합니다. Phase 1에서 플레이스홀더 ARN을 사용한 경우, 스크립트는 실제 EKS MCP Server ARN으로 게이트웨이 타겟을 업데이트하기 위해 **K8sAgentStack을 재배포**합니다.

### Phase 4: 에이전트 런타임

```bash
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent
  AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=<AWS_PROFILE> agentcore deploy
  cd -
done
```

각 에이전트는 CodeBuild를 통해 Bedrock AgentCore에서 ARM64 컨테이너로 배포됩니다.

### 플레이스홀더 ARN 문제

MCP Server 런타임이 CDK 스택보다 먼저 존재해야 하지만(예: Gateway 타겟으로), CDK 스택이 먼저 배포되어야 MCP Server에 필요한 인증 리소스가 생성되는 순환 종속성이 발생합니다:

1. CDK가 MCP Server ARN용 플레이스홀더 SSM 파라미터 생성
2. MCP Server 배포 후 실제 ARN을 SSM에 저장
3. CDK 스택을 재배포하여 플레이스홀더를 실제 ARN으로 교체

이 순환 종속성은 CDK가 관리하는 Gateway가 CLI로 관리되는 MCP Server를 참조하는 모든 프로젝트에서 발생합니다.

### SSM 종속성 흐름

```
Phase 1 (CDK deploy --all)
│
├── K8sAgentStack
│   ├── CognitoAuth → SSM write: userpool_id, client_id, ...
│   ├── CognitoAuth(eks_mcp_) → SSM write: eks_mcp_client_id, ...
│   ├── Gateway → SSM read: eks_mcp_server_arn ← ★ 이 시점에 placeholder
│   │            SSM write: gateway_url, gateway_id, ...
│   └── Runtime → SSM write: runtime_arn, runtime_name
│
├── IncidentAgentStack
│   ├── CognitoAuth → SSM write
│   ├── Lambda x6 → SSM write: *_lambda_arn
│   ├── Gateway → SSM write: gateway_url, ...
│   ├── Runtime → SSM write: runtime_arn, ...
│   └── Monitoring → SSM write: sns_topic_arn
│
├── IstioAgentStack (K8sAgentStack 이후)
│   ├── CognitoAuth → SSM write
│   ├── Lambda x2 → SSM write: *_lambda_arn
│   ├── Gateway → SSM read: eks_mcp_server_arn, eks_mcp_client_id, ... ← K8s SSM
│   │            SSM write: gateway_url, ...
│   └── Runtime → SSM write: runtime_arn, ...
│
└── NetworkAgentStack
    ├── CognitoAuth → SSM write
    ├── Lambda x2 → SSM write: *_lambda_arn
    ├── Gateway → SSM write: gateway_url, ...
    └── Runtime → SSM write: runtime_arn, ...

Phase 2 (EKS RBAC)
│  RBAC만, SSM 미관여

Phase 3 (MCP Server deploy)
│  SSM read: eks_mcp_cognito_* (JWT Authorizer 설정)
│  SSM write: eks_mcp_server_arn ← ★ 실제 ARN으로 교체
│
│  첫 배포 → K8sAgentStack 재배포 (실제 ARN 반영)

Phase 4 (Agent deploy)
│  각 에이전트가 SSM에서 gateway_url을 읽어 MCP Gateway에 연결
```

## 배포 후 체크리스트

`agentcore deploy` 후 모든 AgentCore 에이전트에 대해 다음 단계가 필요합니다. 이 프로젝트에만 해당하는 것이 아니라 Cognito JWT 인증과 SSM 기반 구성을 사용하는 모든 에이전트에 적용됩니다:

### 1. JWT Authorizer 확인

`agentcore deploy`는 `.bedrock_agentcore.yaml`의 `authorizer_configuration`을 그대로 적용합니다. yaml에 올바른 `customJWTAuthorizer` 블록이 있으면 추가 작업이 필요 없습니다. 필드가 `null`이면 배포 전에 yaml을 수정하세요:

```yaml
# .bedrock_agentcore.yaml
authorizer_configuration:
  customJWTAuthorizer:
    allowedClients:
      - <COGNITO_CLIENT_ID>
    discoveryUrl: https://cognito-idp.<REGION>.amazonaws.com/<POOL_ID>/.well-known/openid-configuration
```

이미 `null` 상태로 배포한 경우, 재배포 없이 API로 복원할 수 있습니다([트러블슈팅](../troubleshooting/README.md#403-authorization-method-mismatch) 참조).

### 2. SSM에 에이전트 ARN 등록

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite \
  --profile <AWS_PROFILE> --region us-east-1
```

### 3. 실행 역할에 SSM 권한 추가

`agentcore deploy`가 새 실행 역할을 생성한 경우:

```bash
aws iam put-role-policy --role-name <ROLE_NAME> \
  --policy-name SSMGetParameterAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/app/<agent>/*"
    }]
  }'
```

### 4. Credential Provider 확인

```bash
agentcore identity list-credential-providers
```

## 에이전트 구성 패턴 (.bedrock_agentcore.yaml)

자체 에이전트를 구축할 때 Cognito 풀과 IAM 구성에 맞게 다음 필드를 조정하세요:

```yaml
default_agent: <agent_name>
agents:
  <agent_name>:
    platform: linux/arm64
    aws:
      account: '<ACCOUNT_ID>'
      region: us-east-1
      execution_role: arn:aws:iam::<ACCOUNT_ID>:role/...
      ecr_repository: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/...
    authorizer_configuration:
      customJWTAuthorizer:
        discoveryUrl: https://cognito-idp.us-east-1.amazonaws.com/...
        allowedClients: [<client_id>]
    identity:
      credential_providers:
        - name: <provider_name>
          type: cognito
```

## Web UI 배포

프론트엔드는 ALB + CloudFront 뒤의 EC2 Docker 컨테이너에서 서빙됩니다. `deploy.sh`에는 포함되지 않으며 별도로 배포합니다.

### 업데이트 절차

```bash
# 1. 프론트엔드 빌드
cd app/frontend && npm run build

# 2. 빌드 결과를 백엔드 static으로 복사
cp -r dist/* ../backend/static/

# 3. EC2로 전송 (S3 + SSM 사용)
tar czf /tmp/app.tar.gz --exclude='frontend/node_modules' --exclude='frontend/dist' -C app backend/ frontend/
aws s3 cp /tmp/app.tar.gz s3://<DEPLOY_BUCKET>/app.tar.gz

# 4. 타겟 인스턴스에서 Docker 리빌드
docker build --no-cache -t netaiops-hub /home/ec2-user/app
OLD_ID=$(docker ps -q --filter publish=8000)
if [ -n "$OLD_ID" ]; then docker stop $OLD_ID && docker rm $OLD_ID; fi
docker run -d -p 8000:8000 --restart unless-stopped netaiops-hub

# 5. CloudFront 무효화
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> --paths '/*' \
  --profile <AWS_PROFILE>
```

> **주의**: 프론트엔드 소스(`frontend/src/`)를 반드시 포함해야 합니다. `backend/`만 전송하면 EC2의 기존 프론트엔드 소스로 Docker 빌드가 되어 변경사항이 반영되지 않습니다.

## 외부 서비스 설정

### SSM 파라미터 (Incident Agent용)

```bash
PROFILE="<AWS_PROFILE>"
REGION="us-east-1"

# Datadog (선택사항)
aws ssm put-parameter --name /app/incident/datadog/api_key --value "YOUR_KEY" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/datadog/app_key --value "YOUR_KEY" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/datadog/site --value "us5.datadoghq.com" --type String --profile $PROFILE --region $REGION

# OpenSearch (선택사항)
aws ssm put-parameter --name /app/incident/opensearch/endpoint --value "YOUR_ENDPOINT" --type String --profile $PROFILE --region $REGION

# GitHub (선택사항)
aws ssm put-parameter --name /app/incident/github/pat --value "YOUR_PAT" --type SecureString --profile $PROFILE --region $REGION
aws ssm put-parameter --name /app/incident/github/repo --value "owner/repo-name" --type String --profile $PROFILE --region $REGION
```

### GitHub 통합

```bash
cd agents/incident-agent/prerequisite
bash setup-github.sh
```

### CloudWatch 알람 (수동)

CDK가 알람을 자동으로 생성하지만, 수동 설정의 경우:

```bash
cd agents/incident-agent/prerequisite
bash setup-alarms.sh
```

| 알람 | 조건 |
|------|------|
| `netaiops-cpu-spike` | Pod CPU > 80% (2/3 datapoints, 60s) |
| `netaiops-pod-restarts` | Container restarts > 3 (5min) |
| `netaiops-node-cpu-high` | Node CPU > 85% (2/3 datapoints, 60s) |

## Lambda Docker 이미지 업데이트

CDK가 Docker 변경을 감지하지 못하는 경우, 수동으로 빌드 및 푸시:

```bash
docker build --no-cache --platform linux/amd64 -t <ECR_REPO>:<TAG> <DOCKER_DIR>
docker push <ECR_REPO>:<TAG>
aws lambda update-function-code --function-name <NAME> --image-uri <ECR_REPO>:<TAG>
```

## 검증

### 에이전트 런타임 상태

```bash
cd agents/<name>/agent && agentcore status
```

### Lambda 함수

```bash
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName,'incident-')].[FunctionName,State]" \
  --output table --profile <AWS_PROFILE> --region us-east-1
```

### Lambda 직접 테스트

```bash
aws lambda invoke --function-name incident-container-insight-tools \
  --payload '{"name":"container-insight-cluster-overview","arguments":{"cluster_name":"netaiops-eks-cluster"}}' \
  /tmp/out.json --profile <AWS_PROFILE> --region us-east-1
cat /tmp/out.json | python3 -m json.tool
```

## 스택 삭제

```bash
# CDK 스택
cd infra-cdk
npx cdk destroy --all --profile <AWS_PROFILE>

# AgentCore 런타임
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent && agentcore destroy && cd -
done

# EKS MCP Server 런타임
cd agents/k8s-agent/prerequisite/eks-mcp-server && agentcore destroy
```
