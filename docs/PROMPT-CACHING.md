# Prompt Caching 가이드

## 개요

Bedrock Converse API의 Prompt Caching을 활용하면 반복되는 프롬프트 prefix를 캐싱하여 **비용 절감**과 **응답 지연 감소** 효과를 얻을 수 있습니다. 본 프로젝트에서는 Strands SDK의 `BedrockModel`이 제공하는 2가지 캐싱 옵션을 사용합니다.

## 캐싱 메커니즘

### 1. `cache_config` — 메시지(대화 히스토리) 캐싱

```python
from strands.models.model import CacheConfig

BedrockModel(
    cache_config=CacheConfig(strategy="auto"),
)
```

**작동 방식:**
- SDK가 매 요청마다 마지막 assistant 메시지 끝에 `{"cachePoint": {"type": "default"}}` 블록을 자동 삽입
- Bedrock은 해당 cachePoint까지의 내용을 캐싱 → 다음 턴에서 재사용
- 기존 cachePoint는 자동 제거 후 새 위치에 재삽입

**효과:**
- 멀티턴 대화에서 이전 턴 재처리 비용 절감
- 대화가 길어질수록 효과 증가

**지원 모델:** Claude/Anthropic 모델만 (`model_id`에 `claude` 또는 `anthropic` 포함 시)

**strategy 옵션:**
- `"auto"` — 유일한 옵션 (향후 확장 가능하도록 설계됨)

---

### 2. `cache_tools` — 도구 정의 캐싱

```python
BedrockModel(
    cache_tools="default",
)
```

**작동 방식:**
- `toolConfig`의 도구 스키마 목록 뒤에 `{"cachePoint": {"type": "default"}}` 블록 추가
- 도구 정의(이름, 설명, 파라미터 스키마)가 매 요청마다 재처리되지 않도록 캐싱

**효과:**
- 도구가 많은 에이전트일수록 효과 큼

| Agent | 도구 수 | 예상 효과 |
|-------|--------|----------|
| K8s Agent | ~16개 (EKS MCP Server) | 중간 |
| Incident Agent | ~18개 (6 Lambda 그룹) | 높음 |
| Istio Agent | ~15개 (EKS MCP + Prometheus) | 높음 |

---

### ~~`performanceConfig`~~ — 사용하지 않음

> **주의**: `performanceConfig`는 프롬프트 캐싱이 아닌 **레이턴시 최적화** 옵션이며, 프롬프트 캐싱과는 완전히 별개의 기능입니다.
>
> - `performanceConfig`의 유효한 필드는 `latency`뿐이며, `promptCache`는 존재하지 않는 필드
> - Claude Opus 모델은 `performanceConfig` 자체를 미지원
> - 프롬프트 캐싱은 `cache_config` + `cache_tools`만으로 동작

---

## 2가지 메커니즘 비교

| | `cache_config` | `cache_tools` |
|---|---|---|
| **캐싱 대상** | 시스템 프롬프트 + 대화 히스토리 | 도구 정의 JSON |
| **작동 레벨** | SDK (메시지 cachePoint 삽입) | SDK (toolConfig cachePoint 삽입) |
| **지원 모델** | Claude/Anthropic만 | Claude/Anthropic만 |
| **효과 증가 조건** | 대화가 길어질수록 | 도구가 많을수록 |
| **독립성** | 다른 옵션과 독립 | 다른 옵션과 독립 |

---

## 적용 방법

### Before (캐싱 미적용)

```python
self.model = BedrockModel(
    model_id=self.model_id,
)
```

### After (캐싱 적용)

```python
from strands.models.model import CacheConfig

self.model = BedrockModel(
    model_id=self.model_id,
    cache_config=CacheConfig(strategy="auto"),
    cache_tools="default",
)
```

### 현재 적용 상태

| Agent | 파일 | 캐싱 적용 |
|-------|------|----------|
| Incident Agent (Cached) | `agents/incident-agent/agent-cached/agent_config/agent.py` | **적용** (`ENABLE_PROMPT_CACHE=true` 시) |
| Incident Agent | `agents/incident-agent/agent/agent_config/agent.py` | 미적용 (비교 대조군) |
| K8s Agent | `agents/k8s-agent/agent/agent_config/agent.py` | 미적용 |
| Istio Agent | `agents/istio-agent/agent/agent_config/agent.py` | 미적용 |

