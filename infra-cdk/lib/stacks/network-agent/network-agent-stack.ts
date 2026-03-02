import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkAgentCognitoStack } from './cognito-stack';
import { NetworkAgentLambdaStack } from './lambda-stack';

/**
 * Network Diagnostics Agent
 *
 * Deploys via CDK:
 * - Cognito (Dual Pool: AgentPool + RuntimePool)
 * - IAM Roles (gateway execution + Lambda execution)
 * - 2 Docker Lambda functions (dns, network-metrics)
 * - SSM Parameters
 *
 * Deployed separately via AgentCore CLI:
 * - Network MCP Server Runtime
 * - MCP Gateway + OAuth2CredentialProvider
 * - Agent Runtime
 */
export class NetworkAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new NetworkAgentCognitoStack(this, 'Cognito');

    // Lambdas (2 Docker functions)
    const lambdas = new NetworkAgentLambdaStack(this, 'Lambdas', {
      lambdaRole: cognito.lambdaRole,
    });
  }
}
