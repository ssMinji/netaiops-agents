# NetAIOps Agent Hub - 시나리오 상세 가이드

이 문서는 NetAIOps Agent Hub UI에서 사용할 수 있는 모든 시나리오의 동작을 상세히 설명합니다.

UI에는 세 가지 종류의 시나리오 트리거가 있습니다:

| 구분 | 위치 | 동작 방식 | 실제 장애 발생 |
|------|------|-----------|---------------|
| **Sidebar 시나리오** | 좌측 사이드바 | 사전 정의된 프롬프트를 채팅에 전송 | No |
| **Trigger Incident** | 채팅 헤더 `⚡` 버튼 | Lambda를 호출하여 EKS에 리소스 배포 | **Yes** |
| **Fault Injection** | 채팅 헤더 `🔧` 버튼 | kubectl로 Istio VirtualService/DestinationRule 적용 | **Yes** |

---

## 1. Sidebar 시나리오 (프롬프트 전송만)

사이드바에서 에이전트를 선택하면 해당 에이전트의 시나리오 목록이 표시됩니다. 시나리오 버튼을 클릭하면 **사전 정의된 프롬프트가 채팅창에 자동 전송**됩니다. 실제 장애를 발생시키지 않으며, AI 에이전트에게 분석을 요청하는 질의입니다.

### 1.1 K8s Diagnostics Agent

시나리오 없음 (자유 질의 전용)

### 1.2 Incident Analysis Agent

| 시나리오 | 전송되는 프롬프트 |
|---------|-----------------|
| **CPU 급증 분석** | "서비스 web-api의 CPU 사용률이 90%를 넘었습니다. 원인을 분석해주세요." |
| **에러율 증가** | "지난 1시간 동안 payment 서비스의 에러율이 5%를 초과했습니다. 로그와 메트릭을 분석해주세요." |
| **지연 시간 급증** | "API 응답 지연이 P99 기준 2초를 넘었습니다. APM 트레이스와 컨테이너 상태를 확인해주세요." |
| **파드 재시작 반복** | "EKS 클러스터에서 checkout-service 파드가 반복적으로 재시작됩니다. 진단해주세요." |

### 1.3 Istio Mesh Diagnostics Agent

| 시나리오 | 전송되는 프롬프트 |
|---------|-----------------|
| **서비스 연결 실패 진단** | "istio-sample 네임스페이스에서 productpage→reviews 요청 시 503 에러가 발생합니다. 토폴로지, 사이드카, VirtualService, mTLS 설정을 확인해주세요." |
| **mTLS 감사** | "메시 전체의 mTLS 설정 상태를 확인해주세요. retail-store, istio-sample 등 모든 네임스페이스의 PeerAuthentication 정책, 사이드카 미주입 파드, 보안 권고사항을 알려주세요." |
| **카나리 배포 분석** | "istio-sample 네임스페이스의 reviews 서비스 트래픽 라우팅 상태를 확인해주세요. VirtualService 가중치 설정(v1=80%, v2=10%, v3=10%)과 실제 트래픽 비율을 비교 분석해주세요." |
| **컨트롤 플레인 상태** | "istiod 컨트롤 플레인의 상태를 확인해주세요. xDS 푸시 지연, 에러, 설정 충돌, 연결된 프록시 수를 알려주세요." |
| **지연 핫스팟 탐지** | "retail-store와 istio-sample 양쪽 네임스페이스의 P99 지연 시간을 스캔하고, 가장 느린 서비스를 식별해주세요. VirtualService fault injection 여부도 확인해주세요." |

---

## 2. Trigger Incident (Chaos Engineering)

채팅 헤더의 `⚡ Trigger Incident` 버튼으로 확장되는 패널입니다. **실제 EKS 클러스터에 장애를 주입합니다.**

### 동작 흐름

```
[UI 버튼 클릭]
  → POST /api/chaos/trigger  { scenario: "chaos-cpu-stress" }
    → Backend: trigger_chaos(scenario_name)
      → Lambda invoke (동기, RequestResponse)
        → FunctionName: "incident-chaos-tools"
        → Payload: { "name": "chaos-cpu-stress", "arguments": {} }
          → Lambda: EKS API 인증 (STS presigned token)
            → Kubernetes API: Pod/Deployment 생성
```

