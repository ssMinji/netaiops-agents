"""
NetAIOps Agent Hub - FastAPI Backend
=====================================
REST + SSE API for multiple AgentCore agents.
Ported from the Streamlit frontend.
"""

import json
import os
import time
import uuid
import urllib.parse
from typing import Optional

import boto3
import requests as http_requests
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
AGENT_REGION = os.environ.get("AGENT_REGION", "us-east-1")
CHAOS_LAMBDA_NAME = os.environ.get("CHAOS_LAMBDA_NAME", "incident-chaos-tools")
FAULT_LAMBDA_NAME = os.environ.get("FAULT_LAMBDA_NAME", "istio-fault-injection-tools")

AGENTS = {
    "network": {
        "id": "network",
        "name": "Network Diagnostics Agent",
        "icon": "🌐",
        "description": "AWS 네트워크 진단 에이전트 — VPC, DNS, Flow Logs, NAT Gateway, ELB 분석.",
        "ssm_prefix": "/app/network/agentcore",
        "config_path": os.environ.get(
            "NETWORK_AGENT_CONFIG_PATH",
            os.path.join(
                os.path.dirname(__file__), "..", "..",
                "agents", "network-agent", "agent",
                ".bedrock_agentcore.yaml",
            ),
        ),
        "placeholder": "네트워크 진단 요청을 입력하세요... (예: VPC 서브넷 간 연결 상태를 확인해주세요)",
        "scenarios": [
            {"id": "dns", "name": "DNS 진단", "prompt": "Route 53 호스팅 존과 레코드 상태를 확인해주세요. 헬스체크 상태와 DNS 해석 결과도 검증해주세요."},
            {"id": "vpc", "name": "VPC 구성 분석", "prompt": "현재 리전의 VPC, 서브넷, 라우팅 테이블, 인터넷/NAT 게이트웨이 구성을 분석해주세요. 보안 그룹 규칙도 확인해주세요."},
            {"id": "flowlogs", "name": "Flow Logs 분석", "prompt": "VPC Flow Logs에서 거부된 트래픽 패턴을 분석해주세요. 가장 많이 차단되는 소스 IP와 포트를 식별해주세요."},
            {"id": "elb", "name": "로드밸런서 메트릭", "prompt": "현재 리전의 ALB/NLB 상태를 확인해주세요. 응답 시간, 활성 연결 수, 처리 바이트를 분석해주세요."},
        ],
    },
    "incident": {
        "id": "incident",
        "name": "Incident Analysis Agent",
        "icon": "🔍",
        "description": "인시던트 자동 분석 에이전트 — Datadog, OpenSearch, Container Insight 통합 분석.",
        "ssm_prefix": "/app/incident/agentcore",
        "config_path": os.environ.get(
            "INCIDENT_AGENT_CONFIG_PATH",
            os.path.join(
                os.path.dirname(__file__), "..", "..",
                "workshop-module-6", "module-6", "agentcore-incident-agent",
                ".bedrock_agentcore.yaml",
            ),
        ),
        "placeholder": "인시던트 상황을 설명하세요... (예: API 에러율이 5%를 초과했습니다)",
        "scenarios": [
            {"id": "cpu", "name": "CPU 급증 분석", "prompt": "EKS 클러스터에서 CPU 사용률이 급증했습니다. chaos-cpu-stress 파드가 배포된 것으로 보입니다. 클러스터 상태와 원인을 분석해주세요."},
            {"id": "error", "name": "에러율 증가", "prompt": "web-api 서비스에서 ERROR 로그(ECONNREFUSED)가 급증하고 있습니다. chaos-error-injection 파드의 영향인지 로그와 메트릭을 분석해주세요."},
            {"id": "latency", "name": "지연 시간 급증", "prompt": "api-gateway 서비스에서 응답 지연(500~1000ms)이 급증하고 있습니다. chaos-latency-injection 파드의 영향인지 컨테이너 상태를 확인해주세요."},
            {"id": "pod", "name": "파드 재시작 반복", "prompt": "EKS 클러스터에서 파드가 반복적으로 재시작(CrashLoopBackOff)되고 있습니다. chaos-pod-crash 파드를 포함하여 진단해주세요."},
        ],
    },
    "incident-cached": {
        "id": "incident-cached",
        "name": "Incident Agent (Cached)",
        "icon": "🔍",
        "description": "인시던트 분석 에이전트 (Prompt Cache ON) — 캐싱 성능 비교용.",
        "parentId": "incident",
        "ssm_prefix": "/app/incident/agentcore",
        "arn_ssm_key": "/app/incident-cached/agentcore/agent_runtime_arn",
        "config_path": "",
        "placeholder": "인시던트 상황을 설명하세요... (캐싱 적용 버전)",
        "scenarios": [
            {"id": "cpu", "name": "CPU 급증 분석", "prompt": "EKS 클러스터에서 CPU 사용률이 급증했습니다. chaos-cpu-stress 파드가 배포된 것으로 보입니다. 클러스터 상태와 원인을 분석해주세요."},
            {"id": "error", "name": "에러율 증가", "prompt": "web-api 서비스에서 ERROR 로그(ECONNREFUSED)가 급증하고 있습니다. chaos-error-injection 파드의 영향인지 로그와 메트릭을 분석해주세요."},
            {"id": "latency", "name": "지연 시간 급증", "prompt": "api-gateway 서비스에서 응답 지연(500~1000ms)이 급증하고 있습니다. chaos-latency-injection 파드의 영향인지 컨테이너 상태를 확인해주세요."},
            {"id": "pod", "name": "파드 재시작 반복", "prompt": "EKS 클러스터에서 파드가 반복적으로 재시작(CrashLoopBackOff)되고 있습니다. chaos-pod-crash 파드를 포함하여 진단해주세요."},
        ],
    },
    "k8s": {
        "id": "k8s",
        "name": "K8s Diagnostics Agent",
        "icon": "☸",
        "description": "EKS 클러스터 진단 에이전트 — 리전을 동적으로 전환하며 분석합니다.",
        "ssm_prefix": "/a2a/app/k8s/agentcore",
        "config_path": os.environ.get(
            "K8S_AGENT_CONFIG_PATH",
            os.path.join(
                os.path.dirname(__file__), "..", "..",
                "workshop-module-5", "module-5", "agentcore-k8s-agent",
                ".bedrock_agentcore.yaml",
            ),
        ),
        "placeholder": "Ask about your EKS clusters...",
        "scenarios": [
            {"id": "health", "name": "클러스터 상태 점검", "prompt": "EKS 클러스터의 전체 상태를 점검해주세요. 노드 상태, 파드 수, 리소스 사용률을 확인하고 이상 징후가 있으면 알려주세요."},
            {"id": "pods", "name": "비정상 파드 진단", "prompt": "현재 클러스터에서 CrashLoopBackOff, Error, Pending 등 비정상 상태의 파드를 찾아 원인을 진단해주세요."},
            {"id": "resources", "name": "리소스 사용량 분석", "prompt": "클러스터 노드와 파드의 CPU, 메모리 사용량을 분석해주세요. 리소스 부족이나 과다 할당된 워크로드가 있는지 확인해주세요."},
            {"id": "workloads", "name": "워크로드 현황", "prompt": "클러스터의 네임스페이스별 Deployment, StatefulSet, DaemonSet 현황을 보여주세요. 레플리카 수와 가용성 상태를 포함해주세요."},
        ],
    },
    "istio": {
        "id": "istio",
        "name": "Istio Mesh Diagnostics Agent",
        "icon": "⚡",
        "description": "Istio 서비스 메시 진단 에이전트 — mTLS, 트래픽 라우팅, 컨트롤 플레인, Envoy 사이드카 분석.",
        "ssm_prefix": "/app/istio/agentcore",
        "config_path": os.environ.get(
            "ISTIO_AGENT_CONFIG_PATH",
            os.path.join(
                os.path.dirname(__file__), "..", "..",
                "workshop-module-7", "module-7", "agentcore-istio-agent",
                ".bedrock_agentcore.yaml",
            ),
        ),
        "placeholder": "Istio 메시 진단 요청을 입력하세요... (예: productpage에서 reviews로 503 에러 발생)",
        "scenarios": [
            {"id": "connectivity", "name": "서비스 연결 실패 진단", "prompt": "istio-sample 네임스페이스에서 productpage→reviews 요청 시 503 에러가 발생합니다. 토폴로지, 사이드카, VirtualService, mTLS 설정을 확인해주세요."},
            {"id": "mtls", "name": "mTLS 감사", "prompt": "메시 전체의 mTLS 설정 상태를 확인해주세요. retail-store, istio-sample 등 모든 네임스페이스의 PeerAuthentication 정책, 사이드카 미주입 파드, 보안 권고사항을 알려주세요."},
            {"id": "canary", "name": "카나리 배포 분석", "prompt": "istio-sample 네임스페이스의 reviews 서비스 트래픽 라우팅 상태를 확인해주세요. VirtualService 가중치 설정(v1=80%, v2=10%, v3=10%)과 실제 트래픽 비율을 비교 분석해주세요."},
            {"id": "controlplane", "name": "컨트롤 플레인 상태", "prompt": "istiod 컨트롤 플레인의 상태를 확인해주세요. xDS 푸시 지연, 에러, 설정 충돌, 연결된 프록시 수를 알려주세요."},
            {"id": "latency", "name": "지연 핫스팟 탐지", "prompt": "retail-store와 istio-sample 양쪽 네임스페이스의 P99 지연 시간을 스캔하고, 가장 느린 서비스를 식별해주세요. VirtualService fault injection 여부도 확인해주세요."},
        ],
    },
}

