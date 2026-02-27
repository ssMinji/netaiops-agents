import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AlarmConfig {
  name: string;
  description: string;
  metricName: string;
  statistic: string;
  period: number;
  evaluationPeriods: number;
  datapointsToAlarm: number;
  threshold: number;
  comparisonOperator: string;
}

export interface CrossRegionAlarmProps {
  /** Region for SNS topic and CloudWatch alarms */
  alarmRegion: string;
  /** Region where the Lambda function is deployed */
  lambdaRegion: string;
  /** SNS topic name */
  snsTopicName: string;
  /** EKS cluster name for CloudWatch dimensions */
  clusterName: string;
  /** ARN of the alarm-trigger Lambda to subscribe */
  alarmTriggerLambdaArn: string;
  /** Alarm configurations */
  alarms: AlarmConfig[];
  /** SSM prefix for storing topic ARN */
  ssmPrefix: string;
}

/**
 * Custom Resource that creates SNS topic + CloudWatch alarms in the alarm region
 * and subscribes a Lambda function to the SNS topic for alarm triggering.
 */
export class CrossRegionAlarm extends Construct {
  public readonly snsTopicArn: string;

  constructor(scope: Construct, id: string, props: CrossRegionAlarmProps) {
    super(scope, id);

    // Custom Resource Lambda for cross-region operations
    const onEventHandler = new lambda.Function(this, 'Handler', {
      functionName: 'netaiops-cross-region-alarm-cr',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(this.getLambdaCode()),
    });

    // Grant permissions for cross-region SNS + CloudWatch operations
    onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'sns:CreateTopic',
          'sns:DeleteTopic',
          'sns:SetTopicAttributes',
          'sns:Subscribe',
          'sns:Unsubscribe',
          'sns:GetTopicAttributes',
          'sns:ListSubscriptionsByTopic',
        ],
        resources: ['*'],
      })
    );

    onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudwatch:PutMetricAlarm',
          'cloudwatch:DeleteAlarms',
          'cloudwatch:DescribeAlarms',
        ],
        resources: ['*'],
      })
    );

    onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:AddPermission', 'lambda:RemovePermission'],
        resources: [props.alarmTriggerLambdaArn],
      })
    );

    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler,
    });

    const customResource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        AlarmRegion: props.alarmRegion,
        LambdaRegion: props.lambdaRegion,
        SnsTopicName: props.snsTopicName,
        ClusterName: props.clusterName,
        AlarmTriggerLambdaArn: props.alarmTriggerLambdaArn,
        Alarms: JSON.stringify(props.alarms),
        AccountId: cdk.Aws.ACCOUNT_ID,
      },
    });

    this.snsTopicArn = customResource.getAttString('SnsTopicArn');

    // Store SNS topic ARN in SSM (in primary region)
    new ssm.StringParameter(this, 'SnsTopicArnParam', {
      parameterName: `${props.ssmPrefix}/sns_topic_arn`,
      stringValue: this.snsTopicArn,
    });
  }

  private getLambdaCode(): string {
    return `
import json
import boto3
import time

def handler(event, context):
    request_type = event['RequestType']
    props = event['ResourceProperties']

    alarm_region = props['AlarmRegion']
    lambda_region = props['LambdaRegion']
    sns_topic_name = props['SnsTopicName']
    cluster_name = props['ClusterName']
    alarm_trigger_lambda_arn = props['AlarmTriggerLambdaArn']
    alarms = json.loads(props['Alarms'])
    account_id = props['AccountId']

    sns_client = boto3.client('sns', region_name=alarm_region)
    cw_client = boto3.client('cloudwatch', region_name=alarm_region)
    lambda_client = boto3.client('lambda', region_name=lambda_region)

    if request_type == 'Create' or request_type == 'Update':
        # Create SNS topic
        topic_response = sns_client.create_topic(Name=sns_topic_name)
        sns_topic_arn = topic_response['TopicArn']

        # Set topic policy
        policy = {
            "Version": "2012-10-17",
            "Statement": [{
                "Sid": "AllowCloudWatchAlarms",
                "Effect": "Allow",
                "Principal": {"Service": "cloudwatch.amazonaws.com"},
                "Action": "SNS:Publish",
                "Resource": sns_topic_arn,
                "Condition": {
                    "ArnLike": {
                        "aws:SourceArn": f"arn:aws:cloudwatch:{alarm_region}:{account_id}:alarm:netaiops-*"
                    }
                }
            }]
        }
        sns_client.set_topic_attributes(
            TopicArn=sns_topic_arn,
            AttributeName='Policy',
            AttributeValue=json.dumps(policy)
        )

        # Add Lambda invoke permission
        try:
            lambda_client.add_permission(
                FunctionName=alarm_trigger_lambda_arn.split(':')[-1],
                StatementId='sns-alarm-invoke',
                Action='lambda:InvokeFunction',
                Principal='sns.amazonaws.com',
                SourceArn=sns_topic_arn,
            )
        except lambda_client.exceptions.ResourceConflictException:
            pass  # Permission already exists

        # Subscribe Lambda to SNS topic
        sns_client.subscribe(
            TopicArn=sns_topic_arn,
            Protocol='lambda',
            Endpoint=alarm_trigger_lambda_arn,
        )

        # Create CloudWatch alarms
        for alarm in alarms:
            cw_client.put_metric_alarm(
                AlarmName=alarm['name'],
                AlarmDescription=alarm['description'],
                Namespace='ContainerInsights',
                MetricName=alarm['metricName'],
                Dimensions=[{'Name': 'ClusterName', 'Value': cluster_name}],
                Statistic=alarm['statistic'],
                Period=alarm['period'],
                EvaluationPeriods=alarm['evaluationPeriods'],
                DatapointsToAlarm=alarm['datapointsToAlarm'],
                Threshold=alarm['threshold'],
                ComparisonOperator=alarm['comparisonOperator'],
                AlarmActions=[sns_topic_arn],
                OKActions=[sns_topic_arn],
                TreatMissingData='notBreaching',
            )

        return {
            'PhysicalResourceId': sns_topic_arn,
            'Data': {'SnsTopicArn': sns_topic_arn},
        }

    elif request_type == 'Delete':
        sns_topic_arn = event.get('PhysicalResourceId', '')
        if sns_topic_arn and sns_topic_arn.startswith('arn:aws:sns:'):
            # Delete alarms
            alarm_names = [a['name'] for a in alarms]
            try:
                cw_client.delete_alarms(AlarmNames=alarm_names)
            except Exception as e:
                print(f"Error deleting alarms: {e}")

            # Remove Lambda permission
            try:
                lambda_client.remove_permission(
                    FunctionName=alarm_trigger_lambda_arn.split(':')[-1],
                    StatementId='sns-alarm-invoke',
                )
            except Exception as e:
                print(f"Error removing permission: {e}")

            # Delete SNS topic
            try:
                sns_client.delete_topic(TopicArn=sns_topic_arn)
            except Exception as e:
                print(f"Error deleting topic: {e}")

        return {'PhysicalResourceId': sns_topic_arn or 'deleted'}
`;
  }
}
