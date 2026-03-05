# Demo Traffic Generator

Generates realistic, varied network traffic across the DemoNetworkStack infrastructure (us-west-2) to populate CloudWatch dashboard charts with meaningful data for demos.

## Architecture

The traffic generator runs as a **systemd service** on the 4 Shared VPC CI Runner instances. These instances have network reachability to all VPCs via Transit Gateway and Peering, and can reach the internet through NAT Gateways.

```
shared-ci-runner-01 (10.0.2.189)  ──┐
shared-ci-runner-02 (10.0.3.12)   ──┤── Traffic ──▶  Prod VPC (10.1.x.x)
shared-ci-runner-03 (10.0.2.245)  ──┤              ▶  Staging VPC (10.2.x.x)
shared-ci-runner-04 (10.0.3.201)  ──┘              ▶  External (NAT GW)
```

## Traffic Patterns

| Pattern | Interval | Description | Dashboard Chart |
|---------|----------|-------------|-----------------|
| Base traffic | ~5s | Round-robin HTTP requests to all tiers (web, app, api) | EC2 Network Traffic |
| ALB wave | ~5s | Sine-wave concurrency (3-12 concurrent) against Prod & Staging ALBs | ALB Performance |
| NAT GW egress | 30s | External URL downloads (httpbin, aws.amazon.com, GitHub API) | NAT Gateway |
| Cross-VPC sweep | 2min | Full instance sweep across Prod/Staging/Shared VPCs via TGW | Transit Gateway |
| Burst spike | 15min | 30-second high-concurrency burst (10x normal) | All charts |
| Payload variation | 15s | POST requests with 512B-100KB random payloads | EC2 Network Traffic |
| Error injection | 5% | Requests to non-existent paths for 404/5XX responses | ALB Performance |

### Wave Pattern

Concurrency follows a sine-wave approximation based on minute-of-hour:

- **Peak** (minutes 0-7, 23-29, 30-37, 53-59): 4x multiplier (12 concurrent)
- **Rising/Falling** (minutes 8-11, 19-22, 38-41, 49-52): 3x multiplier (9 concurrent)
- **Trough** (minutes 12-18, 42-48): 1x multiplier (3 concurrent)

## Targets

### Load Balancers

| Name | DNS | Type |
|------|-----|------|
| Prod ALB | `netaiops-prod-alb-1195765903.us-west-2.elb.amazonaws.com` | Application (internet-facing) |
| Staging ALB | `internal-netaiops-staging-alb-524711584.us-west-2.elb.amazonaws.com` | Application (internal) |
| Prod NLB | `netaiops-prod-nlb-71b3e7a39e3ecf8c.elb.us-west-2.amazonaws.com` | Network (internal) |

### Internal Instances

- **Prod VPC** (10.1.x.x): 4 web, 6 app, 4 api, 2 cache = 16 instances
- **Staging VPC** (10.2.x.x): 3 web, 3 app, 2 api, 2 worker = 10 instances
- **Shared VPC** (10.0.x.x): 2 monitoring, 2 log-collector, 2 tools = 6 instances

### External URLs (NAT GW)

`aws.amazon.com`, `httpbin.org/bytes/*`, `api.github.com`, `example.com`, `ifconfig.me`, `checkip.amazonaws.com`

## Deployment

Deploy via SSM Run Command:

```bash
aws ssm send-command \
  --targets '[{"Key":"tag:Name","Values":["netaiops-shared-ci-runner-01","netaiops-shared-ci-runner-02","netaiops-shared-ci-runner-03","netaiops-shared-ci-runner-04"]}]' \
  --document-name "AWS-RunShellScript" \
  --parameters "{\"commands\":[
    \"cat > /opt/traffic-generator.sh << 'SCRIPTEOF'\n$(cat traffic-generator.sh)\nSCRIPTEOF\",
    \"chmod +x /opt/traffic-generator.sh\",
    \"cat > /etc/systemd/system/traffic-generator.service << 'SVCEOF'\n[Unit]\nDescription=NetAIOps Demo Traffic Generator\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=/opt/traffic-generator.sh\nRestart=always\nRestartSec=10\nKillMode=control-group\n\n[Install]\nWantedBy=multi-user.target\nSVCEOF\",
    \"systemctl daemon-reload\",
    \"systemctl enable traffic-generator\",
    \"systemctl restart traffic-generator\"
  ]}" \
  --region us-west-2 \
  --profile netaiops-deploy
```

## Operations

### Check Status

```bash
aws ssm send-command \
  --targets '[{"Key":"tag:Name","Values":["netaiops-shared-ci-runner-01","netaiops-shared-ci-runner-02","netaiops-shared-ci-runner-03","netaiops-shared-ci-runner-04"]}]' \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["systemctl status traffic-generator --no-pager","journalctl -t traffic-gen --no-pager -n 5"]}' \
  --region us-west-2 --profile netaiops-deploy
```

### Stop (after demo)

```bash
aws ssm send-command \
  --targets '[{"Key":"tag:Name","Values":["netaiops-shared-ci-runner-01","netaiops-shared-ci-runner-02","netaiops-shared-ci-runner-03","netaiops-shared-ci-runner-04"]}]' \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["systemctl stop traffic-generator && systemctl disable traffic-generator"]}' \
  --region us-west-2 --profile netaiops-deploy
```

### View Logs

```bash
# Via SSM
aws ssm send-command \
  --targets '[{"Key":"tag:Name","Values":["netaiops-shared-ci-runner-01"]}]' \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["journalctl -t traffic-gen --no-pager -n 50"]}' \
  --region us-west-2 --profile netaiops-deploy
```

## Verification

After deployment, traffic should appear in CloudWatch within 5 minutes:

- **EC2 NetworkIn/NetworkOut**: Increased bytes across all tiers
- **ALB RequestCount**: Steady requests with periodic spikes
- **ALB TargetResponseTime**: Varied response times
- **NAT GW ActiveFlowCount**: Periodic external connection bursts
- **TGW BytesIn/BytesOut**: Cross-VPC traffic every 2 minutes
