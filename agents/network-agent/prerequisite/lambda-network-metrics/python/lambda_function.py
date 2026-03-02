"""
=============================================================================
Lambda Function - Network Metrics Tools
Lambda 함수 - 네트워크 메트릭 도구
=============================================================================

Description (설명):
    Provides MCP tools for querying CloudWatch network metrics and
    VPC Flow Logs insights.
    CloudWatch 네트워크 메트릭 및 VPC Flow Logs 인사이트를 조회합니다.

Tools (도구):
    - network-get-instance-metrics: EC2 network metrics (EC2 네트워크 메트릭)
    - network-get-gateway-metrics: NAT GW/TGW/VPN metrics (게이트웨이 메트릭)
    - network-get-elb-metrics: ALB/NLB metrics (로드밸런서 메트릭)
    - network-query-flow-logs: VPC Flow Logs Insights (플로우 로그 분석)

Author: NetAIOps Team
=============================================================================
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import boto3

# =============================================================================
# Configuration (설정)
# =============================================================================
DEFAULT_REGION = os.environ.get("AWS_REGION", "us-east-1")


def _get_clients(region=None):
    """Get boto3 clients for the specified region (or default)."""
    r = region or DEFAULT_REGION
    return (
        boto3.client("cloudwatch", region_name=r),
        boto3.client("logs", region_name=r),
        boto3.client("ec2", region_name=r),
    )

# =============================================================================
# Tool Schema Definitions (도구 스키마 정의)
# =============================================================================
TOOL_SCHEMAS = [
    {
        "name": "network-list-load-balancers",
        "description": "List all ALB/NLB load balancers in a region with ARN, DNS name, VPC, type, and state. 리전의 모든 로드밸런서를 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {
                    "type": "string",
                    "description": "AWS region (e.g., 'us-west-2'). Default: us-east-1"
                }
            },
            "required": []
        }
    },
    {
        "name": "network-list-instances",
        "description": "List EC2 instances in a region with instance ID, type, state, VPC, subnet, private/public IP. 리전의 EC2 인스턴스를 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {
                    "type": "string",
                    "description": "AWS region (e.g., 'us-west-2'). Default: us-east-1"
                },
                "vpc_id": {
                    "type": "string",
                    "description": "Filter by VPC ID (optional)"
                }
            },
            "required": []
        }
    },
    {
        "name": "network-get-instance-metrics",
        "description": "Get EC2 instance network metrics (NetworkIn/Out, PacketsIn/Out). EC2 인스턴스 네트워크 메트릭을 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "instance_id": {
                    "type": "string",
                    "description": "EC2 instance ID (e.g., 'i-0123456789abcdef0')"
                },
                "region": {
                    "type": "string",
                    "description": "AWS region (e.g., 'us-west-2'). Default: us-east-1"
                },
                "minutes": {
                    "type": "integer",
                    "description": "How many minutes back to query. Default: 60"
                },
                "period": {
                    "type": "integer",
                    "description": "Metric period in seconds. Default: 300"
                }
            },
            "required": ["instance_id"]
        }
    },
    {
        "name": "network-get-gateway-metrics",
        "description": "Get NAT Gateway, Transit Gateway, or VPN connection metrics. NAT GW, TGW, VPN 게이트웨이 메트릭을 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "gateway_type": {
                    "type": "string",
                    "description": "Gateway type: 'natgw', 'tgw', or 'vpn'",
                    "enum": ["natgw", "tgw", "vpn"]
                },
                "gateway_id": {
                    "type": "string",
                    "description": "Gateway resource ID (e.g., 'nat-xxx', 'tgw-xxx', 'vpn-xxx')"
                },
                "region": {
                    "type": "string",
                    "description": "AWS region (e.g., 'us-west-2'). Default: us-east-1"
                },
                "minutes": {
                    "type": "integer",
                    "description": "How many minutes back to query. Default: 60"
                },
                "period": {
                    "type": "integer",
                    "description": "Metric period in seconds. Default: 300"
                }
            },
            "required": ["gateway_type", "gateway_id"]
        }
    },
    {
        "name": "network-get-elb-metrics",
        "description": "Get ALB or NLB metrics (TargetResponseTime, ActiveConnectionCount, ProcessedBytes). ALB/NLB 메트릭을 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "load_balancer_arn": {
                    "type": "string",
                    "description": "Load balancer ARN or the app/xxx/yyy or net/xxx/yyy portion"
                },
                "lb_type": {
                    "type": "string",
                    "description": "Load balancer type: 'alb' or 'nlb'. Default: 'alb'",
                    "enum": ["alb", "nlb"]
                },
                "region": {
                    "type": "string",
                    "description": "AWS region (e.g., 'us-west-2'). Default: us-east-1"
                },
                "minutes": {
                    "type": "integer",
                    "description": "How many minutes back to query. Default: 60"
                },
                "period": {
                    "type": "integer",
                    "description": "Metric period in seconds. Default: 300"
                }
            },
            "required": ["load_balancer_arn"]
        }
    },
    {
        "name": "network-query-flow-logs",
        "description": "Query VPC Flow Logs using CloudWatch Logs Insights. VPC Flow Logs를 CloudWatch Logs Insights로 분석합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "log_group_name": {
                    "type": "string",
                    "description": "CloudWatch Logs group name for VPC Flow Logs"
                },
                "query": {
                    "type": "string",
                    "description": "CloudWatch Logs Insights query. Default: top rejected flows"
                },
                "region": {
                    "type": "string",
                    "description": "AWS region (e.g., 'us-west-2'). Default: us-east-1"
                },
                "minutes": {
                    "type": "integer",
                    "description": "How many minutes back to query. Default: 60"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results. Default: 50"
                }
            },
            "required": ["log_group_name"]
        }
    }
]


# =============================================================================
# Helper Functions
# =============================================================================
def _get_metric_data(namespace, metric_names, dimensions, minutes=60, period=300, stat="Average", region=None):
    """Query CloudWatch for multiple metrics."""
    cw, _, _ = _get_clients(region)
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes)

    queries = []
    for i, metric_name in enumerate(metric_names):
        queries.append({
            "Id": f"m{i}",
            "MetricStat": {
                "Metric": {
                    "Namespace": namespace,
                    "MetricName": metric_name,
                    "Dimensions": dimensions,
                },
                "Period": period,
                "Stat": stat,
            },
        })

    try:
        response = cw.get_metric_data(
            MetricDataQueries=queries,
            StartTime=start,
            EndTime=end,
        )

        results = {}
        for i, metric_name in enumerate(metric_names):
            metric_result = response["MetricDataResults"][i]
            data_points = []
            for ts, val in zip(metric_result.get("Timestamps", []), metric_result.get("Values", [])):
                data_points.append({
                    "time": ts.strftime("%H:%M:%S"),
                    "value": round(val, 4),
                })
            # Sort by time
            data_points.sort(key=lambda x: x["time"])
            results[metric_name] = {
                "data_points": data_points[-20:],  # Last 20 points
                "latest": data_points[-1]["value"] if data_points else None,
            }

        return results
    except Exception as e:
        return {"error": f"CloudWatch query failed: {str(e)}"}


# =============================================================================
# Main Handler (메인 핸들러)
# =============================================================================
def _extract_tool_info(event):
    """Extract tool name and arguments from various event formats."""
    tool_name = ""
    arguments = {}

    method = event.get("method", "")
    if method == "tools/list":
        return "__list_tools__", {}
    if method == "tools/call":
        params = event.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
    elif "tool_name" in event:
        tool_name = event["tool_name"]
        arguments = event.get("parameters", {})
    elif "name" in event and "arguments" in event:
        tool_name = event["name"]
        arguments = event.get("arguments", {})
    elif event.get("action") == "list_tools":
        return "__list_tools__", {}
    else:
        # MCP Gateway Lambda integration: event IS the arguments directly.
        # Gateway strips the tool prefix and passes only arguments to Lambda,
        # so we use _tool field (from schema) or infer from argument keys.
        arguments = event
        if "_tool" in event:
            tool_name = event["_tool"]
        elif "instance_id" in event:
            tool_name = "network-get-instance-metrics"
        elif "gateway_type" in event or "gateway_id" in event:
            tool_name = "network-get-gateway-metrics"
        elif "load_balancer_arn" in event:
            tool_name = "network-get-elb-metrics"
        elif "log_group_name" in event:
            tool_name = "network-query-flow-logs"
        elif "vpc_id" in event:
            tool_name = "network-list-instances"
        else:
            # Ambiguous: both network-list-load-balancers and network-list-instances
            # have only optional 'region' param. Default to load-balancers as it's
            # the more common discovery query; list-instances usually has vpc_id.
            tool_name = "network-list-load-balancers"

    if "___" in tool_name:
        tool_name = tool_name.split("___", 1)[1]

    return tool_name, arguments


def lambda_handler(event, context):
    """Lambda entry point."""
    print(f"RAW_EVENT: {json.dumps(event, default=str)[:2000]}")
    tool_name, parameters = _extract_tool_info(event)
    print(f"EXTRACTED: tool_name={tool_name}, parameters={json.dumps(parameters, default=str)[:500]}")

    if tool_name == "__list_tools__":
        return {"tools": TOOL_SCHEMAS}

    handlers = {
        "network-list-load-balancers": handle_list_load_balancers,
        "network-list-instances": handle_list_instances,
        "network-get-instance-metrics": handle_instance_metrics,
        "network-get-gateway-metrics": handle_gateway_metrics,
        "network-get-elb-metrics": handle_elb_metrics,
        "network-query-flow-logs": handle_flow_logs,
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {
            "error": f"Unknown tool: {tool_name}",
            "available_tools": list(handlers.keys()),
            "raw_event_keys": list(event.keys()),
        }

    try:
        return handler(parameters)
    except Exception as e:
        return {"error": f"Tool execution failed: {str(e)}", "tool": tool_name}


# =============================================================================
# Tool Handlers (도구 핸들러)
# =============================================================================
def handle_list_load_balancers(params):
    """List all ALB/NLB load balancers in a region."""
    region = params.get("region") or None
    r = region or DEFAULT_REGION

    try:
        elbv2 = boto3.client("elbv2", region_name=r)
        response = elbv2.describe_load_balancers()
        lbs = []
        for lb in response.get("LoadBalancers", []):
            lbs.append({
                "name": lb.get("LoadBalancerName"),
                "arn": lb.get("LoadBalancerArn"),
                "dns_name": lb.get("DNSName"),
                "type": lb.get("Type"),
                "scheme": lb.get("Scheme"),
                "vpc_id": lb.get("VpcId"),
                "state": lb.get("State", {}).get("Code"),
                "availability_zones": [az.get("ZoneName") for az in lb.get("AvailabilityZones", [])],
            })
        return {
            "status": "success",
            "region": r,
            "load_balancers": lbs,
            "total": len(lbs),
        }
    except Exception as e:
        return {"error": f"Failed to list load balancers: {str(e)}"}


def handle_list_instances(params):
    """List EC2 instances in a region."""
    region = params.get("region") or None
    vpc_id = params.get("vpc_id", "")
    r = region or DEFAULT_REGION

    try:
        ec2 = boto3.client("ec2", region_name=r)
        filters = []
        if vpc_id:
            filters.append({"Name": "vpc-id", "Values": [vpc_id]})

        response = ec2.describe_instances(Filters=filters) if filters else ec2.describe_instances()
        instances = []
        for res in response.get("Reservations", []):
            for inst in res.get("Instances", []):
                name = ""
                for tag in inst.get("Tags", []):
                    if tag["Key"] == "Name":
                        name = tag["Value"]
                instances.append({
                    "instance_id": inst.get("InstanceId"),
                    "name": name,
                    "type": inst.get("InstanceType"),
                    "state": inst.get("State", {}).get("Name"),
                    "vpc_id": inst.get("VpcId"),
                    "subnet_id": inst.get("SubnetId"),
                    "private_ip": inst.get("PrivateIpAddress"),
                    "public_ip": inst.get("PublicIpAddress"),
                    "az": inst.get("Placement", {}).get("AvailabilityZone"),
                })
        return {
            "status": "success",
            "region": r,
            "instances": instances,
            "total": len(instances),
        }
    except Exception as e:
        return {"error": f"Failed to list instances: {str(e)}"}


def handle_instance_metrics(params):
    """Get EC2 instance network metrics."""
    instance_id = params.get("instance_id", "")
    region = params.get("region") or None
    minutes = params.get("minutes", 60)
    period = params.get("period", 300)

    if not instance_id:
        return {"error": "instance_id is required"}

    dimensions = [{"Name": "InstanceId", "Value": instance_id}]
    metrics = ["NetworkIn", "NetworkOut", "NetworkPacketsIn", "NetworkPacketsOut"]

    results = _get_metric_data("AWS/EC2", metrics, dimensions, minutes, period, region=region)

    return {
        "status": "success",
        "instance_id": instance_id,
        "region": region or DEFAULT_REGION,
        "time_range_minutes": minutes,
        "metrics": results,
    }


def handle_gateway_metrics(params):
    """Get gateway (NAT GW, TGW, VPN) metrics."""
    gateway_type = params.get("gateway_type", "")
    gateway_id = params.get("gateway_id", "")
    region = params.get("region") or None
    minutes = params.get("minutes", 60)
    period = params.get("period", 300)

    if not gateway_type or not gateway_id:
        return {"error": "gateway_type and gateway_id are required"}

    if gateway_type == "natgw":
        namespace = "AWS/NATGateway"
        dimensions = [{"Name": "NatGatewayId", "Value": gateway_id}]
        metrics = [
            "BytesInFromDestination", "BytesInFromSource",
            "BytesOutToDestination", "BytesOutToSource",
            "PacketsInFromDestination", "PacketsInFromSource",
            "PacketsOutToDestination", "PacketsOutToSource",
            "ActiveConnectionCount", "ConnectionAttemptCount",
            "PacketsDropCount", "ErrorPortAllocation",
        ]
    elif gateway_type == "tgw":
        namespace = "AWS/TransitGateway"
        dimensions = [{"Name": "TransitGateway", "Value": gateway_id}]
        metrics = [
            "BytesIn", "BytesOut",
            "PacketsIn", "PacketsOut",
            "PacketDropCountBlackhole", "PacketDropCountNoRoute",
        ]
    elif gateway_type == "vpn":
        namespace = "AWS/VPN"
        dimensions = [{"Name": "VpnId", "Value": gateway_id}]
        metrics = [
            "TunnelDataIn", "TunnelDataOut",
            "TunnelState",
        ]
    else:
        return {"error": f"Unknown gateway_type: {gateway_type}. Use 'natgw', 'tgw', or 'vpn'"}

    results = _get_metric_data(namespace, metrics, dimensions, minutes, period, region=region)

    return {
        "status": "success",
        "gateway_type": gateway_type,
        "gateway_id": gateway_id,
        "region": region or DEFAULT_REGION,
        "time_range_minutes": minutes,
        "metrics": results,
    }


def handle_elb_metrics(params):
    """Get ALB/NLB metrics."""
    load_balancer_arn = params.get("load_balancer_arn", "")
    lb_type = params.get("lb_type", "alb")
    region = params.get("region") or None
    minutes = params.get("minutes", 60)
    period = params.get("period", 300)

    if not load_balancer_arn:
        return {"error": "load_balancer_arn is required"}

    # Extract the load balancer portion from ARN if full ARN is provided
    lb_id = load_balancer_arn
    if "loadbalancer/" in lb_id:
        lb_id = lb_id.split("loadbalancer/")[1]

    namespace = "AWS/ApplicationELB" if lb_type == "alb" else "AWS/NetworkELB"
    dimensions = [{"Name": "LoadBalancer", "Value": lb_id}]

    if lb_type == "alb":
        metrics = [
            "TargetResponseTime", "RequestCount",
            "ActiveConnectionCount", "NewConnectionCount",
            "ProcessedBytes", "HTTPCode_Target_2XX_Count",
            "HTTPCode_Target_4XX_Count", "HTTPCode_Target_5XX_Count",
            "UnHealthyHostCount", "HealthyHostCount",
        ]
    else:
        metrics = [
            "ActiveFlowCount", "NewFlowCount",
            "ProcessedBytes", "ProcessedPackets",
            "TCP_Client_Reset_Count", "TCP_Target_Reset_Count",
            "UnHealthyHostCount", "HealthyHostCount",
        ]

    results = _get_metric_data(namespace, metrics, dimensions, minutes, period, region=region)

    return {
        "status": "success",
        "load_balancer": lb_id,
        "lb_type": lb_type,
        "region": region or DEFAULT_REGION,
        "time_range_minutes": minutes,
        "metrics": results,
    }


def handle_flow_logs(params):
    """Query VPC Flow Logs using CloudWatch Logs Insights."""
    log_group_name = params.get("log_group_name", "")
    query = params.get("query", "")
    region = params.get("region") or None
    minutes = params.get("minutes", 60)
    limit = params.get("limit", 50)

    if not log_group_name:
        return {"error": "log_group_name is required"}

    _, logs, _ = _get_clients(region)

    # Default query: top rejected flows
    if not query:
        query = f"""fields @timestamp, srcAddr, dstAddr, srcPort, dstPort, protocol, packets, bytes, action
