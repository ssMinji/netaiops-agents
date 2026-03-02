# Agents Overview

NetAIOps includes four specialized AI agents, each designed for a specific infrastructure domain. All agents are built on the Strands SDK and deployed as ARM64 containers on AWS Bedrock AgentCore.

## Agent Comparison

| Agent | Domain | MCP Tools | Scenarios |
|-------|--------|-----------|-----------|
| [Network](network.md) | AWS networking | Network MCP Server, DNS, CloudWatch | 4 |
| [Incident](incident.md) | Incident investigation | Datadog, OpenSearch, Container Insights, Chaos, GitHub | 4 |
| [K8s](k8s.md) | Kubernetes/EKS | EKS MCP Server | 4 |
| [Istio](istio.md) | Service mesh | EKS MCP, Prometheus, Fault Injection | 5 |

## Common Architecture

Every agent follows the same structural pattern:

```
agents/<name>/
├── agent/
│   ├── agent_config/
│   │   ├── agent.py          # Agent class with stream() method
│   │   ├── agent_task.py     # Task definitions
│   │   ├── context.py        # System prompt
│   │   ├── access_token.py   # Cognito token exchange
│   │   ├── utils.py          # SSM parameter retrieval
│   │   └── __init__.py
│   ├── main.py               # HTTP server entry point
│   ├── Dockerfile            # ARM64 container definition
│   ├── requirements.txt      # Python dependencies
│   ├── .bedrock_agentcore.yaml  # AgentCore deployment config
│   └── scripts/              # Gateway setup scripts
└── prerequisite/             # MCP servers, Lambda tools
```

## Agent Lifecycle

```
1. Container starts on AgentCore
2. main.py initializes HTTP server (port 8080)
3. Incoming request routed to agent.stream()
4. Agent creates Strands Agent with:
   - System prompt (context.py)
   - MCP tools (via gateway)
   - Model configuration (Claude/Qwen/Nova)
5. Agent streams response via stream_async()
6. Tool usage captured from current_tool_use events
7. Token metrics captured from result event
8. __TOOLS_JSON__ and __METRICS_JSON__ markers emitted
```

## Tool Access Pattern

Agents access tools through MCP Gateway, which routes to either Lambda functions or MCP Server runtimes:

```
Agent → MCP Gateway → Lambda Target (tool schema → invoke Lambda)
                    → mcpServer Target (proxy to MCP Server runtime)
```

**Lambda Target Routing**: Since MCP Gateway passes only tool arguments (not tool name) to Lambda, all tool schemas include a `_tool` required parameter. The Lambda handler uses this to dispatch to the correct tool implementation.

## Supported Models

All agents support multiple AI models, selectable per conversation:

| Model | ID |
|-------|----|
| Claude Opus 4.6 | `global.anthropic.claude-opus-4-6-v1` |
| Claude Sonnet 4.6 | `global.anthropic.claude-sonnet-4-6` |
| Claude Haiku 4.5 | `global.anthropic.claude-haiku-4-5-v1` |
| Qwen 3 32B | `qwen.qwen3-32b-v1:0` |
| Amazon Nova Pro | `us.amazon.nova-pro-v1:0` |
