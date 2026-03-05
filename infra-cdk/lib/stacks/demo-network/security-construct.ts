import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface SecurityConstructProps {
  prodVpc: ec2.Vpc;
  stagingVpc: ec2.Vpc;
  sharedVpc: ec2.Vpc;
}

export class SecurityConstruct extends Construct {
  // Production
  public readonly prodAlbSg: ec2.SecurityGroup;
  public readonly prodWebSg: ec2.SecurityGroup;
  public readonly prodAppSg: ec2.SecurityGroup;
  public readonly prodApiSg: ec2.SecurityGroup;
  public readonly prodCacheSg: ec2.SecurityGroup;
  public readonly prodNlbSg: ec2.SecurityGroup;

  // Staging
  public readonly stagingAlbSg: ec2.SecurityGroup;
  public readonly stagingWebSg: ec2.SecurityGroup;
  public readonly stagingAppSg: ec2.SecurityGroup;

  // Shared Services
  public readonly sharedMonitoringSg: ec2.SecurityGroup;
  public readonly sharedCiRunnerSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    const { prodVpc, stagingVpc, sharedVpc } = props;

    // --- Production Security Groups ---

    // ALB SG (internet-facing): 80/443 from anywhere
    this.prodAlbSg = new ec2.SecurityGroup(this, 'ProdAlbSg', {
      vpc: prodVpc,
      securityGroupName: 'netaiops-prod-alb-sg',
      description: 'Production internet-facing ALB',
      allowAllOutbound: false,
    });
    this.prodAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from internet');
    this.prodAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from internet');
    this.prodAlbSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'To web targets');

    // Web SG: 80 from ALB SG only
    this.prodWebSg = new ec2.SecurityGroup(this, 'ProdWebSg', {
      vpc: prodVpc,
      securityGroupName: 'netaiops-prod-web-sg',
      description: 'Production web tier',
      allowAllOutbound: false,
    });
    this.prodWebSg.addIngressRule(this.prodAlbSg, ec2.Port.tcp(80), 'HTTP from ALB');
    this.prodWebSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, APIs)');
    this.prodWebSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'To app tier');
    this.prodWebSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8443), 'To api tier');

    // NLB SG (internal): from VPC CIDRs
    this.prodNlbSg = new ec2.SecurityGroup(this, 'ProdNlbSg', {
      vpc: prodVpc,
      securityGroupName: 'netaiops-prod-nlb-sg',
      description: 'Production internal NLB',
      allowAllOutbound: false,
    });
    this.prodNlbSg.addIngressRule(ec2.Peer.ipv4('10.1.0.0/16'), ec2.Port.tcp(8080), 'From Prod VPC');
    this.prodNlbSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/16'), ec2.Port.tcp(8080), 'From Shared VPC');
    this.prodNlbSg.addIngressRule(ec2.Peer.ipv4('10.2.0.0/16'), ec2.Port.tcp(8080), 'From Staging VPC');
    this.prodNlbSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'To app targets');

    // App SG: 8080 from web SG + NLB SG
    this.prodAppSg = new ec2.SecurityGroup(this, 'ProdAppSg', {
      vpc: prodVpc,
      securityGroupName: 'netaiops-prod-app-sg',
      description: 'Production app tier',
      allowAllOutbound: false,
    });
    this.prodAppSg.addIngressRule(this.prodWebSg, ec2.Port.tcp(8080), 'From web tier');
    this.prodAppSg.addIngressRule(this.prodNlbSg, ec2.Port.tcp(8080), 'From NLB');
    this.prodAppSg.addIngressRule(ec2.Peer.ipv4('10.1.0.0/16'), ec2.Port.tcp(8080), 'From Prod VPC');
    this.prodAppSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, APIs)');
    this.prodAppSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6379), 'To cache tier');

    // API SG: 8443 from web SG
    this.prodApiSg = new ec2.SecurityGroup(this, 'ProdApiSg', {
      vpc: prodVpc,
      securityGroupName: 'netaiops-prod-api-sg',
      description: 'Production API tier',
      allowAllOutbound: false,
    });
    this.prodApiSg.addIngressRule(this.prodWebSg, ec2.Port.tcp(8443), 'From web tier');
    this.prodApiSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.tcp(8443), 'From all VPCs');
    this.prodApiSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, APIs)');
    this.prodApiSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6379), 'To cache tier');

    // Cache SG: 6379 from app + api SGs
    this.prodCacheSg = new ec2.SecurityGroup(this, 'ProdCacheSg', {
      vpc: prodVpc,
      securityGroupName: 'netaiops-prod-cache-sg',
      description: 'Production cache tier',
      allowAllOutbound: false,
    });
    this.prodCacheSg.addIngressRule(this.prodAppSg, ec2.Port.tcp(6379), 'From app tier');
    this.prodCacheSg.addIngressRule(this.prodApiSg, ec2.Port.tcp(6379), 'From api tier');
    this.prodCacheSg.addIngressRule(ec2.Peer.ipv4('10.1.0.0/16'), ec2.Port.tcp(6379), 'From Prod VPC');
    this.prodCacheSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM)');

    // --- Staging Security Groups ---

    // Staging ALB SG (internal): from VPC CIDRs
    this.stagingAlbSg = new ec2.SecurityGroup(this, 'StagingAlbSg', {
      vpc: stagingVpc,
      securityGroupName: 'netaiops-staging-alb-sg',
      description: 'Staging internal ALB',
      allowAllOutbound: false,
    });
    this.stagingAlbSg.addIngressRule(ec2.Peer.ipv4('10.2.0.0/16'), ec2.Port.tcp(80), 'From Staging VPC');
    this.stagingAlbSg.addIngressRule(ec2.Peer.ipv4('10.1.0.0/16'), ec2.Port.tcp(80), 'From Prod VPC');
    this.stagingAlbSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/16'), ec2.Port.tcp(80), 'From Shared VPC');
    this.stagingAlbSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'To web targets');

    // Staging Web SG
    this.stagingWebSg = new ec2.SecurityGroup(this, 'StagingWebSg', {
      vpc: stagingVpc,
      securityGroupName: 'netaiops-staging-web-sg',
      description: 'Staging web tier',
      allowAllOutbound: false,
    });
    this.stagingWebSg.addIngressRule(this.stagingAlbSg, ec2.Port.tcp(80), 'HTTP from ALB');
    this.stagingWebSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, APIs)');
    this.stagingWebSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'To app tier');

    // Staging App SG (shared for app, api, worker tiers)
    this.stagingAppSg = new ec2.SecurityGroup(this, 'StagingAppSg', {
      vpc: stagingVpc,
      securityGroupName: 'netaiops-staging-app-sg',
      description: 'Staging app/api/worker tier',
      allowAllOutbound: false,
    });
    this.stagingAppSg.addIngressRule(this.stagingWebSg, ec2.Port.tcp(8080), 'From web tier');
    this.stagingAppSg.addIngressRule(ec2.Peer.ipv4('10.2.0.0/16'), ec2.Port.tcp(8080), 'From Staging VPC');
    this.stagingAppSg.addIngressRule(ec2.Peer.ipv4('10.2.0.0/16'), ec2.Port.tcp(8443), 'API from Staging VPC');
    this.stagingAppSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.tcp(9090), 'Metrics from all VPCs');
    this.stagingAppSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, APIs)');

    // --- Shared Services Security Groups ---

    // Monitoring SG: 9090/3000/5044 from 10.0.0.0/8
    this.sharedMonitoringSg = new ec2.SecurityGroup(this, 'SharedMonitoringSg', {
      vpc: sharedVpc,
      securityGroupName: 'netaiops-shared-monitoring-sg',
      description: 'Shared services monitoring/tools/log-collector tier',
      allowAllOutbound: false,
    });
    this.sharedMonitoringSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.tcp(9090), 'Prometheus from all VPCs');
    this.sharedMonitoringSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.tcp(3000), 'Grafana from all VPCs');
    this.sharedMonitoringSg.addIngressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.tcp(5044), 'Log collector from all VPCs');
    this.sharedMonitoringSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, APIs)');
    this.sharedMonitoringSg.addEgressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.icmpPing(), 'ICMP to all VPCs');

    // CI Runner SG: outbound only (pulls from registries, pushes artifacts)
    this.sharedCiRunnerSg = new ec2.SecurityGroup(this, 'SharedCiRunnerSg', {
      vpc: sharedVpc,
      securityGroupName: 'netaiops-shared-ci-runner-sg',
      description: 'Shared services CI runner tier',
      allowAllOutbound: false,
    });
    this.sharedCiRunnerSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS outbound (SSM, registries)');
    this.sharedCiRunnerSg.addEgressRule(ec2.Peer.ipv4('10.0.0.0/8'), ec2.Port.tcp(8080), 'To app tiers across VPCs');
  }
}
