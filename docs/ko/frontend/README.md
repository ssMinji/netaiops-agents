# 프론트엔드 가이드

## 개요

NetAIOps Web UI는 TypeScript와 Vite로 구축된 React 18 SPA입니다. AI 에이전트와 상호작용하기 위한 채팅 기반 인터페이스와 카오스 엔지니어링 및 fault injection을 위한 전문 컨트롤을 제공합니다.

## 기술 스택

- **React 18** with TypeScript
- **Vite** 빌드 도구
- **react-i18next** 국제화
- **react-markdown** + **remark-gfm** 메시지 렌더링

## 프로젝트 구조

```
app/frontend/src/
├── App.tsx              # Main router, state management
├── App.css              # Global styles
├── main.tsx             # React entry point + i18n init
├── types.ts             # TypeScript interfaces
├── api.ts               # Backend API client
├── components/
│   ├── HomePage.tsx     # Agent selection cards
│   ├── ChatPage.tsx     # Chat interface
│   ├── ChaosPanel.tsx   # Incident chaos controls
│   ├── FaultPanel.tsx   # Istio fault injection
│   ├── Dashboard.tsx    # AWS resource overview
│   └── AgentIcon.tsx    # Agent emoji rendering
└── i18n/
    ├── index.ts         # i18next configuration
    └── locales/
        ├── en.json      # English
        ├── ko.json      # Korean
        └── ja.json      # Japanese
```

## 주요 기능

### 국제화 (i18n)

자동 브라우저 감지와 함께 세 가지 언어를 지원합니다.

- **영어** (기본 fallback)
- **한국어** (ko)
- **일본어** (ja)

헤더의 언어 선택기를 통해 런타임 전환이 가능합니다. 선택은 `localStorage`에 저장됩니다.

번역 키는 다음을 포함합니다:
- 에이전트 이름 및 설명
- 시나리오 이름 및 프롬프트
- UI 레이블 및 버튼
- 후속 제안 칩

### 채팅 인터페이스

ChatPage 컴포넌트는 다음을 제공합니다.

- **실시간 스트리밍**: SSE 기반 응답 렌더링
- **마크다운 지원**: 구문 강조를 포함한 전체 GFM
- **모델 선택기**: 대화별로 Claude, Qwen, Nova 모델 간 전환
- **시나리오 빠른 링크**: 미리 구축된 진단 프롬프트
- **후속 칩**: 시나리오 응답 후 컨텍스트 인식 후속 제안
- **중앙 정렬 레이아웃**: 최대 너비 제약이 있는 중앙 채팅 입력

### 메시지 메트릭 푸터

각 에이전트 응답은 다음을 표시합니다.

```
┌─────────────────────────────────────┐
│ Tool Badges: [dns-resolve] [dns-check-health] │
│ TTFB 245ms · Total 3.2s                       │
│ In 1,234 tokens · Out 456 tokens               │
│ Cache Read 100 · Cache Write 50                │
└─────────────────────────────────────┘
```

- **도구 배지**: 응답 중 사용된 MCP 도구(렌치 아이콘)
- **타이밍**: Time To First Byte 및 총 응답 시간
- **토큰 사용량**: 입력/출력 토큰 수
- **캐시 메트릭**: 프롬프트 캐시 읽기/쓰기 토큰(캐싱 활성화 시)

### 에이전트별 패널

**ChaosPanel** (Incident Agent):
- 트리거/정리 버튼이 있는 4개의 카오스 시나리오
- 활성 카오스 상태 표시기
- 대량 정리 기능

**FaultPanel** (Istio Agent):
- 3가지 결함 유형(delay, abort, circuit-breaker)
- 개별 적용/제거 컨트롤
- 대량 정리 기능

### 대시보드

다음을 포함한 AWS 인프라 개요:
- 리전 전환기가 있는 다중 리전 지원
- VPC, EC2, Load Balancer, NAT Gateway 목록
- 리전별 데이터 캐싱(60초 TTL)

## 빌드 및 배포

```bash
# 개발
cd app/frontend
npm install
npm run dev

# 프로덕션 빌드
npm run build
# 출력: app/frontend/dist/ → app/backend/static/로 복사
```
