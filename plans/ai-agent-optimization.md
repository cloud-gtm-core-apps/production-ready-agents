# Feature Implementation Plan: AI Agent Optimization (GCP/Gemini Edition)

## 📋 Todo Checklist
- [ ] **Infrastructure**: Set up `@google-cloud/vertexai` SDK and GCP authentication.
- [ ] **Configuration**: Pin `Gemini 3.0 Flash` versions and externalize safety settings.
- [ ] **Determinism**: Implement Controlled Generation using `responseSchema` and MIME type `application/json`.
- [ ] **Context Management**: Implement Vertex AI Context Caching for large menus/history.
- [ ] **Latency & Cost**: Use `Gemini 3.0 Flash` for high throughput and low latency.
- [ ] **Reliability**: Implement strict safety settings and retry policies.
- [ ] **Observability**: Integrate with Google Cloud Logging for reasoning and usage tracking.
- [ ] **Testing**: Verify with `AITestSimulator` using Gemini.

## 🔍 Analysis & Investigation

### Current Architecture vs. GCP Target
- **Model**: **Gemini 3.0 Flash** (Vertex AI).
- **Prompting**: String formatting -> **Structured Prompts** with native Schema support.
- **State**: Full context every time -> **Context Caching** (Vertex AI) for menu + long history.
- **Caching**: Redis (Application Layer) + **Vertex Context Caching** (Platform Layer).

### 12-Factor AI Optimization Strategy (GCP/Gemini)

| Factor | Current Strategy | GCP/Gemini Optimization |
| :--- | :--- | :--- |
| **1. Determinism** | OpenAI JSON Mode | **Controlled Generation** (`responseSchema` + `application/json`). |
| **2. Tokens** | Full Re-send | **Context Caching** (cache the menu preamble once, reuse). |
| **3. Caching** | None | **Vertex AI Context Caching** (Platform) + Redis (Result Cache). |
| **4. Latency** | `smaller models` | **Gemini 3.0 Flash** (Optimized for speed/volume). |
| **5. Cost** | Standard Token Pricing | Flash pricing + Context Caching (Input tokens cached). |
| **6. Reliability** | Basic | **Safety Settings** (Block HATE_SPEECH, etc.) + Fallback to Pro. |
| **7. Configuration** | Env Vars | **Vertex AI Location** (`us-central1`), Model Versions. |
| **8. Observability** | Console | **Google Cloud Logging** (Structured JSON logs). |
| **9. Speed** | Serial | **Parallel Calls** (Flash's high rate limits allow this). |
| **10. Versioning** | "latest" | Pinned: `Gemini 3.0 Flash` (Stable releases). |
| **11. Security** | Basic | **IAM Roles** (Workload Identity) instead of API Keys. |
| **12. Fallback** | Hard Fail | Fallback to `gemini-3-pro` for complex ambiguity resolution. |

## 📝 Implementation Plan

### Prerequisites
- Google Cloud Project with Vertex AI API enabled.
- Service Account or ADC (Application Default Credentials) configured.
- Install `@google-cloud/vertexai`.

### Step-by-Step Implementation

### Codebase Structure
- **`server/aiFunctions.ts`**: Orchestrates AI logic.
- **`server/utils.ts`**: Currently handles OpenAI/Trucube calls. Needs adaptation for Vertex AI.
- **`server/clients.ts`**: Needs to instantiate Vertex AI client instead of OpenAI.

#### 1. Infrastructure & Clients (Factors: Configuration, Security)
**Goal**: Replace/Augment OpenAI client with Vertex AI.
1.  **Install SDK**: `npm install @google-cloud/vertexai`.
2.  **Update `server/clients.ts`**:
    -   Initialize `VertexAI` with project and location.
    -   Export `getGeminiModel(modelName: string)` helper.
    -   *Constraint*: Ensure we can toggle between providers via env var (`AI_PROVIDER=GCP`).

#### 2. Determinism with Controlled Generation (Factors: Determinism, Reliability)
**Goal**: Use Gemini's native JSON enforcement.
1.  **Create `server/aiSchemas.ts`**:
    -   Define schemas compatible with Vertex AI `Schema` object (FunctionDeclarationSchema).
    -   *Note*: Vertex AI schemas are standard JSON Schemas.
2.  **Update `server/utils.ts`**:
    -   Implement `callGemini(prompt, schema)` wrapper.
    -   Config: `responseMimeType: 'application/json'`, `responseSchema: schema`.
    -   Config: `temperature: 0`.

#### 3. Performance & Cost (Factors: Tokens, Caching, Speed)
**Goal**: Leverage Flash and Caching.
1.  **Context Caching (Menu)**:
    -   The system prompt often contains the entire menu.
    -   **Action**: Create a *Cached Content* resource for the Menu System Prompt (TTL: 60 mins, auto-refresh).
    -   **Benefit**: drastically reduces input token cost for every order request.
2.  **Model Selection**:
    -   Default to `gemini-1.5-flash-002` for `analyzeOrderSummary` (Fast, cheap).
    -   Use `gemini-1.5-pro-002` ONLY if Flash returns low confidence or fails validation (Retry/Fallback layer).

#### 4. Observability & Safety (Factors: Observability, Reliability)
**Goal**: Production-grade logging and safety.
1.  **Safety Settings**:
    -   Configure `HarmCategory` settings (BLOCK_ONLY_HIGH) to prevent false positives on valid menu items (e.g., "Spicy Killer Chicken").
2.  **Structured Logging**:
    -   Log input/output with `traceId` (orderId).
    -   Log token usage metadata returned by Vertex AI (critical for cost tracking).

#### 5. Logic Refactoring (Factors: Speed)
**Goal**: Adapt prompts for Gemini's long-context window.
1.  **Prompt Engineering**:
    -   Gemini handles large context (1M+ tokens) effortlessly.
    -   **Refinement**: We don't need aggressive compression (like in OpenAI plan). We can confidently send full history.
    -   *However*, we still remove noise for clarity.

### Testing Strategy
1.  **Unit Tests**:
    -   Test Schema generation from Zod (if using `zod-to-json-schema` conversion).
2.  **Integration Tests**:
    -   **Connectivity**: Verify ADC works locally.
    -   **Schema Adherence**: Send "Half Sandwich" edge case; verify Gemini returns valid JSON `orderMade: false`.
    -   **Speed**: Measure `analyzeOrderSummary` latency (Target: < 1.5s).

## 🎯 Success Criteria
- **Schema Validation**: 100% compliant JSON responses.
- **Latency**: `Gemini 3.0 Flash` responses < 1.5s.
- **Cost Efficiency**: Context Caching reduces input tokens by >90% for menu-heavy prompts.
- **Safety**: No false triggers on restaurant menu terms.