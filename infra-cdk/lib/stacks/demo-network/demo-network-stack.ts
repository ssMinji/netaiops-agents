import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { VpcConstruct } from './vpc-construct';
import { ConnectivityConstruct } from './connectivity-construct';
import { SecurityConstruct } from './security-construct';
import { ComputeConstruct } from './compute-construct';
import { DnsConstruct } from './dns-construct';
import { ObservabilityConstruct } from './observability-construct';

/**
 * Demo Network Infrastructure Stack (us-west-2)
 *
 * Enterprise-grade network topology for Network SA demos:
 * - 3 VPCs (Production, Staging, Shared Services)
 * - Transit Gateway + VPC Peering (dual connectivity)
 * - 36 EC2 instances across tiers (web, app, api, cache, worker, monitoring, tools, log-collector, ci-runner)
 * - 3 Load Balancers (ALB internet-facing, NLB internal, ALB internal)
 * - Route 53 private hosted zone + health checks
 * - VPC Flow Logs for all VPCs
 *
 * Deploy:  npx cdk deploy DemoNetworkStack --profile netaiops-deploy
 * Destroy: npx cdk destroy DemoNetworkStack --profile netaiops-deploy
 */
export class DemoNetworkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const azs = [`${this.region}a`, `${this.region}b`];

    // 1. VPCs + Subnets + NAT Gateways
    const vpcs = new VpcConstruct(this, 'Vpcs', {
      availabilityZones: azs,
    });

    // 2. Transit Gateway + VPC Peering + Route Tables
    const connectivity = new ConnectivityConstruct(this, 'Connectivity', {
      prodVpc: vpcs.prodVpc,
      stagingVpc: vpcs.stagingVpc,
      sharedVpc: vpcs.sharedVpc,
    });

    // 3. Security Groups
    const security = new SecurityConstruct(this, 'Security', {
      prodVpc: vpcs.prodVpc,
      stagingVpc: vpcs.stagingVpc,
      sharedVpc: vpcs.sharedVpc,
    });

    // 4. EC2 Instances (36) + Load Balancers (3)
    const compute = new ComputeConstruct(this, 'Compute', {
      prodVpc: vpcs.prodVpc,
      stagingVpc: vpcs.stagingVpc,
      sharedVpc: vpcs.sharedVpc,
      prodWebSg: security.prodWebSg,
      prodAppSg: security.prodAppSg,
      prodApiSg: security.prodApiSg,
      prodCacheSg: security.prodCacheSg,
      prodAlbSg: security.prodAlbSg,
      prodNlbSg: security.prodNlbSg,
      stagingWebSg: security.stagingWebSg,
      stagingAppSg: security.stagingAppSg,
      stagingAlbSg: security.stagingAlbSg,
      sharedMonitoringSg: security.sharedMonitoringSg,
      sharedCiRunnerSg: security.sharedCiRunnerSg,
    });

    // 5. Route 53 Private Hosted Zone + Health Checks
    new DnsConstruct(this, 'Dns', {
      prodVpc: vpcs.prodVpc,
      stagingVpc: vpcs.stagingVpc,
      sharedVpc: vpcs.sharedVpc,
      instances: compute.instances,
      prodAlb: compute.prodAlb,
      prodNlb: compute.prodNlb,
      stagingAlb: compute.stagingAlb,
    });

    // 6. VPC Flow Logs + CloudWatch Log Groups
    new ObservabilityConstruct(this, 'Observability', {
      prodVpc: vpcs.prodVpc,
      stagingVpc: vpcs.stagingVpc,
      sharedVpc: vpcs.sharedVpc,
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'ProdVpcId', { value: vpcs.prodVpc.vpcId });
    new cdk.CfnOutput(this, 'StagingVpcId', { value: vpcs.stagingVpc.vpcId });
    new cdk.CfnOutput(this, 'SharedVpcId', { value: vpcs.sharedVpc.vpcId });
    new cdk.CfnOutput(this, 'TransitGatewayId', { value: connectivity.transitGateway.ref });
    new cdk.CfnOutput(this, 'ProdAlbDns', { value: compute.prodAlb.loadBalancerDnsName });
  }
}