---

## 캐싱 요구 조건

- **최소 토큰**: Bedrock prompt caching은 일정 토큰 수 이상일 때만 작동 (Claude 모델 기준 약 1,024~2,048 토큰)
- **모델 지원**: `us.anthropic.claude-*` 또는 `global.anthropic.claude-*` 계열
- **리전**: Prompt caching을 지원하는 Bedrock 리전 (us-east-1, us-west-2, ap-northeast-1 등)

---

## 비용 영향

| 항목 | 캐싱 미적용 | 캐싱 적용 |
|------|-----------|----------|
| 시스템 프롬프트 | 매 요청마다 전체 처리 | 첫 요청만 처리, 이후 캐시 히트 |
| 도구 정의 | 매 요청마다 전체 처리 | 첫 요청만 처리, 이후 캐시 히트 |
| 대화 히스토리 | 매 턴마다 전체 재처리 | 이전 턴까지 캐시, 새 턴만 처리 |
| **캐시 히트 비용** | N/A | 일반 입력 토큰의 **10%** |
| **캐시 쓰기 비용** | N/A | 일반 입력 토큰의 **25% 추가** |

> 첫 요청은 캐시 쓰기 비용이 추가되지만, 이후 요청에서 90% 할인된 비용으로 처리됩니다.
> 멀티턴 대화에서 평균적으로 **50~70% 입력 비용 절감**이 기대됩니다.

---

## 환경변수로 제어

Incident Agent (Cached)는 환경변수로 캐싱을 on/off 합니다:

```python
import os
from strands.models.model import CacheConfig

cache_enabled = os.environ.get("ENABLE_PROMPT_CACHE", "false").lower() == "true"

cache_kwargs = (
    {
        "cache_config": CacheConfig(strategy="auto"),
        "cache_tools": "default",
    }
    if cache_enabled
    else {}
)

self.model = BedrockModel(model_id=self.model_id, **cache_kwargs)
```

Dockerfile에서:
```dockerfile
ENV ENABLE_PROMPT_CACHE=true
```

> 기본값은 `"false"` (캐싱 비활성). Cached Agent의 Dockerfile에서만 `true`로 설정합니다.

---

## 메트릭 UI

Web UI에서 각 assistant 메시지 하단에 응답 시간과 토큰 사용량이 표시됩니다.

### 표시 항목

| 항목 | 설명 | 출처 |
|------|------|------|
| TTFB | 첫 번째 청크까지의 시간 (Time To First Byte) | 서버 측 측정, fallback으로 클라이언트 측 |
| Total | 전체 응답 완료 시간 | 서버 측 측정, fallback으로 클라이언트 측 |
| In | 캐시 없이 새로 처리한 입력 토큰 수 | Bedrock `inputTokens` |
| Out | 출력 토큰 수 | Bedrock `outputTokens` |
| Cache read | 캐시에서 읽은 입력 토큰 수 (비용 90% 절감) | Bedrock `cacheReadInputTokens` |
| Cache write | 캐시에 쓴 입력 토큰 수 (비용 25% 추가) | Bedrock `cacheWriteInputTokens` |

### 표시 예시

캐싱 미적용 에이전트:
```
TTFB 2.4s · Total 69.8s · In 102,468 · Out 7,010 tokens
```

캐싱 적용 에이전트:
```
TTFB 2.8s · Total 103.7s · In 33,174 · Out 9,607 · Cache read 142,221 · Cache write 37,224 tokens
```

### 토큰 필드 해석

| 필드 | 의미 | 캐싱 미적용 시 | 캐싱 적용 시 |
|------|------|--------------|-------------|
| In | 새로 처리한 입력 | 전체 입력 = In | 캐시 안 된 부분만 |
| Cache read | 캐시에서 읽음 | 표시 안 됨 | 캐시 히트된 부분 |
| Cache write | 캐시에 새로 씀 | 표시 안 됨 | 새 캐시 엔트리 |

> **캐싱 효과 확인**: 캐싱 미적용의 `In` ≈ 캐싱 적용의 `In + Cache read + Cache write`
>
> 멀티턴에서 `In`이 턴마다 감소하면 캐시 히트율이 높아지고 있는 것입니다.

### 데이터 흐름

