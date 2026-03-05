import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AnomalyAgentCognitoStack } from './cognito-stack';
import { AnomalyAgentLambdaStack } from './lambda-stack';
import { AnomalyAgentGatewayStack } from './gateway-stack';
/**
 * Anomaly Detection Agent
 *
 * Deploys:
 * - Cognito (1 User Pool)
 * - IAM Roles (gateway execution + Lambda execution)
 * - 2 Docker Lambda functions (CloudWatch Anomaly + Network Anomaly)
 * - MCP Gateway (targets added post-deploy via boto3)
 *
 * Note: AgentCore Runtime is deployed separately via `agentcore deploy` CLI.
 * Note: Gateway Lambda targets are added via boto3 create_gateway_target API.
 */
export class AnomalyAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new AnomalyAgentCognitoStack(this, 'Cognito');

    // Lambdas (2 Docker functions)
    const lambdas = new AnomalyAgentLambdaStack(this, 'Lambdas', {
      lambdaRole: cognito.lambdaRole,
    });

    // Gateway (gateway only; Lambda targets added post-deploy via boto3)
    const gateway = new AnomalyAgentGatewayStack(this, 'Gateway', {
      auth: cognito.auth,
      executionRoleArn: cognito.executionRole.roleArn,
    });
  }
}
