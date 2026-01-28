# Additional AI Optimization Strategies for ORDERFLOW

This document extends the ideas in `ai-determinism.md` with additional strategies to improve AI accuracy, determinism, and reliability.

---

## 1. Model Management & Versioning

### 1.1 Pin Specific Model Versions
**Current State:** Uses `gpt-4o-mini` (latest version)
**Problem:** Model updates can change behavior unpredictably
**Solution:**
```typescript
// Instead of:
model: 'gpt-4o-mini'

// Use specific version:
model: 'gpt-4o-mini-2024-07-18'  // Pinned version
```

**Benefits:**
- Reproducible results across deployments
- Control over when to adopt model updates
- Easier debugging (behavior won't change unexpectedly)

**Implementation:**
- Add `OPENAI_MODEL_VERSION` env variable
- Test new versions in staging before production
- Document model version in logs for debugging

---

### 1.2 Model Fallback Chain
**Concept:** If primary model fails or produces low-quality output, fall back to alternatives

```typescript
const MODEL_CHAIN = [
  'gpt-4o-mini-2024-07-18',  // Fast, cheap
  'gpt-4-turbo',              // More capable fallback
  'gpt-4'                     // Highest quality fallback
];

async function callAIWithFallback(prompt: string, validator: (output: any) => boolean) {
  for (const model of MODEL_CHAIN) {
    try {
      const result = await callAI(model, prompt);
      if (validator(result)) return result;
    } catch (error) {
      console.log(`Model ${model} failed, trying next...`);
    }
  }
  throw new Error('All models failed');
}
```

---

## 2. Confidence Scoring & Uncertainty Detection

### 2.1 Add Confidence Scores to AI Outputs
**Current Issue:** AI always returns a result, even when uncertain
**Solution:** Ask AI to rate its confidence

```typescript
const OrderExtractionWithConfidence = z.object({
  reasoning: z.string(),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    "Your confidence in this extraction: high (99% sure), medium (80% sure), low (<80%)"
  ),
  orderMade: z.boolean(),
  customerName: z.string().optional(),
  items: z.array(/* ... */),
  // ... rest of schema
});
```

**Use Cases:**
- If `confidence === 'low'`, trigger human review
- If `confidence === 'medium'`, show warning in dashboard
- Track confidence scores over time to identify problematic patterns

---

### 2.2 Ambiguity Detection
Ask AI to flag ambiguous situations:

```typescript
ambiguities: z.array(z.object({
  field: z.enum(['items', 'pickupTime', 'customerName']),
  reason: z.string().describe("Why this field is ambiguous"),
  alternatives: z.array(z.string()).describe("Other possible interpretations")
})).optional()
```

**Example:**
```json
{
  "ambiguities": [
    {
      "field": "pickupTime",
      "reason": "Customer said '5:30' without AM/PM",
      "alternatives": ["5:30 AM", "5:30 PM"]
    }
  ]
}
```

---

## 3. Output Validation & Guardrails

### 3.1 Business Logic Validators
**Concept:** Validate AI outputs against known business rules

```typescript
function validateOrderOutput(output: OrderSummaryResult): ValidationResult {
  const errors: string[] = [];

  // Rule 1: Order total should match sum of item prices
  if (output.orderDetails) {
    const calculatedTotal = calculateTotalFromItems(output.orderDetails.items);
    if (calculatedTotal !== output.orderDetails.total) {
      errors.push(`Total mismatch: AI said ${output.orderDetails.total}, calculated ${calculatedTotal}`);
    }
  }

  // Rule 2: Pickup time must be in the future
  if (output.orderDetails?.pickupTime) {
    const pickupDate = parsePickupTime(output.orderDetails.pickupTime);
    if (pickupDate && pickupDate < new Date()) {
      errors.push(`Pickup time is in the past: ${output.orderDetails.pickupTime}`);
    }
  }

  // Rule 3: All items must exist in menu
  if (output.orderDetails?.items) {
    const invalidItems = output.orderDetails.items.filter(item => {
      const itemName = extractItemName(item);
      return !menuItemExists(itemName);
    });
    if (invalidItems.length > 0) {
      errors.push(`Invalid menu items: ${invalidItems.join(', ')}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

### 3.2 Constrained Generation (Logit Bias)
**Concept:** Force AI to only output valid menu item names

```typescript
// Build logit bias to favor valid menu items
function buildMenuLogitBias(menuItems: MenuItem[]): Record<string, number> {
  const bias: Record<string, number> = {};

  // Get token IDs for menu item names
  for (const item of menuItems) {
    const tokens = getTokenIds(item.name);  // Use tiktoken library
    tokens.forEach(tokenId => {
      bias[tokenId] = 10;  // Strongly favor these tokens
    });
  }

  return bias;
}

// Use in API call
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [...],
  logit_bias: buildMenuLogitBias(menuItems),  // Guide token selection
});
```

**Note:** This is advanced and may require experimentation. Works best for constrained vocabularies.

---

## 4. Caching & Performance Optimization

### 4.1 Semantic Caching
**Current:** No caching of AI responses (except suggested responses)
**Problem:** Similar conversations trigger identical API calls

```typescript
import { createHash } from 'crypto';

// Cache key based on conversation semantic content
function getSemanticCacheKey(messages: Message[]): string {
  // Normalize conversation (remove timestamps, IDs, etc.)
  const normalized = messages.map(m => ({
    sender: m.isOutgoing ? 'C' : 'R',
    text: m.text.toLowerCase().trim()
  }));

  return createHash('md5').update(JSON.stringify(normalized)).digest('hex');
}

async function analyzeWithCache(messages: Message[]): Promise<OrderSummaryResult> {
  const cacheKey = `analysis:${getSemanticCacheKey(messages)}`;

  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log('Using cached AI analysis');
    return JSON.parse(cached);
  }

  // Call AI
  const result = await analyzeOrderSummaryFromConversation(messages);

  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, JSON.stringify(result));

  return result;
}
```

---

### 4.2 Prompt Compression
**Problem:** Large prompts = high costs + slower responses
**Solution:** Compress conversation history while preserving meaning

```typescript
function compressConversation(messages: Message[]): string {
  // Keep only messages with order-relevant content
  const relevantMessages = messages.filter(m => {
    const text = m.text.toLowerCase();
    // Skip pure greetings, confirmations without info, etc.
    if (['hi', 'hello', 'hey', 'thanks', 'ok', 'yes', 'no'].includes(text.trim())) {
      return false;
    }
    return true;
  });

  // For very long conversations, summarize early messages
  if (relevantMessages.length > 20) {
    const early = relevantMessages.slice(0, -10);
    const recent = relevantMessages.slice(-10);

    // Summarize early messages
    const summary = `[Earlier conversation: Customer and restaurant discussed ${
      extractTopics(early).join(', ')
    }]`;

    return [summary, ...recent.map(formatMessage)].join('\n');
  }

  return formatConversation(relevantMessages);
}
```

---

## 5. Advanced Prompt Engineering

### 5.1 Negative Prompting
**Concept:** Explicitly tell the AI what NOT to do

```typescript
const systemPrompt = `You are an order detection system.

CRITICAL RULES:
✓ DO include items that are on the menu
✓ DO match "burger" to "Classic Burger"
✓ DO calculate total prices correctly

✗ DO NOT include items not on the menu
✗ DO NOT hallucinate "half sandwich" items (use Lunch Special instead)
✗ DO NOT include prices if not confident
✗ DO NOT assume pickup time if not mentioned
✗ DO NOT change the customer's wording unnecessarily

If you're unsure about any field, set confidence to 'low' and explain in reasoning.
`;
```

---

### 5.2 Self-Correction Loop
**Concept:** Ask AI to validate its own output

```typescript
async function analyzeWithSelfCorrection(messages: Message[]) {
  // Step 1: Initial analysis
  const initialResult = await analyzeOrderSummaryFromConversation(messages);

  // Step 2: Ask AI to validate its own output
  const validationPrompt = `You previously extracted this order:
${JSON.stringify(initialResult, null, 2)}

From this conversation:
${formatConversation(messages)}

Review your extraction and identify any errors or inconsistencies.
Return a JSON object:
{
  "errors": ["error1", "error2"],
  "correctedOutput": { /* corrected version */ }
}

If no errors, return {"errors": [], "correctedOutput": null}`;

  const validation = await callAI(validationPrompt);

  // Step 3: Use corrected output if errors found
  if (validation.errors.length > 0) {
    console.log(`AI self-corrected ${validation.errors.length} errors`);
    return validation.correctedOutput || initialResult;
  }

  return initialResult;
}
```

---

### 5.3 Role-Based Prompting
**Concept:** Give AI a specific role with expertise

```typescript
const systemPrompt = `You are Sarah, an experienced restaurant manager with 10 years of experience
taking phone orders. You have excellent attention to detail and always:
- Double-check item names against the menu
- Confirm quantities explicitly mentioned
- Ask for clarification when pickup times are ambiguous
- Never assume information not stated by the customer

Your job is to extract accurate order information from SMS conversations.`;
```

**Why it works:** Research shows AI performs better when given a specific persona/role.

---

## 6. Error Handling & Retry Logic

### 6.1 Smart Retry with Prompt Modification
**Current:** If AI fails, return `{ orderMade: false }`
**Better:** Retry with simplified or modified prompt

```typescript
async function analyzeWithRetry(
  messages: Message[],
  maxRetries = 3
): Promise<OrderSummaryResult> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Modify prompt based on attempt
      const prompt = attempt === 1
        ? buildStandardPrompt()
        : buildSimplifiedPrompt(lastError);  // Adapt based on failure

      const result = await analyzeOrderSummaryFromConversation(messages, prompt);

      // Validate result
      const validation = validateOrderOutput(result);
      if (validation.valid) {
        return result;
      }

      // If invalid, modify prompt to address specific errors
      lastError = validation.errors;
      console.log(`Attempt ${attempt} failed validation, retrying...`);

    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt} failed, retrying...`);
    }
  }

  // All retries failed
  console.error('All retry attempts failed', lastError);
  return { orderMade: false };
}
```

---

### 6.2 Partial Success Handling
**Concept:** Extract what you can, flag what you can't

```typescript
type PartialOrderSummary = {
  orderMade: boolean;
  orderDetails: {
    customerName?: string;  // ✓ Extracted
    items?: string[];       // ✓ Extracted
    pickupTime?: string;    // ⚠ Failed to extract
    notes?: string;
  };
  extractionStatus: {
    customerName: 'success' | 'failed' | 'uncertain';
    items: 'success' | 'failed' | 'uncertain';
    pickupTime: 'success' | 'failed' | 'uncertain';
  };
};
```

---

## 7. Testing & Monitoring

### 7.1 A/B Testing Framework
**Concept:** Test multiple prompts/strategies and measure results

```typescript
// Define experiments
const EXPERIMENTS = {
  orderDetection: {
    variants: {
      control: 'Standard prompt',
      chainOfThought: 'CoT prompt with reasoning',
      multiShot: 'Prompt with 5 examples',
      simplified: 'Simplified short prompt'
    },
    activeVariant: process.env.ORDER_DETECTION_VARIANT || 'control'
  }
};

