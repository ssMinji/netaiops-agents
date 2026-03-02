# System Architecture

## Overview

NetAIOps follows a layered architecture where a React frontend communicates with a FastAPI backend, which orchestrates AI agents deployed on AWS Bedrock AgentCore. Each agent accesses infrastructure tools through MCP (Model Context Protocol) Gateways.

## Full System Diagram

![Full Architecture](../../full-architecture.png)

## Streaming Protocol

The system uses Server-Sent Events (SSE) for real-time streaming:

```
Frontend ──POST /api/chat──► Backend ──HTTP Stream──► AgentCore Runtime
                                                          │
    ◄──── SSE: data chunks ◄──── text stream ◄────────────┘
    ◄──── SSE: metrics     ◄──── __METRICS_JSON__{...}
                           ◄──── __TOOLS_JSON__[...]
```

### In-Band Marker Protocol

Agents emit metadata as in-band markers at the end of their response stream:

| Marker | Format | Content |
|--------|--------|---------|
| `__TOOLS_JSON__` | `__TOOLS_JSON__["tool-a","tool-b"]` | List of MCP tools used |
| `__METRICS_JSON__` | `__METRICS_JSON__{"input_tokens":...}` | Token usage metrics |

The backend parses these markers, strips them from the text stream, and sends a final `{"metrics": {...}}` SSE event combining timing data, token usage, and tool list.

## Data Flow: Chat Request

```
1. User types message in ChatPage
2. Frontend POST /api/chat { agent_id, prompt, session_id, model_id }
3. Backend validates agent_id, gets M2M token
4. Backend resolves agent ARN from SSM
5. Backend invokes AgentCore runtime (HTTP streaming)
6. AgentCore routes to agent container
7. Agent uses Strands SDK to call Claude model
8. Model selects and calls MCP tools via gateway
9. Agent streams response chunks back
10. Backend parses markers, forwards text via SSE
11. Backend sends final metrics event
12. Frontend renders markdown + metrics footer + tool badges
```

## Infrastructure Layers

| Layer | Managed By | Resources |
|-------|-----------|-----------|
| CDK | `npx cdk deploy` | Cognito, IAM, Lambda, SSM, CloudWatch |
| MCP Server | `agentcore deploy` | EKS MCP Server, Network MCP Server |
| MCP Gateway | boto3 API | Gateway, Gateway Targets |
| Agent Runtime | `agentcore deploy` | Agent containers (ARM64) |
| Web UI | Docker + CloudFront | FastAPI + React SPA |

## Per-Agent Stack Architecture

### K8s Agent Stack

- **Dual Cognito Pool**: Agent auth (K8sAgentPool) and Runtime auth (EksMcpServerPool) are separated
- **Gateway → Runtime OAuth2**: Gateway performs separate OAuth2 auth when calling EKS MCP Server
- **EKS MCP Server deployed via CLI**: Not CDK — deployed with `agentcore deploy`, ARN stored manually in SSM
- **Istio Agent reuses EKS MCP Server**: Shares ARN/OAuth info via SSM

### Incident Agent Stack

- **Single Cognito Pool**: Agent auth only (IncidentAnalysisPool)
- **6 Lambda tools**: 3 gateway-connected (Datadog, OpenSearch, Container Insights) + 3 direct-invoked (Chaos, Alarm Trigger, GitHub)
- **Monitoring**: CloudWatch Alarm → SNS → Alarm Trigger Lambda (auto-analysis)

### Istio Agent Stack (Hybrid)

- **Cross-stack dependency**: Reads K8s Agent's SSM parameters for EKS MCP Server access
- **Hybrid gateway**: mcpServer target (EKS MCP) + Lambda target (Prometheus)
- **Fault injection is UI-driven**: Agent does read-only diagnosis; fault injection goes through FastAPI → Lambda directly

### Istio Cross-Stack Dependencies

```
K8s Agent Stack (deploy first)              Istio Agent Stack (deploy after)
┌──────────────────────────────┐           ┌──────────────────────────────┐
│                              │  SSM ref  │                              │
│  EksMcpServerPool            │──────────→│  Istio Gateway               │
│  ├─ machine_client_id        │           │  ├─ OAuth2Provider           │
│  ├─ machine_client_secret    │           │  │  (K8s Runtime Pool creds)  │
│  ├─ cognito_token_url        │           │  │                            │
│  └─ cognito_auth_scope       │           │  └─ EksMcpServer Target       │
│                              │           │     (EKS MCP Server endpoint) │
│  EKS MCP Server Runtime      │──────────→│                              │
│  └─ eks_mcp_server_arn       │           │                              │
└──────────────────────────────┘           └──────────────────────────────┘
```

## Design Decisions

### Why Per-Agent Stacks?

Each agent is deployed as an independent CDK stack rather than a monolithic shared stack. This enables:

