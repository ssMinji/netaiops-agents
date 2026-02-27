# EKS 샘플 워크로드 - Retail Store

AWS retail-store-sample-app의 인프라 및 배포 스크립트를 포함합니다. Amazon EKS에 배포되는 마이크로서비스 기반 이커머스 애플리케이션으로, K8s 진단 에이전트의 대상 워크로드로 사용됩니다.

## 에이전트 의존성

| 에이전트 | 의존 여부 | 설명 |
|---------|----------|------|
| **K8s Agent** | 권장 | EKS 클러스터 필수. 워크로드 없어도 동작하지만 진단 대상이 없음 |
| **Incident Agent** | 권장 | Container Insights 메트릭 수집 대상. 미배포 시 메트릭이 비어있음. chaos Lambda는 `default` 네임스페이스에 자체 Pod를 생성하므로 이 앱과 무관하게 동작 |
| Istio Agent | 간접 | `retail-store` 네임스페이스에 사이드카 주입 시 메시 관찰 대상이 됨 |

## 설명

retail-store-sample-app은 여러 서비스, 데이터베이스, 메시지 큐로 구성된 전형적인 클라우드 네이티브 아키텍처를 보여주는 마이크로서비스 애플리케이션입니다. Kubernetes 모니터링 및 진단 기능을 테스트하기 위한 현실적인 워크로드를 제공합니다.

## 아키텍처

5개의 마이크로서비스로 구성됩니다:

```
┌─────────────────────────────────────────────────────────┐
│                    LoadBalancer (UI)                    │
└────────────────────────┬────────────────────────────────┘
                         │
            ┌────────────▼───────────┐
            │    UI Service          │  (웹 프론트엔드)
            │    Port: 80            │
            └────────────┬───────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
┌───────▼──────┐  ┌──────▼─────┐  ┌──────▼─────┐
│   Catalog    │  │   Cart     │  │   Orders   │
│   Service    │  │   Service  │  │   Service  │
└───────┬──────┘  └──────┬─────┘  └──────┬─────┘
        │                │                │
        │                │                │
┌───────▼──────┐  ┌──────▼─────┐  ┌──────▼─────┐
│  Catalog DB  │  │  Cart DB   │  │ Orders DB  │
│  (MySQL)     │  │ (DynamoDB) │  │  (MySQL)   │
└──────────────┘  └────────────┘  └────────────┘
                         │
                  ┌──────▼─────┐
                  │  Checkout  │
                  │  Service   │
                  └────────────┘
```

**서비스:**
- **UI**: 사용자가 접속하는 웹 프론트엔드 (Next.js)
- **Catalog**: 상품 카탈로그 관리 서비스
- **Cart**: 장바구니 관리 서비스
- **Orders**: 주문 처리 및 이력 서비스
- **Checkout**: 결제 처리 서비스

## 사전 요구 사항

다음 도구가 설치되어 있어야 합니다:

