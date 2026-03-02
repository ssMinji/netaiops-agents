"""
=============================================================================
Lambda Function - DNS Tools
Lambda 함수 - DNS 도구
=============================================================================

Description (설명):
    Provides MCP tools for querying Route 53 DNS and performing DNS resolution.
    Route 53 DNS 조회 및 DNS 해석 기능을 제공합니다.

Tools (도구):
    - dns-list-hosted-zones: List Route 53 hosted zones (호스팅 존 목록)
    - dns-query-records: Query DNS records (DNS 레코드 조회)
    - dns-check-health: Check Route 53 health checks (헬스 체크 상태)
    - dns-resolve: Resolve DNS names (DNS 이름 해석)

Author: NetAIOps Team
=============================================================================
"""

import json
import os

import boto3
import dns.resolver

# =============================================================================
# Configuration (설정)
# =============================================================================
REGION = os.environ.get("AWS_REGION", "us-east-1")

route53 = boto3.client("route53", region_name=REGION)

# =============================================================================
# Tool Schema Definitions (도구 스키마 정의)
# =============================================================================
TOOL_SCHEMAS = [
    {
        "name": "dns-list-hosted-zones",
        "description": "List all Route 53 hosted zones. Route 53 호스팅 존 목록을 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "max_items": {
                    "type": "integer",
                    "description": "Maximum number of hosted zones to return. Default: 100"
                }
            },
            "required": []
        }
    },
    {
        "name": "dns-query-records",
        "description": "Query DNS records in a specific hosted zone. 특정 호스팅 존의 DNS 레코드를 조회합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "zone_id": {
                    "type": "string",
                    "description": "Route 53 hosted zone ID"
                },
                "record_name": {
                    "type": "string",
                    "description": "DNS record name filter (optional)"
                },
                "record_type": {
                    "type": "string",
                    "description": "DNS record type filter (A, AAAA, CNAME, MX, TXT, etc.)",
                    "enum": ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "PTR", "CAA"]
                },
                "max_items": {
                    "type": "integer",
                    "description": "Maximum number of records to return. Default: 100"
                }
            },
            "required": ["zone_id"]
        }
    },
    {
        "name": "dns-check-health",
        "description": "Check Route 53 health check statuses. Route 53 헬스 체크 상태를 확인합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "health_check_id": {
                    "type": "string",
                    "description": "Specific health check ID to query (optional, returns all if not specified)"
                }
            },
            "required": []
        }
    },
    {
        "name": "dns-resolve",
        "description": "Resolve a DNS name using public DNS resolvers. 공용 DNS 리졸버를 사용하여 DNS 이름을 해석합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "hostname": {
                    "type": "string",
                    "description": "Hostname to resolve (e.g., 'example.com')"
                },
                "record_type": {
                    "type": "string",
                    "description": "DNS record type to query. Default: A",
                    "enum": ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "PTR"]
                },
                "nameserver": {
                    "type": "string",
                    "description": "Custom nameserver to use (optional, e.g., '8.8.8.8')"
                }
            },
            "required": ["hostname"]
        }
    }
]


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
        elif "hostname" in event:
            tool_name = "dns-resolve"
        elif "zone_id" in event:
            tool_name = "dns-query-records"
        elif "health_check_id" in event:
            tool_name = "dns-check-health"
        else:
            tool_name = "dns-list-hosted-zones"

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
        "dns-list-hosted-zones": handle_list_hosted_zones,
        "dns-query-records": handle_query_records,
        "dns-check-health": handle_check_health,
        "dns-resolve": handle_resolve,
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
def handle_list_hosted_zones(params):
    """List all Route 53 hosted zones."""
    max_items = str(params.get("max_items", 100))

    try:
        response = route53.list_hosted_zones(MaxItems=max_items)
        zones = []
        for zone in response.get("HostedZones", []):
            zones.append({
                "id": zone["Id"].split("/")[-1],
                "name": zone["Name"],
                "record_count": zone.get("ResourceRecordSetCount", 0),
                "private": zone.get("Config", {}).get("PrivateZone", False),
                "comment": zone.get("Config", {}).get("Comment", ""),
            })

        return {
            "status": "success",
            "hosted_zones": zones,
            "total": len(zones),
            "is_truncated": response.get("IsTruncated", False),
        }
    except Exception as e:
        return {"error": f"Failed to list hosted zones: {str(e)}"}