// Use in code
const prompt = getPromptForVariant(EXPERIMENTS.orderDetection.activeVariant);

// Track results
await logExperimentResult({
  experiment: 'orderDetection',
  variant: EXPERIMENTS.orderDetection.activeVariant,
  orderId,
  accuracy: wasAccurate,
  latency: responseTime
});
```

---

### 7.2 Accuracy Metrics & Logging
**Track AI performance over time**

```typescript
interface AIMetrics {
  orderId: string;
  timestamp: Date;
  operation: 'orderDetection' | 'pickupTime' | 'suggestedResponse';
  model: string;
  latency: number;
  confidence?: string;
  humanValidated?: boolean;  // Did human confirm/correct?
  corrected?: boolean;       // Was correction needed?
}

async function logAIMetrics(metrics: AIMetrics) {
  await db.insert(aiMetricsTable).values(metrics);
}

// Weekly report
async function generateAccuracyReport() {
  const metrics = await db.select().from(aiMetricsTable)
    .where(/* last 7 days */);

  return {
    accuracy: metrics.filter(m => !m.corrected).length / metrics.length,
    avgConfidence: calculateAvgConfidence(metrics),
    avgLatency: calculateAvgLatency(metrics),
    topErrors: identifyCommonErrors(metrics)
  };
}
```

---

## 8. Advanced Techniques

### 8.1 Ensemble Voting
**Concept:** Call AI multiple times and vote on results

```typescript
async function analyzeWithEnsemble(messages: Message[], votes = 3) {
  // Call AI multiple times with different temperatures
  const results = await Promise.all([
    analyzeOrderSummaryFromConversation(messages, { temperature: 0.0 }),
    analyzeOrderSummaryFromConversation(messages, { temperature: 0.1 }),
    analyzeOrderSummaryFromConversation(messages, { temperature: 0.2 }),
  ]);

  // Vote on each field
  return {
    orderMade: majority(results.map(r => r.orderMade)),
    orderDetails: {
      customerName: majority(results.map(r => r.orderDetails?.customerName)),
      items: mostCommonItems(results.map(r => r.orderDetails?.items)),
      pickupTime: majority(results.map(r => r.orderDetails?.pickupTime)),
    }
  };
}
```

**Trade-off:** 3x cost and latency, but higher accuracy for critical orders.

---

### 8.2 Fine-Tuning for Restaurant Domain
**Long-term strategy:** Train custom model on your data

1. Collect 500-1000 real conversations with manually verified orders
2. Format as training data:
```json
{
  "messages": [
    {"role": "system", "content": "Extract order from conversation"},
    {"role": "user", "content": "Customer: Can I get 2 burgers?\nRestaurant: Sure!"},
    {"role": "assistant", "content": "{\"orderMade\": true, \"items\": [\"2x Burger: $19.98\"]}"}
  ]
}
```
3. Fine-tune model via OpenAI API
4. Use fine-tuned model for order detection

**Benefits:**
- Much higher accuracy on your specific menu/patterns
- Lower token usage (shorter prompts needed)
- Faster inference

**Cost:** $$$, ongoing maintenance

---

### 8.3 Entity Extraction Preprocessing
**Concept:** Use simpler NER model before AI to extract candidates

```typescript
// Use a lightweight NER model to pre-extract entities
import { pipeline } from '@xenova/transformers';