MODELS = [
    # Claude
    {"id": "global.anthropic.claude-opus-4-6-v1", "name": "Claude Opus 4.6"},
    {"id": "global.anthropic.claude-sonnet-4-6", "name": "Claude Sonnet 4.6"},
    {"id": "global.anthropic.claude-sonnet-4-5-20250929-v1:0", "name": "Claude Sonnet 4.5"},
    {"id": "global.anthropic.claude-haiku-4-5-20251001-v1:0", "name": "Claude Haiku 4.5"},
    # Qwen
    {"id": "qwen.qwen3-32b-v1:0", "name": "Qwen 3 32B"},
    # Nova
    {"id": "us.amazon.nova-pro-v1:0", "name": "Nova Pro"},
    {"id": "us.amazon.nova-lite-v1:0", "name": "Nova Lite"},
]

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
_token_cache: dict = {}  # agent_id -> {"token": str, "timestamp": float}
_active_chaos: set = set()
_active_faults: set = set()  # active Istio fault injection labels
_arn_cache: dict = {}  # agent_id -> arn

# ---------------------------------------------------------------------------
# AWS clients (lazy)
# ---------------------------------------------------------------------------
_ssm_client = None
_lambda_client = None
_ec2_client = None
_elbv2_client = None

# AWS session: use AWS_PROFILE if set (local dev), otherwise instance role (EC2 deploy)
AWS_PROFILE = os.environ.get("AWS_PROFILE", "")
if AWS_PROFILE:
    _boto_session = boto3.Session(profile_name=AWS_PROFILE, region_name=AGENT_REGION)