- **Lambda 함수**: `incident-chaos-tools` (Docker 이미지 기반, Python 3.11)
- **대상 클러스터**: `netaiops-eks-cluster`
- **네임스페이스**: `default`
- **리소스 레이블**: `app=chaos-test` (cleanup 시 이 레이블로 일괄 삭제)

### 2.1 CPU Stress

| 항목 | 상세 |
|------|------|
| **시나리오 ID** | `chaos-cpu-stress` |
| **Kubernetes 리소스** | Deployment (`chaos-cpu-stress`) |
| **컨테이너 이미지** | `public.ecr.aws/amazonlinux/amazonlinux:2` |
| **레이블** | `app=chaos-test`, `chaos-type=cpu-stress` |
| **리소스 요청/제한** | requests: 500m CPU, 64Mi / limits: 2 CPU, 128Mi |
| **지속 시간** | 600초 (10분) |

**동작 원리**:
```bash
for i in $(seq 1 4); do while :; do :; done & done
sleep 600
kill 0
```
- bash busy loop 4개를 백그라운드로 실행하여 CPU를 100% 점유
- 외부 도구 설치 없이 순수 bash로 CPU 부하 생성
- Deployment로 배포하여 Container Insights가 `pod_cpu_utilization` 메트릭 수집 가능
- 600초 후 자동 종료 (`kill 0`으로 모든 프로세스 종료)

**관찰 가능한 현상**:
- CloudWatch Container Insights에서 CPU 사용률 급증
- `kubectl top pods` 에서 해당 Pod의 높은 CPU 사용량 확인
- CloudWatch 알람 트리거 가능 (CPU 임계치 초과 시)

### 2.2 Error Injection

| 항목 | 상세 |
|------|------|
| **시나리오 ID** | `chaos-error-injection` |
| **Kubernetes 리소스** | Pod (`chaos-error-injection`) |
| **컨테이너 이미지** | `busybox` |
| **레이블** | `app=chaos-test`, `chaos-type=error-injection` |
| **리소스 요청/제한** | requests: 50m CPU, 32Mi / limits: 100m CPU, 64Mi |
| **restartPolicy** | Always |

**동작 원리**:
```bash
while true; do
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo '{"timestamp":"$timestamp","level":"ERROR","message":"Connection refused to database","service":"web-api","error_code":"ECONNREFUSED"}'
  sleep 2
done
```
- 2초마다 JSON 형식의 ERROR 로그를 stdout으로 출력
- 로그 내용: 데이터베이스 연결 거부 (ECONNREFUSED) 시뮬레이션
- Container Insights / CloudWatch Logs에서 에러 로그로 수집됨

**로그 출력 형식**:
```json
{
  "timestamp": "2025-01-15T12:00:00Z",
  "level": "ERROR",
  "message": "Connection refused to database",
  "service": "web-api",
  "error_code": "ECONNREFUSED"
}
```

**관찰 가능한 현상**:
- CloudWatch Logs에서 ERROR 레벨 로그 급증
- 로그 기반 메트릭 필터가 설정되어 있다면 에러율 알람 트리거
- Incident Analysis Agent가 에러 패턴 분석 가능

### 2.3 Latency Injection

| 항목 | 상세 |
|------|------|
| **시나리오 ID** | `chaos-latency-injection` |
| **Kubernetes 리소스** | Pod (`chaos-latency-injection`) |
| **컨테이너 이미지** | `busybox` |
| **레이블** | `app=chaos-test`, `chaos-type=latency-injection` |
| **리소스 요청/제한** | requests: 50m CPU, 32Mi / limits: 100m CPU, 64Mi |
| **restartPolicy** | Always |

**동작 원리**:
```bash
while true; do
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  latency=$((RANDOM % 500 + 500))
  echo '{"timestamp":"$timestamp","level":"WARN","message":"High latency detected: ${latency}ms","service":"api-gateway","latency_ms":$latency}'
  sleep 3
done
```
- 3초마다 JSON 형식의 WARN 로그를 stdout으로 출력
- 랜덤 지연 값: 500ms ~ 1000ms
- `api-gateway` 서비스의 높은 지연을 시뮬레이션

**로그 출력 형식**:
```json
{
  "timestamp": "2025-01-15T12:00:00Z",
  "level": "WARN",
  "message": "High latency detected: 750ms",
  "service": "api-gateway",
  "latency_ms": 750
}
```

