"""
=============================================================================
Lambda Function - Network Anomaly Detection MCP Tools
Lambda 함수 - 네트워크 이상탐지 MCP 도구
=============================================================================

Tools (도구):
    - anomaly-flowlog-analysis: VPC Flow Logs statistical analysis
    - anomaly-interaz-traffic: Inter-AZ traffic ratio and cost analysis
    - anomaly-elb-shift: ALB/NLB metric shift detection

Author: NetAIOps Team
=============================================================================
"""

import json
import os
import time
import math
import boto3
from datetime import datetime, timedelta

REGION = os.environ.get("TARGET_REGION", os.environ.get("AWS_REGION", "us-east-1"))
cw_client = boto3.client("cloudwatch", region_name=REGION)
logs_client = boto3.client("logs", region_name=REGION)
ec2_client = boto3.client("ec2", region_name=REGION)
elbv2_client = boto3.client("elbv2", region_name=REGION)

# =============================================================================
# Tool Schema Definitions
# =============================================================================
TOOL_SCHEMAS = [
    {
        "name": "anomaly-flowlog-analysis",
        "description": "Analyze VPC Flow Logs for anomalies: denied traffic spikes, port scan patterns, volume anomalies, and top talkers. Uses CloudWatch Logs Insights queries with statistical outlier detection. VPC Flow Logs 통계 분석 (거부 트래픽 급증, 포트 스캔, 볼륨 이상, 상위 통신자).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "_tool": {"type": "string", "description": 'Tool identifier. Must be "anomaly-flowlog-analysis".'},
                "log_group_name": {"type": "string", "description": "CloudWatch Logs group name for VPC Flow Logs"},
                "analysis_type": {"type": "string", "description": "Analysis type. Allowed values: denied_spike, port_scan, volume_anomaly, top_talkers, all. Default: all"},
                "minutes": {"type": "integer", "description": "How many minutes back to analyze. Default: 60"},
                "bucket_minutes": {"type": "integer", "description": "Time bucket size in minutes for trend analysis. Default: 5"}
            },
            "required": ["_tool", "log_group_name"]
        }
    },
    {
        "name": "anomaly-interaz-traffic",
        "description": "Analyze Inter-AZ vs Intra-AZ traffic ratio from VPC Flow Logs. Maps source/destination IPs to subnets and AZs using describe_subnets. Calculates cross-AZ traffic percentage and estimates data transfer cost ($0.01/GB per direction). Inter-AZ 트래픽 비율 분석 및 비용 추정.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "_tool": {"type": "string", "description": 'Tool identifier. Must be "anomaly-interaz-traffic".'},
                "log_group_name": {"type": "string", "description": "CloudWatch Logs group name for VPC Flow Logs"},
                "vpc_id": {"type": "string", "description": "VPC ID to analyze (optional, auto-detected from flow logs if not specified)"},
                "minutes": {"type": "integer", "description": "How many minutes back to analyze. Default: 60"},
                "top_n": {"type": "integer", "description": "Number of top cross-AZ pairs to return. Default: 10"}
            },
            "required": ["_tool", "log_group_name"]
        }
    },
    {
        "name": "anomaly-elb-shift",
        "description": "Detect ALB/NLB metric shifts by comparing current period metrics against a baseline period. Calculates percentage change and flags metrics exceeding threshold. Metrics: RequestCount, TargetResponseTime, HTTP_5XX, ActiveFlowCount, ProcessedBytes, UnHealthyHostCount. ELB 메트릭 변화율 감지.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "_tool": {"type": "string", "description": 'Tool identifier. Must be "anomaly-elb-shift".'},
                "load_balancer_arn": {"type": "string", "description": "Full ARN or the app/xxx/yyy or net/xxx/yyy portion of the load balancer"},
                "lb_type": {"type": "string", "description": "Load balancer type. Allowed values: alb, nlb. Default: alb"},
                "baseline_start_minutes_ago": {"type": "integer", "description": "Baseline period start (minutes ago). Default: 120"},
                "baseline_end_minutes_ago": {"type": "integer", "description": "Baseline period end (minutes ago). Default: 60"},
                "current_minutes": {"type": "integer", "description": "Current period length in minutes. Default: 60"},
                "shift_threshold_pct": {"type": "number", "description": "Percentage change threshold to flag as shift. Default: 50"},
                "period": {"type": "integer", "description": "Metric period in seconds. Default: 300"}
            },
            "required": ["_tool", "load_balancer_arn"]
        }
    }
]


