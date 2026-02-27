import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IstioAgentCognitoStack } from './cognito-stack';
import { IstioAgentLambdaStack } from './lambda-stack';
import { IstioAgentGatewayStack } from './gateway-stack';
import { IstioAgentRuntimeStack } from './runtime-stack';

/**
 * Istio Mesh Diagnostics Agent
 *
 * Deploys:
 * - Cognito (1 User Pool)
 * - IAM Roles (gateway execution + Lambda execution)
 * - 2 Docker Lambda functions (prometheus, fault)
 * - MCP Gateway with hybrid targets (mcpServer + Lambda)
 * - AgentCore Runtime
 *
 * Depends on K8s Agent stack (EKS MCP Server ARN + Runtime Pool OAuth2 credentials).
 */
export class IstioAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new IstioAgentCognitoStack(this, 'Cognito');

    // Lambdas (2 Docker functions)
    const lambdas = new IstioAgentLambdaStack(this, 'Lambdas', {
      lambdaRole: cognito.lambdaRole,
    });

    // Gateway (hybrid: mcpServer + Lambda targets)
    const gateway = new IstioAgentGatewayStack(this, 'Gateway', {
      auth: cognito.auth,
      executionRoleArn: cognito.executionRole.roleArn,
      prometheusLambdaArn: lambdas.prometheusLambda.fn.functionArn,
    });

    // Runtime
    const runtime = new IstioAgentRuntimeStack(this, 'Runtime', {
      executionRoleArn: cognito.executionRole.roleArn,
    });
  }
}
