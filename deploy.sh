#!/bin/bash
# =============================================================================
# NetAIOps 에이전트 인프라 + 런타임 전체 배포 스크립트
# Phase 1: CDK (Cognito, IAM, Lambda, SSM)
# Phase 2: EKS RBAC
# Phase 3: MCP Server Runtime (agentcore deploy)
# Phase 4: Agent Runtime (agentcore deploy × 4)
# 참고: Web UI(netaiops-hub)는 이 스크립트에 포함되지 않음 (별도 배포)
# =============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${AWS_PROFILE:-netaiops-deploy}"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE} NetAIOps 에이전트 전체 배포${NC}"
echo -e "${BLUE} Profile: ${PROFILE}${NC}"
echo -e "${BLUE}================================================${NC}"

# ---------------------------------------------
# 사전 검증
# ---------------------------------------------
echo ""
echo -e "${BLUE}[사전 검증] 필수 도구 확인...${NC}"

MISSING=()
command -v aws &>/dev/null || MISSING+=("aws-cli")
command -v npx &>/dev/null || MISSING+=("npx (Node.js)")
command -v docker &>/dev/null || MISSING+=("docker")
command -v kubectl &>/dev/null || MISSING+=("kubectl")
(command -v agentcore || command -v bedrock-agentcore) &>/dev/null || MISSING+=("agentcore CLI")

if [ ${#MISSING[@]} -gt 0 ]; then
    echo -e "${RED}ERROR: 다음 도구가 설치되어 있지 않습니다: ${MISSING[*]}${NC}"
    exit 1
fi

# Docker 데몬 확인
if ! docker info &>/dev/null; then
    echo -e "${RED}ERROR: Docker 데몬이 실행 중이 아닙니다.${NC}"
    exit 1
fi

# AWS 자격증명 확인
if ! aws sts get-caller-identity --profile "$PROFILE" &>/dev/null; then
    echo -e "${RED}ERROR: AWS 프로필 '${PROFILE}' 인증 실패${NC}"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
REGION="us-east-1"
echo -e "${GREEN}AWS Account: ${ACCOUNT_ID} | Profile: ${PROFILE}${NC}"
echo -e "${GREEN}필수 도구 확인 완료${NC}"

# =============================================================================
# Phase 1: CDK 인프라 배포
# =============================================================================
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE} Phase 1: CDK 인프라 배포${NC}"
echo -e "${BLUE}================================================${NC}"

# K8sAgentStack의 Gateway가 EKS MCP Server ARN을 SSM에서 읽는데,
# 첫 배포 시에는 아직 EKS MCP Server가 없으므로 placeholder를 생성한다.
NEED_K8S_REDEPLOY=false
if ! aws ssm get-parameter \
    --name "/a2a/app/k8s/agentcore/eks_mcp_server_arn" \
    --region "$REGION" --profile "$PROFILE" &>/dev/null; then
    echo -e "${BLUE}첫 배포 감지: EKS MCP Server ARN placeholder 생성...${NC}"
    aws ssm put-parameter \
        --name "/a2a/app/k8s/agentcore/eks_mcp_server_arn" \
        --value "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/placeholder" \
        --type String \
        --profile "$PROFILE" \
        --region "$REGION"
    NEED_K8S_REDEPLOY=true
fi

if ! aws ssm get-parameter \
    --name "/app/network/agentcore/network_mcp_server_arn" \
    --region "$REGION" --profile "$PROFILE" &>/dev/null; then
    echo -e "${BLUE}첫 배포 감지: Network MCP Server ARN placeholder 생성...${NC}"
    aws ssm put-parameter \
        --name "/app/network/agentcore/network_mcp_server_arn" \
        --value "placeholder-deploy-mcp-server-first" \
        --type String \
        --profile "$PROFILE" \
        --region "$REGION"
fi

cd "${ROOT_DIR}/infra-cdk"

echo -e "${BLUE}npm install...${NC}"
npm install --silent

echo -e "${BLUE}TypeScript 빌드...${NC}"
npm run build

echo -e "${BLUE}CDK 배포 시작 (3 stacks)...${NC}"
npx cdk deploy --all --profile "$PROFILE" --require-approval never

echo -e "${GREEN}Phase 1 완료: CDK 인프라 배포 성공${NC}"

# =============================================================================
# Phase 2: EKS RBAC 설정
# =============================================================================
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE} Phase 2: EKS RBAC 설정 (Chaos Lambda)${NC}"
echo -e "${BLUE}================================================${NC}"

