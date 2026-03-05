"""
=============================================================================
Lambda Function - CloudWatch Anomaly Detection MCP Tools
Lambda 함수 - CloudWatch 이상탐지 MCP 도구
=============================================================================

Tools (도구):
    - anomaly-detect-metrics: CloudWatch ML anomaly detection band analysis
    - anomaly-get-alarms: CloudWatch anomaly detection alarm status

Author: NetAIOps Team
=============================================================================
"""

import json
import os
import boto3
from datetime import datetime, timedelta

REGION = os.environ.get("TARGET_REGION", os.environ.get("AWS_REGION", "us-east-1"))
cw_client = boto3.client("cloudwatch", region_name=REGION)

# =============================================================================
# Tool Schema Definitions
# =============================================================================
TOOL_SCHEMAS = [
    {
        "name": "anomaly-detect-metrics",
        "description": "Detect metric anomalies using CloudWatch ANOMALY_DETECTION_BAND. Returns time windows where metric values breach the expected band. If anomaly detector is not trained yet, falls back to statistical analysis (mean +/- 2 standard deviations). 메트릭 이상탐지 밴드 기반 이상 감지.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "_tool": {"type": "string", "description": 'Tool identifier. Must be "anomaly-detect-metrics".'},
                "namespace": {"type": "string", "description": "CloudWatch namespace. Allowed values: AWS/EC2, AWS/ELB, AWS/ApplicationELB, AWS/NetworkELB, AWS/NATGateway, ContainerInsights, AWS/VPN, AWS/TransitGateway"},
                "metric_name": {"type": "string", "description": "CloudWatch metric name (e.g., CPUUtilization, NetworkIn, ActiveFlowCount)"},
                "dimensions": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "CloudWatch dimensions as [{\"Name\":\"key\",\"Value\":\"val\"}]. Example: [{\"Name\":\"InstanceId\",\"Value\":\"i-xxx\"}]"
                },
                "stat": {"type": "string", "description": "Statistic. Allowed values: Average, Sum, Maximum, Minimum, SampleCount. Default: Average"},
                "band_width": {"type": "number", "description": "Anomaly detection band width (standard deviations). Default: 2"},
                "minutes": {"type": "integer", "description": "How many minutes back to analyze. Default: 120"},
                "period": {"type": "integer", "description": "Metric period in seconds. Default: 300"}
            },
            "required": ["_tool", "namespace", "metric_name"]
        }
    },
    {
        "name": "anomaly-get-alarms",
        "description": "Get CloudWatch anomaly detection alarm statuses. Filters alarms that use anomaly detection (ThresholdMetricId present). Returns alarm name, state, metric, and last state change. 이상탐지 알람 상태를 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "_tool": {"type": "string", "description": 'Tool identifier. Must be "anomaly-get-alarms".'},
                "alarm_name_prefix": {"type": "string", "description": "Filter alarms by name prefix (optional)"},
                "state_value": {"type": "string", "description": "Filter by alarm state. Allowed values: OK, ALARM, INSUFFICIENT_DATA. Default: all states"}
            },
            "required": ["_tool"]
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
        elif "metric_name" in event:
            tool_name = "anomaly-detect-metrics"
        elif "alarm_name_prefix" in event or "state_value" in event:
            tool_name = "anomaly-get-alarms"

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
        "anomaly-detect-metrics": handle_detect_metrics,
        "anomaly-get-alarms": handle_get_alarms,
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}", "available_tools": list(handlers.keys()), "raw_event_keys": list(event.keys())}

    try:
        return handler(parameters)
    except Exception as e:
        return {"error": f"Tool execution failed: {str(e)}", "tool": tool_name}


