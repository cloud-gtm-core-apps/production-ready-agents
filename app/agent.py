import os
from google.adk.agents import Agent
from google.adk.tools import load_memory
from google.adk.sessions import InMemorySessionService
from google.adk.memory import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from .tools import search_tool, build_menu_context, calculate_order_total
from google.genai.types import GenerateContentConfig
from google.adk.models import Gemini
from .config import settings
from .prompts.prompt_manager import PromptManager
from .schemas import OrderSummaryResult
from .callbacks import before_model_callback, after_model_callback
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.apps import App
from google.adk.apps.app import EventsCompactionConfig
from google.adk.apps.llm_event_summarizer import LlmEventSummarizer

class LoggingLlmEventSummarizer(LlmEventSummarizer):
    """A summarizer that logs to the console when it triggers."""
    def __init__(self, llm):
        print(f"[ADK COMPACTION] Summarizer Initialized with model: {llm.model}", flush=True)
        super().__init__(llm=llm)

    async def maybe_summarize_events(self, *, events):
        print(f"\n[ADK COMPACTION] --- TRIGGERED ---", flush=True)
        print(f"[ADK COMPACTION] Input: {len(events)} events to condense.", flush=True)
        try:
            result = await super().maybe_summarize_events(events=events)
            
            # --- DEFENSIVE VALIDATION ---
            # Ensure the summary isn't empty to avoid "model output must contain text" errors
            is_valid = False
            if result and result.actions and result.actions.compaction:
                content = result.actions.compaction.compacted_content
                if content.parts and any(p.text and p.text.strip() for p in content.parts):
                    is_valid = True

            if is_valid:
                summary_text = result.actions.compaction.compacted_content.parts[0].text
                print(f"[ADK COMPACTION] --- SUCCESS --- Summary created ({len(summary_text)} chars).", flush=True)
                print(f"[ADK COMPACTION] Content Preview: {summary_text[:500]}...", flush=True)
                return result
            else:
                print("[ADK COMPACTION] --- SKIP --- Summary was empty or invalid.", flush=True)
                return None
        except Exception as e:
            print(f"[ADK COMPACTION] --- ERROR --- {e}", flush=True)
            return None # Fallback: don't break the conversation if summarization fail

class ServiceManager:
    """A centralized manager for agent-related services."""

    def __init__(self):
        """Initializes the manager with lazy-loaded services."""
        print("Initializing ServiceManager...")
        self._session_service = None
        self._memory_service = None
        self._artifact_service = None
        self._root_agent = None
        self._app = None
        self._prompt_manager = PromptManager()
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
        print(f"Initializing Root Agent with model {settings.model.model_name}...")
        return Agent(
            model=Gemini(
                model=settings.model.model_name,
            ),
            name="restaurant_order_agent",
            description="An agent to help users with restaurant ordering, including searching, creating, and updating orders for customers.",
            instruction=self._get_instruction(),
            tools=[load_memory, search_tool, calculate_order_total],
            before_model_callback=before_model_callback,
            after_model_callback=after_model_callback,
            output_schema=OrderSummaryResult,
            generate_content_config=GenerateContentConfig(
                temperature=0.0,
                top_p=1.0,
                max_output_tokens=settings.model.max_tokens
            )
        )

    def _get_instruction(self):
        """Retrieves and formats the instruction from PromptManager."""
        raw_prompt = self._prompt_manager.get_prompt("order_detection")
        instruction = raw_prompt.format(menu_context=build_menu_context())
        
        # --- DEMO: CONTEXT INFLATOR (2026 Re-Refined Standard) ---
        # NOTE: 2026 Documentation states a 2,048 token minimum for Gemini 2.0+.
        # HOWEVER, we target ~8,192 tokens here as a 'Safe Zone' for cross-region
        # reliability and to ensure high-impact visual proof in the ADK Web UI.
        #
        # Caveat: While 2,048 is the new standard, some regional Vertex AI 
        # configurations may still have slightly higher automatic trigger thresholds.
        # 8,000 tokens (~32k characters) is lean enough for zero-latency but 
        # guaranteed to trigger caching stats in almost all environments.
        if settings.inflate_context:
            # Padding to hit the ~8,192 token 'Safe Zone' (approx 32k characters)
            #This is address the required tokens before the caching can happen
            padding_block = "DEMO_PADDING_TEXT_RELIABLE_8K_THRESHOLD_" * 40
            padding = "\n" + (padding_block + "\n") * 20
            instruction += padding
            
            # Store approximate padding token count (heuristic: 4 chars/token)
            os.environ["DEMO_PADDING_TOKENS"] = str(len(padding) // 4)
            
            print(f">>> CONTEXT INFLATION: ACTIVE (Padded for ~8k tokens - Reliable Safe Zone)")
        # ---------------------------------------------------------
        
        return instruction

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

    @property
    def adk_app(self):
        """Lazy-loads and returns the ADK App."""
        if self._app is None:
            cache_config = None
            if settings.enable_caching:
                # We set min_tokens=0 to allow ADK to try caching regardless of size estimation.
                cache_config = ContextCacheConfig(
                    ttl_seconds=3600,  # 60 minutes
                    min_tokens=0       # Enable for all sizes (though API may still enforce limits)
                )
                print(f">>> CONTEXT CACHING: ENABLED (Raw env value: {settings.enable_caching})")
            else:
                print(f">>> CONTEXT CACHING: DISABLED (Raw env value: {settings.enable_caching})")

            compaction_config = None
            if settings.enable_compaction:
                print(">>> CONTEXT COMPACTION: ENABLED", flush=True)
                
                # Dedicated NON-STREAMING model for the summarizer to prevent empty response errors
                summarizer_model = Gemini(
                    model=settings.model.model_name,
                    stream=False
                )
                summarizer = LoggingLlmEventSummarizer(llm=summarizer_model)
                
                compaction_config = EventsCompactionConfig(
                    summarizer=summarizer,
                    compaction_interval=2,  # Aggressive: trigger after 2 turns
                    overlap_size=0
                )
            else:
                print(">>> CONTEXT COMPACTION: DISABLED", flush=True)

            self._app = App(
                name="app",
                root_agent=self.root_agent,
                context_cache_config=cache_config,
                events_compaction_config=compaction_config
            )
        return self._app

# Create a single, module-level instance of the service manager.
# This avoids global variables for each service and centralizes initialization.
_service_manager = ServiceManager()

def get_adk_app():
    """Returns the app instance from the manager (lazy-loaded)."""
    return _service_manager.adk_app

# Expose the app for ADK (and other tools)
# App is a container which contains the root agent , Caching Config, Session Service, Memory Service, Artifact Service
app = get_adk_app()