**관찰 가능한 현상**:
- CloudWatch Logs에서 WARN 레벨 지연 경고 로그
- 지연 시간 메트릭 급증 패턴 (500-1000ms 범위)
- Incident Analysis Agent가 지연 패턴 분석 가능

### 2.4 Pod Crash

| 항목 | 상세 |
|------|------|
| **시나리오 ID** | `chaos-pod-crash` |
| **Kubernetes 리소스** | Pod (`chaos-pod-crash`) |
| **컨테이너 이미지** | `busybox` |
| **레이블** | `app=chaos-test`, `chaos-type=pod-crash` |
| **리소스 요청/제한** | requests: 50m CPU, 32Mi / limits: 100m CPU, 64Mi |
| **restartPolicy** | Always |

**동작 원리**:
```bash
exit 1
```
- 컨테이너 시작 즉시 `exit 1`로 비정상 종료
- `restartPolicy: Always` 설정으로 kubelet이 자동 재시작
- 반복 실패 → Kubernetes가 **CrashLoopBackOff** 상태로 전환
- 재시작 간격이 점점 증가 (10s → 20s → 40s → ... 최대 5분)

**관찰 가능한 현상**:
- `kubectl get pods`에서 `CrashLoopBackOff` 상태 확인
- 재시작 횟수(RESTARTS) 지속 증가
- Container Insights에서 Pod 재시작 이벤트 감지
- Kubernetes 이벤트에서 `BackOff` 경고 발생

### 2.5 Cleanup

| 항목 | 상세 |
|------|------|
| **시나리오 ID** | `chaos-cleanup` |
| **API** | `POST /api/chaos/cleanup` |

**동작 원리**:
1. `app=chaos-test` 레이블의 모든 **Deployment** 조회 및 삭제
2. `app=chaos-test` 레이블의 모든 **standalone Pod** 조회 및 삭제
   - ReplicaSet이 소유한 Pod는 건너뜀 (Deployment 삭제 시 자동 정리)
3. 백엔드 `_active_chaos` 상태 초기화

---

## 2.6 CloudWatch 알람 연동 (자동 인시던트 분석)

Chaos 시나리오로 주입된 장애는 CloudWatch Container Insights 메트릭을 통해 **자동으로 알람을 트리거**하고, 알람이 발생하면 **Incident Analysis Agent가 자동으로 분석을 시작**합니다.

### 전체 자동화 흐름

```
[Chaos 버튼 클릭]
  → Lambda: incident-chaos-tools → EKS에 장애 Pod/Deployment 배포
    → Container Insights 메트릭 수집 (1~5분 소요)
      → CloudWatch 알람 임계치 초과 → ALARM 상태 전환
        → SNS Topic: netaiops-incident-alarm-topic
          → Lambda: incident-alarm-trigger
            → Cognito M2M 인증 (client_credentials)
              → AgentCore Runtime API 호출
                → Incident Analysis Agent 자동 분석 시작
```

### 등록된 CloudWatch 알람

| 알람 이름 | 메트릭 | 네임스페이스 | 임계치 | 평가 기간 | 트리거되는 시나리오 |
|----------|--------|------------|--------|----------|------------------|
| `netaiops-cpu-spike` | `pod_cpu_utilization` | ContainerInsights | - | - | CPU Stress |
| `netaiops-node-cpu-high` | `node_cpu_utilization` | ContainerInsights | - | - | CPU Stress (노드 레벨) |
| `netaiops-pod-restarts` | `pod_number_of_container_restarts` | ContainerInsights | 3회 | 5분 (1 period) | Pod Crash |

### 시나리오별 


| 시나리오 | 동작 | CloudWatch 알람 연동 |
|---------|------|---------------------|
| **CPU Stress** | CPU 100% 점유 Deployment 배포 | `netaiops-cpu-spike` 알람 → 자동 분석 |
| **Pod Crash** | CrashLoopBackOff Pod 배포 | `netaiops-pod-restarts` 알람 → 자동 분석 |
| **Error Injection** | 2초마다 ERROR 로그 출력 Pod 배포 | 알람 없음 - 로그 수집만 |
| **Latency Injection** | 3초마다 WARN 지연 로그 출력 Pod 배포 | 알람 없음 - 로그 수집만 |

