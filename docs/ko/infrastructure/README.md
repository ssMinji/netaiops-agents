# CDK 인프라

## 개요

인프라는 AWS CDK(TypeScript)로 정의되며 에이전트별로 독립적인 스택으로 배포됩니다. CDK는 Cognito, IAM, Lambda, SSM, CloudWatch 리소스를 관리합니다. AgentCore 전용 리소스(Gateway, Runtime)는 CLI 또는 API를 통해 별도로 배포됩니다.

## 프로젝트 구조

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

## 스택 구성

각 에이전트는 여러 중첩 스택을 가집니다.

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

## 구성 (`config.ts`)

모든 에이전트별 구성이 중앙 집중화되어 있습니다.

```typescript
export const CONFIG = {
  account: '<ACCOUNT_ID>',
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

### 도구 스키마 규칙

모든 Lambda 대상 도구 스키마는 라우팅을 위한 `_tool` 필수 파라미터를 포함합니다.

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

**중요**: `enum` 필드는 도구 스키마에서 지원되지 않습니다(API 유효성 검사 오류). 대신 `description`을 사용하여 허용 값을 나열하세요.

## CDK Construct

### CognitoAuth

리소스 서버, machine client, IAM 역할과 함께 이중 Cognito User Pool을 생성합니다.

### DockerLambda

Docker 이미지(ECR)에서 Lambda 함수를 배포합니다. 교차 계정 ECR 액세스 및 실행 역할 구성을 처리합니다.

### McpGateway

Cognito authorizer와 Lambda 및 mcpServer 타겟 유형을 모두 사용하여 MCP Gateway를 구성합니다.

### CrossRegionAlarm

스택과 다른 리전에 CloudWatch 알람을 생성합니다(ap-northeast-2의 EKS 클러스터 모니터링에 사용).

## 빌드 및 배포

CDK 빌드 명령어, `deploy.sh` 배포 단계, 배포 후 체크리스트에 대한 자세한 내용은 [빌드 및 배포 가이드](build-deploy.md)를 참조하세요.
