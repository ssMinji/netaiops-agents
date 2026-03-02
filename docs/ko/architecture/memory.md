# AgentCore 메모리

## 개요

AgentCore 메모리는 에이전트가 세션 간 대화 컨텍스트를 기억할 수 있게 합니다. 이벤트(대화)가 저장되고 LLM 기반 추출을 통해 의미적으로 검색 가능한 메모리 레코드로 변환됩니다.

## 아키텍처

```
User conversation
    │
    ▼
┌─────────────────────┐
│  save_conversation() │  ← Save conversation as events
│  / create_event()    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Events (raw conv.)  │  ← STM: query via get_last_k_turns()
└─────────┬───────────┘
          │  LLM-based auto extraction (memoryExecutionRole required)
          ▼
┌─────────────────────┐
│  Memory Records      │  ← Semantic: vector search via retrieve_memories()
│  (extracted facts)   │
└─────────────────────┘
```

## 현재 구성

| 에이전트 | Memory ID | 전략 | 네임스페이스 |
|-------|-----------|----------|-----------|
| Network | `network_diagnostics_agent_runtime_mem-OSaOFx43jt` | Semantic (`network_context`) | `network/{actorId}` |
| K8s | `a2a_k8s_agent_runtime_mem-rqrPIRCKTr` | Semantic (`k8s_context`) | `k8s/{actorId}` |
| Istio | `istio_mesh_agent_runtime_mem-453pzwCpN7` | Semantic (`istio_context`) | `istio/{actorId}` |
| Incident | `incident_agent_memory-CThNONA84a` | Semantic (`incident_context`) | `incident/{actorId}/context` |
| Incident (Cached) | *(Incident 메모리 공유)* | | |

공통 실행 역할: `arn:aws:iam::175678592674:role/NetAIOps-MemoryExecutionRole`

## 동작하는 메모리를 위한 세 가지 요구사항

### 1. SSM 파라미터 (`memory_id`)

에이전트 코드는 런타임에 SSM에서 `memory_id`를 읽습니다. YAML 파일의 `memory_id`는 참조용일 뿐입니다.

```bash
# 확인
aws ssm get-parameter --name "/app/<agent>/agentcore/memory_id" \
  --profile netaiops-deploy --region us-east-1

# 등록 (누락된 경우)
aws ssm put-parameter --name "/app/<agent>/agentcore/memory_id" \
  --value "<memory-id>" --type String \
  --profile netaiops-deploy --region us-east-1
```

SSM 파라미터 경로:

| 에이전트 | SSM 키 |
|-------|---------|
| Network | `/app/network/agentcore/memory_id` |
| K8s | `/a2a/app/k8s/agentcore/memory_id` |
| Istio | `/app/istio/agentcore/memory_id` |
| Incident | `/app/incident/agentcore/memory_id` |

### 2. 메모리 전략 (Semantic)

이벤트를 메모리 레코드로 추출하기 위한 전략. 전략이 없으면 이벤트가 저장되지만 검색이 작동하지 않습니다.

```bash
# 현재 전략 확인
aws bedrock-agentcore-control get-memory \
  --memory-id "<memory-id>" \
  --profile netaiops-deploy --region us-east-1 \
  --query 'memory.strategies'

# 전략 추가 (strategies가 비어있을 때)
aws bedrock-agentcore-control update-memory \
  --memory-id "<memory-id>" \
  --memory-strategies file:///tmp/strategy.json \
  --profile netaiops-deploy --region us-east-1
```

`/tmp/strategy.json` 예시:
```json
{
  "addMemoryStrategies": [
    {
      "semanticMemoryStrategy": {
        "name": "agent_context",
        "description": "Conversation context for semantic search",
        "namespaces": ["<prefix>/{actorId}"]
      }
    }
  ]
}
```

**제약사항:**
- 타입당 1개의 전략만 허용(2개의 semantic 전략 불가)
- 전략당 1개의 네임스페이스만 허용
- 네임스페이스 패턴은 `{actorId}`, `{sessionId}`, `{memoryStrategyId}` 지원

### 3. 메모리 실행 역할

Semantic 추출(이벤트 → 레코드)은 LLM 호출이 필요하므로, Bedrock 모델 호출 권한이 있는 IAM 역할이 필요합니다.

```bash
# 현재 설정 확인
aws bedrock-agentcore-control get-memory \
  --memory-id "<memory-id>" \
  --query 'memory.memoryExecutionRoleArn'

# 역할 연결
aws bedrock-agentcore-control update-memory \
  --memory-id "<memory-id>" \
  --memory-execution-role-arn "arn:aws:iam::175678592674:role/NetAIOps-MemoryExecutionRole"
```

