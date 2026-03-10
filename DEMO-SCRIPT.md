# NetAIOps Agent Hub — 7-min Live Demo Script

> **Opening (EN):**
> "Thank you, so now let me show you how everything we just discussed actually works — through a live demo."
>
> **Opening (KO):**
> "안녕하세요, 지금까지 설명드린 내용이 실제로 어떻게 동작하는지, 라이브 데모를 통해 보여드리겠습니다."

---

## Pre-Demo Checklist

| # | Item | Detail |
|---|------|--------|
| 1 | Anomaly Report cache | Visit dashboard 5 min before demo so the report is pre-cached (streaming takes 1-2 min) / 데모 5분 전 대시보드 방문하여 Anomaly Report 캐시 채우기 |
| 2 | Chaos cleanup | Ensure no leftover chaos pods — click "Cleanup All" in Incident Agent if needed / 잔여 chaos 파드 정리 |
| 3 | Language | English (global audience) / 영어 설정 |
| 4 | Model | Claude Sonnet 4.6 (best speed-quality balance) |
| 5 | Browser | Single tab, no dev tools open / 탭 하나, 개발자 도구 닫기 |

---

## Phase 1 — Dashboard Overview (1:30)

**[Screen: Login → Dashboard auto-loads]**

> **EN:** "For this demo, we built a multi-VPC network environment — 3 VPCs connected via Transit Gateway, 4 ALB/NLBs, 4 NAT Gateways, and 36 EC2 instances generating live traffic. The same Transit Gateway and multi-VPC patterns that came up in the Yogiyo and Bithumb cases."
>
> **KO:** "데모를 위해 멀티 VPC 네트워크 환경을 구성했습니다 — Transit Gateway로 연결된 3개 VPC, ALB/NLB 4개, NAT Gateway 4개, EC2 36대가 실시간 트래픽을 생성하고 있습니다. 앞서 Yogiyo, Bithumb 사례에서 언급된 Transit Gateway, 멀티 VPC 구조를 반영했습니다."

### Point 1: Summary Cards (5s)

- 3 VPCs, 36 EC2s, 4 LBs, 4 NAT GWs — resource overview at a glance.

### Point 2: CloudWatch Metric Charts (20s)

- EC2 Network Traffic — aggregate inbound/outbound trends
- ALB Performance — request count + response time (point out 5XX spikes if visible)
- NAT Gateway — active connections + egress bytes
- Transit Gateway — inter-VPC traffic flows

> **EN:** "These four charts cover EC2 throughput, ALB health, NAT Gateway egress, and Transit Gateway inter-VPC flows — all pulled from CloudWatch automatically. No manual dashboard setup. You open the page and the current state of the network is right there. To make the charts realistic for this demo, we have traffic generators running on CI runner instances — they send HTTP requests across VPCs, hit the ALBs, and make external calls through the NAT Gateways, with varying load patterns and periodic burst spikes."
>
> **KO:** "이 네 개 차트가 EC2 처리량, ALB 상태, NAT Gateway 이그레스, Transit Gateway VPC 간 트래픽을 보여줍니다 — 전부 CloudWatch에서 자동으로 수집됩니다. 대시보드를 수동으로 구성할 필요 없이, 페이지를 열면 네트워크 현황이 바로 보입니다. 차트에 보이는 트래픽은 데모용으로 CI Runner 인스턴스에서 생성하고 있습니다 — VPC 간 HTTP 요청, ALB 호출, NAT Gateway를 통한 외부 통신을 부하 패턴과 주기적 스파이크를 섞어서 보내고 있습니다."

### Point 3: Anomaly Detection Report (1 min)

- Scroll down → cached report displays instantly.

