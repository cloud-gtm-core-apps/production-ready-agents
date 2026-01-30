# Implementation Plan - Optimize Python ADK Agent: Architecture and Determinism

## Phase 1: Foundation & Configuration

- [ ] Task: Centralize Configuration
    - [ ] Create `python_agent_adk/app/config.py`.
    - [ ] Define settings for `MODEL_NAME`, `ORDER_DETECTION_PROMPT`, and `RESPONSE_SUGGESTION_PROMPT`.
    - [ ] Update `app/agent.py` and `app/strategies.py` to use the new config.
- [ ] Task: Define Strict Pydantic Schemas
    - [ ] Create `python_agent_adk/app/schemas.py`.
    - [ ] Implement `OrderItem` and `OrderSummaryResult` models.
    - [ ] Add validators for business logic (e.g., rejecting "half sandwich").
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Foundation & Configuration' (Protocol in workflow.md)

## Phase 2: Strategy Refactoring

- [ ] Task: Update Strategy Logic
    - [ ] Refactor `app/strategies.py` to use `response_schema`.
    - [ ] Set `temperature=0` and other strict hyperparameters.
    - [ ] Remove formatting instructions from `ORDER_DETECTION_SYSTEM_PROMPT`.
- [ ] Task: Implement Code-First Formatting
    - [ ] Create `format_order_summary` function in Python.
    - [ ] Update the agent loop to use this formatter instead of raw AI strings.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Strategy Refactoring' (Protocol in workflow.md)

## Phase 3: Verification & Polish

- [ ] Task: Reliability Improvements
    - [ ] Add `tenacity` retry logic to model calls.
- [ ] Task: Final Verification
    - [ ] Run `verify.py` to ensure all scenarios (Greeting, Order, Rejection) work as expected.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Verification & Polish' (Protocol in workflow.md)
