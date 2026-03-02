# AgentCore Memory

## Overview

AgentCore Memory allows agents to remember conversation context across sessions. Events (conversations) are stored and transformed into semantically searchable memory records through LLM-based extraction.

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

| Agent | Memory ID | Strategy | Namespace |
|-------|-----------|----------|-----------|
| Network | `network_diagnostics_agent_runtime_mem-OSaOFx43jt` | Semantic (`network_context`) | `network/{actorId}` |
| K8s | `a2a_k8s_agent_runtime_mem-rqrPIRCKTr` | Semantic (`k8s_context`) | `k8s/{actorId}` |
| Istio | `istio_mesh_agent_runtime_mem-453pzwCpN7` | Semantic (`istio_context`) | `istio/{actorId}` |
| Incident | `incident_agent_memory-CThNONA84a` | Semantic (`incident_context`) | `incident/{actorId}/context` |
| Incident (Cached) | *(shares Incident memory)* | | |

Common execution role: `arn:aws:iam::175678592674:role/NetAIOps-MemoryExecutionRole`

## Three Requirements for Working Memory

### 1. SSM Parameter (`memory_id`)

Agent code reads `memory_id` from SSM at runtime. The YAML file's `memory_id` is for reference only.

```bash
# Check
aws ssm get-parameter --name "/app/<agent>/agentcore/memory_id" \
  --profile netaiops-deploy --region us-east-1

# Register (if missing)
aws ssm put-parameter --name "/app/<agent>/agentcore/memory_id" \
  --value "<memory-id>" --type String \
  --profile netaiops-deploy --region us-east-1
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
  --profile netaiops-deploy --region us-east-1 \
  --query 'memory.strategies'

# Add strategy (when strategies is empty)
aws bedrock-agentcore-control update-memory \
  --memory-id "<memory-id>" \
  --memory-strategies file:///tmp/strategy.json \
  --profile netaiops-deploy --region us-east-1
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
  --memory-execution-role-arn "arn:aws:iam::175678592674:role/NetAIOps-MemoryExecutionRole"
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

### Network / K8s / Istio (Same Pattern)

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

### Incident (Different Pattern)

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

## Adding Memory to a New Agent

1. Create memory in AgentCore
   ```bash
   aws bedrock-agentcore-control create-memory \
     --name "<agent>_memory" \
     --event-expiry-duration 30 \
     --memory-execution-role-arn "arn:aws:iam::175678592674:role/NetAIOps-MemoryExecutionRole" \
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