| filter action = "REJECT"
| stats count(*) as rejectedCount by srcAddr, dstAddr, dstPort, protocol
| sort rejectedCount desc
| limit {limit}"""

    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes)

    try:
        start_response = logs.start_query(
            logGroupName=log_group_name,
            startTime=int(start.timestamp()),
            endTime=int(end.timestamp()),
            queryString=query,
            limit=limit,
        )

        query_id = start_response["queryId"]

        # Poll for results
        max_wait = 30
        elapsed = 0
        while elapsed < max_wait:
            result_response = logs.get_query_results(queryId=query_id)
            status = result_response["status"]

            if status == "Complete":
                results = []
                for row in result_response.get("results", []):
                    record = {}
                    for field in row:
                        record[field["field"]] = field["value"]
                    results.append(record)

                return {
                    "status": "success",
                    "log_group": log_group_name,
                    "region": region or DEFAULT_REGION,
                    "time_range_minutes": minutes,
                    "query": query,
                    "results": results,
                    "total": len(results),
                    "statistics": result_response.get("statistics", {}),
                }
            elif status in ("Failed", "Cancelled"):
                return {"error": f"Query {status}", "query": query}

            time.sleep(1)
            elapsed += 1

        return {"error": "Query timed out", "query_id": query_id}

    except Exception as e:
        return {"error": f"Flow logs query failed: {str(e)}"}
