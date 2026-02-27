# NetAIOps Agent

AWS Bedrock AgentCore 기반 AI 네트워크/인프라 운영 에이전트

## 아키텍처

![NetAIOps 전체 아키텍처](docs/full-architecture.png)

## 에이전트

### k8s-agent
EKS 클러스터 진단 에이전트. MCP Gateway를 통한 Kubernetes 리소스 관리, Pod 트러블슈팅, CloudWatch 메트릭 조회, VPC 네트워킹 분석을 수행합니다.

### incident-agent
자동화된 장애 조사 에이전트. 다중 옵저버빌리티 소스(Datadog, OpenSearch, Container Insights) 통합으로 근본 원인을 분석하고, GitHub 이슈를 생성하며, 알려진 장애 시나리오를 자동 복구합니다.

### istio-agent
Istio 서비스 메시 진단 에이전트. 트래픽 관리, Fault Injection 분석, Prometheus 메트릭 상관 분석을 수행합니다.

## 프로젝트 구조

```
netaiops-agent/
├── app/                    # React + Flask 통합 UI
├── docs/                   # 아키텍처 및 배포 문서
├── infra-cdk/              # CDK 인프라
├── sample-workloads/       # 테스트 워크로드
│   ├── retail-store/       #   EKS Retail Store 샘플 앱
│   └── istio-sample/       #   Istio Bookinfo 샘플 앱
└── agents/
    ├── k8s-agent/          # K8s 진단 에이전트
    │   ├── agent/          #   에이전트 소스코드
    │   └── prerequisite/   #   EKS MCP Server + Cognito 설정
    ├── incident-agent/     # 장애 분석 에이전트
    │   ├── agent/          #   에이전트 소스코드
    │   └── prerequisite/   #   Lambda 함수 + Cognito 설정
    └── istio-agent/        # Istio 메시 에이전트
        ├── agent/          #   에이전트 소스코드
        └── prerequisite/   #   Lambda 함수 + Cognito 설정
```

## 사전 요구 사항

- Bedrock AgentCore 접근 가능한 AWS 계정
- EKS 클러스터 (`sample-workloads/retail-store/` 참조)
- 에이전트별 Cognito User Pool (`agents/*/prerequisite/` 참조)
- 에이전트 설정을 위한 SSM Parameter Store 항목

## 샘플 워크로드

에이전트의 진단/모니터링 대상이 되는 워크로드입니다.

| 워크로드 | 설명 | 필수 에이전트 |
|---------|------|-------------|
| [retail-store](sample-workloads/retail-store/) | EKS Retail Store 마이크로서비스 앱 | K8s Agent, Incident Agent (권장) |
| [istio-sample](sample-workloads/istio-sample/) | Istio Bookinfo 샘플 앱 | Istio Agent (필수) |

## 문서

| 문서 | 설명 |
|------|------|
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | 전체 배포 가이드 (EKS, 에이전트, Istio) |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 아키텍처 상세 |
| [COGNITO.md](docs/COGNITO.md) | Cognito User Pool 및 인증 흐름 |