> **EN:** "Before we go into each agent, take a look at this. The Anomaly Detection Agent runs automatically when the dashboard loads — no user query needed. It scans CloudWatch metric anomalies, VPC Flow Logs, and ELB status changes all at once, and surfaces the results right here on the dashboard. Since the report is already cached from earlier, we can see the full analysis immediately without waiting."
>
> **KO:** "각 에이전트 설명에 들어가기 전에 이걸 먼저 보겠습니다. Anomaly Detection Agent는 사용자가 질의하지 않아도 대시보드 진입 시 자동으로 네트워크 분석을 수행합니다. CloudWatch 메트릭 이상탐지, VPC Flow Logs, ELB 상태 변화를 한번에 분석해서 대시보드에 바로 표시합니다. 현재는 분석 결과가 캐시되어 있기 때문에 기다릴 필요 없이 바로 결과를 확인할 수 있습니다."

Walk through 3 key findings:

1. **CRITICAL — EKS Pod CPU saturated at 95.7%**

   > **EN:** "It detects down to the container level."
   > **KO:** "컨테이너 레벨 이상까지 탐지합니다."

2. **HIGH — prod-alb 5XX errors surged 3,000%**

   > **EN:** "It auto-discovers the ALB ARN suffix and queries the exact metric."
   > **KO:** "ALB ARN suffix를 자동으로 식별해서 정확한 메트릭을 조회합니다."

3. **MEDIUM — NAT GW + TGW simultaneous spike**

   > **EN:** "At 15:49, Prod NAT GW spiked, Shared NAT GW dipped, TGW burst — three events correlated on the same timeline."
   > **KO:** "15:49에 Prod NAT GW 스파이크, Shared NAT GW 동시 감소, TGW burst — 세 이벤트를 시간축으로 상관분석합니다."

> **EN:** "This is the key point — as we saw in the slides: 'Something is wrong, but we don't know what, where, or why.' This agent finds the what, where, and why automatically."
>
> **KO:** "핵심은 이겁니다. 슬라이드에서 보신 것처럼 'Something is wrong, but we don't know what, where, or why.' 이 에이전트가 what, where, why를 자동으로 찾아줍니다."

---

## Phase 2 — Anomaly Agent Deep Dive (2:00)

**[Click "Discuss in Chat" button → Navigate to Anomaly Agent chat]**

> **EN:** "From the report, you can dive deeper into suspicious items by chatting with the agent."
>
> **KO:** "리포트에서 의심되는 항목을 에이전트와 대화로 더 파고들 수 있습니다."

**Action: Click sidebar scenario "Flow Log Analysis"**

> **EN:** "Flow Log analysis is one of the most time-consuming tasks in network operations. Even in our 3-VPC demo environment, there are multiple log groups to correlate. The agent handles all of them in a single query."
>
> **KO:** "Flow Log 분석은 네트워크 운영에서 가장 시간이 많이 걸리는 작업 중 하나입니다. 지금 데모 환경만 해도 VPC 3개의 로그 그룹을 교차 분석해야 하는데, 에이전트가 한 번에 처리합니다."

The agent streams in real-time:
- Runs CloudWatch Logs Insights queries
- Analyzes rejected traffic patterns
- Identifies top talker IPs
- Detects port scan patterns

**While streaming, explain:**

> **EN:** "Right now the agent is calling the actual CloudWatch Logs Insights API to query VPC Flow Logs. This isn't a hardcoded dashboard — it dynamically analyzes based on whatever you ask."
>
> **KO:** "지금 에이전트가 실제 CloudWatch Logs Insights API를 호출해서 VPC Flow Logs를 쿼리하고 있습니다. 하드코딩된 대시보드가 아니라, 질문에 따라 동적으로 분석합니다."

When results appear, highlight:
- Top rejected source IPs and ports
- Traffic volume trends
- Any suspicious patterns (port scans, traffic spikes)

> **EN:** "The key point — you ask in natural language, and the agent figures out which log groups to query, what to correlate, and where to look."
>
> **KO:** "핵심은 이겁니다 — 자연어로 질문하면, 에이전트가 어떤 로그 그룹을 조회할지, 무엇을 상관분석할지, 어디를 봐야 할지 알아서 판단합니다."

