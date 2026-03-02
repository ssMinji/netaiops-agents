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

## Prompt Caching Variant

The `agent-cached/` directory contains a variant with prompt caching enabled:

```python
BedrockModel(
    model_id=model_id,
    cache_config=CacheConfig(strategy="auto"),
    cache_tools="default"
)
```

This reduces token usage for repeated conversations by caching:
- Tool definitions (`cache_tools`)
- Last assistant message context (`cache_config`)

See [Prompt Caching](../PROMPT-CACHING.md) for details.

## Chaos Engineering Integration

The UI provides a dedicated ChaosPanel for the Incident Agent, allowing operators to:

1. **Trigger** chaos scenarios (CPU stress, errors, latency, pod crash)
2. **Monitor** active chaos via status indicators
3. **Clean up** all active chaos with one click

This enables live incident simulation for training and testing agent diagnostic capabilities.
