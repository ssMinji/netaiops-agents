# Istio 메시 진단 에이전트

## 목적

Istio 기반 환경을 위한 서비스 메시 분석 및 트래픽 관리. Istio Agent는 컨트롤 플레인 상태, mTLS 구성, 트래픽 라우팅 규칙을 검사하고 레이턴시 핫스팟 감지와 함께 카나리 배포 분석을 제공합니다.

## 위치

```
agents/istio-agent/
├── agent/                   # Agent runtime
└── prerequisite/            # Prometheus Lambda, Fault injection Lambda
```

## MCP 도구

### EKS MCP Server
Kubernetes 오브젝트 검사를 위해 K8s Agent와 공유:
- VirtualService, DestinationRule, Gateway 리소스
- Envoy 사이드카 구성
- Istio 컨트롤 플레인 파드

### Prometheus 도구
- `prometheus-query` - PromQL 메트릭 쿼리
- `prometheus-range-query` - 시간 범위 메트릭 분석

### Fault Injection 도구
- `fault-delay` - 서비스 간 호출에 지연 추가
- `fault-abort` - HTTP 에러 응답 주입
- `fault-circuit-breaker` - 서킷 브레이킹 활성화

## 시나리오

| 시나리오 | 설명 |
|----------|-------------|
| Service Connectivity Failure | 서비스 간 통신 실패 진단 |
| mTLS Audit | 메시 전반의 mutual TLS 구성 확인 |
| Canary Deployment Analysis | 트래픽 분할 및 카나리 상태 분석 |
| Control Plane Status | istiod, pilot, 컨트롤 플레인 상태 검사 |
| Latency Hotspot Detection | 레이턴시 스파이크를 유발하는 서비스 식별 |

## Fault Injection 통합

UI는 Istio Agent를 위한 전용 FaultPanel을 제공합니다.

1. **Delay Injection**: 구성 가능한 지연 추가(예: 트래픽의 50%에 5초 지연)
2. **Abort Injection**: HTTP 에러 반환(예: 요청의 30%에 503)
3. **Circuit Breaker**: Outlier detection 임계값 구성

각 결함은 UI를 통해 개별적으로 적용, 제거하거나 대량 정리할 수 있습니다.

## Docker 구성

Istio Agent는 CodeBuild에서 Docker Hub 속도 제한을 피하기 위해 ECR Public Gallery를 기본 이미지로 사용합니다.

```dockerfile
FROM public.ecr.aws/docker/library/python:3.12-slim
```