# =============================================================================
# Tool Handlers
# =============================================================================
def handle_detect_metrics(params):
    """Detect anomalies using ANOMALY_DETECTION_BAND or statistical fallback."""
    namespace = params["namespace"]
    metric_name = params["metric_name"]
    dimensions = params.get("dimensions", [])
    stat = params.get("stat", "Average")
    band_width = params.get("band_width", 2)
    minutes = params.get("minutes", 120)
    period = params.get("period", 300)

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(minutes=minutes)

    # Try anomaly detection band first
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
                },
                {
                    "Id": "ad1",
                    "Expression": f"ANOMALY_DETECTION_BAND(m1, {band_width})",
                    "ReturnData": True,
                },
            ],
            StartTime=start_time,
            EndTime=end_time,
            ScanBy="TimestampAscending",
        )

        results = {r["Id"]: r for r in response.get("MetricDataResults", [])}
        m1 = results.get("m1", {})
        ad1 = results.get("ad1", {})

        m1_values = m1.get("Values", [])
        m1_timestamps = m1.get("Timestamps", [])
        ad1_values = ad1.get("Values", [])

        if not m1_values:
            return {
                "status": "no_data",
                "namespace": namespace,
                "metric_name": metric_name,
                "message": "No metric data available for the specified time range."
            }

        # If anomaly band has data, use it
        if ad1_values and len(ad1_values) > 0:
            return _analyze_with_band(
                namespace, metric_name, dimensions, stat,
                m1_timestamps, m1_values, ad1_values,
                band_width, minutes, period
            )
        else:
            # Fallback to statistical analysis
            return _analyze_statistical(
                namespace, metric_name, dimensions, stat,
                m1_timestamps, m1_values,
                minutes, period
            )

    except Exception as e:
        error_msg = str(e)
        # If anomaly detection band fails, try plain metric + statistical analysis
        if "ANOMALY_DETECTION_BAND" in error_msg or "Validation" in error_msg:
            return _fallback_statistical_analysis(
                namespace, metric_name, dimensions, stat,
                start_time, end_time, minutes, period
            )
        raise


def _analyze_with_band(namespace, metric_name, dimensions, stat,
                       timestamps, values, band_values, band_width, minutes, period):
    """Analyze using CloudWatch anomaly detection band."""
    anomalies = []
    data_points = []

    for i, (ts, val) in enumerate(zip(timestamps, values)):
        ts_str = ts.strftime("%Y-%m-%d %H:%M:%S")
        point = {"timestamp": ts_str, "value": round(val, 4)}

        # band_values contains alternating lower/upper bounds
        if i * 2 + 1 < len(band_values):
            lower = band_values[i * 2]
            upper = band_values[i * 2 + 1]
            point["band_lower"] = round(lower, 4)
            point["band_upper"] = round(upper, 4)

            if val > upper:
                point["anomaly"] = "above_band"
                anomalies.append({
                    "timestamp": ts_str,
                    "value": round(val, 4),
                    "upper_bound": round(upper, 4),
                    "deviation": round(val - upper, 4),
                    "direction": "above"
                })
            elif val < lower:
                point["anomaly"] = "below_band"
                anomalies.append({
                    "timestamp": ts_str,
                    "value": round(val, 4),
                    "lower_bound": round(lower, 4),
                    "deviation": round(lower - val, 4),
                    "direction": "below"
                })

        data_points.append(point)

    return {
        "status": "success",
        "method": "anomaly_detection_band",
        "namespace": namespace,
        "metric_name": metric_name,
        "dimensions": dimensions,
        "statistic": stat,
        "band_width": band_width,
        "time_range_minutes": minutes,
        "total_data_points": len(data_points),
        "anomaly_count": len(anomalies),
        "anomalies": anomalies,
        "data_points": data_points[-20:],  # Last 20 points for context
        "summary": f"Detected {len(anomalies)} anomalous data points out of {len(data_points)} using ML band (width={band_width}σ)."
    }


def _analyze_statistical(namespace, metric_name, dimensions, stat,
                         timestamps, values, minutes, period):
    """Statistical fallback: mean ± 2σ."""
    import statistics

    if len(values) < 3:
        return {
            "status": "insufficient_data",
            "namespace": namespace,
            "metric_name": metric_name,
            "message": "Need at least 3 data points for statistical analysis."
        }

    mean = statistics.mean(values)
    stdev = statistics.stdev(values) if len(values) > 1 else 0
    upper_threshold = mean + 2 * stdev
    lower_threshold = mean - 2 * stdev

    anomalies = []
    data_points = []

    for ts, val in zip(timestamps, values):
        ts_str = ts.strftime("%Y-%m-%d %H:%M:%S")
        point = {
            "timestamp": ts_str,
            "value": round(val, 4),
            "band_lower": round(lower_threshold, 4),
            "band_upper": round(upper_threshold, 4),
        }

        if val > upper_threshold:
            point["anomaly"] = "above_threshold"
            anomalies.append({
                "timestamp": ts_str,
                "value": round(val, 4),
                "upper_bound": round(upper_threshold, 4),
                "deviation_sigma": round((val - mean) / stdev, 2) if stdev > 0 else 0,
                "direction": "above"
            })
        elif val < lower_threshold:
            point["anomaly"] = "below_threshold"
            anomalies.append({
                "timestamp": ts_str,
                "value": round(val, 4),
                "lower_bound": round(lower_threshold, 4),
                "deviation_sigma": round((mean - val) / stdev, 2) if stdev > 0 else 0,
                "direction": "below"
            })

        data_points.append(point)

    return {
        "status": "success",
        "method": "statistical_fallback",
        "note": "CloudWatch anomaly detection band not available. Using statistical analysis (mean ± 2σ).",
        "namespace": namespace,
        "metric_name": metric_name,
        "dimensions": dimensions,
        "statistic": stat,
        "time_range_minutes": minutes,
        "stats": {
            "mean": round(mean, 4),
            "stdev": round(stdev, 4),
            "upper_threshold": round(upper_threshold, 4),
            "lower_threshold": round(lower_threshold, 4),
        },
        "total_data_points": len(data_points),
        "anomaly_count": len(anomalies),
        "anomalies": anomalies,
        "data_points": data_points[-20:],
        "summary": f"Detected {len(anomalies)} anomalous data points out of {len(data_points)} using statistical analysis (mean ± 2σ)."
    }


