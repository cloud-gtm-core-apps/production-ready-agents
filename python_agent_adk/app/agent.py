import logging
import json
from typing import Dict, Any, Optional
import os
from enum import Enum
from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm
from a2a.types import AgentCard, AgentCapabilities, AgentSkill
from a2a.server.apps.jsonrpc.starlette_app import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from .agent_executor import AdkAgentToA2AExecutor
from google.adk.tools import load_memory
from google.adk.sessions import DatabaseSessionService, InMemorySessionService
from google.adk.memory import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService

from .strategies import analyze_order_summary, ORDER_DETECTION_SYSTEM_PROMPT
from .tools import get_current_date, search_tool, record_order, build_menu_context

class AgentMode(Enum):
    """Represents the different modes the agent can run in."""
    GEMINI = "Gemini"
    VERTEXAI = "VertexAI"
    GKE = "GKE"

# --- Global Initializations ---
# For SQLite, make sure the directory for the DB file is writable by the Django process.
# Explore using VertexAiSessionService or InMemorySessionService for production https://google.github.io/adk-docs/sessions/session/#managing-sessions-with-a-sessionservice

AGENT_PORT = os.environ.get("AGENT_PORT", "8000")
AGENT_URL = os.environ.get("AGENT_URL", f"http://127.0.0.1:{AGENT_PORT}")
AGENT_MODE = os.environ.get("AGENT_MODE", f"{AgentMode.GEMINI.value}")
SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]
DB_URL = os.environ.get("DB_URL", "postgresql://postgres:admin@localhost:5432/tickets-db")


# adding memory https://google.github.io/adk-docs/sessions/memory/#how-memory-works-in-practice

# The RAG Corpus name or ID
# Optional configuration for retrieval
SIMILARITY_TOP_K = 5
VECTOR_DISTANCE_THRESHOLD = 0.7


class ServiceManager:
    """A centralized manager for agent-related services."""

    def __init__(self):
        """Initializes the manager with lazy-loaded services."""
        print("Initializing ServiceManager...")
        self._session_service = None
        self._memory_service = None
        self._artifact_service = None
        self._root_agent = None
        self._agent_executor = None
        print("ServiceManager initialized (services will be lazy-loaded).")

    def _init_session_service(self):
        """Initializes the in-memory session service."""
        print("Initializing InMemorySessionService...")
        return InMemorySessionService()

    def _init_memory_service(self):
        """Initializes the memory service."""
        print("Initializing InMemoryMemoryService...")
        # For RAG-based persistent memory, you would use https://docs.cloud.google.com/agent-builder/agent-engine/memory-bank/overview
        # return memory-bank
        return InMemoryMemoryService()

    def _init_artifact_service(self):
        """Initializes the artifact service."""
        print("Initializing InMemoryArtifactService...")
        return InMemoryArtifactService()

    def _init_agent(self):
        """Initializes the root agent."""
        print("Initializing Root Agent...")
        return Agent(
            model="gemini-3-flash-preview",
            name="restaurant_order_agent",
            description="An agent to help users with restaurant ordering, including searching, creating, and updating orders for customers.",
            instruction=ORDER_DETECTION_SYSTEM_PROMPT.format(menu_context=build_menu_context()),
            tools=[load_memory, get_current_date, search_tool, record_order],
        )


    def _init_vertexai_agent(self):
        """Initializes the Vertex AI agent."""
        endpoint_id = os.getenv("VERTEX_AI_ENDPOINT_ID")
        print(f"Initializing Vertex AI Agent...{endpoint_id}")
        return Agent(
            model=LiteLlm(model=f"vertex_ai/openai/{endpoint_id}"),
            name="restaurant_order_agent",
            description="An agent to help users with restaurant ordering, including searching, creating, and updating orders for customers.",
            instruction=ORDER_DETECTION_SYSTEM_PROMPT.format(menu_context=build_menu_context()),
            tools=[load_memory, get_current_date, search_tool, record_order],
        )

    
    def _init_gke_ai_agent(self):
        """Initializes the GKE AI agent."""
        api_base_url = os.getenv("GKE_INFERENCE_ENDPOINT")
        MODEL_NAME = os.getenv("MODEL_NAME") 
        print(f"Initializing GKE AI Agent: {api_base_url} and {MODEL_NAME}")
        root_agent = Agent(
            model=LiteLlm(
                model=MODEL_NAME,
                api_base=api_base_url,
            ),
            name="restaurant_order_agent",
            description="An agent to help users with restaurant ordering, including searching, creating, and updating orders for customers.",
            instruction=ORDER_DETECTION_SYSTEM_PROMPT.format(menu_context=build_menu_context()),
            tools=[load_memory, get_current_date, search_tool, record_order],
        )

        return root_agent

    def _init_agent_executor(self):
        """Initializes the agent executor."""
        print("Initializing AdkAgentToA2AExecutor...")
        return AdkAgentToA2AExecutor(
            self.root_agent, 
            self.session_service, 
            self.memory_service,
            self.artifact_service
        )

    @property
    def session_service(self):
        """Lazy-loads and returns the session service."""
        if self._session_service is None:
            self._session_service = self._init_session_service()
        return self._session_service

    @property
    def memory_service(self):
        """Lazy-loads and returns the memory service."""
        if self._memory_service is None:
            self._memory_service = self._init_memory_service()
        return self._memory_service

    @property
    def artifact_service(self):
        """Lazy-loads and returns the artifact service."""
        if self._artifact_service is None:
            self._artifact_service = self._init_artifact_service()
        return self._artifact_service

    @property
    def root_agent(self):
        """Lazy-loads and returns the root agent."""
        if self._root_agent is None:
            if AGENT_MODE == AgentMode.GEMINI.value:
                self._root_agent = self._init_agent()
            elif AGENT_MODE == AgentMode.VERTEXAI.value:
                self._root_agent = self._init_vertexai_agent()
            elif AGENT_MODE == AgentMode.GKE.value:
                self._root_agent = self._init_gke_ai_agent()
            else:
                raise ValueError(f"Unsupported AGENT_MODE: {AGENT_MODE}")
        return self._root_agent

    @property
    def agent_executor(self):
        """Lazy-loads and returns the agent executor."""
        if self._agent_executor is None:
            self._agent_executor = self._init_agent_executor()
        return self._agent_executor

