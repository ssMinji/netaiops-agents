import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { K8sAgentCognitoStack } from './cognito-stack';
import { K8sAgentGatewayStack } from './gateway-stack';
import { K8sAgentRuntimeStack } from './runtime-stack';

/**
 * K8s Diagnostics Agent
 *
 * Deploys:
 * - Cognito (Agent + Runtime User Pools)
 * - IAM Execution Role
 * - MCP Gateway with mcpServer target
 * - AgentCore Runtime
 */
export class K8sAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new K8sAgentCognitoStack(this, 'Cognito');

    // Gateway (depends on Cognito for auth config)
    const gateway = new K8sAgentGatewayStack(this, 'Gateway', {
      agentAuth: cognito.agentAuth,
      runtimeAuth: cognito.runtimeAuth,
      executionRoleArn: cognito.executionRole.roleArn,
    });

    // Runtime
    const runtime = new K8sAgentRuntimeStack(this, 'Runtime', {
      executionRoleArn: cognito.executionRole.roleArn,
    });
  }
}