- CPU Stress, Pod Crash: 메트릭 기반 알람이 설정되어 있어 **자동으로 Incident Analysis Agent가 분석을 시작**합니다.
- Error Injection, Latency Injection: CloudWatch Logs에 로그가 쌓이지만 알람이 없으므로, **수동으로 Incident Analysis Agent에 질의**하거나 로그 기반 메트릭 필터 + 알람을 추가하면 자동화할 수 있습니다.

### 알람 트리거 상세

**CPU Stress → `netaiops-cpu-spike` 알람**:
1. `chaos-cpu-stress` Deployment가 CPU 100% 점유
2. Container Insights가 `pod_cpu_utilization` 메트릭 수집
3. 임계치 초과 시 알람 → SNS → Incident Agent 자동 분석

**Pod Crash → `netaiops-pod-restarts` 알람**:
1. `chaos-pod-crash` Pod가 즉시 종료 → CrashLoopBackOff
2. Container Insights가 `pod_number_of_container_restarts` 메트릭 수집
3. 5분 내 재시작 3회 이상 시 알람 → SNS → Incident Agent 자동 분석

### incident-alarm-trigger Lambda

알람 발생 시 호출되는 SNS 이벤트 핸들러입니다 (MCP 도구가 아님).

| 항목 | 상세 |
|------|------|
| **Lambda 함수** | `incident-alarm-trigger` |
| **트리거** | SNS (`netaiops-incident-alarm-topic`) |
| **인증** | Cognito M2M (client_credentials grant) |
| **호출 대상** | AgentCore Runtime API → Incident Analysis Agent |
| **SSM 파라미터** | `/app/incident/agentcore/machine_client_id`, `machine_client_secret`, `cognito_token_url`, `cognito_auth_scope` |

### 타이밍

버튼을 누른 직후 알람이 발생하지는 않습니다:
- Container Insights 메트릭 수집 주기: 약 1~5분
- CloudWatch 알람 평가 주기: 5분 (1 evaluation period)
- **예상 소요 시간: 버튼 클릭 후 약 5~10분 뒤 알람 발생**

---

## 3. Fault Injection (Istio)

채팅 헤더의 `🔧 Fault Injection` 버튼으로 확장되는 패널입니다. **Istio 서비스 메시를 통해 실제 트래픽에 장애를 주입합니다.**

### 동작 흐름

```
[UI 버튼 클릭]
  → POST /api/fault/apply  { fault_type: "delay" }
    → Backend: _run_kubectl("apply", yaml_path)
      → kubectl apply -f fault-delay-reviews.yaml
        → Istio VirtualService/DestinationRule 생성
          → Envoy 사이드카 프록시 설정 업데이트
            → 실제 트래픽에 장애 적용
```

- **대상 네임스페이스**: `istio-sample` (Bookinfo 샘플 앱)
- **적용 방식**: `kubectl apply -f <yaml>` (서버에서 직접 실행)
- **제거 방식**: `kubectl delete -f <yaml> --ignore-not-found`
- **토글 가능**: 같은 버튼으로 적용/제거 전환

### 3.1 Reviews Delay (7s)

| 항목 | 상세 |
|------|------|
| **Fault Type** | `delay` |
| **YAML 파일** | `fault-delay-reviews.yaml` |
| **Istio 리소스** | VirtualService (`reviews`) |
| **대상 서비스** | `reviews` (istio-sample 네임스페이스) |

**적용되는 Istio 설정**:
```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: reviews
  namespace: istio-sample
spec:
  hosts:
    - reviews
  http:
    - fault:
        delay:
          percentage:
            value: 100.0
          fixedDelay: 7s
      match:
        - headers:
            end-user:
              exact: jason
      route:
        - destination:
            host: reviews
            subset: v2
    - route:
        - destination:
            host: reviews
            subset: v1
          weight: 80
        - destination:
            host: reviews
            subset: v2
          weight: 10
        - destination:
            host: reviews
            subset: v3
          weight: 10
```

**동작 원리**:
- `end-user: jason` 헤더가 포함된 요청에 대해 **100% 확률로 7초 지연** 적용
- 해당 트래픽은 `reviews v2`로 라우팅
- 일반 트래픽은 v1:80%, v2:10%, v3:10% 비율로 분산

**관찰 가능한 현상**:
- Bookinfo UI에서 `jason` 사용자로 로그인 시 reviews 로딩에 7초 소요
- Istio 메트릭에서 `reviews` 서비스 응답 시간 급증
- Kiali 대시보드에서 지연 트래픽 시각화

