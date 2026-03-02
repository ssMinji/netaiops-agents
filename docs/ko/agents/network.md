# 네트워크 진단 에이전트

## 목적

VPC 토폴로지, DNS 확인, Route 53 상태 확인, VPC Flow Log, 로드 밸런서 메트릭을 포괄하는 AWS 네트워크 인프라 분석. Network Agent는 포괄적인 네트워크 진단을 위해 AWS Network MCP Server와 커스텀 Lambda 도구를 통합합니다.

## 위치

```
agents/network-agent/
├── agent/                         # Agent runtime
└── prerequisite/
    ├── network-mcp-server/        # AWS Network MCP Server runtime
    ├── lambda-dns/                # Route 53 operations Lambda
    ├── lambda-network-metrics/    # CloudWatch network metrics Lambda
    └── deploy-network-mcp-server.sh
```

## MCP 도구

### AWS Network MCP Server (~27개 도구)
포괄적인 AWS 네트워킹 작업:
- VPC 토폴로지 및 연결 분석
- Transit Gateway 라우팅 검사
- Cloud WAN 진단
- Network Firewall 정책 분석
- VPN Site-to-Site 트러블슈팅
- Security Group 및 NACL 검토

### DNS 도구 (Lambda)
- `dns-list-hosted-zones` - Route 53 호스팅 영역 목록
- `dns-query-records` - 영역의 DNS 레코드 쿼리
- `dns-check-health` - Route 53 상태 확인 상태 체크
- `dns-resolve` - 공용 리졸버를 사용한 DNS 이름 확인

### 네트워크 메트릭 도구 (Lambda)
- `network-list-load-balancers` - 상세 정보를 포함한 ALB/NLB 목록
- `network-list-instances` - 네트워크 정보를 포함한 EC2 인스턴스 목록
- `network-get-metrics` - 네트워크 리소스의 CloudWatch 메트릭
- `network-get-flow-logs` - VPC Flow Log 분석

## 시나리오

| 시나리오 | 설명 |
|----------|-------------|
| DNS Diagnostics | DNS 확인 검증, Route 53 상태 확인 |
| VPC Configuration Analysis | VPC 토폴로지, 서브넷, 라우팅 테이블 검토 |
| Flow Logs Analysis | 거부/허용된 트래픽에 대한 VPC Flow Log 분석 |
| Load Balancer Metrics | ALB/NLB 상태, 요청 수, 에러율 |

## 사전 요구사항

### Network MCP Server

AWS Network MCP Server를 AgentCore 런타임으로 배포합니다.

```bash
cd agents/network-agent/prerequisite
./deploy-network-mcp-server.sh
```

`awslabs.aws-network-mcp-server` 패키지(버전 `0.0.x`) 사용.

### Lambda 함수

DNS 및 Network Metrics Lambda 함수는 Docker 기반 Lambda 함수로 CDK를 통해 배포됩니다.

```bash
cd infra-cdk
npx cdk deploy NetworkAgentLambdaStack --profile netaiops-deploy
```