# Create a single, module-level instance of the service manager.
# This avoids global variables for each service and centralizes initialization.
_service_manager = ServiceManager()

def get_session_service():
    """Returns the session service instance from the manager (lazy-loaded)."""
    return _service_manager.session_service

def get_memory_service():
    """Returns the memory service instance from the manager (lazy-loaded)."""
    return _service_manager.memory_service


# a2a root & subagents https://google.github.io/adk-docs/a2a/quickstart-consuming/#start-the-remote-prime-agent-server
def get_agent():
    """Returns the root agent instance from the manager (lazy-loaded)."""
    return _service_manager.root_agent

def get_agent_executor():
    """Returns the agent executor instance from the manager (lazy-loaded)."""
    return _service_manager.agent_executor

# this is used by adk web or a2a framework for agent to agent communication.
adk_web_env = os.environ.get("ADK")
if adk_web_env is None or adk_web_env.strip().lower() == "true" or adk_web_env.strip().lower() == "a2a":
    capabilities = AgentCapabilities(streaming=True)
    skill = AgentSkill(
        id="restaurant_order_assistant",
        name="Restaurant Order Assistant",
        description="Helps customers place restaurant orders and manages order details like items, quantities, and pickup times.",
        tags=["restaurant", "ordering", "order-management"],
        examples=["I'd like to order a Pepperoni Pizza for pickup at 7pm", "What's on the menu?"],
    )
    agent_card = AgentCard(
        name="OrderFlow Restaurant Assistant",
        description="An AI-powered assistant that manages restaurant orders, automatically detects order details from SMS, and assists managers with order tracking.",
        url=f"{AGENT_URL}",
        version="1.0.0",
        defaultInputModes=SUPPORTED_CONTENT_TYPES,
        defaultOutputModes=SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        skills=[skill],
    )
    # Note: to_a2a() auto-generates an agent card using AgentCardBuilder
    # The agent card uses the agent's name and description properties
    # Skills are auto-generated from the agent's tools
    root_agent = get_agent()
    # a2a_app = to_a2a(root_agent, port=AGENT_PORT)
    request_handler = DefaultRequestHandler(
        agent_executor=get_agent_executor(),
        task_store=InMemoryTaskStore(),
    )

    # 2. The Functions Framework will automatically look for this 'app' variable.
    app = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler,
    ).build()