def _fallback_statistical_analysis(namespace, metric_name, dimensions, stat,
                                   start_time, end_time, minutes, period):
    """Complete fallback when ANOMALY_DETECTION_BAND expression fails."""
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
            },
        ],
        StartTime=start_time,
        EndTime=end_time,
        ScanBy="TimestampAscending",
    )

    results = response.get("MetricDataResults", [])
    if not results or not results[0].get("Values"):
        return {
            "status": "no_data",
            "namespace": namespace,
            "metric_name": metric_name,
            "message": "No metric data available."
        }

    m1 = results[0]
    return _analyze_statistical(
        namespace, metric_name, dimensions, stat,
        m1["Timestamps"], m1["Values"],
        minutes, period
    )


def handle_get_alarms(params):
    """Get CloudWatch anomaly detection alarms."""
    alarm_name_prefix = params.get("alarm_name_prefix")
    state_value = params.get("state_value")

    kwargs = {}
    if alarm_name_prefix:
        kwargs["AlarmNamePrefix"] = alarm_name_prefix
    if state_value:
        kwargs["StateValue"] = state_value

    try:
        response = cw_client.describe_alarms(**kwargs)

        # Filter for anomaly detection alarms (have ThresholdMetricId)
        anomaly_alarms = []
        regular_alarms = []

        for alarm in response.get("MetricAlarms", []):
            alarm_info = {
                "alarm_name": alarm.get("AlarmName"),
                "state": alarm.get("StateValue"),
                "state_reason": alarm.get("StateReason", "")[:200],
                "state_updated": alarm.get("StateUpdatedTimestamp", "").strftime("%Y-%m-%d %H:%M:%S") if alarm.get("StateUpdatedTimestamp") else None,
                "metric_name": alarm.get("MetricName"),
                "namespace": alarm.get("Namespace"),
                "dimensions": alarm.get("Dimensions", []),
                "comparison_operator": alarm.get("ComparisonOperator"),
            }

            if alarm.get("ThresholdMetricId"):
                alarm_info["type"] = "anomaly_detection"
                alarm_info["threshold_metric_id"] = alarm.get("ThresholdMetricId")
                anomaly_alarms.append(alarm_info)
            else:
                alarm_info["type"] = "static_threshold"
                alarm_info["threshold"] = alarm.get("Threshold")
                regular_alarms.append(alarm_info)

        # Also check composite alarms
        composite_alarms = []
        for alarm in response.get("CompositeAlarms", []):
            composite_alarms.append({
                "alarm_name": alarm.get("AlarmName"),
                "state": alarm.get("StateValue"),
                "state_reason": alarm.get("StateReason", "")[:200],
                "state_updated": alarm.get("StateUpdatedTimestamp", "").strftime("%Y-%m-%d %H:%M:%S") if alarm.get("StateUpdatedTimestamp") else None,
                "type": "composite",
                "alarm_rule": alarm.get("AlarmRule", "")[:200],
            })

        return {
            "status": "success",
            "anomaly_detection_alarms": anomaly_alarms,
            "static_threshold_alarms": regular_alarms,
            "composite_alarms": composite_alarms,
            "total_anomaly_alarms": len(anomaly_alarms),
            "total_static_alarms": len(regular_alarms),
            "total_composite_alarms": len(composite_alarms),
            "alarms_in_alarm_state": len([a for a in anomaly_alarms + regular_alarms + composite_alarms if a["state"] == "ALARM"]),
            "summary": f"Found {len(anomaly_alarms)} anomaly detection alarms, {len(regular_alarms)} static threshold alarms, {len(composite_alarms)} composite alarms."
        }

    except Exception as e:
        return {"error": f"Failed to describe alarms: {str(e)}"}