# =============================================================================
# Main Handler
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
        arguments = event
        if "_tool" in event:
            tool_name = event["_tool"]
        elif "log_group_name" in event and "vpc_id" in event:
            tool_name = "anomaly-interaz-traffic"
        elif "log_group_name" in event:
            tool_name = "anomaly-flowlog-analysis"
        elif "load_balancer_arn" in event:
            tool_name = "anomaly-elb-shift"

    if "___" in tool_name:
        tool_name = tool_name.split("___", 1)[1]

    return tool_name, arguments


def lambda_handler(event, context):
    print(f"RAW_EVENT: {json.dumps(event, default=str)[:2000]}")
    tool_name, parameters = _extract_tool_info(event)
    print(f"EXTRACTED: tool_name={tool_name}, parameters={json.dumps(parameters, default=str)[:500]}")

    if tool_name == "__list_tools__":
        return {"tools": TOOL_SCHEMAS}

    handlers = {
        "anomaly-flowlog-analysis": handle_flowlog_analysis,
        "anomaly-interaz-traffic": handle_interaz_traffic,
        "anomaly-elb-shift": handle_elb_shift,
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}", "available_tools": list(handlers.keys()), "raw_event_keys": list(event.keys())}

    try:
        return handler(parameters)
    except Exception as e:
        return {"error": f"Tool execution failed: {str(e)}", "tool": tool_name}


# =============================================================================
# CloudWatch Logs Insights Helper
# =============================================================================
def _run_insights_query(log_group_name, query, minutes):
    """Run a CloudWatch Logs Insights query and wait for results."""
    end_time = int(datetime.utcnow().timestamp())
    start_time = end_time - (minutes * 60)

    response = logs_client.start_query(
        logGroupName=log_group_name,
        startTime=start_time,
        endTime=end_time,
        queryString=query,
        limit=10000,
    )
    query_id = response["queryId"]

    # Poll for results (max 30 seconds)
    for _ in range(60):
        result = logs_client.get_query_results(queryId=query_id)
        if result["status"] in ("Complete", "Failed", "Cancelled"):
            break
        time.sleep(0.5)

    if result["status"] != "Complete":
        return None, result["status"]

    rows = []
    for row in result.get("results", []):
        record = {}
        for field in row:
            record[field["field"]] = field["value"]
        rows.append(record)

    return rows, "Complete"


