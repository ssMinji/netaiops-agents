"""
=============================================================================
NetworkAgent - AWS Network Diagnostics Agent
NetworkAgent - AWS 네트워크 진단 에이전트
=============================================================================

Description (설명):
    Specialized agent for AWS network infrastructure diagnostics.
    Combines AWS Network MCP Server tools (VPC, TGW, Cloud WAN, Firewall,
    VPN, Flow Logs) with DNS tools (Route 53) and Network Metrics tools
    (CloudWatch) for comprehensive network analysis.

Capabilities (기능):
    - VPC connectivity diagnosis (VPC 연결성 진단)
    - Transit Gateway routing analysis (TGW 라우팅 분석)
    - DNS resolution troubleshooting (DNS 해석 문제 해결)
    - Network performance analysis (네트워크 성능 분석)
    - Security group / NACL audit (보안 그룹/NACL 감사)
    - Flow Logs analysis (플로우 로그 분석)

Environment Variables (환경변수):
    BEDROCK_MODEL_ID: Override default Claude model

Author: NetAIOps Team
=============================================================================
"""

from .utils import get_ssm_parameter
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands_tools import current_time
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "global.anthropic.claude-opus-4-6-v1"


class NetworkAgent:
    """
    AWS Network Diagnostics Agent.
    AWS 네트워크 진단 에이전트.

    Combines AWS Network MCP Server (VPC, TGW, Cloud WAN, Firewall, VPN, Flow Logs)
    with DNS Lambda (Route 53) and Network Metrics Lambda (CloudWatch) for
    comprehensive network diagnostics.
    """

    def __init__(
        self,
        bearer_token: str,
        memory_hook=None,
        bedrock_model_id: str = None,
        system_prompt: str = None,
        actor_id: str = None,
        session_id: str = None,
    ):
        if bedrock_model_id is None:
            bedrock_model_id = os.environ.get('BEDROCK_MODEL_ID', DEFAULT_MODEL_ID)

        self.model_id = bedrock_model_id
        self.model = BedrockModel(model_id=self.model_id)
        self.memory_hook = memory_hook

        self.system_prompt = (
            system_prompt
            if system_prompt
            else """You are an AWS Network Diagnostics AI Agent specialized in analyzing
AWS network infrastructure including VPC, Transit Gateway, Cloud WAN, Network Firewall,
VPN, Route 53 DNS, and CloudWatch network metrics.
AWS 네트워크 인프라 진단을 전문으로 하는 AI 에이전트입니다.

## LANGUAGE POLICY (언어 정책):
- 모든 분석 리포트, 근본 원인 추정, 대응 가이드는 **한글(Korean)**로 작성합니다.
- 메트릭 이름, 도구 이름, AWS 리소스 이름 등 기술 용어는 영문 그대로 사용하되, 설명은 한글로 합니다.
- 사용자와의 대화 응답도 한글로 합니다.

## AVAILABLE TOOLS:

Tools are automatically discovered from MCP Gateway. Do NOT hardcode tool names.
Use the exact tool names as they appear in your tool definitions.

### AWS Network MCP Server Tools (via Gateway - mcpServer target):
VPC, Transit Gateway, Cloud WAN, Network Firewall, VPN, Flow Logs 등 ~27개 도구:

- **VPC 관련**: VPC 목록/상세, 서브넷, 라우팅 테이블, 보안 그룹, NACL, VPC 엔드포인트, VPC 피어링
- **Transit Gateway 관련**: TGW 목록/상세, TGW 라우팅 테이블, TGW 연결(attachment)
- **Cloud WAN 관련**: 글로벌 네트워크, 코어 네트워크
- **Network Firewall 관련**: 방화벽 정책, 규칙 그룹
- **VPN 관련**: Site-to-Site VPN 연결, 고객 게이트웨이, 가상 프라이빗 게이트웨이
- **Flow Logs 관련**: VPC Flow Logs 조회, 분석

### DNS Tools (via Gateway - Lambda target):
Route 53 DNS 관련 도구:

- **dns-list-hosted-zones**: Route 53 호스팅 존 목록
- **dns-query-records**: DNS 레코드 조회 (A, CNAME, MX 등)
- **dns-check-health**: Route 53 헬스 체크 상태
- **dns-resolve**: DNS 이름 해석 (A, AAAA, CNAME, MX, TXT)

### Network Metrics Tools (via Gateway - Lambda target):
CloudWatch 네트워크 메트릭 및 리소스 조회:

- **network-list-load-balancers**: 리전의 ALB/NLB 로드밸런서 목록 조회 (ARN, DNS, VPC, 상태)
- **network-list-instances**: 리전의 EC2 인스턴스 목록 조회 (VPC별 필터 가능)
- **network-get-instance-metrics**: EC2 인스턴스 네트워크 메트릭 (NetworkIn/Out, PacketsIn/Out)
- **network-get-gateway-metrics**: NAT GW, TGW, VPN 게이트웨이 메트릭
- **network-get-elb-metrics**: ALB/NLB 메트릭 (TargetResponseTime, ActiveConnectionCount, ProcessedBytes)
- **network-query-flow-logs**: VPC Flow Logs CloudWatch Insights 쿼리

## DIAGNOSTIC WORKFLOWS (진단 워크플로우):

### 1. DNS 해석 문제 진단
1. `dns-resolve` → 현재 DNS 해석 결과 확인
2. `dns-list-hosted-zones` → 관련 호스팅 존 확인
3. `dns-query-records` → 설정된 DNS 레코드 확인
4. `dns-check-health` → 헬스 체크 상태 확인
5. 근본 원인 + 해결 방법 제시

### 2. VPC 연결성 분석
1. VPC/서브넷 구성 확인 (Network MCP Server)
2. 라우팅 테이블 분석
3. 보안 그룹 / NACL 규칙 검증
4. VPC 엔드포인트 확인
5. `network-query-flow-logs` → 트래픽 허용/차단 분석
6. 연결 실패 원인 특정

### 3. Transit Gateway 경로 추적
1. TGW 연결(attachment) 상태 확인
2. TGW 라우팅 테이블 분석
3. `network-get-gateway-metrics` → TGW 트래픽 메트릭
4. VPC 간 경로 추적 및 병목 분석

### 4. 네트워크 성능 분석
1. `network-get-instance-metrics` → EC2 네트워크 처리량 확인
2. `network-get-gateway-metrics` → NAT GW/TGW 성능 확인
3. `network-get-elb-metrics` → 로드밸런서 성능 확인
4. `network-query-flow-logs` → 패킷 손실 분석
5. 성능 병목 원인 분석 및 최적화 권장

### 5. 보안 감사
1. 보안 그룹 규칙 전체 조회 (Network MCP Server)
2. NACL 규칙 확인
3. Network Firewall 정책 분석
4. VPN 연결 상태 확인
5. `network-query-flow-logs` → 비정상 트래픽 패턴 탐지
6. 보안 위험 평가 및 권장 사항

### 6. 수정 가이드 제공
모든 진단 결과에 대해:
1. **근본 원인**: 문제의 정확한 원인
2. **영향 범위**: 영향 받는 리소스 목록
3. **즉시 조치**: AWS CLI 명령어 포함한 구체적 수정 방법
4. **장기 개선**: 재발 방지를 위한 구조적 개선
5. **검증 방법**: 수정 후 확인 명령어

## CRITICAL RULES:
- 리전이 지정되지 않으면 사용자에게 물어보세요
- 여러 도구를 병렬로 호출할 수 있으면 논리적 순서대로 호출하세요
- 도구 실패 시 대안 소스를 사용하세요
- 항상 증거 기반 분석을 제공하세요
- 메모리에서 과거 진단 기록을 참조하세요
"""
        )

        # Get AgentCore Gateway URL
        gateway_url = get_ssm_parameter("/app/network/agentcore/gateway_url")

        self.tools = [current_time]

        # Initialize MCP client if gateway is available
        if gateway_url and bearer_token != "dummy":
            try:
                self.gateway_client = MCPClient(
                    lambda: streamablehttp_client(
                        gateway_url,
                        headers={"Authorization": f"Bearer {bearer_token}"},
                    )
                )

                self.gateway_client.start()

                # Fetch all pages of tools (Gateway paginates at ~30 tools)
                all_mcp_tools = []
                page_token = None
                while True:
                    page = self.gateway_client.list_tools_sync(page_token)
                    all_mcp_tools.extend(page)
                    page_token = page.pagination_token
                    if page_token is None:
                        break

                self.tools.extend(all_mcp_tools)

                tool_names = [t.tool_name if hasattr(t, 'tool_name') else str(t) for t in all_mcp_tools]
                logger.info(f"Retrieved {len(all_mcp_tools)} tools from AgentCore Gateway: {tool_names}")

            except Exception as e:
                logger.error(f"MCP client error: {e}")
                print(f"MCP client error: {e}")

        # Initialize agent with memory hook if provided
        if self.memory_hook:
            self.agent = Agent(
                model=self.model,
                system_prompt=self.system_prompt,
                tools=self.tools,
                hooks=[self.memory_hook],
            )
        else:
            self.agent = Agent(
                model=self.model,
                system_prompt=self.system_prompt,
                tools=self.tools,
            )

        # Set agent state for memory hook provider
        if actor_id and session_id:
            self.actor_id = actor_id
            self.session_id = session_id

            if not hasattr(self.agent, 'state'):
                self.agent.state = {}

            if hasattr(self.agent.state, 'set'):
                self.agent.state.set("actor_id", actor_id)
                self.agent.state.set("session_id", session_id)
            elif hasattr(self.agent.state, '__setitem__'):
                self.agent.state["actor_id"] = actor_id
                self.agent.state["session_id"] = session_id
            else:
                setattr(self.agent, '_actor_id', actor_id)
                setattr(self.agent, '_session_id', session_id)
                if not hasattr(self.agent, 'state'):
                    self.agent.state = {"actor_id": actor_id, "session_id": session_id}

            logger.info(f"Set agent state: actor_id={actor_id}, session_id={session_id}")

    async def stream(self, user_query: str):
        """Stream agent responses with automatic retry."""
        import asyncio
        import json as _json
        max_retries = 3
        retry_delay = 2.0

        for attempt in range(max_retries):
            try:
                logger.info(f"Streaming response for query (attempt {attempt + 1})")
                result = None
                tools_used = []
                async for event in self.agent.stream_async(user_query):
                    if "data" in event:
                        yield event["data"]
                    elif "current_tool_use" in event:
                        tool_name = event["current_tool_use"].get("name")
                        if tool_name and tool_name not in tools_used:
                            tools_used.append(tool_name)
                    elif "result" in event:
                        result = event["result"]

                # Emit tools used as a special marker
                if tools_used:
                    yield f"__TOOLS_JSON__{_json.dumps(tools_used)}"

                # Emit token usage metrics as a special marker
                if result and hasattr(result, "metrics") and result.metrics:
                    usage = getattr(result.metrics, "accumulated_usage", None)
                    if usage:
                        metrics_data = {}
                        for src, dst in [
                            ("inputTokens", "input_tokens"),
                            ("outputTokens", "output_tokens"),
                            ("cacheReadInputTokens", "cache_read_tokens"),
                            ("cacheWriteInputTokens", "cache_creation_tokens"),
                        ]:
                            val = usage.get(src)
                            if val is not None and val > 0:
                                metrics_data[dst] = val
                        if metrics_data:
                            yield f"__METRICS_JSON__{_json.dumps(metrics_data)}"
                return

            except Exception as e:
                error_message = str(e)
                logger.error(f"Agent execution error (attempt {attempt + 1}/{max_retries}): {error_message}")

                if attempt < max_retries - 1:
                    wait_time = retry_delay * (attempt + 1)
                    logger.info(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    yield f"\n\n[ERROR] Network analysis failed after {max_retries} attempts: {error_message}\n"
                    yield "[ERROR] 네트워크 분석이 실패했습니다. 네트워크 연결 또는 도구 상태를 확인해주세요.\n"
                    raise
