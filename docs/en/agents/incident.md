# Incident Analysis Agent

## Purpose

Automated incident investigation with multi-source metric correlation. The Incident Agent pulls data from Datadog, OpenSearch, and Container Insights to perform root cause analysis, correlate events across systems, and provide actionable remediation recommendations.

## Location

```
agents/incident-agent/
├── agent/                 # Standard runtime
└── agent-cached/          # Prompt caching variant (ENABLE_PROMPT_CACHE=true)
```

## MCP Tools

The Incident Agent has the richest toolset, accessing 6 Lambda-based tool groups:

### Datadog Tools
- `datadog-query-metrics` - Query time-series metrics
- `datadog-get-events` - Retrieve events
- `datadog-get-traces` - APM trace analysis
- `datadog-get-monitors` - Monitor status

### OpenSearch Tools
- `opensearch-search-logs` - Full-text log search
- `opensearch-detect-anomalies` - Anomaly detection
- `opensearch-error-summary` - Error aggregation

### Container Insights Tools
- `container-insights-pod-metrics` - Pod-level CPU/memory
- `container-insights-node-metrics` - Node-level metrics
- `container-insights-cluster-overview` - Cluster summary

### Chaos Engineering Tools
- `chaos-cpu-stress` - CPU stress injection
- `chaos-error-inject` - HTTP error injection
- `chaos-latency-inject` - Latency injection
- `chaos-pod-crash` - Pod termination

### Other Tools
- `alarm-trigger` - CloudWatch alarm integration
- `github-*` - Deployment/commit correlation

## Scenarios

| Scenario | Description |
|----------|-------------|
| CPU Spike Analysis | Correlate CPU spikes across Datadog metrics and Container Insights |
| Error Rate Increase | Search OpenSearch logs + Datadog APM for error patterns |
| Latency Spike | Analyze P99 latency across services using traces |
| Pod Restart Loop | Investigate CrashLoopBackOff with Container Insights + logs |

## AWS Service Permissions

| Component | Required AWS Services | Notes |
|-----------|----------------------|-------|
| **Agent Runtime** | Bedrock, SSM, CloudWatch, Bedrock Memory | Gateway execution role |
| **Lambda (Datadog)** | Secrets Manager | Datadog API accessed via external credentials |
| **Lambda (OpenSearch)** | OpenSearch (full HTTP) | Log search, anomaly detection |
| **Lambda (Container Insights)** | CloudWatch Logs, EKS | Pod/node metrics via Container Insights |
| **Lambda (Chaos)** | EKS, Kubernetes API | Chaos scenario injection on target cluster |
| **Lambda (Alarm)** | SNS, CloudWatch | Alarm trigger/notification |
| **Lambda (GitHub)** | Secrets Manager | GitHub API accessed via external credentials |

The Incident Agent does not use an MCP Server. All tools are Lambda-based, invoked through the MCP Gateway's Lambda target type. Each Lambda shares a common execution role (`incident-tools-lambda-role`).

## Prompt Caching Variant (agent-cached)

The `agent-cached/` directory is a separate deployment of the Incident Agent with prompt caching enabled. Both variants share identical agent code — the only difference is the `ENABLE_PROMPT_CACHE` environment variable set in the Dockerfile.

### Directory Structure

```
agents/incident-agent/
├── agent/                 # Standard runtime (caching disabled)
│   ├── agent_config/      # Shared agent logic
│   ├── Dockerfile         # ENABLE_PROMPT_CACHE not set (defaults to false)
│   └── .bedrock_agentcore.yaml
└── agent-cached/          # Cached runtime (caching enabled)
    ├── agent_config/      # Identical agent logic (copied, not symlinked)
    ├── Dockerfile         # ENV ENABLE_PROMPT_CACHE=true
    └── .bedrock_agentcore.yaml
```

### Key Differences

| Feature | Standard (`agent/`) | Cached (`agent-cached/`) |
|---------|--------------------|-----------------------|
| `ENABLE_PROMPT_CACHE` | not set (false) | `true` |
| Runtime name | `incident_analysis_agent_runtime` | `incident_cached_agent_runtime` |
| Agent code | Identical | Identical |
| `cache_config` | Disabled | `CacheConfig(strategy="auto")` |
| `cache_tools` | Disabled | `"default"` |

### How Caching is Activated

The agent code uses the environment variable to conditionally enable caching:

```python
cache_enabled = os.environ.get("ENABLE_PROMPT_CACHE", "false").lower() == "true"

cache_kwargs = (
    {"cache_config": CacheConfig(strategy="auto"), "cache_tools": "default"}
    if cache_enabled
    else {}
)

self.model = BedrockModel(model_id=self.model_id, **cache_kwargs)
```

### Deployment

The cached variant is deployed as a separate AgentCore runtime:

```bash
cd agents/incident-agent/agent-cached
AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=<AWS_PROFILE> agentcore deploy
```

After deployment, follow the same post-deployment checklist (JWT authorizer restore, SSM ARN registration, execution role permissions) as the standard agent. The cached runtime gets its own ARN stored in SSM.

**Important**: Because `agentcore deploy` uses CodeBuild which zips the source directory, `agent-cached/` contains actual file copies (not symlinks) of the shared `agent_config/` files.

See [Prompt Caching](../appendix/prompt-caching.md) for caching mechanisms, cost impact, and A/B testing guide.

## Chaos Engineering Integration

The UI provides a dedicated ChaosPanel for the Incident Agent, allowing operators to:

1. **Trigger** chaos scenarios (CPU stress, errors, latency, pod crash)
2. **Monitor** active chaos via status indicators
3. **Clean up** all active chaos with one click

This enables live incident simulation for training and testing agent diagnostic capabilities.
