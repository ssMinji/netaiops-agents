# Prompt Caching Guide

## Overview

By leveraging Bedrock Converse API's Prompt Caching, you can cache repeated prompt prefixes to achieve **cost reduction** and **lower response latency**. This project uses two caching options provided by the Strands SDK's `BedrockModel`.

## Caching Mechanisms

### 1. `cache_config` — Message (Conversation History) Caching

```python
from strands.models.model import CacheConfig

BedrockModel(
    cache_config=CacheConfig(strategy="auto"),
)
```

**How it works:**
- The SDK automatically inserts a `{"cachePoint": {"type": "default"}}` block at the end of the last assistant message on every request
- Bedrock caches content up to that cachePoint and reuses it on the next turn
- Existing cachePoints are automatically removed and re-inserted at the new position

**Effect:**
- Reduces reprocessing costs for previous turns in multi-turn conversations
- Effectiveness increases as conversations grow longer

**Supported models:** Claude/Anthropic models only (when `model_id` contains `claude` or `anthropic`)

**Strategy options:**
- `"auto"` — The only option (designed for future extensibility)

---

### 2. `cache_tools` — Tool Definition Caching

```python
BedrockModel(
    cache_tools="default",
)
```

**How it works:**
- Appends a `{"cachePoint": {"type": "default"}}` block after the tool schema list in `toolConfig`
- Prevents tool definitions (names, descriptions, parameter schemas) from being reprocessed on every request

**Effect:**
- Greater benefit for agents with more tools

| Agent | Tool Count | Expected Benefit |
|-------|-----------|-----------------|
| K8s Agent | ~16 (EKS MCP Server) | Medium |
| Incident Agent | ~18 (6 Lambda groups) | High |
| Istio Agent | ~15 (EKS MCP + Prometheus) | High |

---

### ~~`performanceConfig`~~ — Not Used

> **Note**: `performanceConfig` is a **latency optimization** option, not prompt caching. It is a completely separate feature from prompt caching.
>
> - The only valid field in `performanceConfig` is `latency`; `promptCache` does not exist as a field
> - Claude Opus models do not support `performanceConfig` at all
> - Prompt caching works solely through `cache_config` + `cache_tools`

---

## Comparing the Two Mechanisms

| | `cache_config` | `cache_tools` |
|---|---|---|
| **Cache target** | System prompt + conversation history | Tool definition JSON |
| **Operation level** | SDK (inserts cachePoint in messages) | SDK (inserts cachePoint in toolConfig) |
| **Supported models** | Claude/Anthropic only | Claude/Anthropic only |
| **Effectiveness increases when** | Conversations get longer | More tools are used |
| **Independence** | Independent of other options | Independent of other options |

---

## How to Apply

### Before (No caching)

```python
self.model = BedrockModel(
    model_id=self.model_id,
)
```

### After (With caching)

```python
from strands.models.model import CacheConfig

self.model = BedrockModel(
    model_id=self.model_id,
    cache_config=CacheConfig(strategy="auto"),
    cache_tools="default",
)
```

### Current Application Status

| Agent | File | Caching Applied |
|-------|------|----------------|
| Incident Agent (Cached) | `agents/incident-agent/agent-cached/agent_config/agent.py` | **Applied** (when `ENABLE_PROMPT_CACHE=true`) |
| Incident Agent | `agents/incident-agent/agent/agent_config/agent.py` | Not applied (control group) |
| K8s Agent | `agents/k8s-agent/agent/agent_config/agent.py` | Not applied |
| Istio Agent | `agents/istio-agent/agent/agent_config/agent.py` | Not applied |

---

## Caching Requirements

- **Minimum tokens**: Bedrock prompt caching only activates above a certain token threshold (approximately 1,024–2,048 tokens for Claude models)
- **Model support**: `us.anthropic.claude-*` or `global.anthropic.claude-*` family
- **Region**: Bedrock regions that support prompt caching (us-east-1, us-west-2, ap-northeast-1, etc.)

---

## Cost Impact

| Item | Without Caching | With Caching |
|------|----------------|-------------|
| System prompt | Fully processed on every request | Processed only on first request, cache hit thereafter |
| Tool definitions | Fully processed on every request | Processed only on first request, cache hit thereafter |
| Conversation history | Fully reprocessed every turn | Previous turns cached, only new turn processed |
| **Cache hit cost** | N/A | **10%** of normal input token cost |
| **Cache write cost** | N/A | **25% additional** over normal input token cost |

> The first request incurs additional cache write costs, but subsequent requests are processed at a 90% discount.
> In multi-turn conversations, an average **50–70% input cost reduction** is expected.

---

## Environment Variable Control

The Incident Agent (Cached) uses an environment variable to toggle caching on/off:

```python
import os
from strands.models.model import CacheConfig

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
```

In Dockerfile:
```dockerfile
ENV ENABLE_PROMPT_CACHE=true
```