else:
    _boto_session = boto3.Session(region_name=AGENT_REGION)


def _get_ssm():
    global _ssm_client
    if _ssm_client is None:
        _ssm_client = _boto_session.client("ssm", region_name=AGENT_REGION)
    return _ssm_client


def _get_lambda():
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = _boto_session.client("lambda", region_name=AGENT_REGION)
    return _lambda_client


# Per-region client caches
_ec2_clients: dict = {}
_elbv2_clients: dict = {}

DASHBOARD_REGIONS = [
    "us-west-2", "us-east-1",
    "ap-northeast-1", "ap-northeast-2", "ap-southeast-1",
    "eu-west-1", "eu-central-1",
]


def _get_ec2(region: str = AGENT_REGION):
    if region not in _ec2_clients:
        _ec2_clients[region] = _boto_session.client("ec2", region_name=region)
    return _ec2_clients[region]


def _get_elbv2(region: str = AGENT_REGION):
    if region not in _elbv2_clients:
        _elbv2_clients[region] = _boto_session.client("elbv2", region_name=region)
    return _elbv2_clients[region]


# ---------------------------------------------------------------------------
# Dashboard helpers (AWS resource fetchers with 60s TTL cache per region)
# ---------------------------------------------------------------------------
_dashboard_cache: dict = {}  # region -> {"data": {...}, "timestamp": float}
_DASHBOARD_TTL = 60  # seconds


def _get_name_tag(tags: list) -> str:
    if not tags:
        return "-"
    for tag in tags:
        if tag.get("Key") == "Name":
            return tag.get("Value", "-")
    return "-"


def _fetch_vpcs(region: str) -> list:
    try:
        resp = _get_ec2(region).describe_vpcs()
        return [
            {
                "id": v["VpcId"],
                "cidr": v.get("CidrBlock", "-"),
                "name": _get_name_tag(v.get("Tags")),
                "state": v.get("State", "unknown"),
            }
            for v in resp.get("Vpcs", [])
        ]
    except Exception:
        return []


