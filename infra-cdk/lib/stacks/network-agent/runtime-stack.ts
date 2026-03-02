import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CONFIG } from '../../config';

export interface NetworkAgentRuntimeStackProps {
  executionRoleArn: string;
}

/**
 * Network Agent Runtime - AgentCore Runtime for the Network Diagnostics Agent.
 */
export class NetworkAgentRuntimeStack extends Construct {
  public readonly runtimeArn: string;

  constructor(scope: Construct, id: string, props: NetworkAgentRuntimeStackProps) {
    super(scope, id);

    const cfg = CONFIG.networkAgent;

    const runtime = new cdk.CfnResource(this, 'Runtime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        RuntimeName: cfg.runtime.name,
        RoleArn: props.executionRoleArn,
        Description: 'Network Diagnostics Agent Runtime',
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC',
        },
      },
    });

    this.runtimeArn = runtime.getAtt('RuntimeArn').toString();

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