역할 요구사항:
- 신뢰 정책: `bedrock-agentcore.amazonaws.com`이 assume 가능
- 권한: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`

## 메모리 전략 유형

| 유형 | 설명 | 사용 사례 |
|------|-------------|----------|
| **Semantic** | LLM을 통해 주요 사실을 벡터 검색 가능한 레코드로 추출 | 과거 진단 컨텍스트, 인시던트 이력 |
| **Summary** | 대화를 요약으로 압축 | 긴 대화 이력 압축 |
| **UserPreference** | 사용자 선호도 추출(언어, 응답 스타일) | "한국어로 답변", "간결하게" |
| **Episodic** | 대화 에피소드를 단위로 저장 | 전체 대화 흐름 재생 |
| **Custom** | 커스텀 추출 로직(프롬프트 오버라이드) | 특수한 추출 요구사항 |

모든 에이전트는 현재 **Semantic** 전략만 사용합니다.

## 에이전트별 MemoryHookProvider 구현

### Network / K8s / Istio (동일 패턴)

```python
# At init: dynamically query namespaces from strategy
self.namespaces = get_namespaces(self.client, self.memory_id)
# → {"SEMANTIC": "network/{actorId}"}

# Retrieval: retrieve_memories() per namespace
for context_type, namespace_template in self.namespaces.items():
    namespace = namespace_template.replace("{actorId}", actor_id)
    memories = self.client.retrieve_memories(
        memory_id=..., namespace=namespace, query=user_query, top_k=3)

# Storage: create_event()
self.client.create_event(
    memory_id=..., actor_id=..., session_id=...,
    messages=[(user_query, "USER"), (agent_response, "ASSISTANT")])
```

### Incident (다른 패턴)

```python
# At init: inject last 5 turns as agent messages (STM)
recent_turns = self.memory_client.get_last_k_turns(
    memory_id=..., actor_id=..., session_id=..., k=5)

# Retrieval: 2 hardcoded namespaces
self.client.retrieve_memories(namespace=f"incident/{actor_id}/context", ...)
self.client.retrieve_memories(namespace=f"incident/{actor_id}/history", ...)

# Storage: save_conversation() (per message)
self.memory_client.save_conversation(
    memory_id=..., actor_id=..., session_id=...,
    messages=[(text, role)])
```

## 새 에이전트에 메모리 추가하기

1. AgentCore에서 메모리 생성
   ```bash
   aws bedrock-agentcore-control create-memory \
     --name "<agent>_memory" \
     --event-expiry-duration 30 \
     --memory-execution-role-arn "arn:aws:iam::175678592674:role/NetAIOps-MemoryExecutionRole" \
     --memory-strategies '[{"semanticMemoryStrategy":{"name":"<agent>_context","description":"...","namespaces":["<prefix>/{actorId}"]}}]'
   ```

2. SSM에 memory_id 등록
   ```bash
   aws ssm put-parameter --name "/app/<agent>/agentcore/memory_id" \
     --value "<memory-id>" --type String
   ```

3. 에이전트 코드에 MemoryHookProvider 추가(기존 패턴 참고)

4. 런타임 실행 역할의 SSM 권한 확인
   ```bash
   aws iam get-role-policy --role-name <runtime-role> --policy-name SSMGetParameterAccess
   ```

5. 런타임 재시작(`update-agent-runtime`)

## 트러블슈팅

### 메모리가 작동하지 않을 때 체크리스트

1. **SSM 파라미터가 존재하는가?**
   ```bash
   aws ssm get-parameter --name "/app/<agent>/agentcore/memory_id"
   ```

2. **전략이 존재하는가?** (비어있음 = 검색 불가)
   ```bash
   aws bedrock-agentcore-control get-memory --memory-id "<id>" --query 'memory.strategies'
   ```

3. **실행 역할이 설정되었는가?** (누락 = 추출 불가)
   ```bash
   aws bedrock-agentcore-control get-memory --memory-id "<id>" --query 'memory.memoryExecutionRoleArn'
   ```

4. **이벤트가 저장되었는가?**
   ```bash
   aws bedrock-agentcore list-events --memory-id "<id>" --actor-id "DEFAULT" --session-id "<session-id>"
   ```

5. **레코드가 추출되었는가?** (이벤트는 있지만 레코드 없음 = 추출 문제)
   ```bash
   aws bedrock-agentcore list-memory-records --memory-id "<id>" --namespace "<namespace>"
   ```

6. **런타임 재시작** (SSM/전략 변경 후, 캐시된 에이전트는 재초기화 필요)

### 에이전트 컨텍스트 캐싱 참고사항

에이전트 코드는 에이전트 인스턴스를 **클래스 변수**로 캐시합니다(예: `NetworkContext._agent`). 초기화된 후에는 런타임 재시작 전까지 동일한 인스턴스가 재사용됩니다. SSM 파라미터나 메모리 전략을 변경한 후에는 **런타임을 재시작해야** 변경 사항이 적용됩니다.