- **eksctl** - EKS 클러스터 관리 도구 ([설치 가이드](https://eksctl.io/))
- **kubectl** - Kubernetes CLI ([설치 가이드](https://kubernetes.io/docs/tasks/tools/))
- **AWS CLI** - AWS 명령줄 인터페이스 ([설치 가이드](https://aws.amazon.com/cli/))
- **AWS Profile** - `ssminji-wesang` 프로필에 적절한 자격 증명 구성

설치 확인:
```bash
eksctl version
kubectl version --client
aws --version
aws configure list-profiles | grep ssminji-wesang
```

## 빠른 시작

### 전체 배포

EKS 클러스터 생성 및 애플리케이션 배포:
```bash
./deploy-eks-workload.sh deploy-all
```

실행 내용:
1. `netaiops-eks-cluster` 이름의 EKS 클러스터 생성
2. 전체 마이크로서비스와 함께 retail-store-sample-app 배포
3. 준비 완료 시 UI LoadBalancer URL 표시

### 상태 확인

클러스터 및 애플리케이션 상태 조회:
```bash
./deploy-eks-workload.sh status
```

표시 내용:
- 클러스터 정보
- 실행 중인 전체 Pod
- 전체 서비스
- UI LoadBalancer URL (프로비저닝된 경우)

### 애플리케이션 접속

배포 완료 후 출력된 LoadBalancer URL로 Retail Store UI에 접속:
```
http://<load-balancer-dns>
```

### 전체 삭제

애플리케이션 제거 및 클러스터 삭제:
```bash
./deploy-eks-workload.sh delete-all
```

실행 내용:
1. retail-store-sample-app 리소스 삭제
2. EKS 클러스터 및 관련 리소스 전체 삭제

## 사용 가능한 명령어

```bash
./deploy-eks-workload.sh <command>
```

**명령어:**
- `create-cluster` - EKS 클러스터만 생성
- `deploy-app` - 애플리케이션만 배포 (클러스터가 존재해야 함)
- `status` - 클러스터 및 애플리케이션 상태 표시
- `delete-app` - 애플리케이션만 삭제
- `delete-cluster` - 클러스터만 삭제
- `deploy-all` - 전체 배포 (클러스터 + 애플리케이션)
- `delete-all` - 전체 정리 (애플리케이션 + 클러스터)
- `help` - 사용법 표시

## 클러스터 구성

EKS 클러스터 구성:
- **클러스터 이름**: netaiops-eks-cluster
- **리전**: ap-northeast-2
- **Kubernetes 버전**: 1.31
- **노드 그룹**: m5.large 인스턴스 2~3개 (각 30GB)
- **관측성**: CloudWatch Container Insights 활성화
- **로깅**: 전체 컨트롤 플레인 로그 활성화
- **IAM**: 서비스 어카운트용 OIDC 프로바이더 활성화

구성은 `cluster-config.yaml`에 정의되어 있습니다.

## 리소스 정리

불필요한 AWS 비용을 방지하기 위해 사용 후 반드시 리소스를 정리하세요:

1. 애플리케이션 먼저 삭제:
   ```bash
   ./deploy-eks-workload.sh delete-app
   ```

2. EKS 클러스터 삭제:
   ```bash
   ./deploy-eks-workload.sh delete-cluster
   ```

또는 통합 명령어 사용:
```bash
./deploy-eks-workload.sh delete-all
```

AWS 콘솔에서 정리 확인:
- EKS 클러스터 삭제 여부
- EC2 인스턴스 종료 여부
- Load Balancer 제거 여부
- CloudFormation 스택 삭제 여부

## K8s 진단 에이전트 연동

이 워크로드는 K8s 진단 에이전트의 대상으로 설계되었습니다. 에이전트는 다음을 수행합니다:
- EKS 클러스터에 연결
- Pod 상태 및 성능 모니터링
- 컨테이너 로그 분석
- 이상 징후 및 문제 탐지
- 진단 결과 및 권장 사항 제공

## 문제 해결

**클러스터 생성 실패:**
- AWS 자격 증명 및 권한 확인
- `ssminji-wesang` 프로필 구성 여부 확인
- ap-northeast-2 리전의 서비스 할당량 확인

**애플리케이션 Pod 시작 안 됨:**
- `kubectl describe pod <pod-name>`으로 상세 정보 확인
- `kubectl get events`로 에러 메시지 확인
- `kubectl top nodes`로 노드 용량 확인

**LoadBalancer URL 미확인:**
- AWS가 LoadBalancer를 프로비저닝할 때까지 잠시 대기
- `./deploy-eks-workload.sh status`로 다시 확인
- 보안 그룹에서 HTTP 트래픽 허용 여부 확인

**비용 관련:**
- EKS 클러스터: 시간당 약 $0.10
- m5.large 인스턴스: 노드당 시간당 약 $0.10 (2개 노드)
- 예상 총 비용: 시간당 약 $0.30
- 미사용 시 반드시 리소스 삭제
