"""
=============================================================================
Lambda Function - Istio Fault Injection MCP Tools (Module 7)
Lambda 함수 - Istio 장애 주입 MCP 도구 (모듈 7)
=============================================================================

Description (설명):
    Provides MCP tools for applying/removing Istio fault injection resources
    on the EKS cluster via Kubernetes CustomObjectsApi.
    Kubernetes CustomObjectsApi를 통해 EKS 클러스터에 Istio 장애 주입 리소스를
    적용/삭제하는 MCP 도구를 제공합니다.

Tools (도구):
    - fault-delay-inject: Apply 7s delay on reviews-v2 VirtualService
    - fault-abort-inject: Apply 50% HTTP 503 abort on ratings VirtualService
    - fault-circuit-breaker: Apply circuit breaker DestinationRule on reviews
    - fault-cleanup: Remove fault injection resources (all or specific type)

Environment Variables (환경변수):
    TARGET_REGION: AWS region (default: us-west-2)
    AWS_REGION: Fallback region if TARGET_REGION not set

Author: NetAIOps Team
Module: workshop-module-7
=============================================================================
"""

import json
import os
import logging
import base64
import re
import boto3
from botocore.signers import RequestSigner

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# =============================================================================
# Configuration (설정)
# =============================================================================
REGION = os.environ.get("TARGET_REGION", os.environ.get("AWS_REGION", "us-west-2"))
CLUSTER_NAME = "netaiops-eks-cluster"
NAMESPACE = "istio-sample"

# Istio CRD API info
ISTIO_GROUP = "networking.istio.io"
ISTIO_VERSION = "v1beta1"

# =============================================================================
# Tool Schema Definitions (도구 스키마 정의)
# =============================================================================
TOOL_SCHEMAS = [
    {
        "name": "fault-delay-inject",
        "description": "Inject 7s delay on reviews-v2 VirtualService. reviews-v2에 7초 지연을 주입합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "fault-abort-inject",
        "description": "Inject 50% HTTP 503 abort on ratings VirtualService. ratings에 50% 503 에러를 주입합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "fault-circuit-breaker",
        "description": "Apply circuit breaker DestinationRule on reviews. reviews에 서킷 브레이커를 적용합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "fault-cleanup",
        "description": "Remove fault injection resources. 장애 주입 리소스를 삭제합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "fault_type": {
                    "type": "string",
                    "description": "Optional: specific fault to remove (delay/abort/circuit-breaker). Omit to remove all."
                }
            },
            "required": []
        }
    },
]

# =============================================================================
# Istio Resource Definitions (Istio 리소스 정의)
# Embedded as dicts to remove file dependency.
# 파일 의존성을 제거하기 위해 dict로 내장.
# =============================================================================

# Original (baseline) VirtualService specs for restoration after cleanup.
# Cleanup 후 원본 복원을 위한 기본 VirtualService 스펙.
ORIGINAL_VIRTUALSERVICES = {
    "reviews": {
        "apiVersion": "networking.istio.io/v1beta1",
        "kind": "VirtualService",
        "metadata": {
            "name": "reviews",
            "namespace": NAMESPACE,
        },
        "spec": {
            "hosts": ["reviews"],
            "http": [
                {
                    "route": [
                        {"destination": {"host": "reviews", "subset": "v1"}, "weight": 80},
                        {"destination": {"host": "reviews", "subset": "v2"}, "weight": 10},
                        {"destination": {"host": "reviews", "subset": "v3"}, "weight": 10},
                    ]
                },
            ],
        },
    },
    "ratings": {
        "apiVersion": "networking.istio.io/v1beta1",
        "kind": "VirtualService",
        "metadata": {
            "name": "ratings",
            "namespace": NAMESPACE,
        },
        "spec": {
            "hosts": ["ratings"],
            "http": [
                {
                    "route": [
                        {"destination": {"host": "ratings", "subset": "v1"}, "weight": 100},
                    ]
                },
            ],
        },
    },
}

