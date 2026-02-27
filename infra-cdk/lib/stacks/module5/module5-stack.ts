import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Module5CognitoStack } from './cognito-stack';
import { Module5GatewayStack } from './gateway-stack';
import { Module5RuntimeStack } from './runtime-stack';

/**
 * Module 5: K8s Diagnostics Agent
 *
 * Deploys:
 * - Cognito (Agent + Runtime User Pools)
 * - IAM Execution Role
 * - MCP Gateway with mcpServer target
 * - AgentCore Runtime
 */
export class Module5Stack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new Module5CognitoStack(this, 'Cognito');

    // Gateway (depends on Cognito for auth config)
    const gateway = new Module5GatewayStack(this, 'Gateway', {
      agentAuth: cognito.agentAuth,
      runtimeAuth: cognito.runtimeAuth,
      executionRoleArn: cognito.executionRole.roleArn,
    });

    // Runtime
    const runtime = new Module5RuntimeStack(this, 'Runtime', {
      executionRoleArn: cognito.executionRole.roleArn,
    });
  }
}