- **Independent lifecycle**: Deploy, update, or rollback one agent without affecting others
- **Isolated failure domain**: A misconfigured stack doesn't break other agents
- **Team ownership**: Different teams can own different agent stacks
- **Incremental adoption**: Add new agents without modifying existing infrastructure

**Trade-off**: Cross-agent resource sharing (e.g., Istio Agent reusing K8s Agent's MCP Server) requires SSM parameter-based coordination instead of direct CDK references.

### When to Share vs Isolate Resources

| Resource | Share | Isolate | This Project |
|----------|-------|---------|-------------|
| MCP Server Runtime | Multiple agents use same tools | Agent needs custom tool config | EKS MCP Server shared by K8s + Istio |
| Cognito Pool | Agents in same trust boundary | Different auth requirements | Isolated per agent |
| Lambda Functions | Tools reused across agents | Agent-specific tool logic | Isolated per agent |
| IAM Roles | Same permission requirements | Least privilege per agent | Isolated per agent |

## SSM Parameter Structure

Each agent's Cognito, Gateway, and Runtime resources store parameters in SSM at creation time. Agent Python code reads from SSM at runtime to connect to MCP Gateway.

```
{ssmPrefix}/
├── Cognito (CognitoAuth construct)
│   ├── userpool_id
│   ├── machine_client_id
│   ├── machine_client_secret
│   ├── web_client_id
│   ├── cognito_discovery_url
│   ├── cognito_token_url
│   ├── cognito_auth_url
│   ├── cognito_domain
│   ├── cognito_auth_scope
│   └── cognito_provider
│
├── Gateway (McpGateway construct)
│   ├── gateway_id
│   ├── gateway_name
│   ├── gateway_arn
│   └── gateway_url              ★ Key parameter for agent → gateway connection
│
├── Runtime (runtime-stack)
│   ├── runtime_arn
│   └── runtime_name
│
└── IAM (cognito-stack)
    └── gateway_iam_role
```

### SSM Data Flow

```
                        CDK Deploy                       Runtime
                        ==========                       =======

 ┌─────────────────┐    SSM Write    ┌──────────────┐    SSM Read     ┌──────────────┐
 │ CognitoAuth     │ ──────────────→ │              │ ─────────────→ │ Agent Python │
 │ (CDK construct) │   userpool_id   │              │   gateway_url  │ (agent.py)   │
 └─────────────────┘   client_id     │              │   token_url    │              │
                       client_secret  │              │   client_id    │ MCPClient(   │
 ┌─────────────────┐   token_url     │     SSM      │   client_secret│   gateway_url│
 │ McpGateway      │ ──────────────→ │  Parameter   │                │ )            │
 │ (CDK construct) │   gateway_url   │    Store     │                └──────────────┘
 └─────────────────┘   gateway_id    │              │
                       gateway_arn    │              │    SSM Read     ┌──────────────┐
 ┌─────────────────┐                 │              │ ─────────────→ │ CDK Gateway  │
 │ deploy-eks-     │   eks_mcp_      │              │  eks_mcp_      │ (at deploy   │
 │ mcp-server.sh   │ ──server_arn──→ │              │  server_arn    │  time)       │
 │ (CLI)           │                 │              │                │              │
 └─────────────────┘                 └──────────────┘                └──────────────┘
```

## Scaling and Concurrency

### AgentCore Runtime Scaling

AgentCore manages container scaling automatically. Key considerations when designing your agent:

- **Stateless containers**: Each invocation may hit a different container instance. Do not rely on in-memory state between requests — use SSM, DynamoDB, or AgentCore Memory for persistence.
- **Cold starts**: First invocation after deployment or scale-up has container initialization overhead. Keep container images lean to minimize this.
- **Concurrent invocations**: Multiple users can invoke the same agent simultaneously. Ensure your agent code is safe for concurrent execution (no shared mutable globals).

### MCP Server Concurrency

- **MCP Server runtimes** are also auto-scaled by AgentCore. If your MCP Server connects to external systems (databases, Kubernetes API), ensure connection pooling or rate limiting is in place.
- **Lambda targets** inherit AWS Lambda's concurrency model. Set reserved concurrency if your Lambda calls rate-limited external APIs.

### Token Caching

When multiple agents or users share a Cognito pool, OAuth2 token requests can become a bottleneck. This project caches tokens in-memory with a TTL shorter than the token's actual expiry (3500s for 3600s tokens). For multi-container setups, consider a shared cache (ElastiCache, DynamoDB) if token endpoint rate limits become an issue.

### Gateway Throughput

MCP Gateway is a managed service with its own limits. If your agent makes many parallel tool calls, be aware that each tool call is a separate Gateway request. Strands SDK executes parallel tool calls concurrently, which can amplify Gateway request volume.

## Related Pages

- [AgentCore Identity (Cognito)](cognito.md) — Detailed auth flows, per-agent pool configuration
- [AgentCore Memory](memory.md) — Memory configuration, strategy types, troubleshooting