> Default is `"false"` (caching disabled). Only the Cached Agent's Dockerfile sets it to `true`.

---

## Metrics UI

The Web UI displays response time and token usage at the bottom of each assistant message.

### Displayed Items

| Item | Description | Source |
|------|-------------|--------|
| TTFB | Time To First Byte | Server-side measurement, client-side fallback |
| Total | Total response completion time | Server-side measurement, client-side fallback |
| In | Input tokens processed without cache | Bedrock `inputTokens` |
| Out | Output token count | Bedrock `outputTokens` |
| Cache read | Input tokens read from cache (90% cost reduction) | Bedrock `cacheReadInputTokens` |
| Cache write | Input tokens written to cache (25% additional cost) | Bedrock `cacheWriteInputTokens` |

### Display Examples

Agent without caching:
```
TTFB 2.4s · Total 69.8s · In 102,468 · Out 7,010 tokens
```

Agent with caching:
```
TTFB 2.8s · Total 103.7s · In 33,174 · Out 9,607 · Cache read 142,221 · Cache write 37,224 tokens
```

### Token Field Interpretation

| Field | Meaning | Without Caching | With Caching |
|-------|---------|----------------|-------------|
| In | Newly processed input | Total input = In | Only uncached portion |
| Cache read | Read from cache | Not displayed | Cache hit portion |
| Cache write | Newly written to cache | Not displayed | New cache entries |

> **Verifying caching effect**: Without caching `In` ≈ With caching `In + Cache read + Cache write`
>
> If `In` decreases with each turn in multi-turn conversations, cache hit rate is improving.

### Data Flow

```
BedrockModel (Bedrock API) → AgentResult.metrics.accumulated_usage
    → agent.py: Sent in stream as __METRICS_JSON__ marker
    → backend main.py: Marker detection → merged into metrics SSE event
    → frontend api.ts: Metrics event parsing → onDone(metrics)
    → ChatPage.tsx: MessageMetricsFooter rendering
```

---

## A/B Testing Guide

A method for quantitatively comparing performance differences between the Incident Agent (without caching) and Incident Agent Cached (with caching).

### Prerequisites

1. Set the same model in the Web UI (e.g., Claude Sonnet 4.5)
2. Start a new session with "+ New Chat" on both agents
3. Send identical questions to both in sequence

### Scenario A: Error Rate Increase Deep Analysis

| Order | Question |
|-------|----------|
| 1 | ERROR logs (ECONNREFUSED) are surging in the web-api service. Please analyze the cluster status and logs. |
| 2 | Identify the pods causing errors and check their CPU/memory usage. |
| 3 | Compare the log pattern changes 30 minutes before and after the errors. |
| 4 | Based on the analysis so far, summarize the root cause and response plan. |

### Scenario B: CPU Spike + Cascading Impact

| Order | Question |
|-------|----------|
| 1 | CPU usage has spiked in the EKS cluster. Please analyze per-node and per-pod CPU usage. |
| 2 | Check the detailed metrics and logs for the top 3 pods consuming the most CPU. |
| 3 | Check if the CPU spike is affecting response latency or errors in other services. |
| 4 | Create a GitHub Issue for this incident and add the analysis results as a comment. |

### Scenario C: Pod Restart Loop Diagnosis

| Order | Question |
|-------|----------|
| 1 | Pods are repeatedly restarting (CrashLoopBackOff) in the EKS cluster. Please check overall pod status. |
| 2 | Analyze error patterns in the logs of pods in CrashLoopBackOff state. |
| 3 | Check the impact on other services. Analyze dependency relationships and error propagation. |
| 4 | Summarize the estimated root cause and preventive measures. |

### Expected Results

| Question Order | Without Caching | With Caching (Expected) |
|---------------|----------------|------------------------|
| 1st | Only In displayed (full input) | High Cache write, Cache read 0 (cache creation) |
| 2nd | In increases (history accumulates) | Cache read increases, In decreases (system prompt + tools + 1 turn cache hit) |
| 3rd | In increases further | Cache read increases further, In decreases further (accumulated history cache hit) |
| 4th | In at maximum | Cache read at maximum, In at minimum (most context cached) |

### Notes

- **Agent non-determinism**: Even with the same question, the model may select different tools or call them different numbers of times on each execution. For fair comparison, run the same scenario multiple times (5+ runs) and compare averages
- **Cache TTL**: Bedrock prompt cache TTL is 5 minutes. If the interval between questions exceeds 5 minutes, the cache expires
- **TTFB vs Total**: TTFB includes tool execution time within the agent (Lambda calls), so the difference may be smaller than pure model latency improvement
- **Token count comparison**: If without caching `In` ≈ with caching `In + Cache read + Cache write`, it's working correctly
- **First request**: Cache creation (write) costs are added, so the cached agent may actually be slightly slower on the first request
