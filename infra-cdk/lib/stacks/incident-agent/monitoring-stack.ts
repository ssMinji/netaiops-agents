import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CrossRegionAlarm } from '../../constructs/cross-region-alarm';
import { CONFIG } from '../../config';

export interface IncidentAgentMonitoringStackProps {
  alarmTriggerLambdaArn: string;
}

/**
 * Incident Agent Monitoring - CloudWatch alarms + SNS.
 *
 * Creates via Custom Resource:
 * - SNS topic (netaiops-incident-alarm-topic)
 * - 3 CloudWatch alarms (cpu-spike, pod-restarts, node-cpu-high)
 * - SNS subscription → alarm-trigger Lambda
 */
export class IncidentAgentMonitoringStack extends Construct {
  constructor(scope: Construct, id: string, props: IncidentAgentMonitoringStackProps) {
    super(scope, id);

    const cfg = CONFIG.incidentAgent;

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