FAULT_RESOURCES = {
    "delay": {
        "kind": "VirtualService",
        "plural": "virtualservices",
        "restore_key": "reviews",  # key into ORIGINAL_VIRTUALSERVICES
        "body": {
            "apiVersion": "networking.istio.io/v1beta1",
            "kind": "VirtualService",
            "metadata": {
                "name": "reviews",
                "namespace": NAMESPACE,
                "labels": {"managed-by": "fault-injection-lambda"},
            },
            "spec": {
                "hosts": ["reviews"],
                "http": [
                    {
                        "fault": {
                            "delay": {
                                "percentage": {"value": 100.0},
                                "fixedDelay": "7s",
                            }
                        },
                        "match": [
                            {"headers": {"end-user": {"exact": "jason"}}}
                        ],
                        "route": [
                            {"destination": {"host": "reviews", "subset": "v2"}}
                        ],
                    },
                    {
                        "route": [
                            {"destination": {"host": "reviews", "subset": "v1"}, "weight": 80},
                            {"destination": {"host": "reviews", "subset": "v2"}, "weight": 10},
                            {"destination": {"host": "reviews", "subset": "v3"}, "weight": 10},
                        ]
                    },
                ],
            },
        },
    },
    "abort": {
        "kind": "VirtualService",
        "plural": "virtualservices",
        "restore_key": "ratings",  # key into ORIGINAL_VIRTUALSERVICES
        "body": {
            "apiVersion": "networking.istio.io/v1beta1",
            "kind": "VirtualService",
            "metadata": {
                "name": "ratings",
                "namespace": NAMESPACE,
                "labels": {"managed-by": "fault-injection-lambda"},
            },
            "spec": {
                "hosts": ["ratings"],
                "http": [
                    {
                        "fault": {
                            "abort": {
                                "percentage": {"value": 50.0},
                                "httpStatus": 503,
                            }
                        },
                        "route": [
                            {"destination": {"host": "ratings", "subset": "v1"}}
                        ],
                    }
                ],
            },
        },
    },
    "circuit-breaker": {
        "kind": "DestinationRule",
        "plural": "destinationrules",
        "restore_key": None,  # no original to restore; just delete
        "body": {
            "apiVersion": "networking.istio.io/v1beta1",
            "kind": "DestinationRule",
            "metadata": {
                "name": "reviews-circuit-breaker",
                "namespace": NAMESPACE,
                "labels": {"managed-by": "fault-injection-lambda"},
            },
            "spec": {
                "host": "reviews",
                "trafficPolicy": {
                    "connectionPool": {
                        "tcp": {"maxConnections": 10},
                        "http": {
                            "http1MaxPendingRequests": 5,
                            "http2MaxRequests": 10,
                            "maxRequestsPerConnection": 5,
                        },
                    },
                    "outlierDetection": {
                        "consecutive5xxErrors": 3,
                        "interval": "10s",
                        "baseEjectionTime": "30s",
                        "maxEjectionPercent": 50,
                    },
                },
                "subsets": [
                    {"name": "v1", "labels": {"version": "v1"}},
                    {"name": "v2", "labels": {"version": "v2"}},
                    {"name": "v3", "labels": {"version": "v3"}},
                ],
            },
        },
    },
}


# =============================================================================
# Kubernetes Client Setup (쿠버네티스 클라이언트 설정)
# =============================================================================
def _get_eks_token():
    """Generate a presigned token for EKS authentication.
    EKS 인증을 위한 사전 서명 토큰을 생성합니다."""
    STS_TOKEN_EXPIRES_IN = 60
    session = boto3.session.Session()

    sts_client = session.client("sts", region_name=REGION)
    service_id = sts_client.meta.service_model.service_id

    signer = RequestSigner(
        service_id,
        REGION,
        "sts",
        "v4",
        session.get_credentials(),
        session.events
    )

    params = {
        "method": "GET",
        "url": f"https://sts.{REGION}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15",
        "body": {},
        "headers": {"x-k8s-aws-id": CLUSTER_NAME},
        "context": {},
    }

    signed_url = signer.generate_presigned_url(
        params,
        region_name=REGION,
        expires_in=STS_TOKEN_EXPIRES_IN,
        operation_name="",
    )

    base64_url = base64.urlsafe_b64encode(signed_url.encode("utf-8")).decode("utf-8")
    # Remove base64 padding
    return "k8s-aws-v1." + re.sub(r"=*", "", base64_url)


def _get_k8s_client():
    """Get an authenticated Kubernetes API client for the EKS cluster.
    EKS 클러스터용 인증된 쿠버네티스 API 클라이언트를 가져옵니다."""
    from kubernetes import client as k8s_client
    from kubernetes.client import Configuration

    # Get EKS cluster info (EKS 클러스터 정보 가져오기)
    eks_client = boto3.client("eks", region_name=REGION)
    cluster_info = eks_client.describe_cluster(name=CLUSTER_NAME)
    cluster = cluster_info["cluster"]

    # Configure kubernetes client (쿠버네티스 클라이언트 설정)
    configuration = Configuration()
    configuration.host = cluster["endpoint"]
    configuration.verify_ssl = True

    # Write CA cert to temp file (CA 인증서를 임시 파일에 작성)
    ca_data = base64.b64decode(cluster["certificateAuthority"]["data"])
    ca_file = "/tmp/eks_ca.crt"
    with open(ca_file, "wb") as f:
        f.write(ca_data)
    configuration.ssl_ca_cert = ca_file

    # Get token (토큰 가져오기)
    configuration.api_key = {"authorization": f"Bearer {_get_eks_token()}"}

    api_client = k8s_client.ApiClient(configuration)
    return api_client


