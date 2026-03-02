# 에이전트 개요

NetAIOps는 각각 특정 인프라 도메인을 위해 설계된 4개의 전문 AI 에이전트를 포함합니다. 모든 에이전트는 Strands SDK로 구축되어 AWS Bedrock AgentCore에 ARM64 컨테이너로 배포됩니다.

## 에이전트 비교

| 에이전트 | 도메인 | MCP 도구 | 시나리오 |
|-------|--------|-----------|-----------|
| [Incident](incident.md) | 인시던트 조사 | Datadog, OpenSearch, Container Insights, Chaos, GitHub | 4 |
| [K8s](k8s.md) | Kubernetes/EKS | EKS MCP Server | 4 |
| [Istio](istio.md) | 서비스 메시 | EKS MCP, Prometheus, Fault Injection | 5 |
| [Network](network.md) | AWS 네트워킹 | Network MCP Server, DNS, CloudWatch | 4 |

## 공통 아키텍처

모든 에이전트는 동일한 구조 패턴을 따릅니다.

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

## 에이전트 라이프사이클

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

## 도구 접근 패턴

에이전트는 MCP Gateway를 통해 도구에 접근하며, Gateway는 Lambda 함수 또는 MCP Server 런타임으로 라우팅합니다.

```
Agent → MCP Gateway → Lambda Target (tool schema → invoke Lambda)
                    → mcpServer Target (proxy to MCP Server runtime)
```

**Lambda Target 라우팅**: MCP Gateway는 Lambda에 도구 인자만 전달하고 도구 이름은 전달하지 않으므로, 모든 도구 스키마에 `_tool` 필수 파라미터가 포함됩니다. Lambda 핸들러는 이를 사용하여 올바른 도구 구현으로 디스패치합니다.

## 지원 모델

모든 에이전트는 대화별로 선택 가능한 여러 AI 모델을 지원합니다.

| 모델 | ID |
|-------|----|
| Claude Opus 4.6 | `global.anthropic.claude-opus-4-6-v1` |
| Claude Sonnet 4.6 | `global.anthropic.claude-sonnet-4-6` |
| Claude Haiku 4.5 | `global.anthropic.claude-haiku-4-5-v1` |
| Qwen 3 32B | `qwen.qwen3-32b-v1:0` |
| Amazon Nova Pro | `us.amazon.nova-pro-v1:0` |
