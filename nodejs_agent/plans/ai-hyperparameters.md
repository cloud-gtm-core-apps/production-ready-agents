# Feature Implementation Plan: AI Hyperparameter Optimization

## 📋 Todo Checklist
- [ ] Define optimized hyperparameter configuration for each AI model type (OpenAI vs. Trucube).
- [ ] Update `server/utils.ts` to implement `max_tokens` and `top_p` in AI calls.
- [ ] Refactor system prompts to be strict, structured, and free of formatting noise.
- [ ] Integrate Zod schemas as the primary "hyperparameter" for structure enforcement.
- [ ] Implement post-processing validation logic for Trucube/Llama responses.
- [ ] Verify changes with `AITestSimulator`.

## 🔍 Analysis & Investigation

### Codebase Structure
- **`server/aiFunctions.ts`**: Contains the `systemPrompt` logic which is currently "noisy" with formatting instructions.
- **`server/utils.ts`**: Handles the API calls to OpenAI and Trucube. This is where `max_tokens`, `temperature`, and `response_format` are passed.
- **`plans/ai-determinism.md`**: Sets the groundwork for using Zod, which is central to this optimization plan.

### Current Architecture
- **Model Usage**: Uses `gpt-4o-mini` and `Llama 3.1` (via Trucube).
- **Hyperparameters**: Currently relies mainly on `temperature: 0.3` (or `0.7` for creative tasks) and `response_format: { type: 'json_object' }`.
- **Formatting**: Relying on the prompt ("Please format as...") which is non-deterministic.

### Dependencies & Integration Points
- **OpenAI SDK**: Supports `max_tokens`, `top_p`, `frequency_penalty`, etc.
- **Trucube API**: Standard chat completion endpoint, likely supports standard parameters.

### Considerations & Challenges
- **Determinism**: The primary goal is consistent JSON extraction.
- **Token Efficiency**: Preventing the model from "rambling" after generating JSON saves cost and latency.
- **Model differences**: OpenAI supports native schema enforcement; Trucube (Llama) requires prompt-based structure + code-based validation.

## 📝 Implementation Plan

### Prerequisites
- Completion of `plans/ai-determinism.md` (Zod schema setup).

### Step-by-Step Implementation

1.  **Step 1: The Most Impactful "Hyperparameter": Prompt Engineering & Structured Output**
    - **Goal**: Remove ambiguity. Treat the prompt as a data schema definition, not a conversation.
    - **Action**: In `server/utils.ts` (or `server/aiFunctions.ts` if refactored):
        - Rewrite prompts to strictly define the *data* to extract (using the JSON schema representation).
        - **Remove** all instructions related to string formatting (e.g., "Add $ sign", "Use colon").
        - **Files to modify**: `server/aiFunctions.ts` (System Prompts).

2.  **Step 2: Optimize Core Hyperparameters (`max_tokens`, `top_p`)**
    - **Goal**: Constrain the model's search space and output length.
    - **Action**: In `server/utils.ts`:
        - Update `OpenAIOrderSummary`, `OpenAIPickupTime`, `OpenAIHalfSandwich`:
            - Set `temperature: 0` (Absolute focus on most probable tokens).
            - Set `top_p: 1` (Standard when temp is 0, or `0.1` if temp > 0 for slight variability).
            - Set `max_tokens: 500` (Sufficient for complex orders, prevents infinite loops).
            - Set `frequency_penalty: 0`, `presence_penalty: 0` (We want strict extraction, not creative writing).
        - Apply equivalent settings to `Trucube` calls.

3.  **Step 3: Integrate Zod as a "Hyperparameter" (OpenAI)**
    - **Goal**: Enforce structure at the API level.
    - **Action**:
        - Use `client.beta.chat.completions.parse` with `zodResponseFormat`.
        - This effectively sets the "grammar" hyperparameter for the model.

4.  **Step 4: Post-Processing as a Safety Net (Trucube)**
    - **Goal**: Mimic strict mode for open-source models.
    - **Action**:
        - Pass the JSON schema in the system prompt.
        - Parse response -> Validate with Zod -> Return data.
        - This acts as a filter, rejecting "high entropy" or hallucinated responses.

### Testing Strategy
- **Unit Tests**: Verify that `server/utils.ts` functions accept and pass these parameters correctly.
- **Integration Test**: Run a known set of conversation logs through the `AITestSimulator` and verify that outputs are identical across multiple runs (determinism check).

## 🎯 Success Criteria
- **Zero formatting errors**: The application *never* crashes due to malformed JSON or missing string patterns.
- **100% Determinism**: Identical inputs produce identical structured outputs (for OpenAI path).
- **Reduced Latency/Tokens**: Responses are concise, containing only the JSON data.