def _fetch_ec2_instances(region: str) -> list:
    try:
        resp = _get_ec2(region).describe_instances()
        instances = []
        for res in resp.get("Reservations", []):
            for i in res.get("Instances", []):
                instances.append({
                    "id": i["InstanceId"],
                    "type": i.get("InstanceType", "-"),
                    "state": i.get("State", {}).get("Name", "unknown"),
                    "name": _get_name_tag(i.get("Tags")),
                    "private_ip": i.get("PrivateIpAddress", "-"),
                })
        return instances
    except Exception:
        return []


def _fetch_load_balancers(region: str) -> list:
    try:
        resp = _get_elbv2(region).describe_load_balancers()
        return [
            {
                "name": lb.get("LoadBalancerName", "-"),
                "type": lb.get("Type", "-"),
                "scheme": lb.get("Scheme", "-"),
                "state": lb.get("State", {}).get("Code", "unknown"),
                "dns": lb.get("DNSName", "-"),
            }
            for lb in resp.get("LoadBalancers", [])
        ]
    except Exception:
        return []


def _fetch_nat_gateways(region: str) -> list:
    try:
        resp = _get_ec2(region).describe_nat_gateways(
            Filter=[{"Name": "state", "Values": ["available", "pending", "deleting", "failed"]}]
        )
        result = []
        for ng in resp.get("NatGateways", []):
            public_ip = "-"
            for addr in ng.get("NatGatewayAddresses", []):
                if addr.get("PublicIp"):
                    public_ip = addr["PublicIp"]
                    break
            result.append({
                "id": ng["NatGatewayId"],
                "state": ng.get("State", "unknown"),
                "subnet": ng.get("SubnetId", "-"),
                "public_ip": public_ip,
            })
        return result
    except Exception:
        return []


# ---------------------------------------------------------------------------
# AWS helpers
# ---------------------------------------------------------------------------
def get_ssm_parameter(name: str) -> Optional[str]:
    try:
        resp = _get_ssm().get_parameter(Name=name, WithDecryption=True)
        return resp["Parameter"]["Value"]
    except Exception:
        return None


def get_m2m_access_token(ssm_prefix: str) -> Optional[str]:
    """Get access token using Cognito M2M client_credentials flow."""
    client_id = get_ssm_parameter(f"{ssm_prefix}/machine_client_id")
    client_secret = get_ssm_parameter(f"{ssm_prefix}/machine_client_secret")
    token_url = get_ssm_parameter(f"{ssm_prefix}/cognito_token_url")
    scopes = get_ssm_parameter(f"{ssm_prefix}/cognito_auth_scope")

    if not all([client_id, client_secret, token_url]):
        return None

    try:
        resp = http_requests.post(
            token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": scopes or "",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json().get("access_token")
    except Exception:
        pass
    return None


def get_agent_arn(agent_id: str) -> Optional[str]:
    """Discover agent runtime ARN from YAML config or SSM."""
    if agent_id in _arn_cache:
        return _arn_cache[agent_id]

    agent_cfg = AGENTS[agent_id]
    config_path = agent_cfg["config_path"]
    ssm_prefix = agent_cfg["ssm_prefix"]

    # Try local YAML first
    path = os.path.normpath(config_path)
    if os.path.exists(path):
        try:
            with open(path) as f:
                cfg = yaml.safe_load(f)
            default_agent = cfg.get("default_agent", "")
            agents = cfg.get("agents", {})
            agent_c = agents.get(default_agent, {})
            arn = agent_c.get("bedrock_agentcore", {}).get("agent_arn")
            if arn:
                _arn_cache[agent_id] = arn
                return arn
        except Exception:
            pass

    # Fallback to SSM (use arn_ssm_key if specified, otherwise default path)
    arn_key = agent_cfg.get("arn_ssm_key") or f"{ssm_prefix}/agent_runtime_arn"
    arn = get_ssm_parameter(arn_key)
    if arn:
        _arn_cache[agent_id] = arn
    return arn


def ensure_token(agent_id: str) -> Optional[str]:
    """Return a valid cached token or fetch a new one."""
    cached = _token_cache.get(agent_id)
    if cached and (time.time() - cached["timestamp"]) < 3500:
        return cached["token"]

    agent_cfg = AGENTS[agent_id]
    token = get_m2m_access_token(agent_cfg["ssm_prefix"])
    if token:
        _token_cache[agent_id] = {"token": token, "timestamp": time.time()}
    return token


# ---------------------------------------------------------------------------
# AgentCore invocation (streaming SSE)
# ---------------------------------------------------------------------------
def invoke_agent(agent_arn: str, token: str, session_id: str, prompt: str, model_id: str = None):
    """Invoke AgentCore runtime and yield streamed text chunks."""
    escaped_arn = urllib.parse.quote(agent_arn, safe="")
    url = (
        f"https://bedrock-agentcore.{AGENT_REGION}.amazonaws.com"
        f"/runtimes/{escaped_arn}/invocations"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
    }

    body = {"prompt": prompt, "actor_id": "DEFAULT"}
    if model_id:
        body["model_id"] = model_id

    try:
        resp = http_requests.post(
            url,
            params={"qualifier": "DEFAULT"},
            headers=headers,
            json=body,
            timeout=300,
            stream=True,
        )

        if resp.status_code != 200:
            yield f"Error ({resp.status_code}): {resp.text}"
            return

        for line in resp.iter_lines(chunk_size=8192, decode_unicode=True):
            if not line:
                continue
            if line.strip() in ("data: [DONE]", "[DONE]"):
                break
            if line.startswith("data: "):
                content = line[6:].strip('"')
                content = content.replace("\\n", "\n")
                content = content.replace('\\"', '"')
                content = content.replace("\\\\", "\\")
                yield content
            elif line.startswith("event: "):
                continue

    except http_requests.exceptions.Timeout:
        yield "Request timed out (5 min limit)."
    except http_requests.exceptions.ConnectionError:
        yield "Connection error. Is the agent runtime running?"
    except Exception as e:
        yield f"Error: {e}"


# ---------------------------------------------------------------------------
# Chaos Engineering helpers
# ---------------------------------------------------------------------------
def trigger_chaos(scenario_name: str, params: dict = None) -> dict:
    payload = {"name": scenario_name, "arguments": params or {}}
    try:
        resp = _get_lambda().invoke(
            FunctionName=CHAOS_LAMBDA_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )
        result = json.loads(resp["Payload"].read())
        return result
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="NetAIOps Agent Hub")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- Pydantic models -------------------------------------------------------
class ChatRequest(BaseModel):
    agent_id: str
    session_id: str
    message: str
    model_id: str = None


