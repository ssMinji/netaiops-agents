# 샘플 워크로드

에이전트의 진단/모니터링 대상이 되는 워크로드입니다.

| 워크로드 | 네임스페이스 | 설명 |
|---------|------------|------|
| [retail-store](retail-store/) | `retail-store` | AWS Retail Store 마이크로서비스 앱 (5개 서비스) |
| [istio-sample](istio-sample/) | `istio-sample` | Istio Bookinfo 샘플 앱 (4개 서비스) |

## 전체 배포 (권장)

하나의 명령어로 EKS 클러스터, retail-store 앱, Istio 인프라, istio-sample 앱을 모두 배포합니다:

```bash
./retail-store/deploy-eks-workload.sh deploy-all
```

수행 내용:
1. EKS 클러스터 생성 (`netaiops-eks-cluster`)
2. retail-store 앱 배포 (`retail-store` 네임스페이스)
3. Istio 설치 (demo profile) + 사이드카 주입 활성화
4. AMP 워크스페이스 + ADOT Collector 배포
5. `retail-store` 네임스페이스에 사이드카 주입
6. istio-sample Bookinfo 앱 배포 (`istio-sample` 네임스페이스)
7. 초기 트래픽 생성 (메트릭 시딩)

## 개별 배포

클러스터가 이미 존재하는 경우, 필요한 부분만 배포할 수 있습니다:

```bash
# retail-store 앱만 배포
./retail-store/deploy-eks-workload.sh deploy-app

# Istio 인프라 + istio-sample 앱만 배포 (클러스터 + retail-store 존재 시)
./retail-store/deploy-eks-workload.sh setup-istio
```

## 상태 확인

```bash
./retail-store/deploy-eks-workload.sh status
```

## 에이전트별 필요 워크로드

| 에이전트 | retail-store | istio-sample | Istio 인프라 |
|---------|-------------|-------------|-------------|
| K8s Agent | 권장 | 불필요 | 불필요 |
| Incident Agent | 권장 | 불필요 | 불필요 |
| Istio Agent | 간접 (메시 관찰) | **필수** (fault injection) | **필수** |

## 전체 삭제

```bash
# 앱 + 클러스터 전체 삭제
./retail-store/deploy-eks-workload.sh delete-all

# Istio만 삭제
istioctl uninstall --purge -y
kubectl delete namespace istio-system istio-sample
```