```
BedrockModel (Bedrock API) → AgentResult.metrics.accumulated_usage
    → agent.py: __METRICS_JSON__ 마커로 스트림에 전송
    → backend main.py: 마커 감지 → metrics SSE 이벤트에 병합
    → frontend api.ts: metrics 이벤트 파싱 → onDone(metrics)
    → ChatPage.tsx: MessageMetricsFooter 렌더링
```

---

## A/B 테스트 가이드

Incident Agent(캐싱 미적용)와 Incident Agent Cached(캐싱 적용) 간 성능 차이를 정량적으로 비교하는 방법입니다.

### 사전 준비

1. Web UI에서 모델을 동일하게 설정 (예: Claude Sonnet 4.5)
2. 양쪽 에이전트에서 "+ New Chat"으로 새 세션 시작
3. 동일한 질문을 양쪽에 순서대로 전송

### 시나리오 A: 에러율 증가 심층 분석

| 순서 | 질문 |
|------|------|
| 1 | web-api 서비스에서 ERROR 로그(ECONNREFUSED)가 급증하고 있습니다. 클러스터 상태와 로그를 분석해주세요. |
| 2 | 에러를 발생시키는 파드를 특정하고, 해당 파드의 CPU/메모리 사용량을 확인해주세요. |
| 3 | 에러 발생 전후 30분간의 로그 패턴 변화를 비교해주세요. |
| 4 | 지금까지의 분석 결과를 바탕으로 근본 원인과 대응 방안을 요약해주세요. |

### 시나리오 B: CPU 급증 + 연쇄 영향

| 순서 | 질문 |
|------|------|
| 1 | EKS 클러스터에서 CPU 사용률이 급증했습니다. 노드별, 파드별 CPU 사용 현황을 분석해주세요. |
| 2 | CPU를 가장 많이 소비하는 상위 3개 파드의 상세 메트릭과 로그를 확인해주세요. |
| 3 | CPU 급증이 다른 서비스의 응답 지연이나 에러에 영향을 미치고 있는지 확인해주세요. |
| 4 | 이 인시던트에 대한 GitHub Issue를 생성하고, 분석 결과를 코멘트로 추가해주세요. |

### 시나리오 C: 파드 재시작 반복 진단

| 순서 | 질문 |
|------|------|
| 1 | EKS 클러스터에서 파드가 반복적으로 재시작(CrashLoopBackOff)되고 있습니다. 전체 파드 상태를 확인해주세요. |
| 2 | CrashLoopBackOff 상태인 파드의 로그에서 에러 패턴을 분석해주세요. |
| 3 | 해당 파드가 다른 서비스에 미치는 영향을 확인해주세요. 의존성 관계와 에러 전파 여부를 분석해주세요. |
| 4 | 근본 원인 추정 결과와 재발 방지 대책을 정리해주세요. |

### 기대 결과

| 질문 순서 | 캐싱 미적용 | 캐싱 적용 (기대값) |
|-----------|-----------|-------------------|
| 1번째 | In만 표시 (전체 입력) | Cache write 높음, Cache read 0 (캐시 생성) |
| 2번째 | In 증가 (히스토리 누적) | Cache read 증가, In 감소 (시스템 프롬프트 + 도구 + 1턴 캐시 히트) |
| 3번째 | In 더 증가 | Cache read 더 증가, In 더 감소 (누적 히스토리 캐시 히트) |
| 4번째 | In 최대 | Cache read 최대, In 최소 (대부분의 컨텍스트가 캐시됨) |

### 주의사항

- **에이전트 비결정성**: 같은 질문이라도 매 실행마다 모델이 다른 도구를 선택하거나 다른 횟수로 호출할 수 있음. 공정한 비교를 위해 동일 시나리오를 여러 번(5회 이상) 실행하여 평균 비교 권장
- **캐시 TTL**: Bedrock 프롬프트 캐시의 TTL은 5분. 질문 사이 간격이 5분을 초과하면 캐시가 만료됨
- **TTFB vs Total**: TTFB에는 에이전트 내부의 도구 실행 시간(Lambda 호출)이 포함되어, 순수 모델 레이턴시 개선보다 차이가 작을 수 있음
- **토큰 수 비교**: 캐싱 미적용의 `In` ≈ 캐싱 적용의 `In + Cache read + Cache write`이면 정상
- **첫 요청**: 캐시 생성(write) 비용이 추가되므로 캐싱 적용 에이전트가 오히려 약간 느릴 수 있음