bash "${ROOT_DIR}/agents/incident-agent/prerequisite/setup-eks-rbac.sh"

echo -e "${GREEN}Phase 2 완료: EKS RBAC 설정 성공${NC}"

# =============================================================================
# Phase 3: EKS MCP Server Runtime 배포
# =============================================================================
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE} Phase 3: EKS MCP Server Runtime 배포${NC}"
echo -e "${BLUE}================================================${NC}"

bash "${ROOT_DIR}/agents/k8s-agent/prerequisite/eks-mcp-server/deploy-eks-mcp-server.sh"

echo -e "${GREEN}Phase 3 완료: EKS MCP Server 배포 성공${NC}"

# =============================================================================
# Phase 3-B: Network MCP Server Runtime 배포
# =============================================================================
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE} Phase 3-B: Network MCP Server Runtime 배포${NC}"
echo -e "${BLUE}================================================${NC}"

bash "${ROOT_DIR}/agents/network-agent/prerequisite/deploy-network-mcp-server.sh"

echo -e "${GREEN}Phase 3-B 완료: Network MCP Server 배포 성공${NC}"

# 첫 배포 시 placeholder를 사용했으므로, 실제 ARN으로 K8sAgentStack 재배포
if [ "$NEED_K8S_REDEPLOY" = true ]; then
    echo ""
    echo -e "${BLUE}K8sAgentStack 재배포 (실제 EKS MCP Server ARN 반영)...${NC}"
    cd "${ROOT_DIR}/infra-cdk"
    npx cdk deploy K8sAgentStack --profile "$PROFILE" --require-approval never
    echo -e "${GREEN}K8sAgentStack 재배포 완료${NC}"
fi

# =============================================================================
# Phase 4: Agent Runtime 배포
# =============================================================================
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE} Phase 4: Agent Runtime 배포${NC}"
echo -e "${BLUE}================================================${NC}"

AGENTCORE_CMD="agentcore"
command -v agentcore &>/dev/null || AGENTCORE_CMD="bedrock-agentcore"

echo -e "${BLUE}[4-1] K8s Agent Runtime 배포...${NC}"
cd "${ROOT_DIR}/agents/k8s-agent/agent"
$AGENTCORE_CMD deploy
echo -e "${GREEN}K8s Agent Runtime 배포 완료${NC}"

echo ""
echo -e "${BLUE}[4-2] Incident Agent Runtime 배포...${NC}"
cd "${ROOT_DIR}/agents/incident-agent/agent"
$AGENTCORE_CMD deploy
echo -e "${GREEN}Incident Agent Runtime 배포 완료${NC}"

echo ""
echo -e "${BLUE}[4-3] Istio Agent Runtime 배포...${NC}"
cd "${ROOT_DIR}/agents/istio-agent/agent"
$AGENTCORE_CMD deploy
echo -e "${GREEN}Istio Agent Runtime 배포 완료${NC}"

echo ""
echo -e "${BLUE}[4-4] Network Agent Runtime 배포...${NC}"
cd "${ROOT_DIR}/agents/network-agent/agent"
$AGENTCORE_CMD deploy
echo -e "${GREEN}Network Agent Runtime 배포 완료${NC}"

echo -e "${GREEN}Phase 4 완료: Agent Runtime 배포 성공${NC}"

# =============================================================================
# 완료
# =============================================================================
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN} 전체 배포 완료!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "배포된 Agent:"
echo "  - K8s Agent Runtime"
echo "  - Incident Agent Runtime"
echo "  - Istio Agent Runtime"
echo "  - Network Agent Runtime"
echo ""
echo "Istio 인프라 (메시, AMP/ADOT, 샘플 워크로드)는"
echo "EKS 클러스터 배포 시 자동 설정됩니다:"
echo "  ./sample-workloads/retail-store/deploy-eks-workload.sh deploy-all"
echo ""
