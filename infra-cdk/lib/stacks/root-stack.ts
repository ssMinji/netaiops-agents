import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Module5Stack } from './module5/module5-stack';
import { Module6Stack } from './module6/module6-stack';

/**
 * Root Stack - Orchestrates Module 5 and Module 6 as nested stacks.
 *
 * Deploy with: cdk deploy --all --profile netaiops-deploy
 */
export class RootStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Module 5: K8s Diagnostics Agent
    new Module5Stack(this, 'Module5', {
      description: 'Module 5 - K8s Diagnostics Agent (Cognito, Gateway, Runtime)',
    });

    // Module 6: Incident Analysis Agent
    new Module6Stack(this, 'Module6', {
      description: 'Module 6 - Incident Analysis Agent (Cognito, Lambdas, Gateway, Runtime, Monitoring)',
    });
  }
}
