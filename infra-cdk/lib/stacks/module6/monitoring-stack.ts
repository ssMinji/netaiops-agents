import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CrossRegionAlarm } from '../../constructs/cross-region-alarm';
import { CONFIG } from '../../config';

export interface Module6MonitoringStackProps {
  alarmTriggerLambdaArn: string;
}

/**
 * Module 6 Monitoring - Cross-region CloudWatch alarms + SNS in us-west-2.
 *
 * Creates via Custom Resource:
 * - SNS topic in us-west-2 (netaiops-incident-alarm-topic)
 * - 3 CloudWatch alarms (cpu-spike, pod-restarts, node-cpu-high)
 * - SNS subscription → alarm-trigger Lambda in us-east-1
 */
export class Module6MonitoringStack extends Construct {
  constructor(scope: Construct, id: string, props: Module6MonitoringStackProps) {
    super(scope, id);

    const cfg = CONFIG.module6;

    new CrossRegionAlarm(this, 'Alarms', {
      alarmRegion: CONFIG.alarmRegion,
      lambdaRegion: CONFIG.primaryRegion,
      snsTopicName: cfg.monitoring.snsTopicName,
      clusterName: CONFIG.eksClusterName,
      alarmTriggerLambdaArn: props.alarmTriggerLambdaArn,
      alarms: cfg.monitoring.alarms.map((a) => ({
        name: a.name,
        description: a.description,
        metricName: a.metricName,
        statistic: a.statistic,
        period: a.period,
        evaluationPeriods: a.evaluationPeriods,
        datapointsToAlarm: a.datapointsToAlarm,
        threshold: a.threshold,
        comparisonOperator: a.comparisonOperator,
      })),
      ssmPrefix: cfg.ssmPrefix,
    });
  }
}
