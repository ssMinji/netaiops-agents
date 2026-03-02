# 빌드 및 배포

## CDK 빌드

```bash
cd infra-cdk

# 의존성 설치
npm install

# 타입 체크
npx tsc --noEmit

# CloudFormation 템플릿 합성 (선택, 검토용)
npx cdk synth

# 전체 스택 배포
npx cdk deploy --all --profile netaiops-deploy

# 특정 스택 배포
npx cdk deploy IncidentAgentStack --profile netaiops-deploy
```

## 스택 배포 순서

CDK 스택은 `bin/netaiops-infra.ts`에 정의되며 다음 순서로 배포됩니다:

| 순서 | 스택 | 설명 | 의존성 |
|-------|-------|-------------|-------------|
| 1 | `K8sAgentStack` | Cognito, Gateway, Runtime 설정 | 없음 (먼저 배포) |
| 2 | `IncidentAgentStack` | Cognito, 6 Lambda, Gateway, Monitoring | 없음 |
| 3 | `IstioAgentStack` | Cognito, 2 Lambda, Hybrid Gateway | K8s Agent SSM 파라미터 참조 |
| 4 | `NetworkAgentStack` | Cognito, 2 Lambda, Gateway | 없음 |

**교차 스택 의존성**: IstioAgentStack은 배포 시 K8s Agent의 SSM 파라미터(`eks_mcp_server_arn`, `eks_mcp_client_id` 등)를 읽습니다. K8sAgentStack이 먼저 배포되어야 합니다.

## 전체 배포: deploy.sh

`deploy.sh` 스크립트는 4개의 배포 단계를 순차적으로 오케스트레이션합니다.

```bash
# 전체 배포 실행
./deploy.sh
```

### 사전 요구사항 검증

스크립트는 시작 전에 다음 도구를 검증합니다:

- `aws` CLI (`netaiops-deploy` 프로필 포함)
- `npx` (Node.js)
- `docker` (데몬 실행 중)
- `kubectl`
- `agentcore` CLI (`bedrock-agentcore`가 없으면 대체)

### Phase 1: CDK 인프라

```bash
cd infra-cdk
npm install --silent
npm run build
npx cdk deploy --all --profile netaiops-deploy --require-approval never
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

에이전트에게 EKS 클러스터 접근 권한을 부여하는 Kubernetes RBAC 리소스(`ClusterRole`, `ClusterRoleBinding`)를 생성합니다. Chaos Lambda가 파드에 대해 작업하는 데 필요합니다.

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
  AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=netaiops-deploy agentcore deploy
  cd -
done
```

각 에이전트는 CodeBuild를 통해 Bedrock AgentCore에서 ARM64 컨테이너로 배포됩니다.

## 배포 후 체크리스트

`agentcore deploy` 후, 각 에이전트에 대해 여러 수동 단계가 필요합니다:

### 1. JWT Authorizer 복원

`agentcore deploy`는 authorizer 설정을 초기화합니다. 복원 방법:

```python
import boto3
client = boto3.client('bedrock-agentcore-control', region_name='us-east-1')

resp = client.get_agent_runtime(agentRuntimeId='<AGENT_ID>')
client.update_agent_runtime(
    agentRuntimeId='<AGENT_ID>',
    agentRuntimeArtifact=resp['agentRuntimeArtifact'],
    roleArn=resp['roleArn'],
    networkConfiguration=resp['networkConfiguration'],
    protocolConfiguration=resp['protocolConfiguration'],
    authorizerConfiguration={
        'customJWTAuthorizer': {
            'discoveryUrl': '<COGNITO_DISCOVERY_URL>',
            'allowedClients': ['<COGNITO_CLIENT_ID>']
        }
    }
)
```

### 2. SSM에 에이전트 ARN 등록

```bash
aws ssm put-parameter \
  --name "/app/<agent>/agentcore/agent_runtime_arn" \
  --value "<AGENT_ARN>" --type String --overwrite \
  --profile netaiops-deploy --region us-east-1
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
      "Resource": "arn:aws:ssm:us-east-1:175678592674:parameter/app/<agent>/*"
    }]
  }'
```

### 4. Credential Provider 확인

```bash
agentcore identity list-credential-providers
```

## Web UI 배포

프론트엔드는 ALB + CloudFront 뒤의 EC2 Docker 컨테이너에서 서빙됩니다.

### 업데이트 절차

```bash
# 1. 프론트엔드 빌드
cd app/frontend && npm run build

# 2. 빌드 결과를 백엔드 static으로 복사
cp -r dist/* ../backend/static/

# 3. EC2로 전송 (S3 + SSM 사용)
tar czf /tmp/app.tar.gz -C app .
aws s3 cp /tmp/app.tar.gz s3://netaiops-deploy-175678592674-us-east-1/app.tar.gz

# 4. 타겟 인스턴스에서 Docker 리빌드
docker build --no-cache -t netaiops-hub /home/ec2-user/app
OLD_ID=$(docker ps -q --filter publish=8000)
if [ -n "$OLD_ID" ]; then docker stop $OLD_ID && docker rm $OLD_ID; fi
docker run -d -p 8000:8000 --restart unless-stopped netaiops-hub

# 5. CloudFront 무효화
aws cloudfront create-invalidation \
  --distribution-id EO3603OVKIG2I --paths '/*' \
  --profile netaiops-deploy
```

## Lambda Docker 이미지 업데이트

CDK가 Docker 변경을 감지하지 못하는 경우, 수동으로 빌드 및 푸시:

```bash
docker build --no-cache --platform linux/amd64 -t <ECR_REPO>:<TAG> <DOCKER_DIR>
docker push <ECR_REPO>:<TAG>
aws lambda update-function-code --function-name <NAME> --image-uri <ECR_REPO>:<TAG>
```

## 스택 삭제

```bash
# CDK 스택
cd infra-cdk
npx cdk destroy --all --profile netaiops-deploy

# AgentCore 런타임
for agent in k8s-agent incident-agent istio-agent network-agent; do
  cd agents/$agent/agent && agentcore destroy && cd -
done

# EKS MCP Server 런타임
cd agents/k8s-agent/prerequisite/eks-mcp-server && agentcore destroy
```
