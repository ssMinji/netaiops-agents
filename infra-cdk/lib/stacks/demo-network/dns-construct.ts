import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface DnsConstructProps {
  prodVpc: ec2.Vpc;
  stagingVpc: ec2.Vpc;
  sharedVpc: ec2.Vpc;
  instances: ec2.Instance[];
  prodAlb: elbv2.ApplicationLoadBalancer;
  prodNlb: elbv2.NetworkLoadBalancer;
  stagingAlb: elbv2.ApplicationLoadBalancer;
}

export class DnsConstruct extends Construct {
  public readonly hostedZone: route53.PrivateHostedZone;

  constructor(scope: Construct, id: string, props: DnsConstructProps) {
    super(scope, id);

    // Private hosted zone associated with all 3 VPCs
    this.hostedZone = new route53.PrivateHostedZone(this, 'PrivateZone', {
      zoneName: 'netaiops.internal',
      vpc: props.prodVpc,
    });
    this.hostedZone.addVpc(props.stagingVpc);
    this.hostedZone.addVpc(props.sharedVpc);

    // A records for each instance — derive DNS name from construct ID
    // e.g. ProdWeb01 → prod-web-01.netaiops.internal
    for (const instance of props.instances) {
      const logicalId = instance.node.id; // e.g., ProdWeb01
      const dnsName = this.logicalIdToDnsName(logicalId);
      if (dnsName) {
        new route53.ARecord(this, `Record${logicalId}`, {
          zone: this.hostedZone,
          recordName: dnsName,
          target: route53.RecordTarget.fromIpAddresses(
            instance.instancePrivateIp,
          ),
        });
      }
    }

    // CNAME records for load balancers
    new route53.CnameRecord(this, 'ProdWebCname', {
      zone: this.hostedZone,
      recordName: 'web.prod',
      domainName: props.prodAlb.loadBalancerDnsName,
    });

    new route53.CnameRecord(this, 'ProdAppCname', {
      zone: this.hostedZone,
      recordName: 'app.prod',
      domainName: props.prodNlb.loadBalancerDnsName,
    });

    new route53.CnameRecord(this, 'StagingWebCname', {
      zone: this.hostedZone,
      recordName: 'web.staging',
      domainName: props.stagingAlb.loadBalancerDnsName,
    });

    // Route 53 health checks on Prod ALB (public endpoint)
    new route53.CfnHealthCheck(this, 'ProdAlbHealthRoot', {
      healthCheckConfig: {
        type: 'HTTP',
        fullyQualifiedDomainName: props.prodAlb.loadBalancerDnsName,
        port: 80,
        resourcePath: '/',
        requestInterval: 30,
        failureThreshold: 3,
      },
      healthCheckTags: [{ key: 'Name', value: 'netaiops-prod-alb-root' }],
    });

    new route53.CfnHealthCheck(this, 'ProdAlbHealthPath', {
      healthCheckConfig: {
        type: 'HTTP',
        fullyQualifiedDomainName: props.prodAlb.loadBalancerDnsName,
        port: 80,
        resourcePath: '/health',
        requestInterval: 30,
        failureThreshold: 3,
      },
      healthCheckTags: [{ key: 'Name', value: 'netaiops-prod-alb-health' }],
    });
  }

  /**
   * Convert construct logical ID to DNS record name.
   * ProdWeb01 → prod-web-01
   * SharedLogCollector02 → shared-log-collector-02
   * StagingWorker01 → staging-worker-01
   */
  private logicalIdToDnsName(logicalId: string): string {
    // Insert hyphens before uppercase letters, then lowercase
    // ProdWeb01 → Prod-Web-01 → prod-web-01
    const hyphenated = logicalId
      .replace(/([a-z])([A-Z])/g, '$1-$2')   // camelCase boundary
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2') // acronym boundary
      .replace(/(\D)(\d)/g, '$1-$2')           // letter-digit boundary
      .toLowerCase();
    return hyphenated;
  }
}
