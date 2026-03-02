# 배포 가이드

## 사전 요구사항

- 구성된 AWS CLI 프로필
- Node.js 18+ (CDK용)
- Python 3.12+ (에이전트용)
- AgentCore CLI (PATH에 `agentcore` 존재)
- Docker (Lambda 이미지 빌드용)

## 배포 개요

전체 배포는 `deploy.sh`로 오케스트레이션되는 4단계를 따릅니다. 상세 명령어, 배포 후 체크리스트, Web UI 배포는 [빌드 및 배포](../infrastructure/build-deploy.md)를 참조하세요.

```
Phase 1: CDK 인프라         →  Cognito, IAM, Lambda, SSM, CloudWatch
Phase 2: EKS RBAC           →  ClusterRole/ClusterRoleBinding
Phase 3: MCP Server 런타임  →  EKS MCP Server, Network MCP Server
Phase 4: Agent 런타임       →  agentcore deploy × 4 에이전트
```

## 일반적인 AgentCore 배포 패턴

AgentCore 기반 에이전트 프로젝트는 에이전트 수에 관계없이 다음 배포 순서를 따릅니다:

```
1. 인프라 (CDK/CloudFormation)  →  인증, IAM, 도구, 구성
2. 클러스터 접근 (필요 시)       →  Kubernetes 기반 도구를 위한 RBAC
3. MCP Server 런타임 (필요 시)   →  장기 실행 도구 서버
4. Agent 런타임                  →  에이전트별 agentcore deploy
```

**핵심 포인트**: CDK/CloudFormation은 AgentCore 전용 리소스(Gateway, Runtime, Credential Provider)를 관리할 수 없습니다. 이러한 리소스는 AgentCore CLI 또는 boto3 API가 필요합니다. 배포 파이프라인 설계 시 IaC와 CLI 단계를 모두 고려하세요.

### 플레이스홀더 ARN 문제

MCP Server 런타임이 CDK 스택보다 먼저 존재해야 하지만(예: Gateway 타겟으로), CDK 스택이 먼저 배포되어야 MCP Server에 필요한 인증 리소스가 생성되는 순환 종속성이 발생합니다:

1. CDK가 MCP Server ARN용 플레이스홀더 SSM 파라미터 생성
2. MCP Server 배포 후 실제 ARN을 SSM에 저장
3. CDK 스택을 재배포하여 플레이스홀더를 실제 ARN으로 교체

이 순환 종속성은 CDK가 관리하는 Gateway가 CLI로 관리되는 MCP Server를 참조하는 모든 프로젝트에서 발생합니다.

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

## CDK 스택 리소스

| 스택 | 생성된 리소스 |
|-------|------------------|
| **K8sAgentStack** | Cognito (Agent Pool + Runtime Pool), IAM Role, MCP Gateway (mcpServer target), Runtime config |
| **IncidentAgentStack** | Cognito, IAM Role, 6 Docker Lambda, MCP Gateway (Lambda targets), Runtime config, SNS + CloudWatch Alarms |
| **IstioAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |
| **NetworkAgentStack** | Cognito, IAM Role, 2 Docker Lambda, MCP Gateway (mcpServer + Lambda hybrid), Runtime config |

## SSM 종속성 및 첫 배포 순서

```
Phase 1 (CDK deploy --all)
│
├── K8sAgentStack
│   ├── CognitoAuth → SSM write: userpool_id, client_id, ...
│   ├── CognitoAuth(eks_mcp_) → SSM write: eks_mcp_client_id, ...
│   ├── Gateway → SSM read: eks_mcp_server_arn ← ★ placeholder at this point
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
├── IstioAgentStack (after K8sAgentStack)
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
│  RBAC only, no SSM involved

Phase 3 (MCP Server deploy)
│  SSM read: eks_mcp_cognito_* (JWT Authorizer config)
│  SSM write: eks_mcp_server_arn ← ★ replace with actual ARN
│
│  First deploy → redeploy K8sAgentStack (to use real ARN)

Phase 4 (Agent deploy)
│  Each agent reads gateway_url from SSM to connect to MCP Gateway
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
|-------|-----------|
| `netaiops-cpu-spike` | Pod CPU > 80% (2/3 datapoints, 60s) |
| `netaiops-pod-restarts` | Container restarts > 3 (5min) |
| `netaiops-node-cpu-high` | Node CPU > 85% (2/3 datapoints, 60s) |

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
