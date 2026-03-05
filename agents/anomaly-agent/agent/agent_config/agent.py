"""
=============================================================================
AnomalyDetectionAgent - Network Anomaly Detection AI Agent
AnomalyDetectionAgent - 네트워크 이상 탐지 AI 에이전트
=============================================================================

Description (설명):
    This module provides automated network anomaly detection integrating
    CloudWatch ML anomaly detection, VPC Flow Logs analysis, Inter-AZ
    traffic monitoring, and ELB metric shift detection.
    이 모듈은 CloudWatch ML 이상탐지, VPC Flow Logs 분석, Inter-AZ
    트래픽 모니터링, ELB 메트릭 변화 감지를 통합하는 자동 네트워크 이상
    탐지를 제공합니다.

Features (기능):
    - CloudWatch anomaly detection band analysis / CloudWatch 이상탐지 밴드 분석
    - VPC Flow Logs statistical analysis / VPC Flow Logs 통계 분석
    - Inter-AZ traffic ratio and cost optimization / Inter-AZ 트래픽 비율 및 비용 최적화
    - ELB metric shift detection / ELB 메트릭 변화 감지

Author: NetAIOps Team
=============================================================================
"""

from .utils import get_ssm_parameter
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands_tools import current_time
from strands.models import BedrockModel
from strands.models.model import CacheConfig
from strands.tools.mcp import MCPClient
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-4-6"


