import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CONFIG } from '../../config';

export interface K8sAgentRuntimeStackProps {
  executionRoleArn: string;
}

/**
 * K8s Agent Runtime - AgentCore Runtime for the K8s Diagnostics Agent.
 *
 * Uses CfnResource since the @aws-cdk/aws-bedrock-agentcore-alpha L2 construct
 * may not be available. Falls back to L1 CloudFormation resource.
 */
export class K8sAgentRuntimeStack extends Construct {
  public readonly runtimeArn: string;

  constructor(scope: Construct, id: string, props: K8sAgentRuntimeStackProps) {
    super(scope, id);

    const cfg = CONFIG.k8sAgent;

    // AgentCore Runtime via L1 CfnResource
    const runtime = new cdk.CfnResource(this, 'Runtime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        RuntimeName: cfg.runtime.name,
        RoleArn: props.executionRoleArn,
        Description: 'K8s Diagnostics Agent Runtime (Module 5)',
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC',
        },
      },
    });

    this.runtimeArn = runtime.getAtt('RuntimeArn').toString();

    // Store runtime ARN in SSM
    new ssm.StringParameter(this, 'RuntimeArnParam', {
      parameterName: `${cfg.ssmPrefix}/runtime_arn`,
      stringValue: this.runtimeArn,
    });

    new ssm.StringParameter(this, 'RuntimeNameParam', {
      parameterName: `${cfg.ssmPrefix}/runtime_name`,
      stringValue: cfg.runtime.name,
    });
  }
}
