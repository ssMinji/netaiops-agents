# CDK Infrastructure

## Overview

Infrastructure is defined in AWS CDK (TypeScript) and deployed per-agent as independent stacks. CDK manages Cognito, IAM, Lambda, SSM, and CloudWatch resources. AgentCore-specific resources (Gateway, Runtime) are deployed separately via CLI or API.

## Project Structure

```
infra-cdk/
├── bin/netaiops-infra.ts     # CDK app entry point
├── lib/
│   ├── config.ts             # Centralized configuration
│   ├── constructs/           # Reusable CDK constructs
│   │   ├── CognitoAuth.ts
│   │   ├── DockerLambda.ts
│   │   ├── McpGateway.ts
│   │   └── CrossRegionAlarm.ts
│   └── stacks/
│       ├── k8s-agent/
│       ├── incident-agent/
│       ├── istio-agent/
│       └── network-agent/
├── agent-src/                # Symlinks to agents/
├── lambda-src/               # Symlinks to agent Lambda sources
└── package.json
```

## Stack Composition

Each agent has multiple nested stacks:

```
AgentStack (parent)
├── CognitoStack
│   ├── Agent Pool (JWT authorizer)
│   ├── Runtime Pool (M2M credentials)
│   ├── Resource Servers + Scopes
│   ├── Machine Client (client credentials)
│   └── IAM Roles (execution, gateway)
├── LambdaStack (if agent has Lambda tools)
│   └── Docker Lambda functions (ECR-based)
├── GatewayStack
│   ├── MCP Gateway definition
│   ├── Lambda targets (with tool schemas)
│   └── mcpServer targets (MCP Server runtimes)
├── RuntimeStack
│   └── SSM parameters (ARN, credentials)
└── MonitoringStack (optional)
    └── CloudWatch cross-region alarms
```

## Configuration (`config.ts`)

All agent-specific configuration is centralized:

```typescript
export const CONFIG = {
  account: '175678592674',
  primaryRegion: 'us-east-1',

  k8sAgent: {
    ssmPrefix: '/a2a/app/k8s/agentcore',
    agentPool: { name, domainPrefix, ... },
    runtimePool: { ... },
    gateway: { name, ... },
    runtime: { name, memoryStrategy },
  },

  // Tool schemas for Lambda targets
  toolSchemas: {
    datadog: [...],
    opensearch: [...],
    containerInsight: [...],
    dns: [...],
    networkMetrics: [...],
  },
}
```

### Tool Schema Convention

All Lambda-targeted tool schemas include a `_tool` required parameter for routing:

```typescript
{
  name: 'dns-resolve',
  inputSchema: {
    properties: {
      _tool: { type: 'string', description: 'Must be "dns-resolve"' },
      hostname: { type: 'string' },
    },
    required: ['_tool', 'hostname'],
  },
}
```

**Important**: `enum` fields are not supported in tool schemas (API validation error). Use `description` to list allowed values instead.

## CDK Constructs

### CognitoAuth

Creates dual Cognito User Pools with resource servers, machine clients, and IAM roles.

### DockerLambda

Deploys Lambda functions from Docker images (ECR). Handles cross-account ECR access and execution role configuration.

### McpGateway

Configures MCP Gateway with Cognito authorizer and both Lambda and mcpServer target types.

### CrossRegionAlarm

Creates CloudWatch alarms in a different region than the stack (used for EKS cluster monitoring in ap-northeast-2).

## Build & Deploy

```bash
cd infra-cdk

# Type check
npx tsc --noEmit

# Deploy all stacks
npx cdk deploy --all --profile netaiops-deploy

# Deploy specific stack
npx cdk deploy IncidentAgentStack --profile netaiops-deploy
```