class ChaosRequest(BaseModel):
    scenario: str


class FaultRequest(BaseModel):
    fault_type: str  # "delay" | "abort" | "circuit-breaker"


# -- Endpoints --------------------------------------------------------------
@app.get("/api/config")
def get_config():
    """Return agent definitions, available models, and region."""
    agents = []
    for aid, acfg in AGENTS.items():
        entry = {
            "id": aid,
            "name": acfg["name"],
            "icon": acfg["icon"],
            "description": acfg["description"],
            "placeholder": acfg["placeholder"],
            "scenarios": acfg["scenarios"],
        }
        if "parentId" in acfg:
            entry["parentId"] = acfg["parentId"]
        agents.append(entry)
    return {"agents": agents, "models": MODELS, "region": AGENT_REGION}


@app.post("/api/chat")
def chat(req: ChatRequest):
    """Stream agent response as SSE."""
    if req.agent_id not in AGENTS:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {req.agent_id}")

    token = ensure_token(req.agent_id)
    if not token:
        raise HTTPException(status_code=503, detail="Failed to acquire authentication token")

    arn = get_agent_arn(req.agent_id)
    if not arn:
        raise HTTPException(status_code=503, detail="Agent ARN not found")

    def event_stream():
        # Flush proxy buffers (CloudFront/nginx typically buffer 4-8KB)
        yield f": {' ' * 4096}\n\n"
        start_time = time.time()
        first_chunk_time = None
        token_metrics = {}
        tools_used = []
        metrics_marker = "__METRICS_JSON__"
        tools_marker = "__TOOLS_JSON__"
        for chunk in invoke_agent(arn, token, req.session_id, req.message, req.model_id):
            # Check for tools marker from agent
            if tools_marker in chunk:
                idx = chunk.index(tools_marker)
                text_before = chunk[:idx]
                json_str = chunk[idx + len(tools_marker):]
                if text_before:
                    if first_chunk_time is None:
                        first_chunk_time = time.time()
                    yield f"data: {json.dumps({'content': text_before})}\n\n"
                try:
                    tools_used = json.loads(json_str)
                except json.JSONDecodeError:
                    pass
                continue
            # Check for token metrics marker from agent
            if metrics_marker in chunk:
                idx = chunk.index(metrics_marker)
                text_before = chunk[:idx]
                json_str = chunk[idx + len(metrics_marker):]
                if text_before:
                    if first_chunk_time is None:
                        first_chunk_time = time.time()
                    yield f"data: {json.dumps({'content': text_before})}\n\n"
                try:
                    token_metrics = json.loads(json_str)
                except json.JSONDecodeError:
                    pass
                continue
            if first_chunk_time is None:
                first_chunk_time = time.time()
            data = json.dumps({"content": chunk})
            yield f"data: {data}\n\n"
        end_time = time.time()
        metrics = {
            "ttfb_ms": round((first_chunk_time - start_time) * 1000) if first_chunk_time else None,
            "total_ms": round((end_time - start_time) * 1000),
            **token_metrics,
        }
        if tools_used:
            # Strip MCP Gateway target prefix (e.g. "DnsTools___dns-resolve" → "dns-resolve")
            metrics["tools_used"] = [
                t.split("___", 1)[1] if "___" in t else t for t in tools_used
            ]
        yield f"data: {json.dumps({'metrics': metrics})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.post("/api/chaos/trigger")
