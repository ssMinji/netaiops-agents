# 인시던트 분석 에이전트

## 목적

다중 소스 메트릭 상관 분석을 통한 자동화된 인시던트 조사. Incident Agent는 Datadog, OpenSearch, Container Insights에서 데이터를 가져와 근본 원인 분석, 시스템 간 이벤트 상관 분석, 실행 가능한 복구 권장 사항을 제공합니다.

## 위치

```
agents/incident-agent/
├── agent/                 # 표준 런타임
└── agent-cached/          # 프롬프트 캐싱 변형 (ENABLE_PROMPT_CACHE=true)
```

## MCP 도구

Incident Agent는 6개의 Lambda 기반 도구 그룹에 접근하는 가장 풍부한 도구셋을 보유하고 있습니다.

### Datadog 도구
- `datadog-query-metrics` - 시계열 메트릭 쿼리
- `datadog-get-events` - 이벤트 검색
- `datadog-get-traces` - APM 추적 분석
- `datadog-get-monitors` - 모니터 상태

### OpenSearch 도구
- `opensearch-search-logs` - 전체 텍스트 로그 검색
- `opensearch-detect-anomalies` - 이상 감지
- `opensearch-error-summary` - 에러 집계

### Container Insights 도구
- `container-insights-pod-metrics` - 파드 수준 CPU/메모리
- `container-insights-node-metrics` - 노드 수준 메트릭
- `container-insights-cluster-overview` - 클러스터 요약

### 카오스 엔지니어링 도구
- `chaos-cpu-stress` - CPU 스트레스 주입
- `chaos-error-inject` - HTTP 에러 주입
- `chaos-latency-inject` - 지연 주입
- `chaos-pod-crash` - 파드 종료

### 기타 도구
- `alarm-trigger` - CloudWatch 알람 통합
- `github-*` - 배포/커밋 상관 분석

## 시나리오

| 시나리오 | 설명 |
|----------|-------------|
| CPU Spike Analysis | Datadog 메트릭과 Container Insights에서 CPU 스파이크 상관 분석 |
| Error Rate Increase | 에러 패턴을 위한 OpenSearch 로그 + Datadog APM 검색 |
| Latency Spike | 추적을 사용한 서비스 간 P99 레이턴시 분석 |
| Pod Restart Loop | Container Insights + 로그로 CrashLoopBackOff 조사 |

## AWS 서비스 권한

| 구성요소 | 필요 AWS 서비스 | 비고 |
|-----------|----------------------|-------|
| **Agent 런타임** | Bedrock, SSM, CloudWatch, Bedrock Memory | Gateway 실행 역할 |
| **Lambda (Datadog)** | Secrets Manager | 외부 자격 증명을 통한 Datadog API 접근 |
| **Lambda (OpenSearch)** | OpenSearch (전체 HTTP) | 로그 검색, 이상 감지 |
| **Lambda (Container Insights)** | CloudWatch Logs, EKS | Container Insights를 통한 파드/노드 메트릭 |
| **Lambda (Chaos)** | EKS, Kubernetes API | 대상 클러스터에 카오스 시나리오 주입 |
| **Lambda (Alarm)** | SNS, CloudWatch | 알람 트리거/알림 |
| **Lambda (GitHub)** | Secrets Manager | 외부 자격 증명을 통한 GitHub API 접근 |

Incident Agent는 MCP Server를 사용하지 않습니다. 모든 도구가 Lambda 기반이며, MCP Gateway의 Lambda 타겟 유형을 통해 호출됩니다. 각 Lambda는 공통 실행 역할(`incident-tools-lambda-role`)을 공유합니다.

## 프롬프트 캐싱 변형 (agent-cached)

`agent-cached/` 디렉토리는 프롬프트 캐싱이 활성화된 Incident Agent의 별도 배포입니다. 두 변형은 동일한 에이전트 코드를 공유하며, 유일한 차이점은 Dockerfile에 설정된 `ENABLE_PROMPT_CACHE` 환경변수입니다.

### 디렉토리 구조

```
agents/incident-agent/
├── agent/                 # 표준 런타임 (캐싱 비활성화)
│   ├── agent_config/      # 공유 에이전트 로직
│   ├── Dockerfile         # ENABLE_PROMPT_CACHE 미설정 (기본값 false)
│   └── .bedrock_agentcore.yaml
└── agent-cached/          # 캐시 런타임 (캐싱 활성화)
    ├── agent_config/      # 동일한 에이전트 로직 (심링크가 아닌 복사본)
    ├── Dockerfile         # ENV ENABLE_PROMPT_CACHE=true
    └── .bedrock_agentcore.yaml
```

### 주요 차이점

| 항목 | 표준 (`agent/`) | 캐시 (`agent-cached/`) |
|---------|--------------------|-----------------------|
| `ENABLE_PROMPT_CACHE` | 미설정 (false) | `true` |
| 런타임 이름 | `incident_analysis_agent_runtime` | `incident_cached_agent_runtime` |
| 에이전트 코드 | 동일 | 동일 |
| `cache_config` | 비활성화 | `CacheConfig(strategy="auto")` |
| `cache_tools` | 비활성화 | `"default"` |

### 캐싱 활성화 방법

에이전트 코드는 환경변수를 사용하여 조건부로 캐싱을 활성화합니다:

```python
cache_enabled = os.environ.get("ENABLE_PROMPT_CACHE", "false").lower() == "true"

cache_kwargs = (
    {"cache_config": CacheConfig(strategy="auto"), "cache_tools": "default"}
    if cache_enabled
    else {}
)

self.model = BedrockModel(model_id=self.model_id, **cache_kwargs)
```

### 배포

캐시 변형은 별도의 AgentCore 런타임으로 배포됩니다:

```bash
cd agents/incident-agent/agent-cached
AWS_DEFAULT_REGION=us-east-1 AWS_PROFILE=<AWS_PROFILE> agentcore deploy
```

배포 후 표준 에이전트와 동일한 배포 후 체크리스트(JWT authorizer 복원, SSM ARN 등록, 실행 역할 권한)를 따릅니다. 캐시 런타임은 자체 ARN을 SSM에 저장합니다.

**중요**: `agentcore deploy`는 CodeBuild를 사용하여 소스 디렉토리를 zip으로 압축하기 때문에, `agent-cached/`는 공유 `agent_config/` 파일의 심링크가 아닌 실제 파일 복사본을 포함합니다.

자세한 내용은 [프롬프트 캐싱](../appendix/prompt-caching.md)에서 캐싱 메커니즘, 비용 영향, A/B 테스트 가이드를 참조하세요.

## 카오스 엔지니어링 통합

UI는 Incident Agent를 위한 전용 ChaosPanel을 제공하여 운영자가 다음을 수행할 수 있습니다.

1. **트리거**: 카오스 시나리오(CPU 스트레스, 에러, 지연, 파드 크래시) 실행
2. **모니터**: 상태 표시기를 통한 활성 카오스 모니터링
3. **정리**: 한 번의 클릭으로 모든 활성 카오스 정리

이를 통해 에이전트 진단 능력의 훈련 및 테스트를 위한 실시간 인시던트 시뮬레이션이 가능합니다.
