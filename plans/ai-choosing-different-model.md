# Feature Implementation Plan: AI Model Selection & Benchmarking
# https://artificialanalysis.ai/models
## 📋 Todo Checklist
- [ ] Analyze and document performance benchmarks for JSON extraction (GPT-4o Mini vs Llama 3.1 70B).
- [ ] Compare reasoning capabilities for order detection tasks.
- [ ] Evaluate coding performance for potential self-correction or logic generation.
- [ ] Assess cost-benefit ratio (pricing vs performance).
- [ ] Analyze latency/throughput trade-offs.
- [ ] Document final model recommendation for ORDERFLOW.

## 🔍 Analysis & Investigation

### Codebase Structure
- **Current Integration**: The project currently supports both `GPT-4o-mini` (via OpenAI SDK) and `Llama 3.1` (via Trucube custom API).
- **Control Mechanism**: `process.env.MODEL` determines which path is taken in `server/utils.ts` (e.g., `OpenAIOrderSummary` vs `TrucubeOrderSummary`).
- **Logic**: Both paths perform essentially the same task—analyzing conversation history to extract order details.

### Current Architecture
- **Dual-Path Strategy**: The application abstraction allows swapping models easily, but the *prompts* and *post-processing* are currently shared or slightly duplicated.
- **Task Nature**: The core task is **Information Extraction** (JSON), not creative writing. This favors models with strong instruction-following and structured output capabilities.

### Dependencies & Integration Points
- **OpenAI SDK**: Native support for `zodResponseFormat` (Structured Outputs), which heavily favors GPT models for reliability.
- **Trucube API**: A standard chat completion endpoint. Requires manual JSON parsing and validation (as planned in the "Zod" refactor), making it slightly more brittle but potentially faster/cheaper depending on the provider.

### Considerations & Challenges
- **Reliability vs. Cost**: GPT-4o Mini is a managed service with guaranteed uptime and structured output features. Llama 3.1 70B (via Trucube) is open-source and potentially cheaper/faster but lacks native "strict mode" for JSON.
- **Latency**: For a real-time ordering system, latency is critical. Llama 3.1 70B has shown higher throughput (250 t/s vs 103 t/s) in some benchmarks, which could provide a snappier user experience.
- **Accuracy**: Reasoning benchmarks show Llama 3.1 70B/3.3 70B effectively matching or beating GPT-4o Mini in complex reasoning (MMLU, MATH), which is relevant for parsing ambiguous customer orders.

## 📝 Implementation Plan

### Prerequisites
- Access to benchmark data (gathered via investigation).

### Step-by-Step Implementation

1.  **Step 1: Document Benchmark Findings**
    - Create `docs/ai-benchmarks.md`.
    - **JSON Extraction**: Note that both models are strong, but GPT-4o Mini has the edge in *tooling* (native strict mode). Llama 3.1 70B is "slightly better" at raw extraction quality in some tests.
    - **Reasoning**: Highlight Llama 3.3 70B's superior reasoning scores (86% MMLU vs 82% for GPT-4o Mini), suggesting it might handle edge cases (e.g., "half sandwich" logic) better.
    - **Coding**: Less critical for this specific task, but both are competent.
    - **Cost/Speed**: Llama 3.1 70B is ~1.2x cheaper and ~2.5x faster (throughput) than GPT-4o Mini.

2.  **Step 2: Update Application Logic Recommendation**
    - In `docs/ai-model-recommendation.md`:
    - **Primary Recommendation**: **Llama 3.1 70B (or 3.3)** for production *if* hosted on a high-throughput provider (like Trucube/Groq). The speed and reasoning advantages outweigh the slightly better tooling of OpenAI for this specific use case.
    - **Fallback/Stability**: **GPT-4o Mini** for reliability and ease of use (Structured Outputs).
    - **Reasoning**: The 250 t/s throughput of Llama 3.1 70B is a massive advantage for a real-time chat interface.

3.  **Step 3: Define "Model Selection" Logic**
    - Propose a configuration change (future work) to allow dynamic model selection based on task complexity.
    - Simple tasks (Greeting): Llama 3.1 8B (fastest).
    - Complex tasks (Order Extraction): Llama 3.1 70B or GPT-4o Mini.

### Testing Strategy
- N/A (Documentation task).

## 🎯 Success Criteria
- A clear, data-backed document explaining *why* a specific model (Llama 3.1 70B) is recommended for the ORDERFLOW system, referencing the benchmarks found (MMLU scores, throughput, extraction quality).