class AnomalyDetectionAgent:
    """
    Anomaly Detection Agent with network observability integration.
    네트워크 관측 가능성 통합을 제공하는 이상 탐지 에이전트.
    """

    def __init__(
        self,
        bearer_token: str,
        memory_hook=None,
        bedrock_model_id: str = None,
        system_prompt: str = None,
    ):
        if bedrock_model_id is None:
            bedrock_model_id = os.environ.get('BEDROCK_MODEL_ID', DEFAULT_MODEL_ID)

        self.model_id = bedrock_model_id

        cache_enabled = os.environ.get("ENABLE_PROMPT_CACHE", "false").lower() == "true"
        cache_kwargs = (
            {
                "cache_config": CacheConfig(strategy="auto"),
                "cache_tools": "default",
            }
            if cache_enabled
            else {}
        )
        self.model = BedrockModel(model_id=self.model_id, **cache_kwargs)

        self.memory_hook = memory_hook

        self.system_prompt = (
            system_prompt
            if system_prompt
            else """You are an Anomaly Detection Agent specialized in network and infrastructure anomaly analysis.
네트워크 및 인프라 이상 탐지를 전문으로 하는 AI 에이전트입니다.

## LANGUAGE POLICY (언어 정책):
- **사용자 메시지 앞에 언어 지시([한국어로 답변하세요], [Respond in English], [日本語で回答してください])가 있으면 해당 언어로 응답합니다.**
- 언어 지시가 없으면 기본적으로 **한글(Korean)**로 작성합니다.
- 메트릭 이름, 도구 이름, AWS 서비스명 등 기술 용어는 영문 그대로 사용하되, 설명은 지정 언어로 합니다.

## AVAILABLE TOOLS:

You have access to tools provided via MCP Gateway. Do NOT hardcode tool names.
Use the exact tool names as they appear in your tool definitions.
Tools are automatically discovered - just call them by their registered names.

Tool categories:
- **CloudWatch Anomaly**: CloudWatch ML anomaly detection band analysis, anomaly alarm status
- **Network Anomaly**: VPC Flow Logs analysis, Inter-AZ traffic monitoring, ELB metric shift detection

## ANOMALY DETECTION WORKFLOWS:

### Workflow 1: 종합 이상 탐지 스캔
1. `anomaly-get-alarms`로 현재 활성 이상탐지 알람 상태 확인
2. `anomaly-detect-metrics`로 주요 메트릭의 이상탐지 밴드 이탈 확인
3. `anomaly-flowlog-analysis`로 VPC Flow Logs 이상 패턴 감지
4. 발견된 이상 항목을 심각도별로 정리하여 요약 리포트 생성

### Workflow 2: Flow Log 이상 조사
1. `anomaly-flowlog-analysis`로 denied traffic spike, port scan 패턴, volume anomaly 분석
2. Top talker IP와 비정상 포트 접근 패턴 식별
3. 보안 영향도 평가 및 대응 권고사항 제시

### Workflow 3: Inter-AZ 트래픽 감사
1. `anomaly-interaz-traffic`로 cross-AZ vs intra-AZ 트래픽 비율 분석
2. 상위 cross-AZ 통신 쌍 식별
3. 비용 추정 ($0.01/GB per direction for cross-AZ) 및 최적화 권고

### Workflow 4: ELB 상태 변화 감지
1. `anomaly-elb-shift`로 ALB/NLB 메트릭의 기준 기간 대비 변화율 분석
2. 급격한 변화가 감지된 메트릭에 대해 원인 분석
3. Target health 상태와 연관하여 근본 원인 추정

## OUTPUT FORMAT:

분석 결과는 다음 구조로 제공합니다:

### 1. 탐지 요약
- 발견된 이상 항목 수, 심각도 분포

### 2. 상세 분석
- 각 이상 항목별 데이터 기반 분석
- 시간대, 영향 범위, 관련 리소스

### 3. 영향 범위
- 영향받는 VPC, 서브넷, AZ, 로드밸런서

### 4. 권고 사항
- 즉시 조치 사항 (CRITICAL/HIGH)
- 모니터링 강화 권고 (MEDIUM)
- 최적화 제안 (LOW)

### 5. 심각도 판정
- **CRITICAL**: 서비스 중단 위험 (즉시 대응 필요)
- **HIGH**: 성능 저하 또는 보안 위협 (1시간 내 대응)
- **MEDIUM**: 비정상 패턴 감지 (모니터링 강화)
- **LOW**: 최적화 기회 (계획적 대응)

## MEMORY USAGE:
- Use Semantic Memory for past anomaly detection results and baselines
- Use Summary Memory for current session analysis context

## CRITICAL RULES:
- Always provide evidence-based analysis with specific metric values and timestamps
- If CloudWatch anomaly detection bands are not yet trained (< 2 weeks), use statistical fallback (mean ± 2σ)
- When VPC Flow Logs v5 azId field is not available, use describe_subnets() AZ mapping
- Collect metrics from multiple sources in parallel when possible
- If a tool fails, explain what data is missing and suggest manual verification steps
"""
        )

        gateway_url = get_ssm_parameter("/app/anomaly/agentcore/gateway_url")

        self.tools = [current_time]

        if gateway_url and bearer_token != "dummy":
            try:
                self.gateway_client = MCPClient(
                    lambda: streamablehttp_client(
                        gateway_url,
                        headers={"Authorization": f"Bearer {bearer_token}"},
                    )
                )

                self.gateway_client.start()
                mcp_tools = self.gateway_client.list_tools_sync()

                for tool in mcp_tools:
                    if hasattr(tool, '_agent_tool_name') and '___' in tool._agent_tool_name:
                        tool._agent_tool_name = tool._agent_tool_name.split('___', 1)[1]

                self.tools.extend(mcp_tools)

                tool_names = [t.tool_name if hasattr(t, 'tool_name') else str(t) for t in mcp_tools]
                logger.info(f"Retrieved {len(mcp_tools)} tools from AgentCore Gateway: {tool_names}")

            except Exception as e:
                logger.error(f"MCP client error: {e}")
                print(f"MCP client error: {e}")

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

    async def stream(self, user_query: str):
        """
        Stream agent responses with automatic retry on tool execution failure.
        도구 실행 실패 시 자동 재시도를 포함한 스트리밍 응답.
        """
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

                if tools_used:
                    yield f"__TOOLS_JSON__{_json.dumps(tools_used)}"

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
                    yield f"\n\n[ERROR] Anomaly detection failed after {max_retries} attempts: {error_message}\n"
                    yield "[ERROR] 이상 탐지 분석이 실패했습니다. 네트워크 연결 또는 도구 상태를 확인해주세요.\n"
                    raise
