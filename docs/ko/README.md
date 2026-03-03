# NetAIOps Agent Hub

AWS Bedrock AgentCore 기반 인프라 진단 플랫폼으로, 네트워크, 인시던트, Kubernetes, Istio 서비스 메시 분석을 위한 4개의 전문 AI 에이전트를 제공합니다.

## NetAIOps란?

NetAIOps(Network AI Operations)는 AI 에이전트를 통해 자율적인 인프라 진단을 제공하는 멀티 에이전트 시스템입니다. 각 에이전트는 다중 소스 관측 도구(Datadog, OpenSearch, Container Insights, CloudWatch)와 AWS 인프라 API를 통합하여 실시간 분석 및 권장 사항을 제공합니다.

## 주요 기능

- **자동 인시던트 조사**: 다중 소스 메트릭 상관 분석 및 근본 원인 추정
- **Kubernetes 진단**: EKS 클러스터 상태 모니터링, 파드/노드 분석, 리소스 관리
- **Istio 서비스 메시 분석**: mTLS 감사, 트래픽 라우팅 점검, 카나리 배포 분석
- **네트워크 진단**: VPC 토폴로지, DNS 확인, 플로우 로그 분석, 로드 밸런서 메트릭
- **카오스 엔지니어링**: CPU 스트레스, 에러 주입, 지연 주입, 파드 크래시 시뮬레이션
- **다국어 UI**: 영어, 한국어, 일본어 실시간 언어 전환 지원

## 아키텍처 개요

![아키텍처 개요](../architecture-overview.png)

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| AI 모델 | Claude (Opus 4.6, Sonnet 4.6), Qwen, Nova |
| 에이전트 프레임워크 | Strands SDK + Bedrock AgentCore |
| 백엔드 | FastAPI (Python) |
| 프론트엔드 | React 18 + TypeScript + Vite |
| 인프라 | AWS CDK (TypeScript) |
| 인증 | Amazon Cognito (M2M 클라이언트 자격 증명) |
| 관측성 | Datadog, OpenSearch, Container Insights, CloudWatch |

## 시작하기

1. [아키텍처](architecture/) - 시스템 설계 이해
2. [에이전트](agents/) - 각 AI 에이전트 소개
3. [배포](deployment/) - 플랫폼 배포
4. [프론트엔드](frontend/) - Web UI 기능
5. [백엔드](backend/) - API 레퍼런스
6. [트러블슈팅](troubleshooting/) - 일반적인 문제 및 해결
