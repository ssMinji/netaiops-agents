#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { K8sAgentStack } from '../lib/stacks/k8s-agent/k8s-agent-stack';
import { IncidentAgentStack } from '../lib/stacks/incident-agent/incident-agent-stack';
import { IstioAgentStack } from '../lib/stacks/istio-agent/istio-agent-stack';
import { NetworkAgentStack } from '../lib/stacks/network-agent/network-agent-stack';
import { AnomalyAgentStack } from '../lib/stacks/anomaly-agent/anomaly-agent-stack';
import { DemoNetworkStack } from '../lib/stacks/demo-network/demo-network-stack';
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

new NetworkAgentStack(app, 'NetworkAgentStack', {
  env,
  description: 'Network Diagnostics Agent (Cognito, Lambdas, Gateway, Runtime)',
});

new AnomalyAgentStack(app, 'AnomalyAgentStack', {
  env,
  description: 'Anomaly Detection Agent (Cognito, Lambdas, Gateway, Runtime)',
});

new DemoNetworkStack(app, 'DemoNetworkStack', {
  env: { account: CONFIG.account, region: 'us-west-2' },
  description: 'Demo Network Infrastructure (3 VPCs, TGW, 8 EC2s, 3 LBs, Route 53, Flow Logs)',
});
