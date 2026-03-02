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

## 프롬프트 캐싱 변형

`agent-cached/` 디렉토리는 프롬프트 캐싱이 활성화된 변형을 포함합니다.

```python
BedrockModel(
    model_id=model_id,
    cache_config=CacheConfig(strategy="auto"),
    cache_tools="default"
)
```

이는 다음을 캐싱하여 반복되는 대화의 토큰 사용량을 줄입니다:
- 도구 정의(`cache_tools`)
- 마지막 assistant 메시지 컨텍스트(`cache_config`)

자세한 내용은 [프롬프트 캐싱](../appendix/prompt-caching.md)을 참조하세요.

## 카오스 엔지니어링 통합

UI는 Incident Agent를 위한 전용 ChaosPanel을 제공하여 운영자가 다음을 수행할 수 있습니다.

1. **트리거**: 카오스 시나리오(CPU 스트레스, 에러, 지연, 파드 크래시) 실행
2. **모니터**: 상태 표시기를 통한 활성 카오스 모니터링
3. **정리**: 한 번의 클릭으로 모든 활성 카오스 정리

이를 통해 에이전트 진단 능력의 훈련 및 테스트를 위한 실시간 인시던트 시뮬레이션이 가능합니다.
