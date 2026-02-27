import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Module6CognitoStack } from './cognito-stack';
import { Module6LambdaStack } from './lambda-stack';
import { Module6GatewayStack } from './gateway-stack';
import { Module6RuntimeStack } from './runtime-stack';
import { Module6MonitoringStack } from './monitoring-stack';

/**
 * Module 6: Incident Analysis Agent
 *
 * Deploys:
 * - Cognito (1 User Pool)
 * - IAM Roles (gateway execution + Lambda execution)
 * - 6 Docker Lambda functions
 * - MCP Gateway with Lambda targets
 * - AgentCore Runtime
 * - Cross-region CloudWatch alarms + SNS (us-west-2)
 */
export class Module6Stack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // Cognito + IAM
    const cognito = new Module6CognitoStack(this, 'Cognito');

    // Lambdas (6 Docker functions)
    const lambdas = new Module6LambdaStack(this, 'Lambdas', {
      lambdaRole: cognito.lambdaRole,
    });

    // Gateway (Lambda targets)
    const gateway = new Module6GatewayStack(this, 'Gateway', {
      auth: cognito.auth,
      executionRoleArn: cognito.executionRole.roleArn,
      lambdas,
    });

    // Runtime
    const runtime = new Module6RuntimeStack(this, 'Runtime', {
      executionRoleArn: cognito.executionRole.roleArn,
    });

    // Monitoring (cross-region alarms + SNS)
    const monitoring = new Module6MonitoringStack(this, 'Monitoring', {
      alarmTriggerLambdaArn: lambdas.alarmTriggerLambda.fn.functionArn,
    });
  }
}
