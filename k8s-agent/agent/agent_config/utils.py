import boto3
from botocore.exceptions import ClientError
import logging

logger = logging.getLogger(__name__)


def get_ssm_parameter(name: str, with_decryption: bool = True) -> str:
    try:
        ssm = boto3.client("ssm")
        response = ssm.get_parameter(Name=name, WithDecryption=with_decryption)
        return response["Parameter"]["Value"]
    except ClientError as e:
        if e.response['Error']['Code'] == 'ParameterNotFound':
            return None
        raise


def get_aws_account_id() -> str | None:
    try:
        return boto3.client("sts").get_caller_identity()["Account"]
    except Exception as e:
        logger.warning(f"Could not get AWS account ID: {e}")
        return None
