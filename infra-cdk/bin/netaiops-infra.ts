#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { K8sAgentStack } from '../lib/stacks/k8s-agent/k8s-agent-stack';
import { IncidentAgentStack } from '../lib/stacks/incident-agent/incident-agent-stack';
import { IstioAgentStack } from '../lib/stacks/istio-agent/istio-agent-stack';
import { CONFIG } from '../lib/config';

const app = new cdk.App();
const env = { account: CONFIG.account, region: CONFIG.primaryRegion };

new K8sAgentStack(app, 'K8sAgentStack', {
  env,
  description: 'K8s Diagnostics Agent (Cognito, Gateway, Runtime)',
});

new IncidentAgentStack(app, 'IncidentAgentStack', {
  env,
  description: 'Incident Analysis Agent (Cognito, Lambdas, Gateway, Runtime, Monitoring)',
});

new IstioAgentStack(app, 'IstioAgentStack', {
  env,
  description: 'Istio Mesh Diagnostics Agent (Cognito, Lambdas, Gateway, Runtime)',
});
