# AgentCore Memory

## Overview

AgentCore Memory allows agents to remember conversation context across sessions. Events (conversations) are stored and transformed into semantically searchable memory records through LLM-based extraction.

**When extraction happens**: After an event is saved via `create_event()` or `save_conversation()`, AgentCore **asynchronously** invokes the configured memory strategy to extract facts from the raw conversation. This extraction runs in the background using the `memoryExecutionRole` to call a Bedrock model. It is not instant — there is a delay (typically seconds) between saving an event and the resulting memory record becoming available for retrieval via `retrieve_memories()`.

## Architecture

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

## Current Configuration

> **Note:** The values below are from the reference implementation. Replace with your own resource identifiers.

| Agent | Memory ID | Strategy | Namespace |
|-------|-----------|----------|-----------|
| Network | `network_diagnostics_agent_runtime_mem-OSaOFx43jt` | Semantic (`network_context`) | `network/{actorId}` |
| K8s | `a2a_k8s_agent_runtime_mem-rqrPIRCKTr` | Semantic (`k8s_context`) | `k8s/{actorId}` |
| Istio | `istio_mesh_agent_runtime_mem-453pzwCpN7` | Semantic (`istio_context`) | `istio/{actorId}` |
| Incident | `incident_agent_memory-CThNONA84a` | Semantic (`incident_context`) | `incident/{actorId}/context` |
| Incident (Cached) | *(shares Incident memory)* | | |

Common execution role: `arn:aws:iam::<ACCOUNT_ID>:role/NetAIOps-MemoryExecutionRole`

## Three Requirements for Working Memory

### 1. SSM Parameter (`memory_id`)

Agent code reads `memory_id` from SSM at runtime. The YAML file's `memory_id` is for reference only.

```bash
# Check
aws ssm get-parameter --name "/app/<agent>/agentcore/memory_id" \
  --profile <AWS_PROFILE> --region us-east-1

# Register (if missing)
aws ssm put-parameter --name "/app/<agent>/agentcore/memory_id" \
  --value "<memory-id>" --type String \
  --profile <AWS_PROFILE> --region us-east-1
```

SSM parameter paths:

| Agent | SSM Key |
|-------|---------|
| Network | `/app/network/agentcore/memory_id` |
| K8s | `/a2a/app/k8s/agentcore/memory_id` |
| Istio | `/app/istio/agentcore/memory_id` |
| Incident | `/app/incident/agentcore/memory_id` |

### 2. Memory Strategy (Semantic)

Strategy for extracting events into memory records. Without it, events are stored but retrieval won't work.

```bash
# Check current strategy
aws bedrock-agentcore-control get-memory \
  --memory-id "<memory-id>" \
  --profile <AWS_PROFILE> --region us-east-1 \
  --query 'memory.strategies'

# Add strategy (when strategies is empty)
aws bedrock-agentcore-control update-memory \
  --memory-id "<memory-id>" \
  --memory-strategies file:///tmp/strategy.json \
  --profile <AWS_PROFILE> --region us-east-1
```

`/tmp/strategy.json` example:
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

**Constraints:**
- Only 1 strategy per type (cannot have 2 semantic strategies)
- Only 1 namespace per strategy
- Namespace pattern supports: `{actorId}`, `{sessionId}`, `{memoryStrategyId}`

### 3. Memory Execution Role

Semantic extraction (event → record) requires LLM invocation, so an IAM role with Bedrock model invocation permissions is needed.

```bash
# Check current setting
aws bedrock-agentcore-control get-memory \
  --memory-id "<memory-id>" \
  --query 'memory.memoryExecutionRoleArn'

# Attach role
aws bedrock-agentcore-control update-memory \
  --memory-id "<memory-id>" \
  --memory-execution-role-arn "arn:aws:iam::<ACCOUNT_ID>:role/NetAIOps-MemoryExecutionRole"
```

Role requirements:
- Trust policy: `bedrock-agentcore.amazonaws.com` can assume
- Permissions: `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`

## Memory Strategy Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Semantic** | Extract key facts via LLM into vector-searchable records | Past diagnostic context, incident history |
| **Summary** | Compress conversations into summaries | Long conversation history compression |
| **UserPreference** | Extract user preferences (language, response style) | "Answer in Korean", "Be concise" |
| **Episodic** | Store conversation episodes as units | Full conversation flow replay |
| **Custom** | Custom extraction logic (prompt override) | Specialized extraction needs |

All agents currently use **Semantic** strategy only.

## Per-Agent MemoryHookProvider Implementation

Two distinct patterns are used:

### Pattern A: Network / K8s / Istio

These agents use `MemoryHookProvider` with dynamic namespace discovery and optional seed data.

**Hook events:**
- `MessageAddedEvent` → Retrieve relevant memories and prepend to user query
- `AfterInvocationEvent` → Save the conversation turn

```python
class MemoryHookProvider:
    def __init__(self, memory_id, client):
        self.namespaces = get_namespaces(client, memory_id)
        # → {"SEMANTIC": "network/{actorId}"}

    def retrieve_memories(self, event: MessageAddedEvent):
        # Iterate all namespace types, retrieve top-3 per namespace
        for context_type, namespace_template in self.namespaces.items():
            namespace = namespace_template.replace("{actorId}", actor_id)
            memories = self.client.retrieve_memories(
                memory_id=..., namespace=namespace, query=user_query, top_k=3)
        # Prepend context to user query
        event.messages[-1]["content"] = f"Application Context:\n{context}\n\n{original_query}"

    def save_memories(self, event: AfterInvocationEvent):
        # Save user query + assistant response as an event
        self.client.create_event(
            memory_id=..., actor_id=..., session_id=...,
            messages=[(user_query, "USER"), (agent_response, "ASSISTANT")])
```