# =============================================================================
# Tool Handlers
# =============================================================================
def handle_flowlog_analysis(params):
    """Analyze VPC Flow Logs for anomalous patterns."""
    log_group_name = params["log_group_name"]
    analysis_type = params.get("analysis_type", "all")
    minutes = params.get("minutes", 60)
    bucket_minutes = params.get("bucket_minutes", 5)

    results = {}

    # 1. Denied traffic spike analysis
    if analysis_type in ("denied_spike", "all"):
        query = f"""
            fields @timestamp, srcAddr, dstAddr, dstPort, action
            | filter action = "REJECT"
            | stats count(*) as reject_count by bin({bucket_minutes}m) as time_bucket
            | sort time_bucket
        """
        rows, status = _run_insights_query(log_group_name, query, minutes)
        if rows:
            counts = [int(r.get("reject_count", 0)) for r in rows]
            mean_val = sum(counts) / len(counts) if counts else 0
            stdev_val = _stdev(counts) if len(counts) > 1 else 0
            threshold = mean_val + 2 * stdev_val

            spike_buckets = []
            for r in rows:
                count = int(r.get("reject_count", 0))
                if count > threshold and threshold > 0:
                    spike_buckets.append({
                        "time_bucket": r.get("time_bucket"),
                        "reject_count": count,
                        "deviation_sigma": round((count - mean_val) / stdev_val, 2) if stdev_val > 0 else 0
                    })

            results["denied_spike"] = {
                "status": "success",
                "total_buckets": len(rows),
                "mean_rejects_per_bucket": round(mean_val, 2),
                "stdev": round(stdev_val, 2),
                "threshold_2sigma": round(threshold, 2),
                "spike_buckets": spike_buckets,
                "spike_count": len(spike_buckets),
                "time_series": [{"time": r.get("time_bucket"), "count": int(r.get("reject_count", 0))} for r in rows]
            }

    # 2. Port scan detection
    if analysis_type in ("port_scan", "all"):
        query = """
            fields srcAddr, dstAddr, dstPort, action
            | filter action = "REJECT"
            | stats count(distinct(dstPort)) as unique_ports, count(*) as total_attempts by srcAddr
            | filter unique_ports > 10
            | sort unique_ports desc
            | limit 20
        """
        rows, status = _run_insights_query(log_group_name, query, minutes)
        results["port_scan"] = {
            "status": "success",
            "suspicious_sources": [
                {
                    "source_ip": r.get("srcAddr"),
                    "unique_ports_targeted": int(r.get("unique_ports", 0)),
                    "total_attempts": int(r.get("total_attempts", 0)),
                }
                for r in (rows or [])
            ],
            "total_suspicious": len(rows) if rows else 0,
        }

    # 3. Volume anomaly (bytes transferred)
    if analysis_type in ("volume_anomaly", "all"):
        query = f"""
            fields @timestamp, bytes
            | filter action = "ACCEPT"
            | stats sum(bytes) as total_bytes by bin({bucket_minutes}m) as time_bucket
            | sort time_bucket
        """
        rows, status = _run_insights_query(log_group_name, query, minutes)
        if rows:
            byte_vals = [int(r.get("total_bytes", 0)) for r in rows]
            mean_val = sum(byte_vals) / len(byte_vals) if byte_vals else 0
            stdev_val = _stdev(byte_vals) if len(byte_vals) > 1 else 0
            threshold = mean_val + 2 * stdev_val

            anomaly_buckets = []
            for r in rows:
                vol = int(r.get("total_bytes", 0))
                if vol > threshold and threshold > 0:
                    anomaly_buckets.append({
                        "time_bucket": r.get("time_bucket"),
                        "bytes": vol,
                        "bytes_gb": round(vol / (1024**3), 4),
                        "deviation_sigma": round((vol - mean_val) / stdev_val, 2) if stdev_val > 0 else 0
                    })

            results["volume_anomaly"] = {
                "status": "success",
                "total_buckets": len(rows),
                "mean_bytes_per_bucket": round(mean_val, 2),
                "mean_gb_per_bucket": round(mean_val / (1024**3), 4),
                "stdev_bytes": round(stdev_val, 2),
                "anomaly_buckets": anomaly_buckets,
                "anomaly_count": len(anomaly_buckets),
            }

    # 4. Top talkers
    if analysis_type in ("top_talkers", "all"):
        query = """
            fields srcAddr, dstAddr, bytes
            | filter action = "ACCEPT"
            | stats sum(bytes) as total_bytes, count(*) as flow_count by srcAddr, dstAddr
            | sort total_bytes desc
            | limit 20
        """
        rows, status = _run_insights_query(log_group_name, query, minutes)
        results["top_talkers"] = {
            "status": "success",
            "pairs": [
                {
                    "source": r.get("srcAddr"),
                    "destination": r.get("dstAddr"),
                    "total_bytes": int(r.get("total_bytes", 0)),
                    "total_gb": round(int(r.get("total_bytes", 0)) / (1024**3), 4),
                    "flow_count": int(r.get("flow_count", 0)),
                }
                for r in (rows or [])
            ],
        }

    return {
        "status": "success",
        "log_group": log_group_name,
        "time_range_minutes": minutes,
        "bucket_minutes": bucket_minutes,
        "analysis": results,
    }


