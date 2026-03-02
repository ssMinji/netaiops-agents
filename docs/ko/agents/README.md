# 에이전트 개요

NetAIOps는 각각 특정 인프라 도메인을 위해 설계된 4개의 전문 AI 에이전트를 포함합니다. 모든 에이전트는 Strands SDK로 구축되어 AWS Bedrock AgentCore에 ARM64 컨테이너로 배포됩니다.

## 에이전트 비교

| 에이전트 | 도메인 | MCP 도구 | 시나리오 |
|-------|--------|-----------|-----------|
| [Network](network.md) | AWS 네트워킹 | Network MCP Server, DNS, CloudWatch | 4 |
| [Incident](incident.md) | 인시던트 조사 | Datadog, OpenSearch, Container Insights, Chaos, GitHub | 4 |
| [K8s](k8s.md) | Kubernetes/EKS | EKS MCP Server | 4 |
| [Istio](istio.md) | 서비스 메시 | EKS MCP, Prometheus, Fault Injection | 5 |

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

## 도구 통합 패턴

### MCP Server vs Lambda 타겟

에이전트의 도구 아키텍처를 설계할 때 두 가지 타겟 유형 중 선택합니다:

| 기준 | MCP Server 타겟 | Lambda 타겟 |
|----------|-------------------|---------------|
| **적합한 경우** | 많은 작업을 가진 풍부하고 상태를 유지하는 도구 서버 | 개별 도구 또는 소규모 도구 그룹 |
| **인증 모델** | OAuth2 (Runtime Pool + credential provider 필요) | IAM Role (더 간단, 추가 Cognito 풀 불필요) |
| **상태** | 영속적 프로세스, 연결 유지 가능 | 무상태, cold start 가능 |
| **스케일링** | AgentCore가 런타임 스케일링 관리 | AWS Lambda 자동 스케일링 |
| **기존 생태계** | AWS Labs MCP Server (EKS, Network 등) | 모든 Lambda 함수 |
| **도구 수** | 무제한 (서버가 모든 도구 노출) | Gateway 타겟별 스키마 정의 |
| **배포** | `agentcore deploy` (CodeBuild + 컨테이너) | CDK/CloudFormation (Docker 이미지) |

**이 프로젝트의 선택**:
- **K8s Agent**: MCP Server만 — 수십 개의 K8s 작업을 갖춘 `awslabs/eks-mcp-server` 전체 활용
- **Incident Agent**: Lambda만 — 관련 도구를 묶은 6개의 집중된 Lambda 함수
- **Network/Istio Agent**: 하이브리드 — 핵심 기능은 MCP Server + 커스텀 도구는 Lambda

### Lambda 도구 라우팅 (`_tool` 패턴)

MCP Gateway는 Lambda 타겟에 `arguments` 객체만 전달하며, 도구 이름은 포함하지 않습니다. 단일 Lambda에 여러 도구를 번들링할 때 라우팅 메커니즘이 필요합니다:

```python
# Lambda handler
def handler(event, context):
    tool_name = event.get("_tool")  # 모델이 arguments에 포함
    if tool_name == "dns-resolve":
        return resolve_dns(event)
    elif tool_name == "dns-check-health":
        return check_health(event)
```

```json
// 도구 스키마 — _tool을 필수 파라미터로 포함
{
  "name": "dns-resolve",
  "inputSchema": {
    "properties": {
      "_tool": { "type": "string", "description": "Must be \"dns-resolve\"" },
      "hostname": { "type": "string" }
    },
    "required": ["_tool", "hostname"]
  }
}
```

**중요**: Gateway 도구 스키마에서 `enum` 필드는 지원되지 않습니다(API 유효성 검사 오류). 대신 `description`으로 허용 값을 문서화하세요.
