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