def handle_query_records(params):
    """Query DNS records in a hosted zone."""
    zone_id = params.get("zone_id", "")
    record_name = params.get("record_name", "")
    record_type = params.get("record_type", "")
    max_items = str(params.get("max_items", 100))

    if not zone_id:
        return {"error": "zone_id is required"}

    try:
        kwargs = {
            "HostedZoneId": zone_id,
            "MaxItems": max_items,
        }
        if record_name:
            kwargs["StartRecordName"] = record_name
        if record_type:
            kwargs["StartRecordType"] = record_type

        response = route53.list_resource_record_sets(**kwargs)

        records = []
        for rrs in response.get("ResourceRecordSets", []):
            # Apply filters
            if record_name and not rrs["Name"].startswith(record_name):
                continue
            if record_type and rrs["Type"] != record_type:
                continue

            record = {
                "name": rrs["Name"],
                "type": rrs["Type"],
                "ttl": rrs.get("TTL"),
            }

            if "ResourceRecords" in rrs:
                record["values"] = [r["Value"] for r in rrs["ResourceRecords"]]
            if "AliasTarget" in rrs:
                record["alias"] = {
                    "dns_name": rrs["AliasTarget"]["DNSName"],
                    "zone_id": rrs["AliasTarget"]["HostedZoneId"],
                    "evaluate_health": rrs["AliasTarget"]["EvaluateTargetHealth"],
                }
            if "Weight" in rrs:
                record["weight"] = rrs["Weight"]
            if "Region" in rrs:
                record["region"] = rrs["Region"]
            if "Failover" in rrs:
                record["failover"] = rrs["Failover"]

            records.append(record)

        return {
            "status": "success",
            "zone_id": zone_id,
            "records": records,
            "total": len(records),
        }
    except Exception as e:
        return {"error": f"Failed to query records: {str(e)}"}


def handle_check_health(params):
    """Check Route 53 health check statuses."""
    health_check_id = params.get("health_check_id", "")

    try:
        if health_check_id:
            # Get specific health check
            hc_response = route53.get_health_check(HealthCheckId=health_check_id)
            status_response = route53.get_health_check_status(HealthCheckId=health_check_id)

            hc = hc_response["HealthCheck"]
            config = hc.get("HealthCheckConfig", {})

            checkers = []
            for checker in status_response.get("HealthCheckObservations", []):
                checkers.append({
                    "region": checker.get("Region", "unknown"),
                    "ip": checker.get("IPAddress", ""),
                    "status": checker.get("StatusReport", {}).get("Status", "unknown"),
                    "checked_time": str(checker.get("StatusReport", {}).get("CheckedTime", "")),
                })

            return {
                "status": "success",
                "health_check": {
                    "id": health_check_id,
                    "type": config.get("Type", ""),
                    "fqdn": config.get("FullyQualifiedDomainName", ""),
                    "ip": config.get("IPAddress", ""),
                    "port": config.get("Port"),
                    "resource_path": config.get("ResourcePath", ""),
                    "request_interval": config.get("RequestInterval"),
                    "failure_threshold": config.get("FailureThreshold"),
                },
                "checker_results": checkers,
            }
        else:
            # List all health checks
            response = route53.list_health_checks()
            checks = []
            for hc in response.get("HealthChecks", []):
                config = hc.get("HealthCheckConfig", {})
                checks.append({
                    "id": hc["Id"],
                    "type": config.get("Type", ""),
                    "fqdn": config.get("FullyQualifiedDomainName", ""),
                    "ip": config.get("IPAddress", ""),
                    "port": config.get("Port"),
                    "resource_path": config.get("ResourcePath", ""),
                })

            return {
                "status": "success",
                "health_checks": checks,
                "total": len(checks),
            }
    except Exception as e:
        return {"error": f"Failed to check health: {str(e)}"}


def handle_resolve(params):
    """Resolve a DNS name using DNS resolvers."""
    hostname = params.get("hostname", "")
    record_type = params.get("record_type", "A")
    nameserver = params.get("nameserver", "")

    if not hostname:
        return {"error": "hostname is required"}

    try:
        resolver = dns.resolver.Resolver()
        if nameserver:
            resolver.nameservers = [nameserver]

        answers = resolver.resolve(hostname, record_type)

        results = []
        for rdata in answers:
            results.append(str(rdata))

        return {
            "status": "success",
            "hostname": hostname,
            "record_type": record_type,
            "nameserver": nameserver or "system default",
            "ttl": answers.rrset.ttl,
            "results": results,
        }
    except dns.resolver.NXDOMAIN:
        return {
            "status": "nxdomain",
            "hostname": hostname,
            "record_type": record_type,
            "error": f"Domain {hostname} does not exist (NXDOMAIN)",
        }
    except dns.resolver.NoAnswer:
        return {
            "status": "no_answer",
            "hostname": hostname,
            "record_type": record_type,
            "error": f"No {record_type} records found for {hostname}",
        }
    except dns.resolver.NoNameservers:
        return {
            "status": "no_nameservers",
            "hostname": hostname,
            "error": "No nameservers available to answer the query",
        }
    except Exception as e:
        return {"error": f"DNS resolution failed: {str(e)}", "hostname": hostname}