def handle_interaz_traffic(params):
    """Analyze Inter-AZ vs Intra-AZ traffic from VPC Flow Logs."""
    log_group_name = params["log_group_name"]
    vpc_id = params.get("vpc_id")
    minutes = params.get("minutes", 60)
    top_n = params.get("top_n", 10)

    # Get subnet-to-AZ mapping
    subnet_kwargs = {}
    if vpc_id:
        subnet_kwargs["Filters"] = [{"Name": "vpc-id", "Values": [vpc_id]}]

    try:
        subnets_resp = ec2_client.describe_subnets(**subnet_kwargs)
    except Exception as e:
        return {"error": f"Failed to describe subnets: {str(e)}"}

    # Build CIDR -> AZ mapping
    subnet_az_map = {}
    for subnet in subnets_resp.get("Subnets", []):
        subnet_az_map[subnet["SubnetId"]] = {
            "az": subnet["AvailabilityZone"],
            "cidr": subnet["CidrBlock"],
        }

    # Build IP prefix -> AZ mapping from CIDRs
    ip_az_cache = {}

    def _get_az_for_ip(ip):
        if ip in ip_az_cache:
            return ip_az_cache[ip]
        for sid, info in subnet_az_map.items():
            if _ip_in_cidr(ip, info["cidr"]):
                ip_az_cache[ip] = info["az"]
                return info["az"]
        ip_az_cache[ip] = "unknown"
        return "unknown"

    # Query flow logs for source/dest IP pairs with bytes
    query = """
        fields srcAddr, dstAddr, bytes
        | filter action = "ACCEPT" and bytes > 0
        | stats sum(bytes) as total_bytes, count(*) as flow_count by srcAddr, dstAddr
        | sort total_bytes desc
        | limit 500
    """
    rows, status = _run_insights_query(log_group_name, query, minutes)

    if not rows:
        return {
            "status": "no_data",
            "log_group": log_group_name,
            "message": "No flow log data found."
        }

    # Classify traffic
    cross_az_bytes = 0
    intra_az_bytes = 0
    unknown_bytes = 0
    cross_az_pairs = {}

    for r in rows:
        src = r.get("srcAddr", "")
        dst = r.get("dstAddr", "")
        total_bytes = int(r.get("total_bytes", 0))

        src_az = _get_az_for_ip(src)
        dst_az = _get_az_for_ip(dst)

        if src_az == "unknown" or dst_az == "unknown":
            unknown_bytes += total_bytes
        elif src_az != dst_az:
            cross_az_bytes += total_bytes
            pair_key = f"{src_az} -> {dst_az}"
            if pair_key not in cross_az_pairs:
                cross_az_pairs[pair_key] = {"bytes": 0, "flows": 0, "top_sources": {}}
            cross_az_pairs[pair_key]["bytes"] += total_bytes
            cross_az_pairs[pair_key]["flows"] += int(r.get("flow_count", 0))
            cross_az_pairs[pair_key]["top_sources"].setdefault(f"{src}->{dst}", total_bytes)
        else:
            intra_az_bytes += total_bytes

    total_classified = cross_az_bytes + intra_az_bytes
    cross_az_pct = round(cross_az_bytes / total_classified * 100, 2) if total_classified > 0 else 0

    # Cost estimation ($0.01/GB per direction for cross-AZ)
    cross_az_gb = cross_az_bytes / (1024**3)
    estimated_cost_per_hour = cross_az_gb * 0.01 * (60 / minutes)
    estimated_cost_per_month = estimated_cost_per_hour * 24 * 30

    # Top cross-AZ pairs
    sorted_pairs = sorted(cross_az_pairs.items(), key=lambda x: x[1]["bytes"], reverse=True)[:top_n]
    top_pairs = [
        {
            "az_pair": pair,
            "bytes": info["bytes"],
            "gb": round(info["bytes"] / (1024**3), 4),
            "flows": info["flows"],
        }
        for pair, info in sorted_pairs
    ]

    return {
        "status": "success",
        "log_group": log_group_name,
        "vpc_id": vpc_id or "auto-detected",
        "time_range_minutes": minutes,
        "subnets_mapped": len(subnet_az_map),
        "traffic_summary": {
            "cross_az_bytes": cross_az_bytes,
            "cross_az_gb": round(cross_az_gb, 4),
            "intra_az_bytes": intra_az_bytes,
            "intra_az_gb": round(intra_az_bytes / (1024**3), 4),
            "unknown_bytes": unknown_bytes,
            "cross_az_percentage": cross_az_pct,
        },
        "cost_estimation": {
            "cross_az_gb_analyzed": round(cross_az_gb, 4),
            "rate_per_gb": 0.01,
            "estimated_cost_for_period": round(cross_az_gb * 0.01, 4),
            "estimated_hourly_cost": round(estimated_cost_per_hour, 4),
            "estimated_monthly_cost": round(estimated_cost_per_month, 2),
        },
        "top_cross_az_pairs": top_pairs,
        "optimization_note": "Cross-AZ 트래픽이 높은 경우: 같은 AZ에 통신량이 많은 서비스를 배치하거나, VPC Endpoint를 활용하여 비용을 절감할 수 있습니다."
    }


