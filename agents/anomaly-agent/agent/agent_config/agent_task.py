from .context import AnomalyContext
from .memory_hook_provider import MemoryHook
from .utils import get_ssm_parameter
from .agent import AnomalyDetectionAgent
from bedrock_agentcore.memory import MemoryClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

memory_client = MemoryClient()

async def agent_task(user_message, session_id, actor_id):
    agent = AnomalyContext.get_agent_ctx()
    response_queue = AnomalyContext.get_response_queue_ctx()
    gateway_access_token = AnomalyContext.get_gateway_token_ctx()
    if not gateway_access_token:
        raise RuntimeError("Gateway Access token is none")
    try:
        if agent is None:
            memory_id = get_ssm_parameter("/app/anomaly/agentcore/memory_id")
            if memory_id:
                memory_hook = MemoryHook(memory_client=memory_client, memory_id=memory_id,
                    actor_id=actor_id, session_id=session_id)
                agent = AnomalyDetectionAgent(bearer_token=gateway_access_token, memory_hook=memory_hook)
            else:
                agent = AnomalyDetectionAgent(bearer_token=gateway_access_token, memory_hook=None)
            AnomalyContext.set_agent_ctx(agent)
        async for chunk in agent.stream(user_query=user_message):
            await response_queue.put(chunk)
    except Exception as e:
        logger.exception("Agent execution failed.")
        await response_queue.put(f"Error: {str(e)}")
    finally:
        await response_queue.finish()
