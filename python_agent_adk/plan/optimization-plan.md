# Feature Implementation Plan: Python ADK Agent Optimization (Refined)

## 📋 Todo Checklist
- [ ] **Configuration**: Create `app/config.py` to centralize settings (Model Version, Prompts) and load from environment variables.
- [ ] **Data Structure**: Create `app/schemas.py` with strict Pydantic models (`OrderSummaryResult`, `OrderItem`) including `confidence` and `reasoning` fields.
- [ ] **Determinism**: Update `app/strategies.py` to use `response_schema` with the Pydantic models and strict hyperparameters (`temperature=0`). #double check documentation (Verify exact syntax for passing Pydantic classes in the specific SDK version used, e.g., LiteLLM vs google-genai)
- [ ] **Logic Separation**: Refactor `ORDER_DETECTION_SYSTEM_PROMPT` (loaded from config) to remove all *formatting* instructions (move formatting logic to Python code).
- [ ] **Validation**: Implement Pydantic `@field_validator`s for business rules (e.g., menu item existence, "half sandwich" rejection).
- [ ] **Memory Management**: Implement a "Sliding Window" strategy in `app/agent.py` to manage conversation history size before sending to API.
- [ ] **Context Caching**: Implement Vertex AI Context Caching for the immutable Menu + System Prompt segments. #double check documentation (Verify minimum token count requirements - usually ~32k - to ensure this is applicable/cost-effective for this prompt size)
- [ ] **Reliability**: Add `tenacity` retry logic with exponential backoff for model calls.
- [ ] **Externalization**: Ensure `MODEL_NAME`, `ORDER_DETECTION_SYSTEM_PROMPT`, `RESPONSE_SUGGESTION_SYSTEM_PROMPT` are loaded from `app/config.py` (or external files) to avoid hardcoding in `strategies.py`.

## 🔍 Analysis & Investigation

### Codebase Structure
- **`python_agent_adk/app/agent.py`**: Manages the agent loop and service instantiation.
- **`python_agent_adk/app/strategies.py`**: Contains the prompt definitions (`ORDER_DETECTION_SYSTEM_PROMPT`) and calls the model.
- **`python_agent_adk/app/tools.py`**: Helper functions.

### Key Optimization Philosophies (Synthesized from Node.js & GenAI Plans)
1.  **Application Code Extraction vs. AI Formatting**: The AI should *only* extract raw data (JSON). All string formatting (e.g., "$10.50", "2x Burger") must happen in deterministic Python code. This eliminates a huge class of hallucination bugs.
2.  **Hybrid Memory Management**:
    *   **Platform Level**: Use **Vertex AI Context Caching** for the static "System Prompt + Menu" block (huge token savings).
    *   **Application Level**: Use a **Sliding Window** (last N messages) for conversation history to maintain focus and reduce noise.
3.  **Strict Determinism**: Use `temperature=0`, `top_p=1`, `frequency_penalty=0`, and native schema enforcement (`response_schema`) to treat the LLM as a data extraction engine, not a creative writer.
4.  **Configuration as Code**: Hardcoded strings (prompts, model versions) are technical debt. They must be externalized to allow for easier experimentation and updates without code changes.

### Dependencies & Integration Points
- **Google GenAI SDK**: Requires the latest version to support `response_schema` with Pydantic objects.
- **Pydantic**: Already in use, but needs to be leveraged for *runtime validation* of AI outputs, not just settings.
- **Tenacity**: New dependency needed for robust retries.

## 📝 Implementation Plan

### Prerequisites
- Ensure `google-genai` SDK is updated to support `response_schema`.
- Add `tenacity` to `requirements.txt`.

### Step-by-Step Implementation

#### 1. Centralize Configuration
**Goal**: Remove hardcoded values from logic files.
*   **File**: `app/config.py` (Create new).
*   **Content**:
    *   Define `Settings` class using `pydantic-settings` or `os.environ`.
    *   **Externalize Model**: Load `GEMINI_MODEL_NAME` from environment variable `GEMINI_MODEL_NAME` (defaulting to "gemini-3-flash-preview").
    *   **Static Variable**: Assign this to a module-level static variable `MODEL_NAME` in `app/config.py` for easy import.
    *   Fields:
        *   `MODEL_NAME` (Static variable derived from env var)
        *   `ORDER_DETECTION_PROMPT` (Default: Load from a constant or file)
        *   `RESPONSE_SUGGESTION_PROMPT` (Default: Load from a constant or file)
*   **Action**:
    *   Refactor `app/agent.py` to import `MODEL_NAME` from `app/config.py`.
    *   Refactor `app/strategies.py` to import prompts and `MODEL_NAME` from `app/config.py`.