def handle_elb_shift(params):
    """Detect ELB metric shifts between baseline and current periods."""
    lb_arn = params["load_balancer_arn"]
    lb_type = params.get("lb_type", "alb")
    baseline_start_ago = params.get("baseline_start_minutes_ago", 120)
    baseline_end_ago = params.get("baseline_end_minutes_ago", 60)
    current_minutes = params.get("current_minutes", 60)
    shift_threshold = params.get("shift_threshold_pct", 50)
    period = params.get("period", 300)

    now = datetime.utcnow()
    baseline_start = now - timedelta(minutes=baseline_start_ago)
    baseline_end = now - timedelta(minutes=baseline_end_ago)
    current_start = now - timedelta(minutes=current_minutes)
    current_end = now

    # Extract load balancer dimension value
    lb_dimension = _extract_lb_dimension(lb_arn, lb_type)
    if not lb_dimension:
        return {"error": f"Could not extract load balancer dimension from ARN: {lb_arn}"}

    namespace = "AWS/ApplicationELB" if lb_type == "alb" else "AWS/NetworkELB"
    dimension_name = "LoadBalancer"

    # Metrics to check for each LB type
    if lb_type == "alb":
        metrics_config = [
            ("RequestCount", "Sum", "Total requests"),
            ("TargetResponseTime", "Average", "Target response time (seconds)"),
            ("HTTPCode_Target_5XX_Count", "Sum", "5XX error count"),
            ("HTTPCode_Target_4XX_Count", "Sum", "4XX error count"),
            ("ActiveConnectionCount", "Average", "Active connections"),
            ("ProcessedBytes", "Sum", "Processed bytes"),
            ("UnHealthyHostCount", "Maximum", "Unhealthy hosts"),
            ("HealthyHostCount", "Minimum", "Healthy hosts"),
        ]
    else:
        metrics_config = [
            ("ActiveFlowCount", "Average", "Active flows"),
            ("NewFlowCount", "Sum", "New flows"),
            ("ProcessedBytes", "Sum", "Processed bytes"),
            ("TCP_Client_Reset_Count", "Sum", "Client TCP resets"),
            ("TCP_Target_Reset_Count", "Sum", "Target TCP resets"),
            ("UnHealthyHostCount", "Maximum", "Unhealthy hosts"),
            ("HealthyHostCount", "Minimum", "Healthy hosts"),
        ]

    dimensions = [{"Name": dimension_name, "Value": lb_dimension}]
    shifts = []
    metric_details = []

    for metric_name, stat, description in metrics_config:
        baseline_avg = _get_period_average(namespace, metric_name, dimensions, baseline_start, baseline_end, period, stat)
        current_avg = _get_period_average(namespace, metric_name, dimensions, current_start, current_end, period, stat)

        detail = {
            "metric": metric_name,
            "description": description,
            "baseline_value": baseline_avg,
            "current_value": current_avg,
        }

        if baseline_avg is not None and current_avg is not None:
            if baseline_avg > 0:
                pct_change = ((current_avg - baseline_avg) / baseline_avg) * 100
            elif current_avg > 0:
                pct_change = 100.0
            else:
                pct_change = 0.0

            detail["pct_change"] = round(pct_change, 2)
            detail["shift_detected"] = abs(pct_change) > shift_threshold

            if detail["shift_detected"]:
                shifts.append({
                    "metric": metric_name,
                    "description": description,
                    "baseline": baseline_avg,
                    "current": current_avg,
                    "pct_change": round(pct_change, 2),
                    "direction": "increase" if pct_change > 0 else "decrease",
                })

        metric_details.append(detail)

    # Get target health for context
    target_health = _get_target_health(lb_arn)

    return {
        "status": "success",
        "load_balancer": lb_dimension,
        "lb_type": lb_type,
        "baseline_period": f"{baseline_start_ago}m ago to {baseline_end_ago}m ago",
        "current_period": f"last {current_minutes}m",
        "shift_threshold_pct": shift_threshold,
        "metrics": metric_details,
        "shifts_detected": shifts,
        "shift_count": len(shifts),
        "target_health": target_health,
        "summary": f"Detected {len(shifts)} metric shifts exceeding {shift_threshold}% threshold on {lb_dimension}."
    }


