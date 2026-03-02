from .context import NetworkContext
from .memory_hook_provider import MemoryHookProvider
from .utils import get_ssm_parameter
from .agent import NetworkAgent
from bedrock_agentcore.memory import MemoryClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

memory_client = MemoryClient()


async def agent_task(user_message: str, session_id: str, actor_id: str):
    agent = NetworkContext.get_agent_ctx()

    response_queue = NetworkContext.get_response_queue_ctx()
    gateway_access_token = NetworkContext.get_gateway_token_ctx()

    if not gateway_access_token:
        raise RuntimeError("Gateway Access token is none")
    try:
        if agent is None:
            # Get memory ID and user ID from SSM
            try:
                memory_id = get_ssm_parameter("/app/network/agentcore/memory_id")
            except Exception:
                memory_id = None

            # Get consistent USER_ID from SSM, fallback to actor_id
            try:
                consistent_user_id = get_ssm_parameter("/app/network/agentcore/user_id")
                logger.info(f"Using consistent USER_ID from SSM: {consistent_user_id}")
            except Exception as e:
                logger.warning(f"Could not retrieve USER_ID from SSM, using actor_id: {e}")
                consistent_user_id = actor_id

            # Create new memory hook provider (only if memory is configured)
            memory_hook_provider = None
            if memory_id:
                memory_hook_provider = MemoryHookProvider(
                    memory_id=memory_id,
                    client=memory_client
                )

            # Create agent with memory hook provider
            agent = NetworkAgent(
                bearer_token=gateway_access_token,
                memory_hook=memory_hook_provider,
                actor_id=consistent_user_id,
                session_id=session_id,
            )

            # Store context for future use
            NetworkContext.set_memory_id_ctx(memory_id)
            NetworkContext.set_actor_id_ctx(consistent_user_id)
            NetworkContext.set_session_id_ctx(session_id)
            NetworkContext.set_agent_ctx(agent)

        async for chunk in agent.stream(user_query=user_message):
            await response_queue.put(chunk)

    except Exception as e:
        logger.exception("Agent execution failed.")
        await response_queue.put(f"Error: {str(e)}")
    finally:
        await response_queue.finish()
