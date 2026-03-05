import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ObservabilityConstructProps {
  prodVpc: ec2.Vpc;
  stagingVpc: ec2.Vpc;
  sharedVpc: ec2.Vpc;
}

export class ObservabilityConstruct extends Construct {
  constructor(scope: Construct, id: string, props: ObservabilityConstructProps) {
    super(scope, id);

    // IAM role for VPC Flow Logs
    const flowLogsRole = new iam.Role(this, 'FlowLogsRole', {
      roleName: 'netaiops-flow-logs-role',
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
    });

    flowLogsRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
      ],
      resources: ['*'],
    }));

    const vpcs: Array<{ vpc: ec2.Vpc; name: string }> = [
      { vpc: props.prodVpc, name: 'prod' },
      { vpc: props.stagingVpc, name: 'staging' },
      { vpc: props.sharedVpc, name: 'shared' },
    ];

    for (const { vpc, name } of vpcs) {
      const logGroup = new logs.LogGroup(this, `${name}FlowLogGroup`, {
        logGroupName: `/vpc/netaiops-${name}-flow-logs`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new ec2.FlowLog(this, `${name}FlowLog`, {
        resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
        destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup, flowLogsRole),
        trafficType: ec2.FlowLogTrafficType.ALL,
        flowLogName: `netaiops-${name}-flow-log`,
      });
    }
  }
}