---

## Phase 3 — Network Diagnostics Agent (1:30)

**[Click "Network Diagnostics Agent" in sidebar]**

> **EN:** "Now let's look at the Network Diagnostics Agent. The Anomaly Agent we just saw analyzes traffic patterns — Flow Logs, metric anomalies, what's happening right now. The Network Agent is different — it inspects the infrastructure itself. VPC configurations, routing tables, security group rules, DNS resolution. Think of it this way: the Anomaly Agent tells you 'something abnormal is happening,' while the Network Agent tells you 'here's what's misconfigured.'"
>
> **KO:** "이번에는 Network Diagnostics Agent를 보겠습니다. 방금 본 Anomaly Agent는 트래픽 패턴을 분석합니다 — Flow Logs, 메트릭 이상탐지, 지금 무슨 일이 일어나고 있는지. Network Agent는 다릅니다 — 인프라 자체를 점검합니다. VPC 구성, 라우팅 테이블, 보안 그룹 규칙, DNS 해석. 쉽게 말하면, Anomaly Agent는 '비정상적인 일이 일어나고 있다'를 알려주고, Network Agent는 '어디가 잘못 설정되어 있다'를 알려줍니다."

**Click scenario "VPC Config Analysis"** (show streaming start, don't wait for full result)

> **EN:** "It's now automatically analyzing VPC, subnets, routing tables, and security group rules. It also finds overly permissive security groups and unused network interfaces."
>
> **KO:** "지금 VPC, 서브넷, 라우팅 테이블, 보안 그룹 규칙을 자동으로 분석하고 있습니다. 과도하게 열린 보안 그룹, 미사용 네트워크 인터페이스 같은 것도 찾아냅니다."

**While streaming, transition to Incident Agent:**

> **EN:** "While this runs, let me show you one more agent — the Incident Agent. This one handles the full incident lifecycle."
>
> **KO:** "이게 실행되는 동안, 에이전트 하나를 더 보겠습니다 — Incident Agent입니다. 인시던트의 전체 라이프사이클을 처리합니다."

---

## Phase 4 — Incident Agent: Cause → Detect → Analyze → Ticket (2:00)

**[Click "Incident Analysis Agent" in sidebar]**

> **EN:** "This agent is designed for customers running EKS at scale — pod failures kind of incidents that happen daily across large clusters. It integrates Container Insights, OpenSearch logs, and GitHub to handle the full incident lifecycle. In a real customer environment, this would typically integrate with Jira — we used GitHub Issues here for the demo to keep things simple. Let's trigger a real incident and watch the agent work."
>
> **KO:** "이 에이전트는 EKS를 대규모로 운영하는 고객사를 위해 만들었습니다 — 파드 장애, CPU 스파이크, OOM Kill 같은, 대형 클러스터에서 매일 발생하는 인시던트를 다룹니다. Container Insights, OpenSearch 로그, GitHub을 통합해서 인시던트의 전체 라이프사이클을 처리합니다. 실제 고객 환경에서는 보통 Jira와 통합하지만, 데모 편의상 GitHub Issue로 구성했습니다. 실제 인시던트를 발생시키고 에이전트가 어떻게 처리하는지 보겠습니다."

### Step 1: Trigger a real incident (10s)

- Click **"Trigger Incident"** button → Select **"CPU Stress"**
- A chaos pod deploys to the EKS cluster, spiking CPU immediately.

> **EN:** "We just deployed a CPU stress pod to the live EKS cluster. This is a real incident — CloudWatch Container Insights will pick it up within a minute."
>
> **KO:** "지금 라이브 EKS 클러스터에 CPU 스트레스 파드를 배포했습니다. 실제 인시던트입니다 — CloudWatch Container Insights가 1분 내로 감지합니다."

### Step 2: Ask the agent to investigate (10s)

- Click sidebar scenario **"CPU Spike Analysis"**

> **EN:** "The agent now follows a 6-step automated workflow."
>
> **KO:** "에이전트가 6단계 자동화 워크플로우를 시작합니다."

### Step 3: Watch the agent work (1 min 30s — streaming)

The agent performs these steps in sequence:
1. Parses the incident description
2. **Creates a GitHub issue** automatically (with `incident`, `auto-analysis` labels)
3. Collects Container Insights metrics (pod CPU, node CPU, restarts)
4. Queries OpenSearch for correlated error logs
5. Correlates evidence across sources
6. **Posts analysis + remediation guide as a GitHub comment**

**While streaming, explain:**

> **EN:** "Notice what's happening — the agent just created a GitHub issue with severity labels. Now it's pulling pod-level CPU metrics from Container Insights and cross-referencing with application logs in OpenSearch. Everything is correlated automatically."
>
> **KO:** "지금 일어나는 걸 보세요 — 에이전트가 방금 GitHub Issue를 심각도 라벨과 함께 생성했습니다. 지금은 Container Insights에서 파드 레벨 CPU 메트릭을 가져오고, OpenSearch의 애플리케이션 로그와 교차 검증하고 있습니다. 모든 게 자동으로 상관분석됩니다."

When the agent finishes, highlight:
- The GitHub issue link (clickable in the response)
- Root cause identification: `chaos-cpu-stress` pod consuming resources
- Remediation commands: `kubectl delete`, resource limits recommendation

> **EN:** "From incident trigger to root cause analysis to a fully documented ticket — all automated. In this demo we triggered the incident manually, but in production this would be kicked off automatically by a CloudWatch alarm or EventBridge rule. And if you extend this with Jira integration, you can go further — auto-assign the right on-call engineer based on the affected service, and push the root cause analysis directly as a notification to the assignee. SREs start from a hypothesis, not from zero."
>
> **KO:** "인시던트 발생부터 근본 원인 분석, 완전히 문서화된 티켓까지 — 전부 자동화입니다. 데모에서는 인시던트를 수동으로 트리거했지만, 실제 환경에서는 CloudWatch 알람이나 EventBridge 규칙으로 자동 실행됩니다. 여기에 Jira 연동을 확장하면, 영향받는 서비스 기준으로 담당자를 자동 매핑하고, 근본 원인 분석 결과를 담당자에게 알림으로 바로 전달하는 것까지 가능합니다. SRE가 제로가 아니라 가설부터 시작할 수 있습니다."

### Step 4: Cleanup (10s)

- Click **"Cleanup All"** to remove the chaos pod.

> **EN:** "And we clean up. In production, this same workflow triggers automatically via CloudWatch alarms — no human needs to click anything."
>
> **KO:** "정리합니다. 프로덕션에서는 이 워크플로우가 CloudWatch 알람으로 자동 트리거됩니다 — 사람이 클릭할 필요가 없습니다."

---

## Closing

**Mention K8s / Istio agents** (point at sidebar, don't click)

> **EN:** "We also have a K8s Agent for EKS cluster diagnostics and an Istio Agent for service mesh — mTLS audits, canary deployments, latency hotspot detection. Today we focused on network and incident response, but the same pattern extends to containers and service mesh."
>
> **KO:** "K8s Agent로 EKS 클러스터 진단, Istio Agent로 서비스 메시 mTLS, 카나리 배포, 레이턴시 핫스팟 분석도 가능합니다. 오늘은 네트워크와 인시던트 대응 중심으로 보여드렸지만, 컨테이너 환경까지 동일한 패턴으로 커버합니다."

> **EN:** "Each of these agents is modular — you deploy only what you need. A customer focused on network operations can start with the Anomaly and Network Agents alone. Another running large EKS clusters can add the Incident Agent. Because everything runs on Bedrock AgentCore, there's no complex infrastructure to set up. And when you need new capabilities, you just attach a new tool as a Lambda function or API endpoint — the agent can use it immediately. This is the same platform available to every AWS customer."
>
> **KO:** "각 에이전트는 모듈 형태로 구성되어 있어서, 필요한 것만 골라 배포할 수 있습니다. 네트워크 운영이 중심인 고객사는 Anomaly Agent와 Network Agent만 시작할 수 있고, EKS를 대규모로 운영하는 곳은 Incident Agent를 추가하면 됩니다. Bedrock AgentCore 기반이기 때문에 복잡한 인프라 설정이 필요 없고, 새로운 기능이 필요하면 Lambda 함수나 API 엔드포인트 형태로 도구를 붙이기만 하면 에이전트가 바로 사용할 수 있습니다. 모든 AWS 고객이 사용할 수 있는 동일한 플랫폼입니다."

---

## Wrap Up — "What We Learned"

**[Switch to PPT — "What We Learned" slide]**

> **EN:** "Let me wrap up with three takeaways from building this."
>
> **KO:** "마무리로, 이걸 만들면서 얻은 세 가지 교훈을 정리하겠습니다."

### 1. Invisibility is the real problem, not complexity.

> **EN:** "Both customers had complex systems — but the real issue was that nobody could see inside them. The dashboard and agents we just showed are fundamentally about making the invisible visible."
>
> **KO:** "두 고객사 모두 복잡한 시스템을 운영하고 있었지만, 진짜 문제는 복잡성이 아니라 안이 보이지 않는다는 것이었습니다. 방금 보여드린 대시보드와 에이전트는 결국 보이지 않는 것을 보이게 만드는 것입니다."

### 2. AIOps starts in the mess — and network is always the first layer.

> **EN:** "You don't need a clean environment to start. Opaque traffic, scattered metrics, misaligned AZs — identifying these structural issues is often what AIOps does first. And the cleaner the environment gets, the faster the agents become."
>
> **KO:** "깔끔한 환경이 먼저 갖춰져야 하는 게 아닙니다. 불투명한 트래픽, 흩어진 메트릭, 정렬되지 않은 AZ — 이런 구조적 문제를 찾아내는 게 AIOps가 가장 먼저 하는 일입니다. 그리고 환경이 정리될수록 에이전트는 더 빨라집니다."

### 3. Start when the customer is already asking.

> **EN:** "The signal isn't 'is their environment ready?' — it's 'are they already asking where do we begin?' That's when you bring this in. The demo you saw today, the source code, everything is available — try it, fork it, adapt it for your customers."
>
> **KO:** "시작 시점은 '고객 환경이 준비됐는가?'가 아닙니다. '고객이 이미 어디서부터 시작하면 되냐고 묻고 있는가?' — 그게 신호입니다. 오늘 보신 데모와 소스 코드는 모두 공개되어 있습니다. 직접 사용해보시고, 고객 환경에 맞게 적용해보시기 바랍니다."

**[Point to links on slide]**

> **EN:** "The live demo is at bit.ly/netaiops, and the full source code is on GitLab. If you have any questions, I'll be around for the rest of the event — come find me or Hwikyoung. And a special thanks to Woohyung back in Korea, who helped us deliver this to customers. Thank you."
>
> **KO:** "라이브 데모는 bit.ly/netaiops에서, 소스 코드는 GitLab에서 확인하실 수 있습니다. 추가 질문이 있으시면 저와 휘경을 찾아주세요, 행사 끝까지 계속 있겠습니다. 그리고 고객사 딜리버리를 함께 서포트해준 한국의 우형에게도 스페셜 땡스를 전하고 싶습니다. 감사합니다."

---

## Timing Summary

| Phase | Time | Content |
|-------|------|---------|
| 1. Dashboard + Anomaly Report | 1:30 | Summary cards → Metric charts → Cached report walkthrough |
| 2. Anomaly Agent Chat | 2:00 | Flow Log analysis live streaming |
| 3. Network Agent | 1:30 | VPC Config Analysis → Anomaly vs Network Agent difference |
| 4. Incident Agent + Closing | 2:00 | CPU Chaos trigger → Auto-analysis → GitHub Issue → K8s/Istio mention → Closing |
| **Total** | **7:00** | |

---

## Demo Flow Diagram

```
Dashboard (auto-load)
  │
  ├─ Summary Cards ─── "Full picture"
  ├─ CloudWatch Charts ── "Real-time metrics"
  └─ Anomaly Report (cached) ── "Auto-detection"
        │
        └─ [Discuss in Chat] ──→ Anomaly Agent
                                    │
                                    └─ Flow Log Analysis ── "VPC traffic deep dive"

  Network Agent ←── [sidebar click]
        │
        └─ VPC Config Analysis ── "Infra config audit"
              (Anomaly = traffic patterns / Network = infrastructure config)

  Incident Agent ←── [sidebar click]
        │
        ├─ [Trigger Incident] → CPU Stress ── "Real incident"
        ├─ CPU Spike Analysis ── "6-step automated workflow"
        │     ├─ GitHub Issue creation
        │     ├─ Container Insights collection
        │     ├─ OpenSearch log correlation
        │     └─ Analysis + remediation → GitHub Comment
        └─ [Cleanup All] ── "Cleanup"

  Closing ── K8s / Istio mention + Key message
```

---

## Risk Mitigation

| Risk | Response (EN) | Response (KO) |
|------|---------------|---------------|
| Agent response slow | "It's calling real APIs, so it takes a moment. In production, Prompt Caching makes it ~40% faster." → Point to Incident Agent (Cached) | "실제 API를 호출하기 때문에 시간이 좀 걸립니다. 프로덕션에서는 Prompt Caching으로 40% 정도 빨라집니다." → Incident Agent (Cached) 가리키기 |
| Chaos pod doesn't trigger fast enough | "Container Insights has a ~60s collection interval. The agent queries the latest available data." Move on with analysis. | "Container Insights 수집 주기가 약 60초입니다. 에이전트가 최신 데이터를 조회합니다." 분석으로 넘어가기. |
| GitHub Issue creation fails | "The GitHub integration uses PAT tokens stored in SSM. In this demo environment..." → Show the analysis portion instead. | "GitHub 연동은 SSM에 저장된 PAT 토큰을 사용합니다. 데모 환경에서..." → 분석 부분만 보여주기. |
| 5XX / Error | "Demo environment — occasional hiccups." → Fall back to cached anomaly report. | "데모 환경이라 간혹 이런 경우가 있습니다." → 캐시된 anomaly report로 커버. |
| Running over time | Cut Phase 4 short — skip Incident Agent live demo, go straight to closing. | Phase 4 축소 — Incident Agent 라이브 건너뛰고 마무리 멘트로 직행. |
| Audience asks about model cost | "Claude Sonnet 4.6 — about $3/1M input tokens. A full anomaly scan costs roughly $0.02-0.05 per run." | "Claude Sonnet 4.6 기준 입력 100만 토큰당 약 $3. 이상탐지 1회 실행 비용은 약 $0.02-0.05 수준입니다." |

---

## Key Messages to Reinforce

| # | Message (EN) | Message (KO) |
|---|-------------|-------------|
| 1 | "SREs start from a hypothesis, not from zero." (Slide 8) | "SRE가 제로가 아니라 가설부터 시작합니다." |
| 2 | "Natural language in, root cause out." | "자연어로 질문하면, 근본 원인이 나옵니다." |
| 3 | "Same platform, any layer — network, container, service mesh." | "같은 플랫폼, 어떤 레이어든 — 네트워크, 컨테이너, 서비스 메시." |
| 4 | "AIOps doesn't need a perfect environment — just a starting point." (Slide 7) | "AIOps는 완벽한 환경이 필요 없습니다 — 시작점만 있으면 됩니다." |
