# Istio 샘플 워크로드 - Bookinfo

Istio 공식 Bookinfo 샘플 애플리케이션입니다. `istio-sample` 네임스페이스에 배포되며, Istio Agent의 트래픽 관리 및 Fault Injection 데모 대상으로 사용됩니다.

## 에이전트 의존성

| 에이전트 | 의존 여부 | 설명 |
|---------|----------|------|
| **Istio Agent** | **필수** | `lambda-istio-fault`가 `istio-sample` 네임스페이스를 하드코딩하여 fault injection 수행. 미배포 시 fault injection 실패 |
| K8s Agent | 불필요 | 직접적 의존 없음 |
| Incident Agent | 불필요 | 직접적 의존 없음 |

## 아키텍처

Istio Bookinfo 애플리케이션 구조:

```
                    Istio IngressGateway
                           │
                    ┌──────▼──────┐
                    │ productpage │  (Python)
                    │     v1      │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐  ┌─▼──────┐  ┌──▼─────┐
       │   details    │  │reviews │  │reviews │
       │     v1       │  │  v1-v3 │  │(통합)  │
       └─────────────┘  └───┬────┘  └────────┘
                            │
                     ┌──────▼──────┐
                     │   ratings   │
                     │     v1      │
                     └─────────────┘
```

**서비스:**
- **productpage**: 웹 프론트엔드 (Python)
- **details**: 도서 상세 정보
- **reviews**: 도서 리뷰 (v1: 별점 없음, v2: 검정 별점, v3: 빨간 별점)
- **ratings**: 별점 서비스

## 배포

### 사전 요구 사항

- EKS 클러스터 (`sample-workloads/retail-store/deploy-eks-workload.sh`로 생성)
- Istio 설치 완료 (`deploy-eks-workload.sh deploy-all` 또는 `setup-istio`로 자동 설치)

### 자동 배포 (권장)

EKS 클러스터 배포 스크립트가 Istio 설정 시 자동으로 배포합니다:

```bash
# 전체 배포 (EKS + retail-store + Istio + Bookinfo)
./sample-workloads/retail-store/deploy-eks-workload.sh deploy-all

# Istio만 별도 설정 (클러스터 존재 시)
./sample-workloads/retail-store/deploy-eks-workload.sh setup-istio
```

### 수동 배포

```bash
# 네임스페이스 생성 + 사이드카 주입 활성화
kubectl create namespace istio-sample
kubectl label namespace istio-sample istio-injection=enabled

# Bookinfo 앱 배포
kubectl apply -f bookinfo.yaml

# Istio 네트워킹 리소스 적용
kubectl apply -f bookinfo-gateway.yaml
kubectl apply -f destination-rules.yaml
kubectl apply -f virtual-services.yaml
kubectl apply -f peer-authentication.yaml
```

### 상태 확인

```bash
kubectl get pods -n istio-sample
kubectl get virtualservices,destinationrules,gateways -n istio-sample
```

## Fault Injection 데모

Istio Agent가 사용하는 fault injection 시나리오:

```bash
# Delay fault (reviews 서비스에 지연 주입)
kubectl apply -f fault-injection/fault-delay-reviews.yaml

# Abort fault (ratings 서비스에 HTTP 오류 주입)
kubectl apply -f fault-injection/fault-abort-ratings.yaml

# Circuit breaker
kubectl apply -f fault-injection/circuit-breaker.yaml
```

## 삭제

```bash
kubectl delete namespace istio-sample
```