# =============================================================================
# Helper Functions
# =============================================================================
def _stdev(values):
    """Calculate standard deviation."""
    if len(values) < 2:
        return 0
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
    return math.sqrt(variance)


def _ip_in_cidr(ip, cidr):
    """Check if an IP is in a CIDR range."""
    try:
        ip_parts = ip.split(".")
        cidr_ip, cidr_mask = cidr.split("/")
        cidr_parts = cidr_ip.split(".")
        mask = int(cidr_mask)

        ip_int = sum(int(p) << (24 - 8 * i) for i, p in enumerate(ip_parts))
        cidr_int = sum(int(p) << (24 - 8 * i) for i, p in enumerate(cidr_parts))
        mask_int = (0xFFFFFFFF << (32 - mask)) & 0xFFFFFFFF

        return (ip_int & mask_int) == (cidr_int & mask_int)
    except Exception:
        return False


def _extract_lb_dimension(arn, lb_type):
    """Extract the CloudWatch dimension value from LB ARN."""
    # If already in short form (app/xxx/yyy or net/xxx/yyy)
    if arn.startswith("app/") or arn.startswith("net/"):
        return arn

    # Extract from full ARN
    # arn:aws:elasticloadbalancing:region:account:loadbalancer/app/name/id
    if "/app/" in arn:
        idx = arn.index("/app/")
        return arn[idx + 1:]
    elif "/net/" in arn:
        idx = arn.index("/net/")
        return arn[idx + 1:]

    return arn


def _get_period_average(namespace, metric_name, dimensions, start, end, period, stat):
    """Get average metric value over a period."""
    try:
        response = cw_client.get_metric_data(
            MetricDataQueries=[
                {
                    "Id": "m1",
                    "MetricStat": {
                        "Metric": {
                            "Namespace": namespace,
                            "MetricName": metric_name,
                            "Dimensions": dimensions,
                        },
                        "Period": period,
                        "Stat": stat,
                    },
                    "ReturnData": True,
                }
            ],
            StartTime=start,
            EndTime=end,
            ScanBy="TimestampAscending",
        )

        results = response.get("MetricDataResults", [])
        if not results or not results[0].get("Values"):
            return None

        values = results[0]["Values"]
        return round(sum(values) / len(values), 4) if values else None

    except Exception:
        return None


def _get_target_health(lb_arn):
    """Get target group health for the load balancer."""
    try:
        # Find target groups for this LB
        tg_resp = elbv2_client.describe_target_groups(LoadBalancerArn=lb_arn)
        health_info = []

        for tg in tg_resp.get("TargetGroups", []):
            try:
                th_resp = elbv2_client.describe_target_health(
                    TargetGroupArn=tg["TargetGroupArn"]
                )
                healthy = sum(1 for t in th_resp.get("TargetHealthDescriptions", [])
                             if t.get("TargetHealth", {}).get("State") == "healthy")
                unhealthy = sum(1 for t in th_resp.get("TargetHealthDescriptions", [])
                               if t.get("TargetHealth", {}).get("State") == "unhealthy")
                total = len(th_resp.get("TargetHealthDescriptions", []))

                health_info.append({
                    "target_group": tg["TargetGroupName"],
                    "healthy": healthy,
                    "unhealthy": unhealthy,
                    "total": total,
                })
            except Exception:
                continue

        return health_info if health_info else None

    except Exception:
        return None