#### 2. Define Strict Pydantic Schemas
**Goal**: Create the contract for AI output.
*   **File**: `app/schemas.py`.
*   **Content**:
    ```python
    from pydantic import BaseModel, Field, field_validator
    from enum import Enum
    from typing import List, Optional

    class ConfidenceLevel(str, Enum):
        HIGH = "HIGH"
        MEDIUM = "MEDIUM"
        LOW = "LOW"

    class OrderItem(BaseModel):
        name: str
        quantity: int
        special_instructions: Optional[str] = None

    class OrderSummaryResult(BaseModel):
        reasoning: str = Field(..., description="Step-by-step logic for the extraction.")
        confidence: ConfidenceLevel
        order_made: bool
        items: List[OrderItem]
        
        # Validator Example: Business Logic in Code
        @field_validator('items')
        def validate_menu_items(cls, v):
            # Load MENU_ITEMS from config/constant
            # if item.name not in MENU_ITEMS: raise ValueError(...)
            return v
    ```

#### 3. Implement "Code-First" Logic & System Prompt Refactor
**Goal**: Remove formatting noise from prompts and enforce strict extraction.
*   **File**: `app/strategies.py`.
*   **Changes**:
    *   **Hyperparameters**: Configure the model call with strict parameters:
        *   `temperature: 0` (Absolute focus on most probable tokens).
        *   `top_p: 1` (Standard when temp is 0).
        *   `max_tokens: 500` (Sufficient for complex orders, prevents infinite loops).
        *   `frequency_penalty: 0`, `presence_penalty: 0` (Strict extraction, no creative writing).
        *   *Note*: Allow for per-model overrides in `app/config.py` if different models (e.g., Flash vs Pro) require tuning.
    *   **Structure Enforcement**: Use `response_schema=OrderSummaryResult` as the primary "hyperparameter" for structure enforcement, reducing reliance on prompt instructions.
    *   **Strip Prompt**: Remove instructions like "Format as 2x Item", "Use $ sign", etc. from `ORDER_DETECTION_SYSTEM_PROMPT`.
    *   **Add Negative Constraints**: "DO NOT hallucinate items. If item is not in menu (e.g. 'half sandwich'), reject it."
    *   **Post-Processing Validation**:
        *   Validate parsed Pydantic objects against business rules (already in `app/schemas.py` validators).
        *   Add sanity checks (e.g., total price calculation verification if price is extracted).
    *   **Add Formatter**: Create a Python function `format_order_summary(result: OrderSummaryResult) -> str` that takes the clean object and produces the user-facing string.

#### 4. Implement Memory Optimization (Sliding Window + Caching)
**Goal**: Optimize token usage and latency.
*   **File**: `app/agent.py` (or new `app/memory.py`).
*   **Changes**:
    *   **Sliding Window**: Before calling `generate_content`, slice `conversation_history` to the last ~10-15 relevant messages.
    *   **Context Caching**:
        *   Initialize a `cached_content` object using the Google GenAI SDK that contains the `ORDER_DETECTION_SYSTEM_PROMPT` (which includes the Menu).
        *   Pass this `cached_content` resource to the `generate_content` call instead of sending the raw text every time.
        *   *Note*: Ensure cache TTL is managed (e.g., 60 mins).

#### 5. Reliability & Retries
**Goal**: Handle transient failures gracefully.
*   **File**: `app/strategies.py`.
*   **Changes**:
    *   Decorate the generation function with `@retry`.
    *   Config: `stop=stop_after_attempt(3)`, `wait=wait_exponential(multiplier=1, min=2, max=10)`.
    *   Handle `ValidationError` from Pydantic: If the model returns valid JSON but invalid data (e.g., negative quantity), catch the error and potentially retry with a "correction prompt" (advanced) or return a safe fallback.

### Testing Strategy
1.  **Configuration Tests**: Verify that changing `GEMINI_MODEL_NAME` env var changes the model used in `app/agent.py`.
2.  **Unit Tests**: Test `format_order_summary` with various `OrderSummaryResult` inputs to ensure deterministic string output.
3.  **Schema Tests**: Verify `OrderSummaryResult` correctly rejects invalid JSON structures or logic violations (via validators).
4.  **Integration Tests**: Use `verify.py` to run the "Half Sandwich" scenario.
    *   *Expectation*: The model returns `order_made=False` with `reasoning` explaining the rejection.

## 🎯 Success Criteria
- **100% Deterministic Formatting**: The presentation of the order is controlled entirely by Python code, zero AI formatting errors.
- **Valid JSON**: The API *always* returns a structure parsing to `OrderSummaryResult`.
- **Reduced Latency/Cost**: Context Caching reduces input tokens for the menu by >90% per request.
- **Explainability**: Every decision has a `reasoning` trace available in logs.
- **Configurability**: Model version and prompts can be changed without deploying new code.