def chaos_trigger(req: ChaosRequest):
    """Trigger a chaos scenario."""
    result = trigger_chaos(req.scenario)
    if result.get("status") == "success":
        _active_chaos.add(req.scenario)
    return result


@app.post("/api/chaos/cleanup")
def chaos_cleanup():
    """Cleanup all active chaos scenarios."""
    result = trigger_chaos("chaos-cleanup")
    if result.get("status") in ("success", "partial"):
        _active_chaos.clear()
    return result


@app.get("/api/chaos/status")
def chaos_status():
    """Return currently active chaos scenarios."""
    return {"active": list(_active_chaos)}


# -- Istio fault injection endpoints ----------------------------------------
FAULT_TYPES = {"delay", "abort", "circuit-breaker"}

# Map fault_type -> Lambda tool name
_FAULT_TOOL_MAP = {
    "delay": "fault-delay-inject",
    "abort": "fault-abort-inject",
    "circuit-breaker": "fault-circuit-breaker",
}


def trigger_fault(tool_name: str, arguments: dict = None) -> dict:
    """Invoke the Istio fault injection Lambda."""
    payload = {"name": tool_name, "arguments": arguments or {}}
    try:
        resp = _get_lambda().invoke(
            FunctionName=FAULT_LAMBDA_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )
        result = json.loads(resp["Payload"].read())
        return result
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/fault/apply")
def fault_apply(req: FaultRequest):
    """Apply an Istio fault injection via Lambda."""
    if req.fault_type not in FAULT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown fault type: {req.fault_type}")
    tool_name = _FAULT_TOOL_MAP[req.fault_type]
    result = trigger_fault(tool_name)
    if result.get("status") == "success":
        _active_faults.add(req.fault_type)
    return result


@app.post("/api/fault/remove")
def fault_remove(req: FaultRequest):
    """Remove an Istio fault injection via Lambda."""
    if req.fault_type not in FAULT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown fault type: {req.fault_type}")
    result = trigger_fault("fault-cleanup", {"fault_type": req.fault_type})
    if result.get("status") == "success":
        _active_faults.discard(req.fault_type)
    return result


@app.post("/api/fault/cleanup")
def fault_cleanup():
    """Remove all active Istio fault injections via Lambda."""
    result = trigger_fault("fault-cleanup")
    if result.get("status") in ("success", "partial"):
        _active_faults.clear()
    return result


@app.get("/api/fault/status")
def fault_status():
    """Return currently active fault injections."""
    return {"active": list(_active_faults)}


# -- Dashboard endpoint -----------------------------------------------------
@app.get("/api/dashboard")
def dashboard(region: str = None):
    """Return AWS infrastructure overview (VPCs, EC2, LBs, NAT GWs) with 60s per-region cache."""
    region = region or DASHBOARD_REGIONS[0]
    if region not in DASHBOARD_REGIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported region: {region}")

    now = time.time()
    entry = _dashboard_cache.get(region)
    if entry and (now - entry.get("timestamp", 0)) < _DASHBOARD_TTL:
        return entry["data"]

    data = {
        "vpcs": _fetch_vpcs(region),
        "ec2_instances": _fetch_ec2_instances(region),
        "load_balancers": _fetch_load_balancers(region),
        "nat_gateways": _fetch_nat_gateways(region),
        "region": region,
        "regions": DASHBOARD_REGIONS,
        "cached_at": now,
    }
    _dashboard_cache[region] = {"data": data, "timestamp": now}
    return data


# -- Static file serving (production build) ---------------------------------
_static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