# =============================================================================
# Main Handler (메인 핸들러)
# =============================================================================
def _extract_tool_info(event):
    """Extract tool name and arguments from various event formats.
    다양한 이벤트 형식에서 도구 이름과 인자를 추출합니다."""
    tool_name = ""
    arguments = {}

    # MCP protocol format
    method = event.get("method", "")
    if method == "tools/list":
        return "__list_tools__", {}
    if method == "tools/call":
        params = event.get("params", {})
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
    # Direct invocation: {"tool_name": "...", "parameters": {...}}
    elif "tool_name" in event:
        tool_name = event["tool_name"]
        arguments = event.get("parameters", {})
    # Simplified: {"name": "...", "arguments": {...}}
    elif "name" in event:
        tool_name = event["name"]
        arguments = event.get("arguments", {})
    # Legacy: {"action": "list_tools"}
    elif event.get("action") == "list_tools":
        return "__list_tools__", {}
    else:
        arguments = event
        return "", arguments

    # Strip MCP Gateway target prefix (TargetName___tool-name -> tool-name)
    if "___" in tool_name:
        tool_name = tool_name.split("___", 1)[1]

    return tool_name, arguments


def lambda_handler(event, context):
    """Main Lambda handler. 메인 Lambda 핸들러."""
    print(f"RAW_EVENT: {json.dumps(event, default=str)[:2000]}")
    tool_name, parameters = _extract_tool_info(event)
    print(f"EXTRACTED: tool_name={tool_name}, parameters={json.dumps(parameters, default=str)[:500]}")

    if tool_name == "__list_tools__":
        return {"tools": TOOL_SCHEMAS}

    handlers = {
        "fault-delay-inject": handle_delay_inject,
        "fault-abort-inject": handle_abort_inject,
        "fault-circuit-breaker": handle_circuit_breaker,
        "fault-cleanup": handle_cleanup,
    }

    handler = handlers.get(tool_name)
    if not handler:
        return {
            "error": f"Unknown tool: {tool_name}. Please specify tool name using 'name' field.",
            "available_tools": list(handlers.keys()),
            "hint": "Use payload format: {\"name\": \"fault-delay-inject\", \"arguments\": {}}"
        }

    try:
        return handler(parameters)
    except Exception as e:
        logger.error(f"Tool execution failed: {str(e)}", exc_info=True)
        return {"error": f"Tool execution failed: {str(e)}", "tool": tool_name}


# =============================================================================
# Helpers (헬퍼)
# =============================================================================
def _apply_istio_resource(fault_type: str) -> dict:
    """Apply an Istio CRD resource (create or update).
    Istio CRD 리소스를 적용합니다 (생성 또는 업데이트)."""
    from kubernetes import client as k8s_client

    resource = FAULT_RESOURCES[fault_type]
    body = resource["body"]
    plural = resource["plural"]
    name = body["metadata"]["name"]

    api_client = _get_k8s_client()
    custom_api = k8s_client.CustomObjectsApi(api_client)

    try:
        # Try to replace existing resource (기존 리소스 업데이트 시도)
        existing = custom_api.get_namespaced_custom_object(
            group=ISTIO_GROUP,
            version=ISTIO_VERSION,
            namespace=NAMESPACE,
            plural=plural,
            name=name,
        )
        # Preserve resourceVersion for update (업데이트를 위해 resourceVersion 유지)
        body["metadata"]["resourceVersion"] = existing["metadata"]["resourceVersion"]
        custom_api.replace_namespaced_custom_object(
            group=ISTIO_GROUP,
            version=ISTIO_VERSION,
            namespace=NAMESPACE,
            plural=plural,
            name=name,
            body=body,
        )
        action = "updated"
    except k8s_client.exceptions.ApiException as e:
        if e.status == 404:
            # Resource doesn't exist, create it (리소스가 없으면 생성)
            custom_api.create_namespaced_custom_object(
                group=ISTIO_GROUP,
                version=ISTIO_VERSION,
                namespace=NAMESPACE,
                plural=plural,
                body=body,
            )
            action = "created"
        else:
            raise

    return {
        "status": "success",
        "message": f"{action} {resource['kind']}/{name} in namespace {NAMESPACE}",
        "resource": f"{resource['kind']}/{name}",
        "namespace": NAMESPACE,
        "cluster": CLUSTER_NAME,
        "action": action,
    }


