# NetAIOps Agent

AWS Bedrock AgentCore 기반 네트워크/인프라 진단 에이전트 모음 (K8s, Incident, Istio).

## Build

```bash
cd infra-cdk && npx tsc --noEmit
```

## Deploy

```bash
cd infra-cdk
npx cdk deploy --profile ssminji-wesang <StackName>
```

배포는 반드시 `ssminji-wesang` 프로필을 사용한다.

## Project Structure

- `agents/` — 에이전트 소스코드 (k8s-agent, incident-agent, istio-agent)
- `infra-cdk/` — CDK 인프라 스택
  - `bin/netaiops-infra.ts` — CDK 앱 엔트리포인트
  - `lib/config.ts` — 공유 설정 (계정, 리전, 에이전트별 config, tool schemas)
  - `lib/constructs/` — 재사용 CDK construct (CognitoAuth, McpGateway, DockerLambda)
  - `lib/stacks/{k8s,incident,istio}-agent/` — 에이전트별 CDK 스택
  - `agent-src/` — 에이전트 소스 심링크
  - `lambda-src/` — 람다 소스 심링크

## Conventions

- CDK 스택 구성 순서: Cognito → Lambda → Gateway → Runtime
- 설정은 `lib/config.ts`에 중앙 집중
- 심링크로 `agents/` 소스를 `infra-cdk/` 하위에서 참조
- 스택 파일은 `lib/stacks/<agent-name>/` 디렉토리에 배치

## Git

커밋 메시지에 footer를 작성하지 않는다.
