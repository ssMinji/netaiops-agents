# System Architecture

## Overview

NetAIOps follows a layered architecture where a React frontend communicates with a FastAPI backend, which orchestrates AI agents deployed on AWS Bedrock AgentCore. Each agent accesses infrastructure tools through MCP (Model Context Protocol) Gateways.

## Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Web UI (React)                          │
│  i18n (en/ko/ja) · Streaming Chat · Chaos/Fault Controls    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (CloudFront → ALB)
┌──────────────────────────▼──────────────────────────────────┐
│                   FastAPI Backend                             │
│  /api/chat (SSE)  /api/chaos  /api/fault  /api/dashboard     │
│  Token caching · Metrics parsing · Agent routing              │
└──────────────────────────┬──────────────────────────────────┘
                           │ Bearer Token (Cognito M2M)
┌──────────────────────────▼──────────────────────────────────┐
│               Bedrock AgentCore Runtimes                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │ K8s Agent│ │ Incident │ │  Istio   │ │   Network     │   │
│  │          │ │  Agent   │ │  Agent   │ │   Agent       │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘   │
│       │             │            │               │            │
│  ┌────▼─────────────▼────────────▼───────────────▼────────┐  │
│  │              MCP Gateways (Cognito Auth)                │  │
│  └────┬─────────────┬────────────┬───────────────┬────────┘  │
└───────┼─────────────┼────────────┼───────────────┼───────────┘
        │             │            │               │
   ┌────▼────┐   ┌────▼────┐  ┌───▼───┐    ┌──────▼──────┐
   │EKS MCP  │   │ Lambda  │  │Lambda │    │Network MCP  │
   │ Server  │   │  Tools  │  │ Tools │    │  Server     │
   └─────────┘   └─────────┘  └───────┘    └─────────────┘
                  Datadog       Prometheus    DNS, CloudWatch
                  OpenSearch    Fault Inj.   VPC Flow Logs
                  Container
                  Insights
                  Chaos, GitHub
```

## Authentication Flow

All agent-to-gateway communication uses Cognito M2M (machine-to-machine) tokens:

```
1. Backend reads client_id/secret from SSM Parameter Store
2. Backend exchanges credentials for Bearer token (Cognito client_credentials grant)
3. Token cached for 3500 seconds
4. Bearer token sent in Authorization header to AgentCore Runtime
5. AgentCore validates JWT against Cognito discovery URL
6. Agent uses OAuth2 credential provider for MCP Gateway access
```

### Dual Cognito Pool Design

Each agent uses two Cognito User Pools:

| Pool | Purpose | Used By |
|------|---------|---------|
| Agent Pool | JWT authorizer for agent runtime | Backend → Agent |
| Runtime Pool | OAuth2 credential for MCP gateway | Agent → MCP Gateway |

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

## Full System Diagram

![Full Architecture](../../full-architecture.png)

```
us-east-1
==========

                         ┌─────────────────────────────────────────────┐
                         │              EKS Cluster                    │
                         │          (netaiops-eks-cluster)             │
                         │                                             │
                         │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
                         │  │ retail-  │ │ istio-   │ │ Istio      │  │
                         │  │ store    │ │ sample   │ │ + ADOT     │  │
                         │  │ (default)│ │ (Bookinfo│ │ + AMP      │  │
                         │  └──────────┘ └──────────┘ └────────────┘  │
                         └──────────┬──────────┬──────────┬───────────┘
                                    │          │          │
                    ┌───────────────┤          │          │
                    │               │          │          │
        ┌───────────▼────────┐  ┌──▼──────────▼──┐  ┌───▼─────────────────┐
        │   K8s Agent        │  │ Incident Agent  │  │   Istio Agent       │
        │                    │  │                 │  │                     │
        │ ┌────────────────┐ │  │ ┌─────────────┐ │  │ ┌────────────────┐  │
        │ │ Agent Runtime  │ │  │ │Agent Runtime│ │  │ │ Agent Runtime  │  │
        │ └───────┬────────┘ │  │ └──────┬──────┘ │  │ └───────┬────────┘  │
        │         │          │  │        │        │  │         │          │
        │ ┌───────▼────────┐ │  │ ┌──────▼──────┐ │  │ ┌───────▼────────┐  │
        │ │ MCP Gateway    │ │  │ │MCP Gateway  │ │  │ │ MCP Gateway    │  │
        │ │ (mcpServer)    │ │  │ │(Lambda x3)  │ │  │ │ (Hybrid)       │  │
        │ └───────┬────────┘ │  │ └──────┬──────┘ │  │ │ mcpServer +    │  │
        │         │          │  │        │        │  │ │ Lambda x1      │  │
        │ ┌───────▼────────┐ │  │   ┌────┴────┐   │  │ └──┬─────┬──────┘  │
        │ │ EKS MCP Server │ │  │   │ Lambda  │   │  │    │     │         │
        │ │ Runtime        │◄├──┼───┼─────────┼───┼──┤    │     │         │
        │ └────────────────┘ │  │   │ x6 total│   │  │    │     │         │
        │                    │  │   └─────────┘   │  │    │     │         │
        │ ┌────────────────┐ │  │ ┌─────────────┐ │  │    │     │         │
        │ │ Cognito        │ │  │ │ Cognito     │ │  │ ┌──▼──┐ ┌▼──────┐  │
        │ │ (Agent Pool +  │ │  │ │             │ │  │ │EKS  │ │Prom.  │  │
        │ │  Runtime Pool) │ │  │ └─────────────┘ │  │ │MCP  │ │Lambda │  │
        │ └────────────────┘ │  │ ┌─────────────┐ │  │ │reuse│ └───────┘  │
        │                    │  │ │ SNS + Alarm │ │  │ └─────┘            │
        │                    │  │ │ (monitoring)│ │  │ ┌────────────────┐  │
        │                    │  │ └─────────────┘ │  │ │ Cognito        │  │
        └────────────────────┘  └─────────────────┘  │ └────────────────┘  │
                                                     └─────────────────────┘
```

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

## Related Pages

- [Cognito Authentication](cognito.md) — Detailed auth flows, per-agent pool configuration
- [AgentCore Memory](memory.md) — Memory configuration, strategy types, troubleshooting
