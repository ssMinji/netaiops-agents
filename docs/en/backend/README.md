# Backend API Reference

## Overview

The backend is a FastAPI application serving as the gateway between the React frontend and Bedrock AgentCore agent runtimes. It handles authentication, streaming proxy, chaos/fault orchestration, and static file serving.

## Location

```
app/backend/
├── main.py           # FastAPI application
├── Dockerfile        # Docker image definition
├── requirements.txt  # Python dependencies
└── static/           # React build output (served as SPA)
```

## Endpoints

### Configuration

#### `GET /api/config`

Returns agent definitions, available models, and region.

```json
{
  "agents": {
    "network": {
      "name": "Network Diagnostics Agent",
      "description": "...",
      "icon": "globe",
      "scenarios": [...]
    }
  },
  "models": ["global.anthropic.claude-opus-4-6-v1", ...],
  "region": "us-east-1"
}
```

### Chat

#### `POST /api/chat`

Streaming chat endpoint using Server-Sent Events.

**Request:**
```json
{
  "agent_id": "k8s",
  "prompt": "Check cluster health",
  "session_id": "uuid-v4",
  "model_id": "global.anthropic.claude-opus-4-6-v1"
}
```

**SSE Events:**
```
data: {"content": "Checking cluster..."}
data: {"content": " health status"}
data: {"metrics": {"ttfb_ms": 245, "total_ms": 3200, "input_tokens": 1234, "output_tokens": 456, "tools_used": ["eks-list-clusters"]}}
```

### Chaos Engineering (Incident Agent)

#### `POST /api/chaos/trigger`
```json
{ "scenario": "cpu-stress", "params": {"duration": 60} }
```

#### `POST /api/chaos/cleanup`
Cleans up all active chaos scenarios.

#### `GET /api/chaos/status`
Returns list of currently active chaos scenarios.

### Fault Injection (Istio Agent)

#### `POST /api/fault/apply`
```json
{ "type": "delay", "params": {"delay_seconds": 5, "percentage": 50} }
```

#### `POST /api/fault/remove`
```json
{ "type": "delay" }
```

#### `POST /api/fault/cleanup`
Removes all active fault injections.

#### `GET /api/fault/status`
Returns list of currently active faults.

### Dashboard

#### `GET /api/dashboard?region=us-east-1`

Returns AWS infrastructure overview for the specified region.

```json
{
  "vpcs": [...],
  "ec2_instances": [...],
  "load_balancers": [...],
  "nat_gateways": [...]
}
```

Data is cached per-region with 60-second TTL.

## Authentication

### M2M Token Flow

```
1. Read client_id, client_secret from SSM Parameter Store
2. POST to Cognito token endpoint (client_credentials grant)
3. Receive Bearer token (3600s expiry)
4. Cache token for 3500s (with safety margin)
5. Include in Authorization header for AgentCore calls
```

### Token Caching Mechanism

The backend caches M2M tokens in-memory per agent to avoid redundant Cognito token exchanges.

```python
_token_cache: dict = {}  # {agent_id -> {"token": str, "timestamp": float}}

def ensure_token(agent_id: str) -> Optional[str]:
    cached = _token_cache.get(agent_id)
    if cached and (time.time() - cached["timestamp"]) < 3500:
        return cached["token"]

    token = get_m2m_access_token(AGENTS[agent_id]["ssm_prefix"])
    if token:
        _token_cache[agent_id] = {"token": token, "timestamp": time.time()}
    return token
```

| Parameter | Value | Notes |
|-----------|-------|-------|
| Cache storage | In-memory `dict` | Per-process, not shared across workers |
| Cache key | `agent_id` | Each agent has its own cached token |
| TTL | 3500 seconds | 100s safety margin before Cognito's 3600s expiry |
| Refresh | Lazy | New token fetched only when cache miss or expired |

The `get_m2m_access_token()` function reads credentials from SSM (`machine_client_id`, `machine_client_secret`, `cognito_token_url`, `cognito_auth_scope`) and performs a `client_credentials` grant POST to the Cognito token endpoint.

### Agent ARN Resolution

Each agent's runtime ARN is stored in SSM:

```
/app/incident/agentcore/agent_runtime_arn
/a2a/app/k8s/agentcore/agent_runtime_arn
/app/istio/agentcore/agent_runtime_arn
/app/network/agentcore/agent_runtime_arn
```

## Streaming Protocol

The backend acts as a streaming proxy between AgentCore and the frontend:

1. **Receive** HTTP chunked response from AgentCore
2. **Parse** in-band markers (`__TOOLS_JSON__`, `__METRICS_JSON__`)
3. **Forward** text content as SSE `data` events
4. **Emit** final `metrics` SSE event with combined timing + tokens + tools

## Lambda Integration

Chaos and fault operations invoke Lambda functions directly:

```python
lambda_client.invoke(
    FunctionName="incident-chaos-tools",
    InvocationType="RequestResponse",
    Payload=json.dumps({"name": tool_name, "arguments": params})
)
```
