import os
from google.adk.agents import Agent
from google.adk.tools import load_memory
from google.adk.sessions import InMemorySessionService
from google.adk.memory import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from .prompt import ORDER_DETECTION_SYSTEM_PROMPT
from .tools import search_tool, build_menu_context


class ServiceManager:
    """A centralized manager for agent-related services."""

    def __init__(self):
        """Initializes the manager with lazy-loaded services."""
        print("Initializing ServiceManager...")
        self._session_service = None
        self._memory_service = None
        self._artifact_service = None
        self._root_agent = None
        print("ServiceManager initialized (services will be lazy-loaded).")

    def _init_session_service(self):
        """Initializes the in-memory session service."""
        print("Initializing InMemorySessionService...")
        return InMemorySessionService()

    def _init_memory_service(self):
        """Initializes the memory service."""
        print("Initializing InMemoryMemoryService...")
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
            tools=[load_memory, search_tool],
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
            self._root_agent = self._init_agent()
        return self._root_agent

# Create a single, module-level instance of the service manager.
# This avoids global variables for each service and centralizes initialization.
_service_manager = ServiceManager()

def get_agent():
    """Returns the root agent instance from the manager (lazy-loaded)."""
    return _service_manager.root_agent

# Expose the agent instance for ADK Web. It looks for root_agent global variable in the folder chosen
root_agent = get_agent()