# AgentCore Identity (Cognito)

## Overview

Each agent uses Cognito User Pools for OAuth2 authentication. A total of 4+ User Pools are used across the system.

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

## User Pool Inventory

| User Pool | Agent | Domain Prefix | Purpose |
|-----------|-------|---------------|---------|
| `K8sAgentPool` | K8s Agent | `k8sagent` | Agent → Gateway auth |
| `EksMcpServerPool` | K8s Agent (Runtime) | `eks-mcp` | Gateway → EKS MCP Server Runtime auth |
| `IncidentAnalysisPool` | Incident Agent | `incident-analysis` | Agent → Gateway auth |
| `IstioMeshPool` | Istio Agent | `istioagent` | Agent → Gateway auth |
| `NetworkAgentPool` | Network Agent | `networkagent` | Agent → Gateway auth |

## Client Types

### Machine Client (M2M)

- **OAuth flow**: `client_credentials`
- **Auth method**: Client ID + Client Secret
- **Purpose**: Server-to-server communication (agent runtimes, backend API, scripts)
- **Primary usage**: UI backend (`app/backend/main.py`) calling AgentCore Runtime
- `generateSecret: true`

## Authentication Flows

### End-to-End Flow

```
User → React Frontend → FastAPI Backend → Cognito (M2M token) → AgentCore Runtime
                                                                        │
                                                                   MCP Gateway
                                                                   ┌────┴────┐
                                                                   │         │
                                                          mcpServer target  Lambda target
                                                          (OAuth2 auth)    (IAM Role)
                                                                   │         │
                                                          EKS MCP Server  Lambda function
```

### 1. UI Backend → AgentCore Runtime (Machine Client)

```
React Frontend ──(no auth)──→ FastAPI Backend ──(Bearer token)──→ AgentCore Runtime
                                      │
                                      ├── Read machine_client_id from SSM
                                      ├── Read machine_client_secret from SSM
                                      ├── Exchange for token via Cognito client_credentials
                                      └── Call Runtime API with Bearer token
```

- Frontend sends unauthenticated requests to `/api/chat`
- Backend handles Cognito token exchange server-side, then calls Runtime

### 2. MCP Gateway → EKS MCP Server (OAuth2)

```
MCP Gateway → OAuth2CredentialProvider → EksMcpServerPool → EKS MCP Server Runtime
                       │
                       ├── Uses EksMcpServerPool Machine Client credentials
                       └── scope: eks-mcp-server/invoke
```

- K8s Agent: CDK directly creates Runtime Pool and configures OAuth2 Provider
- Istio Agent: Reads K8s Agent's Runtime Pool credentials from SSM for OAuth2 Provider

### 3. MCP Gateway → Lambda (IAM Role)

```
MCP Gateway → GATEWAY_IAM_ROLE → Lambda Function
```

- No OAuth2 auth; Gateway's IAM role invokes Lambda directly

## Design Decisions

### Why Dual Cognito Pools?

A single pool could handle both inbound and outbound authentication, but dual pools provide:

- **Scope isolation**: Inbound scopes (who can call the agent) are completely separate from outbound scopes (what the agent can access)
- **Independent rotation**: Rotate M2M credentials without disrupting frontend auth
- **Audit clarity**: CloudTrail logs clearly distinguish "user called agent" vs "agent called tool"
- **Least privilege**: Backend tokens cannot accidentally access MCP Server resources

**When you DON'T need dual pools**: If your agent only uses Lambda targets (like the Incident Agent in this project), there's no outbound OAuth2 flow — Lambda targets authenticate via IAM role. A single Agent Pool is sufficient.

### Choosing Your Auth Pattern

| Pattern | Use When | Example |
|---------|----------|---------|
| **Dual Pool** (Agent + Runtime) | Agent calls MCP Server targets requiring OAuth2 | K8s, Network, Istio agents |
| **Single Pool** (Agent only) | Agent uses only Lambda targets or IAM-based auth | Incident agent |
| **No Pool** (IAM only) | Internal-only agent, no external callers | Development/testing |

## Per-Agent Details

### K8s Agent

- **Agent Pool** (`K8sAgentPool`): scopes `gateway:read`, `gateway:write`, `invoke`
  - Machine Client: `K8sMachineClient` — UI backend Runtime invocation
- **Runtime Pool** (`EksMcpServerPool`): scope `invoke`
  - Machine Client: `EksMcpServerClient`
  - Shared by Istio Agent Gateway for EKS MCP Server access

### Incident Agent

- **Auth Pool** (`IncidentAnalysisPool`): scope `invoke`
  - Machine Client: `IncidentAnalysisMachineClient` — UI backend Runtime invocation
- Gateway uses only Lambda targets, so no Runtime Pool needed

### Istio Agent

- **Auth Pool** (`IstioMeshPool`): scopes `gateway:read`, `gateway:write`
  - Machine Client: `IstioMachineClient` — UI backend Runtime invocation
- EKS MCP Server access uses K8s Agent's `EksMcpServerPool` credentials read from SSM

### Network Agent

- **Auth Pool** (`NetworkAgentPool`): scopes for gateway and invoke
  - Machine Client — UI backend Runtime invocation
- Uses Network MCP Server Runtime with its own OAuth2 Provider

## SSM Parameters

Each Pool's credentials are stored in SSM Parameter Store:

| Parameter | Description |
|-----------|-------------|
| `{prefix}/machine_client_id` | Machine Client ID |
| `{prefix}/machine_client_secret` | Machine Client Secret |
| `{prefix}/cognito_token_url` | OAuth2 token endpoint |
| `{prefix}/cognito_discovery_url` | OIDC Discovery URL |
| `{prefix}/cognito_auth_scope` | Allowed OAuth2 scopes |
| `{prefix}/userpool_id` | User Pool ID |

**SSM Prefixes:**
- K8s Agent: `/a2a/app/k8s/agentcore`
- K8s Runtime Pool: `/a2a/app/k8s/agentcore` (key prefix: `eks_mcp_`)
- Incident Agent: `/app/incident/agentcore`
- Istio Agent: `/app/istio/agentcore`
- Network Agent: `/app/network/agentcore`
