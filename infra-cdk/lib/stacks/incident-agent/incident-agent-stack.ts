import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IncidentAgentCognitoStack } from './cognito-stack';
import { IncidentAgentLambdaStack } from './lambda-stack';
import { IncidentAgentGatewayStack } from './gateway-stack';
import { IncidentAgentRuntimeStack } from './runtime-stack';
import { IncidentAgentMonitoringStack } from './monitoring-stack';

/**
 * Incident Analysis Agent
 *
 * Deploys:
 * - Cognito (1 User Pool)
 * - IAM Roles (gateway execution + Lambda execution)
 * - 6 Docker Lambda functions
 * - MCP Gateway with Lambda targets
 * - AgentCore Runtime
 * - CloudWatch alarms + SNS (ap-northeast-2)
 */
export class IncidentAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new IncidentAgentCognitoStack(this, 'Cognito');

    // Lambdas (6 Docker functions)
    const lambdas = new IncidentAgentLambdaStack(this, 'Lambdas', {
      lambdaRole: cognito.lambdaRole,
    });

    // Gateway (Lambda targets)
    const gateway = new IncidentAgentGatewayStack(this, 'Gateway', {
      auth: cognito.auth,
      executionRoleArn: cognito.executionRole.roleArn,
      lambdas,
    });

    // Runtime
    const runtime = new IncidentAgentRuntimeStack(this, 'Runtime', {
      executionRoleArn: cognito.executionRole.roleArn,
    });

    // Monitoring (cross-region alarms + SNS)
    const monitoring = new IncidentAgentMonitoringStack(this, 'Monitoring', {
      alarmTriggerLambdaArn: lambdas.alarmTriggerLambda.fn.functionArn,
    });
  }
}