def _delete_istio_resource(fault_type: str) -> dict:
    """Remove fault injection: restore original VirtualService or delete DestinationRule.
    장애 주입 제거: VirtualService는 원본 복원, DestinationRule은 삭제."""
    from kubernetes import client as k8s_client

    resource = FAULT_RESOURCES[fault_type]
    plural = resource["plural"]
    name = resource["body"]["metadata"]["name"]
    restore_key = resource.get("restore_key")

    api_client = _get_k8s_client()
    custom_api = k8s_client.CustomObjectsApi(api_client)

    # If there's an original spec, restore it instead of deleting
    # 원본 스펙이 있으면 삭제 대신 복원
    if restore_key and restore_key in ORIGINAL_VIRTUALSERVICES:
        original_body = ORIGINAL_VIRTUALSERVICES[restore_key]
        try:
            existing = custom_api.get_namespaced_custom_object(
                group=ISTIO_GROUP,
                version=ISTIO_VERSION,
                namespace=NAMESPACE,
                plural=plural,
                name=name,
            )
            original_body["metadata"]["resourceVersion"] = existing["metadata"]["resourceVersion"]
            custom_api.replace_namespaced_custom_object(
                group=ISTIO_GROUP,
                version=ISTIO_VERSION,
                namespace=NAMESPACE,
                plural=plural,
                name=name,
                body=original_body,
            )
            return {
                "status": "success",
                "message": f"Restored original {resource['kind']}/{name} in namespace {NAMESPACE}",
                "resource": f"{resource['kind']}/{name}",
                "namespace": NAMESPACE,
                "action": "restored",
            }
        except k8s_client.exceptions.ApiException as e:
            if e.status == 404:
                # Resource was already deleted; recreate original
                # 리소스가 이미 삭제됨; 원본 재생성
                custom_api.create_namespaced_custom_object(
                    group=ISTIO_GROUP,
                    version=ISTIO_VERSION,
                    namespace=NAMESPACE,
                    plural=plural,
                    body=original_body,
                )
                return {
                    "status": "success",
                    "message": f"Recreated original {resource['kind']}/{name} in namespace {NAMESPACE}",
                    "resource": f"{resource['kind']}/{name}",
                    "namespace": NAMESPACE,
                    "action": "recreated",
                }
            raise

    # No original to restore; delete the resource (e.g. circuit-breaker DestinationRule)
    # 복원할 원본 없음; 리소스 삭제 (예: circuit-breaker DestinationRule)
    try:
        custom_api.delete_namespaced_custom_object(
            group=ISTIO_GROUP,
            version=ISTIO_VERSION,
            namespace=NAMESPACE,
            plural=plural,
            name=name,
        )
        return {
            "status": "success",
            "message": f"Deleted {resource['kind']}/{name} from namespace {NAMESPACE}",
            "resource": f"{resource['kind']}/{name}",
            "namespace": NAMESPACE,
            "action": "deleted",
        }
    except k8s_client.exceptions.ApiException as e:
        if e.status == 404:
            return {
                "status": "success",
                "message": f"{resource['kind']}/{name} not found (already removed)",
                "resource": f"{resource['kind']}/{name}",
                "namespace": NAMESPACE,
                "action": "not_found",
            }
        raise


# =============================================================================
# Tool Handlers (도구 핸들러)
# =============================================================================
def handle_delay_inject(params):
    """Apply 7s delay on reviews-v2 VirtualService.
    reviews-v2에 7초 지연 VirtualService를 적용합니다."""
    return _apply_istio_resource("delay")


def handle_abort_inject(params):
    """Apply 50% HTTP 503 abort on ratings VirtualService.
    ratings에 50% 503 에러 VirtualService를 적용합니다."""
    return _apply_istio_resource("abort")


def handle_circuit_breaker(params):
    """Apply circuit breaker DestinationRule on reviews.
    reviews에 서킷 브레이커 DestinationRule을 적용합니다."""
    return _apply_istio_resource("circuit-breaker")


def handle_cleanup(params):
    """Remove fault injection resources (all or specific type).
    장애 주입 리소스를 삭제합니다 (전체 또는 특정 타입)."""
    fault_type = params.get("fault_type", "") if params else ""

    if fault_type:
        # Delete specific fault type (특정 타입만 삭제)
        if fault_type not in FAULT_RESOURCES:
            return {
                "error": f"Unknown fault type: {fault_type}",
                "available_types": list(FAULT_RESOURCES.keys()),
            }
        return _delete_istio_resource(fault_type)

    # Delete all fault resources (모든 장애 주입 리소스 삭제)
    reverted = []
    errors = []

    for ft in FAULT_RESOURCES:
        try:
            result = _delete_istio_resource(ft)
            action = result.get("action", "unknown")
            reverted.append(f"{result['resource']} ({action})")
        except Exception as e:
            errors.append(f"{ft}: {str(e)}")

    result = {
        "status": "success" if not errors else "partial",
        "message": f"Reverted {len(reverted)} fault injection resource(s)",
        "reverted": reverted,
        "namespace": NAMESPACE,
        "cluster": CLUSTER_NAME,
    }

    if errors:
        result["errors"] = errors

    return result
