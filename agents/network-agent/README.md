# Network Agent

AWS 네트워크 인프라 진단 에이전트. VPC, Transit Gateway, Cloud WAN, Network Firewall, VPN, Route 53 DNS, CloudWatch 네트워크 메트릭을 분석한다.

## 구성요소

```
agents/network-agent/
├── agent/                          # Network Agent Runtime
│   ├── agent_config/
│   │   ├── agent.py                # NetworkAgent 클래스 (Strands Agent)
│   │   ├── agent_task.py           # 세션별 에이전트 생성/실행
│   │   ├── access_token.py         # Gateway OAuth2 토큰 획득
│   │   ├── context.py              # ContextVar 기반 세션 컨텍스트
│   │   ├── memory_hook_provider.py # AgentCore Memory 연동
│   │   ├── streaming_queue.py      # 스트리밍 응답 큐
│   │   └── utils.py                # SSM 파라미터 조회
│   ├── main.py                     # Bedrock AgentCore 엔트리포인트
│   └── Dockerfile
└── prerequisite/
    └── network-mcp-server/         # Network MCP Server Runtime
        ├── main.py                 # awslabs.aws-network-mcp-server 래퍼
        ├── Dockerfile
        └── requirements.txt
```

## 아키텍처

```
UI → Backend → Network Agent Runtime → MCP Gateway → ┬─ NetworkMcpServer (MCP Server)
                                                      ├─ NetworkMetricsTools (Lambda)
                                                      └─ DnsTools (Lambda)
```

- **NetworkMcpServer**: `awslabs.aws-network-mcp-server` 패키지. VPC, TGW, CloudWAN, Firewall, VPN, Flow Logs 등 ~27개 도구.
- **NetworkMetricsTools**: CloudWatch 네트워크 메트릭 Lambda (EC2, NAT GW, TGW, ELB, Flow Logs).
- **DnsTools**: Route 53 DNS Lambda (hosted zones, records, health checks, resolve).

## IAM 권한

### Network MCP Server Runtime 역할

MCP Server가 EC2/VPC API를 직접 호출하므로, **MCP Server의 실행 역할**에 다음 권한이 필요하다.
Agent Runtime 역할이 아닌 MCP Server Runtime 역할에 추가해야 한다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeRouteTables",
        "ec2:DescribeInternetGateways",
        "ec2:DescribeNatGateways",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeNetworkAcls",
        "ec2:DescribeVpcEndpoints",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DescribeVpcPeeringConnections",
        "ec2:DescribeTransitGateways",
        "ec2:DescribeTransitGatewayAttachments",
        "ec2:DescribeTransitGatewayRouteTables",
        "ec2:DescribeVpnConnections",
        "ec2:DescribeVpnGateways",
        "ec2:DescribeCustomerGateways",
        "ec2:DescribeFlowLogs",
        "ec2:DescribeAddresses",
        "ec2:DescribePrefixLists"
      ],
      "Resource": "*"
    }
  ]
}
```

CloudWatch Logs Insights (VPC Flow Logs 분석용):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:StartQuery",
        "logs:GetQueryResults",
        "logs:StopQuery",
        "logs:DescribeLogGroups",
        "logs:FilterLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:*:175678592674:log-group:/vpc/flowlogs/*",
        "arn:aws:logs:*:175678592674:log-group:/vpc/flowlogs/*:*"
      ]
    }
  ]
}
```

현재 역할: `AmazonBedrockAgentCoreSDKRuntime-us-east-1-094b8c1fa5`
인라인 정책:
- `EC2NetworkDescribeAccess` — EC2/VPC Describe 권한
- `CloudWatchLogsInsightsAccess` — Flow Logs 쿼리 권한

### Network Agent Runtime 역할

Agent가 SSM에서 설정값을 읽으므로 SSM 권한이 필요하다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:us-east-1:175678592674:parameter/app/network/*"
    }
  ]
}
```

현재 역할: `AmazonBedrockAgentCoreSDKRuntime-us-east-1-5f84276e36`
인라인 정책명: `SSMGetParameterAccess`

## 배포

```bash
# 1. MCP Server 배포
cd agents/network-agent/prerequisite/network-mcp-server
AWS_PROFILE=netaiops-deploy agentcore deploy

# 2. Agent Runtime 배포
cd agents/network-agent/agent
AWS_PROFILE=netaiops-deploy agentcore deploy

# 3. 배포 후 체크리스트 (CLAUDE.md 참조)
#    - JWT authorizer 재설정
#    - SSM 권한 확인
#    - Gateway 타겟 상태 확인 (READY)
```

## 의존성 주의사항

- `awslabs.aws-network-mcp-server`는 `fastmcp`에 의존한다. Dockerfile에서 `--no-deps`로 설치하므로 `requirements.txt`에 `fastmcp`를 명시해야 한다.
- `create_server()` 함수는 제거됨. 모듈 레벨의 `mcp` 인스턴스를 직접 import: `from awslabs.aws_network_mcp_server.server import mcp`