async function preprocessWithNER(conversation: string) {
  const ner = await pipeline('ner', 'Xenova/bert-base-NER');
  const entities = await ner(conversation);

  // Extract potential items, times, names
  const candidates = {
    items: entities.filter(e => e.entity === 'FOOD').map(e => e.word),
    times: entities.filter(e => e.entity === 'TIME').map(e => e.word),
    names: entities.filter(e => e.entity === 'PERSON').map(e => e.word),
  };

  // Pass to AI with hints
  return analyzeOrderSummaryFromConversation(messages, {
    hints: `Detected potential items: ${candidates.items.join(', ')}`
  });
}
```

---

## 9. Priority Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks)
1. ✓ Add confidence scoring to schemas
2. ✓ Implement business logic validators
3. ✓ Pin model versions
4. ✓ Add negative prompting to system prompts
5. ✓ Implement retry logic with backoff

### Phase 2: Infrastructure (2-4 weeks)
1. ✓ Semantic caching for AI responses
2. ✓ Metrics tracking and logging
3. ✓ A/B testing framework
4. ✓ Conversation compression

### Phase 3: Advanced (1-2 months)
1. ✓ Ensemble voting for critical orders
2. ✓ Self-correction loops
3. ✓ Entity extraction preprocessing
4. ✓ Fine-tuning exploration

### Phase 4: Ongoing
1. ✓ Monitor accuracy metrics weekly
2. ✓ Collect training data for fine-tuning
3. ✓ Iterate on prompts based on errors
4. ✓ Update validators as business rules evolve

---

## 10. Specific Recommendations for ORDERFLOW

### High-Impact, Low-Effort
1. **Confidence Scoring** - Add to existing schemas (2 hours)
2. **Business Validators** - Validate totals, menu items (4 hours)
3. **Model Pinning** - Use specific versions (30 mins)
4. **Negative Prompting** - Update prompts (1 hour)

### Medium-Impact, Medium-Effort
1. **Semantic Caching** - Reduce API costs by 30-40% (1 day)
2. **Metrics Dashboard** - Track accuracy over time (2 days)
3. **Retry Logic** - Handle failures gracefully (1 day)
4. **Conversation Compression** - Reduce token usage (1 day)

### High-Impact, High-Effort
1. **Fine-Tuning** - Custom model for restaurant orders (2-4 weeks)
2. **Ensemble Voting** - For high-value orders (1 week)
3. **A/B Testing** - Systematic prompt optimization (1 week)

### Edge Case Specific
- **Half Sandwich Issue**: Already using conditional AI, but add validator:
```typescript
function validateNoHalfSandwich(items: string[]): boolean {
  const hasHalf = items.some(item =>
    item.toLowerCase().includes('half') &&
    item.toLowerCase().includes('sandwich') &&
    !item.toLowerCase().includes('lunch special')
  );

  if (hasHalf) {
    console.error('AI HALLUCINATED HALF SANDWICH!', items);
    return false;
  }
  return true;
}
```

---

## 11. Cost-Benefit Analysis

| Strategy | Cost Increase | Accuracy Gain | Latency Impact | Implementation Time |
|----------|---------------|---------------|----------------|---------------------|
| Confidence Scoring | 0% | +5-10% | 0ms | 2 hours |
| Business Validators | 0% | +10-15% | +50ms | 4 hours |
| Semantic Caching | -30-40% | 0% | -500ms | 1 day |
| Retry Logic | +20% | +15-20% | +2s (on retry) | 1 day |
| Ensemble Voting | +200% | +20-25% | +3s | 1 week |
| Fine-Tuning | -50% (long-term) | +30-40% | -200ms | 2-4 weeks |

---

## Conclusion

The strategies above offer multiple paths to improve AI accuracy and determinism:

**Immediate Actions:**
1. Add confidence scoring and validators (Phase 1)
2. Implement semantic caching to reduce costs
3. Pin model versions for reproducibility

**Medium-Term Goals:**
1. Build metrics dashboard to track accuracy
2. Implement A/B testing for prompt optimization
3. Add retry logic and self-correction

**Long-Term Investment:**
1. Consider fine-tuning for domain-specific accuracy
2. Explore ensemble approaches for critical orders
3. Build feedback loops from manual corrections

Combined with the structured outputs from `ai-determinism.md`, these strategies create a robust, production-grade AI system for order processing.
