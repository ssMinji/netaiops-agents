from .context import K8sContext
from .memory_hook_provider import MemoryHookProvider
from .utils import get_ssm_parameter
from .agent import K8sAgent
from bedrock_agentcore.memory import MemoryClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

memory_client = MemoryClient()

SSM_PREFIX = "/a2a/app/k8s/agentcore"


async def agent_task(user_message, session_id, actor_id):
    agent = K8sContext.get_agent_ctx()
    response_queue = K8sContext.get_response_queue_ctx()
    gateway_access_token = K8sContext.get_gateway_token_ctx()
    if not gateway_access_token:
        raise RuntimeError("Gateway Access token is none")
    try:
        if agent is None:
            memory_id = get_ssm_parameter(f"{SSM_PREFIX}/memory_id")

            # Get consistent user ID from SSM, fallback to actor_id
            try:
                user_id = get_ssm_parameter(f"{SSM_PREFIX}/user_id")
                logger.info(f"Using consistent USER_ID from SSM: {user_id}")
            except Exception:
                logger.warning("Could not retrieve USER_ID from SSM, using actor_id")
                user_id = actor_id

            if memory_id:
                memory_hook = MemoryHookProvider(
                    memory_id=memory_id,
                    client=memory_client,
                )
                agent = K8sAgent(bearer_token=gateway_access_token, memory_hook=memory_hook)
                # Set agent state for memory hook provider
                if hasattr(agent.agent, "state"):
                    if hasattr(agent.agent.state, "set"):
                        agent.agent.state.set("actor_id", user_id)
                        agent.agent.state.set("session_id", session_id)
                    elif hasattr(agent.agent.state, "__setitem__"):
                        agent.agent.state["actor_id"] = user_id
                        agent.agent.state["session_id"] = session_id
                else:
                    agent.agent.state = {"actor_id": user_id, "session_id": session_id}
                logger.info(f"Set agent state: actor_id={user_id}, session_id={session_id}")
            else:
                agent = K8sAgent(bearer_token=gateway_access_token, memory_hook=None)
            K8sContext.set_agent_ctx(agent)
        async for chunk in agent.stream(user_query=user_message):
            await response_queue.put(chunk)
    except Exception as e:
        logger.exception("Agent execution failed.")
        await response_queue.put(f"Error: {str(e)}")
    finally:
        await response_queue.finish()