### 3.2 Ratings 503 (50%)

| 항목 | 상세 |
|------|------|
| **Fault Type** | `abort` |
| **YAML 파일** | `fault-abort-ratings.yaml` |
| **Istio 리소스** | VirtualService (`ratings`) |
| **대상 서비스** | `ratings` (istio-sample 네임스페이스) |

**적용되는 Istio 설정**:
```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: ratings
  namespace: istio-sample
spec:
  hosts:
    - ratings
  http:
    - fault:
        abort:
          percentage:
            value: 50.0
          httpStatus: 503
      route:
        - destination:
            host: ratings
            subset: v1
```

**동작 원리**:
- `ratings` 서비스로 향하는 모든 요청의 **50%를 HTTP 503 (Service Unavailable)** 으로 즉시 실패 처리
- Envoy 프록시 레벨에서 처리되므로 실제 ratings Pod에는 요청이 도달하지 않음

**관찰 가능한 현상**:
- Bookinfo UI에서 별점(ratings)이 간헐적으로 표시되지 않음
- Istio 메트릭에서 `ratings` 서비스 5xx 에러율 50%
- `reviews → ratings` 호출의 절반이 실패
- Kiali에서 빨간색 에러 트래픽 표시

### 3.3 Circuit Breaker

| 항목 | 상세 |
|------|------|
| **Fault Type** | `circuit-breaker` |
| **YAML 파일** | `circuit-breaker.yaml` |
| **Istio 리소스** | DestinationRule (`reviews-circuit-breaker`) |
| **대상 서비스** | `reviews` (istio-sample 네임스페이스) |

**적용되는 Istio 설정**:
```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: reviews-circuit-breaker
  namespace: istio-sample
spec:
  host: reviews
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 10
      http:
        http1MaxPendingRequests: 5
        http2MaxRequests: 10
        maxRequestsPerConnection: 5
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
```

**동작 원리**:

Connection Pool 제한:
- TCP 최대 연결 수: 10개
- HTTP/1.1 대기 요청: 최대 5개
- HTTP/2 동시 요청: 최대 10개
- 연결 당 최대 요청: 5개

Outlier Detection (이상치 감지):
- 연속 5xx 에러 **3회** 발생 시 해당 엔드포인트를 서킷에서 제거(eject)
- 감시 간격: 10초
- 제거 지속 시간: 30초 (이후 복귀 시도)
- 최대 제거 비율: 50% (최소 절반의 엔드포인트는 유지)

**관찰 가능한 현상**:
- 부하가 높을 때 `reviews` 서비스에 대한 요청이 즉시 거부됨 (503 overflow)
- 특정 `reviews` Pod에서 에러가 반복되면 해당 Pod가 30초간 트래픽에서 제외
- Istio 메트릭에서 `upstream_rq_pending_overflow` 카운터 증가
- Kiali에서 서킷 브레이커 활성화 상태 표시

### 3.4 Fault Cleanup

| 항목 | 상세 |
|------|------|
| **UI** | `🧹 Remove All` 버튼 |
| **API** | `POST /api/fault/cleanup` |

**동작 원리**:
1. 등록된 모든 fault YAML 파일에 대해 `kubectl delete -f <yaml> --ignore-not-found` 실행
2. 백엔드 `_active_faults` 상태 초기화
3. Istio가 원래 라우팅 설정으로 자동 복원

---

## 시나리오 조합 활용

Trigger Incident와 Fault Injection은 동시에 사용할 수 있습니다. 다음과 같은 조합으로 복합적인 장애 상황을 시뮬레이션할 수 있습니다:

| 조합 | 효과 |
|------|------|
| CPU Stress + Ratings 503 | 리소스 부족 + 서비스 에러 동시 발생 |
| Pod Crash + Reviews Delay | 파드 불안정 + 지연 발생으로 cascading failure 시뮬레이션 |
| Error Injection + Circuit Breaker | 에러 로그 발생 + 서킷 브레이커로 자동 격리 관찰 |
| 전체 Chaos + 전체 Fault | 최대 부하 상황에서 AI 에이전트 진단 능력 테스트 |

장애 주입 후 해당 에이전트(Incident Analysis 또는 Istio Mesh Diagnostics)의 사이드바 시나리오를 클릭하거나 자유 질의를 통해 AI 에이전트가 실제 장애를 분석하도록 할 수 있습니다.