**Seed memory**: On first run, these agents pre-populate memory with infrastructure context (e.g., EKS cluster info, network topology) using `create_event()`. This ensures the agent has baseline knowledge even before user conversations.

### Pattern B: Incident Agent

The Incident Agent uses a `MemoryHook` class with STM (Short-Term Memory) injection and hardcoded dual namespaces.

**Why a different pattern?** The Incident Agent needs conversation continuity within a session (not just cross-session recall), so it injects the last 5 turns as Short-Term Memory at initialization. The other agents only need cross-session semantic search. Additionally, the Incident Agent uses two separate namespaces (`context` and `history`) to separate diagnostic context from conversation history, while the other agents use a single dynamically discovered namespace.

**Hook events:**
- `AgentInitializedEvent` → Load last 5 conversation turns (STM)
- `MessageAddedEvent` → Retrieve semantic memories from 2 namespaces + save conversation

```python
class MemoryHook:
    def on_agent_initialized(self, event):
        # Short-Term Memory: inject last 5 turns into agent context
        recent_turns = self.memory_client.get_last_k_turns(
            memory_id=..., actor_id=..., session_id=..., k=5)

    def on_message_added(self, event):
        # Retrieve from 2 hardcoded namespaces
        self.client.retrieve_memories(namespace=f"incident/{actor_id}/context", ...)
        self.client.retrieve_memories(namespace=f"incident/{actor_id}/history", ...)
        # Save conversation per message
        self.memory_client.save_conversation(
            memory_id=..., actor_id=..., session_id=...,
            messages=[(text, role)])
```

### Pattern Comparison

| Feature | Network / K8s / Istio | Incident |
|---------|----------------------|----------|
| Namespace discovery | Dynamic (from strategy API) | Hardcoded (2 namespaces) |
| STM (recent turns) | Not used | Last 5 turns injected at init |
| Seed memory | Yes (infrastructure context) | No |
| Storage method | `create_event()` (batch) | `save_conversation()` (per message) |
| Retrieval hook | `MessageAddedEvent` | `MessageAddedEvent` |
| Save hook | `AfterInvocationEvent` | `MessageAddedEvent` |

### Choosing a Memory Pattern for Your Agent

| Requirement | Recommended Pattern | Rationale |
|-------------|-------------------|-----------|
| Cross-session context recall only | **Pattern A** (Dynamic namespace) | Simpler setup, automatic namespace discovery |
| In-session conversation continuity | **Pattern B** (STM injection) | `get_last_k_turns()` provides immediate context without waiting for async extraction |
| Multiple context types (e.g., diagnostics + history) | **Pattern B** (Dual namespace) | Separate namespaces enable targeted retrieval |
| Pre-populated domain knowledge | **Pattern A** (Seed memory) | `create_event()` at init populates baseline context |
| Minimal implementation effort | **Pattern A** | Single class, fewer hook events to implement |

**Key consideration**: Semantic memory extraction is asynchronous. If your agent needs context from the *current* session (not just previous sessions), you must implement STM (Pattern B) — semantic retrieval alone will miss recently saved events that haven't been extracted yet.

## Adding Memory to a New Agent

1. Create memory in AgentCore
   ```bash
   aws bedrock-agentcore-control create-memory \
     --name "<agent>_memory" \
     --event-expiry-duration 30 \
     --memory-execution-role-arn "arn:aws:iam::<ACCOUNT_ID>:role/NetAIOps-MemoryExecutionRole" \
     --memory-strategies '[{"semanticMemoryStrategy":{"name":"<agent>_context","description":"...","namespaces":["<prefix>/{actorId}"]}}]'
   ```

2. Register memory_id in SSM
   ```bash
   aws ssm put-parameter --name "/app/<agent>/agentcore/memory_id" \
     --value "<memory-id>" --type String
   ```

3. Add MemoryHookProvider to agent code (follow existing patterns)

4. Verify SSM permissions on runtime execution role
   ```bash
   aws iam get-role-policy --role-name <runtime-role> --policy-name SSMGetParameterAccess
   ```

5. Restart runtime (`update-agent-runtime`)

## Troubleshooting

### Memory Not Working Checklist

1. **SSM parameter exists?**
   ```bash
   aws ssm get-parameter --name "/app/<agent>/agentcore/memory_id"
   ```

2. **Strategies exist?** (empty = no retrieval)
   ```bash
   aws bedrock-agentcore-control get-memory --memory-id "<id>" --query 'memory.strategies'
   ```

3. **Execution role set?** (missing = no extraction)
   ```bash
   aws bedrock-agentcore-control get-memory --memory-id "<id>" --query 'memory.memoryExecutionRoleArn'
   ```

4. **Events saved?**
   ```bash
   aws bedrock-agentcore list-events --memory-id "<id>" --actor-id "DEFAULT" --session-id "<session-id>"
   ```

5. **Records extracted?** (events exist but no records = extraction issue)
   ```bash
   aws bedrock-agentcore list-memory-records --memory-id "<id>" --namespace "<namespace>"
   ```

6. **Restart runtime** (after SSM/strategy changes, cached agent needs reinitialization)

### Agent Context Caching Note

Agent code caches the agent instance as a **class variable** (e.g., `NetworkContext._agent`). Once initialized, the same instance is reused until runtime restart. After changing SSM parameters or memory strategy, **you must restart the runtime** for changes to take effect.
