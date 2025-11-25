# Conversation Session Management & Long-Term Memory

## Problem Statement

**Current Implementation:**
- Every AI call sends the **entire conversation history** from the beginning
- No distinction between recent context and older messages
- No memory of customer preferences, past orders, or important facts
- As conversations grow (10+ messages), we face:
  - Increased token costs
  - Slower response times
  - Risk of hitting context limits (32k-128k tokens)
  - Difficulty maintaining coherence in long conversations

**Goal:**
Build a smart memory system that:
1. Maintains relevant **short-term context** (current order)
2. Preserves **long-term memory** (customer preferences, history)
3. Scales to unlimited conversation length
4. Reduces token usage and improves accuracy

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Conversation Layer                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Working    │  │   Session    │  │  Long-Term   │      │
│  │   Memory     │  │   Summary    │  │   Memory     │      │
│  │ (Last 5-10   │  │ (Compressed  │  │ (Customer    │      │
│  │  messages)   │  │  history)    │  │  profile)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         ↓                  ↓                  ↓              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            Context Assembly & Prompt Building        │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    AI Model                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Short-Term Memory: Sliding Window

### Concept
Keep only the most recent N messages in "active memory" for the AI.

### Implementation

```typescript
interface ConversationWindow {
  recentMessages: Message[];      // Last 10 messages
  sessionSummary?: string;         // Summary of older messages
  importantFacts: string[];        // Extracted key facts
}

function buildWorkingMemory(
  allMessages: Message[],
  windowSize: number = 10
): ConversationWindow {
  const totalMessages = allMessages.length;

  // If conversation is short, use all messages
  if (totalMessages <= windowSize) {
    return {
      recentMessages: allMessages,
      importantFacts: []
    };
  }

  // Split into old and recent
  const oldMessages = allMessages.slice(0, -windowSize);
  const recentMessages = allMessages.slice(-windowSize);

  // Summarize old messages
  const sessionSummary = summarizeConversation(oldMessages);

  // Extract key facts from old messages
  const importantFacts = extractImportantFacts(oldMessages);

  return {
    recentMessages,
    sessionSummary,
    importantFacts
  };
}
```

### Prompt Construction

```typescript
function buildPromptWithMemory(window: ConversationWindow): string {
  let context = '';

  // Add session summary
  if (window.sessionSummary) {
    context += `CONVERSATION HISTORY SUMMARY:\n${window.sessionSummary}\n\n`;
  }

  // Add important facts
  if (window.importantFacts.length > 0) {
    context += `IMPORTANT FACTS FROM EARLIER:\n`;
    window.importantFacts.forEach(fact => {
      context += `- ${fact}\n`;
    });
    context += '\n';
  }

  // Add recent messages
  context += `RECENT CONVERSATION:\n`;
  context += formatConversation(window.recentMessages);

  return context;
}
```

**Benefits:**
- ✓ Fixed token usage regardless of conversation length
- ✓ Maintains recent context in full detail
- ✓ Preserves critical information from earlier
- ✓ Scales to unlimited conversation length

---

## 2. Conversation Summarization

### Progressive Summarization Strategy

```typescript
interface ConversationSummary {
  stage: 'greeting' | 'ordering' | 'confirming' | 'modifications' | 'completed';
  keyPoints: string[];
  resolvedIssues: string[];
  pendingQuestions: string[];
  lastUpdated: Date;
}

async function summarizeConversation(
  messages: Message[]
): Promise<string> {
  // Use AI to create a concise summary
  const prompt = `Summarize this restaurant order conversation in 3-5 bullet points.
Focus on:
- What the customer ordered (items, quantities)
- Any modifications or special requests
- Pickup time if mentioned
- Any issues that were resolved
- Current status of the order

Conversation:
${formatConversation(messages)}

Return a brief summary:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 200, // Keep summary short
  });

  return response.choices[0].message.content || '';
}
```

### Incremental Summarization

Instead of re-summarizing everything, update incrementally:

```typescript
interface IncrementalSummary {
  summary: string;
  lastProcessedMessageIndex: number;
  version: number;
}

async function updateSummaryIncremental(
  currentSummary: IncrementalSummary,
  newMessages: Message[]
): Promise<IncrementalSummary> {
  if (newMessages.length === 0) return currentSummary;

  const prompt = `Current conversation summary:
${currentSummary.summary}

New messages since last summary:
${formatConversation(newMessages)}

Update the summary to include the new information. Keep it concise (3-5 bullet points):`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 200,
  });

  return {
    summary: response.choices[0].message.content || currentSummary.summary,
    lastProcessedMessageIndex: currentSummary.lastProcessedMessageIndex + newMessages.length,
    version: currentSummary.version + 1
  };
}
```

**Storage:**
```sql
CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  summary TEXT,
  last_processed_message_index INT,
  version INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## 3. Important Facts Extraction

### Auto-Extract Critical Information

```typescript
interface ImportantFact {
  type: 'allergy' | 'preference' | 'instruction' | 'constraint';
  content: string;
  confidence: number;
  messageIndex: number;
}

async function extractImportantFacts(
  messages: Message[]
): Promise<ImportantFact[]> {
  const prompt = `Analyze this conversation and extract any important facts that should be remembered:

Types of facts to extract:
- ALLERGIES: "no peanuts", "allergic to dairy"
- PREFERENCES: "extra sauce", "well done", "light on salt"
- INSTRUCTIONS: "leave at door", "call when ready"
- CONSTRAINTS: "no onions", "vegetarian only"

Conversation:
${formatConversation(messages)}

Return JSON array of facts:
{
  "facts": [
    {
      "type": "allergy",
      "content": "Customer is allergic to peanuts",
      "confidence": 0.95
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(response.choices[0].message.content || '{"facts":[]}');
  return result.facts || [];
}
```

### Fact Persistence

```sql
CREATE TABLE conversation_facts (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  customer_id UUID REFERENCES customers(id),
  type TEXT, -- 'allergy', 'preference', 'instruction', 'constraint'
  content TEXT,
  confidence FLOAT,
  extracted_at TIMESTAMP,
  still_relevant BOOLEAN DEFAULT true
);

CREATE INDEX idx_conversation_facts_customer ON conversation_facts(customer_id);
```

---

## 4. Long-Term Memory: Customer Profiles

### Customer Memory Schema

```typescript
interface CustomerMemory {
  customerId: string;
  profile: {
    name: string;
    phoneNumber: string;
    preferredPickupTimes: string[];  // e.g., ["6:00 PM", "7:30 PM"]
    averageOrderValue: number;
  };
  preferences: {
    favoriteItems: Array<{ item: string; count: number }>;
    allergies: string[];
    dietaryRestrictions: string[];  // vegetarian, gluten-free, etc.
    customizations: Array<{ item: string; modification: string }>;
  };
  orderHistory: {
    totalOrders: number;
    lastOrderDate: Date;
    recentOrders: Array<{
      date: Date;
      items: string[];
      total: number;
    }>;
  };
  conversationStyle: {
    typicalGreeting: string;  // "Hi", "Hey", "Hello"
    responseTime: 'fast' | 'moderate' | 'slow';
    communicationStyle: 'brief' | 'detailed';
  };
}
```

### Database Schema for Long-Term Memory

```sql
-- Extend existing customers table
ALTER TABLE customers ADD COLUMN preferred_pickup_times JSONB;
ALTER TABLE customers ADD COLUMN dietary_restrictions TEXT[];
ALTER TABLE customers ADD COLUMN communication_style TEXT;

-- Customer preferences table
CREATE TABLE customer_preferences (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  preference_type TEXT, -- 'favorite_item', 'allergy', 'customization'
  preference_key TEXT,   -- e.g., 'Burger', 'peanuts'
  preference_value TEXT, -- e.g., 'extra cheese', 'allergic'
  confidence FLOAT,
  times_mentioned INT DEFAULT 1,
  last_mentioned TIMESTAMP,
  created_at TIMESTAMP
);

-- Customer item preferences (what they usually order)
CREATE TABLE customer_item_preferences (
  customer_id UUID REFERENCES customers(id),
  menu_item_name TEXT,
  order_count INT DEFAULT 0,
  customizations JSONB, -- e.g., {"modifications": ["extra cheese", "no onions"]}
  last_ordered TIMESTAMP,
  PRIMARY KEY (customer_id, menu_item_name)
);
```

### Building Customer Profile

```typescript
async function buildCustomerProfile(
  customerId: string
): Promise<CustomerMemory> {
  // Fetch customer data
  const customer = await storage.getCustomerById(customerId);
  const stats = await storage.getCustomerStats(customerId);
  const recentOrders = await storage.getRecentOrders(customerId, 10);
  const preferences = await storage.getCustomerPreferences(customerId);

  // Analyze order history for patterns
  const favoriteItems = await analyzeFavoriteItems(recentOrders);
  const preferredTimes = await analyzePreferredPickupTimes(recentOrders);

  return {
    customerId,
    profile: {
      name: formatCustomerName(customer.firstName, customer.lastName),
      phoneNumber: customer.phoneNumber,
      preferredPickupTimes: preferredTimes,
      averageOrderValue: parseFloat(stats?.totalSpent || '0') / (stats?.totalOrders || 1)
    },
    preferences: {
      favoriteItems,
      allergies: preferences.filter(p => p.preference_type === 'allergy').map(p => p.preference_value),
      dietaryRestrictions: customer.dietaryRestrictions || [],
      customizations: preferences.filter(p => p.preference_type === 'customization')
    },
    orderHistory: {
      totalOrders: stats?.totalOrders || 0,
      lastOrderDate: stats?.lastOrderDate || new Date(),
      recentOrders: recentOrders.map(o => ({
        date: o.createdAt,
        items: o.items || [],
        total: parseFloat(o.orderPrice || '0')
      }))
    },
    conversationStyle: {
      typicalGreeting: 'Hi', // Could be extracted from conversations
      responseTime: 'moderate',
      communicationStyle: 'brief'
    }
  };
}
```

### Using Customer Profile in Prompts

```typescript
function buildPromptWithCustomerMemory(
  messages: Message[],
  customerProfile: CustomerMemory
): string {
  let context = `CUSTOMER PROFILE:\n`;
  context += `Name: ${customerProfile.profile.name}\n`;

  // Add relevant history
  if (customerProfile.orderHistory.totalOrders > 0) {
    context += `Total previous orders: ${customerProfile.orderHistory.totalOrders}\n`;
    context += `Average order value: $${customerProfile.profile.averageOrderValue.toFixed(2)}\n`;
  }

  // Add preferences
  if (customerProfile.preferences.favoriteItems.length > 0) {
    context += `\nUSUAL ORDERS:\n`;
    customerProfile.preferences.favoriteItems.slice(0, 3).forEach(item => {
      context += `- ${item.item} (ordered ${item.count} times)\n`;
    });
  }

  // Add important restrictions
  if (customerProfile.preferences.allergies.length > 0) {
    context += `\n⚠️ ALLERGIES: ${customerProfile.preferences.allergies.join(', ')}\n`;
  }

  if (customerProfile.preferences.dietaryRestrictions.length > 0) {
    context += `⚠️ DIETARY RESTRICTIONS: ${customerProfile.preferences.dietaryRestrictions.join(', ')}\n`;
  }

  // Add recent order context
  if (customerProfile.orderHistory.recentOrders.length > 0) {
    const lastOrder = customerProfile.orderHistory.recentOrders[0];
    const daysSinceLastOrder = Math.floor(
      (Date.now() - lastOrder.date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLastOrder < 7) {
      context += `\nLast order was ${daysSinceLastOrder} days ago:\n`;
      context += lastOrder.items.join(', ') + '\n';
    }
  }

  context += `\n---\n\nCURRENT CONVERSATION:\n`;
  context += formatConversation(messages);

  return context;
}
```

---

## 5. Hybrid Memory System

Combine all approaches for optimal performance:

```typescript
interface HybridMemoryContext {
  // Short-term memory (current session)
  workingMemory: {
    recentMessages: Message[];          // Last 10 messages
    sessionSummary?: string;             // Summary of earlier messages in this session
    currentOrderState: OrderSummaryResult; // Latest detected order
  };

  // Medium-term memory (this conversation)
  conversationMemory: {
    importantFacts: ImportantFact[];     // Extracted from this conversation
    conversationStage: ConversationStage;
    unresolved: string[];                 // Pending questions/issues
  };

  // Long-term memory (customer history)
  customerMemory: CustomerMemory;

  // Context metadata
  metadata: {
    totalMessages: number;
    conversationDuration: number;        // minutes
    lastAIUpdate: Date;
  };
}

async function buildHybridContext(
  orderId: string,
  userId: string
): Promise<HybridMemoryContext> {
  // Fetch all data in parallel
  const [order, conversation, customer] = await Promise.all([
    storage.getOrderById(userId, orderId),
    storage.getOrderConversation(userId, orderId),
    storage.getCustomerById(order.customerId)
  ]);

  const allMessages = (conversation.messages as Message[]) || [];

  // Build working memory (sliding window)
  const workingMemory = buildWorkingMemory(allMessages, 10);

  // Extract important facts from conversation
  const importantFacts = await extractImportantFacts(allMessages);

  // Build customer profile
  const customerMemory = await buildCustomerProfile(order.customerId);

  // Detect current order state
  const currentOrderState = await analyzeOrderSummaryFromConversation(
    workingMemory.recentMessages,
    customerMemory.profile.name
  );

  return {
    workingMemory: {
      recentMessages: workingMemory.recentMessages,
      sessionSummary: workingMemory.sessionSummary,
      currentOrderState
    },
    conversationMemory: {
      importantFacts,
      conversationStage: detectConversationStage(allMessages),
      unresolved: detectUnresolvedQuestions(allMessages)
    },
    customerMemory,
    metadata: {
      totalMessages: allMessages.length,
      conversationDuration: calculateDuration(allMessages),
      lastAIUpdate: new Date()
    }
  };
}
```

---

## 6. Vector Database for Semantic Memory

For very advanced use cases, use vector embeddings to find relevant past conversations:

### Architecture

```typescript
// Store conversation chunks as vectors
interface ConversationChunk {
  id: string;
  orderId: string;
  customerId: string;
  content: string;           // 3-5 messages grouped together
  embedding: number[];       // Vector embedding (1536 dimensions for OpenAI)
  timestamp: Date;
  messageIndices: number[];  // Which messages this chunk contains
}
```

### Implementation with pgvector

```sql
-- Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create table for conversation embeddings
CREATE TABLE conversation_embeddings (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  customer_id UUID REFERENCES customers(id),
  content TEXT,
  embedding vector(1536),  -- OpenAI ada-002 embedding size
  message_indices INT[],
  created_at TIMESTAMP
);

-- Create index for similarity search
CREATE INDEX ON conversation_embeddings USING ivfflat (embedding vector_cosine_ops);
```

### Generating Embeddings

```typescript
async function storeConversationEmbeddings(
  orderId: string,
  customerId: string,
  messages: Message[]
) {
  // Chunk messages into groups of 5
  const chunks = chunkMessages(messages, 5);

  for (const chunk of chunks) {
    const content = formatConversation(chunk.messages);

    // Generate embedding
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: content
    });

    // Store in database
    await db.insert(conversationEmbeddings).values({
      id: randomUUID(),
      orderId,
      customerId,
      content,
      embedding: embedding.data[0].embedding,
      messageIndices: chunk.indices,
      createdAt: new Date()
    });
  }
}
```

### Semantic Search for Relevant Context

```typescript
async function findRelevantPastConversations(
  query: string,
  customerId: string,
  limit: number = 3
): Promise<ConversationChunk[]> {
  // Generate embedding for current query
  const queryEmbedding = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: query
  });

  // Find similar past conversations using cosine similarity
  const results = await db.execute(sql`
    SELECT
      id,
      order_id,
      content,
      message_indices,
      1 - (embedding <=> ${queryEmbedding.data[0].embedding}::vector) as similarity
    FROM conversation_embeddings
    WHERE customer_id = ${customerId}
    ORDER BY embedding <=> ${queryEmbedding.data[0].embedding}::vector
    LIMIT ${limit}
  `);

  return results.rows;
}
```

### Using Semantic Memory

```typescript
async function buildPromptWithSemanticMemory(
  currentMessages: Message[],
  customerId: string
): Promise<string> {
  // Find relevant past conversations
  const currentContext = formatConversation(currentMessages.slice(-3));
  const relevantPast = await findRelevantPastConversations(
    currentContext,
    customerId,
    3
  );

  let prompt = '';

  if (relevantPast.length > 0) {
    prompt += `RELEVANT PAST CONVERSATIONS:\n`;
    relevantPast.forEach((chunk, i) => {
      prompt += `\n[${i + 1}] Similarity: ${(chunk.similarity * 100).toFixed(1)}%\n`;
      prompt += chunk.content + '\n';
    });
    prompt += '\n---\n\n';
  }

  prompt += `CURRENT CONVERSATION:\n`;
  prompt += formatConversation(currentMessages);

  return prompt;
}
```

**Benefits:**
- Find similar past situations automatically
- "This customer asked about gluten-free options last time"
- Handle edge cases by learning from past conversations
- No need to manually track everything

---

## 7. Conversation State Machine

Track where the customer is in the ordering process:

```typescript
enum ConversationStage {
  INITIAL_GREETING = 'greeting',
  BROWSING_MENU = 'browsing',
  PLACING_ORDER = 'ordering',
  CONFIRMING_DETAILS = 'confirming',
  DISCUSSING_PICKUP = 'pickup',
  ORDER_MODIFICATIONS = 'modifying',
  ORDER_COMPLETED = 'completed',
  ISSUE_RESOLUTION = 'issue'
}

interface ConversationState {
  stage: ConversationStage;
  enteredAt: Date;
  confidence: number;
  transitions: Array<{
    from: ConversationStage;
    to: ConversationStage;
    timestamp: Date;
  }>;
}

function detectConversationStage(messages: Message[]): ConversationStage {
  if (messages.length === 0) return ConversationStage.INITIAL_GREETING;

  const lastMessages = messages.slice(-3).map(m => m.text.toLowerCase());
  const allText = lastMessages.join(' ');

  // Pattern matching for stages
  if (allText.match(/\b(hi|hello|hey)\b/)) {
    return ConversationStage.INITIAL_GREETING;
  }

  if (allText.match(/\b(menu|what do you have|options)\b/)) {
    return ConversationStage.BROWSING_MENU;
  }

  if (allText.match(/\b(want|order|get|can i have)\b/)) {
    return ConversationStage.PLACING_ORDER;
  }

  if (allText.match(/\b(pickup|ready|time|when)\b/)) {
    return ConversationStage.DISCUSSING_PICKUP;
  }

  if (allText.match(/\b(change|actually|instead|modify)\b/)) {
    return ConversationStage.ORDER_MODIFICATIONS;
  }

  if (allText.match(/\b(confirm|sounds good|perfect|thanks)\b/)) {
    return ConversationStage.CONFIRMING_DETAILS;
  }

  return ConversationStage.PLACING_ORDER;
}
```

### Stage-Specific Context

```typescript
function buildStageSpecificPrompt(
  stage: ConversationStage,
  messages: Message[]
): string {
  const baseContext = formatConversation(messages);

  const stageInstructions = {
    [ConversationStage.INITIAL_GREETING]: `
      Customer just started conversation. Focus on:
      - Greeting warmly
      - Asking what they'd like to order
    `,
    [ConversationStage.PLACING_ORDER]: `
      Customer is actively ordering. Focus on:
      - Capturing all items clearly
      - Noting quantities and customizations
      - Confirming menu items exist
    `,
    [ConversationStage.DISCUSSING_PICKUP]: `
      Customer is discussing pickup time. Focus on:
      - Capturing exact time
      - Converting relative times ("in 30 minutes")
      - Confirming feasibility
    `,
    [ConversationStage.ORDER_MODIFICATIONS]: `
      Customer is changing their order. Focus on:
      - Understanding what changed
      - Updating order accurately
      - Confirming new total
    `
  };

  return stageInstructions[stage] + '\n\n' + baseContext;
}
```

---

## 8. Implementation Roadmap

### Phase 1: Basic Sliding Window (1 week)
```typescript
// ✓ Implement sliding window (last 10 messages)
// ✓ Add conversation summarization for older messages
// ✓ Update prompts to use windowed context
// ✓ Add token usage metrics
```

### Phase 2: Important Facts Extraction (1-2 weeks)
```typescript
// ✓ Build fact extraction system
// ✓ Create conversation_facts table
// ✓ Auto-extract allergies, preferences
// ✓ Include facts in prompts
```

### Phase 3: Customer Profiles (2-3 weeks)
```typescript
// ✓ Extend customer schema with preferences
// ✓ Build customer_item_preferences table
// ✓ Analyze order history for patterns
// ✓ Include customer memory in prompts
```

### Phase 4: Conversation State Machine (1 week)
```typescript
// ✓ Implement stage detection
// ✓ Track stage transitions
// ✓ Add stage-specific instructions
```

### Phase 5: Vector Memory (Advanced, 3-4 weeks)
```typescript
// ✓ Set up pgvector
// ✓ Generate conversation embeddings
// ✓ Implement semantic search
// ✓ Use relevant past conversations in prompts
```

---

## 9. Expected Impact

### Token Usage Reduction
| Conversation Length | Current Tokens | With Sliding Window | Savings |
|---------------------|----------------|---------------------|---------|
| 10 messages         | 1,200          | 1,200               | 0%      |
| 20 messages         | 2,400          | 1,500               | 38%     |
| 50 messages         | 6,000          | 2,000               | 67%     |
| 100 messages        | 12,000         | 2,500               | 79%     |

### Accuracy Improvements
- **With Customer Memory**: 15-20% better item predictions (knows favorites)
- **With Fact Extraction**: 25-30% fewer allergy/preference errors
- **With Stage Detection**: 10-15% better response relevance
- **With Vector Search**: 20-25% better edge case handling

### Response Time
- **Current**: 2-3s for 50+ message conversations
- **With Sliding Window**: 1-1.5s (consistent regardless of length)
- **With Caching**: 0.5s for repeat patterns

---

## 10. Code Examples

### Complete Working Memory System

```typescript
// server/services/memory.service.ts

export class ConversationMemoryService {
  private windowSize = 10;

  async buildContext(
    orderId: string,
    userId: string
  ): Promise<string> {
    // Get conversation
    const conversation = await storage.getOrderConversation(userId, orderId);
    const allMessages = (conversation.messages as Message[]) || [];

    // Build working memory
    const context: string[] = [];

    // 1. Add customer profile if available
    const order = await storage.getOrderById(userId, orderId);
    if (order.customerId) {
      const customerProfile = await this.buildCustomerContext(order.customerId);
      if (customerProfile) {
        context.push(customerProfile);
      }
    }

    // 2. Add conversation summary if long
    if (allMessages.length > this.windowSize) {
      const oldMessages = allMessages.slice(0, -this.windowSize);
      const summary = await this.summarizeMessages(oldMessages);
      context.push(`EARLIER IN CONVERSATION:\n${summary}`);

      // 3. Extract important facts
      const facts = await this.extractFacts(oldMessages);
      if (facts.length > 0) {
        context.push(`IMPORTANT NOTES:\n${facts.join('\n')}`);
      }
    }

    // 4. Add recent messages
    const recentMessages = allMessages.slice(-this.windowSize);
    context.push(`CURRENT CONVERSATION:\n${formatConversation(recentMessages)}`);

    return context.join('\n\n---\n\n');
  }

  private async buildCustomerContext(customerId: string): Promise<string | null> {
    const stats = await storage.getCustomerStats(customerId);
    if (!stats || stats.totalOrders === 0) return null;

    const recentOrders = await storage.getRecentOrders(customerId, 5);
    const favoriteItems = this.analyzeFavorites(recentOrders);

    let context = `CUSTOMER HISTORY:\n`;
    context += `- Total orders: ${stats.totalOrders}\n`;
    context += `- Average order: $${(parseFloat(stats.totalSpent) / stats.totalOrders).toFixed(2)}\n`;

    if (favoriteItems.length > 0) {
      context += `- Frequently orders: ${favoriteItems.join(', ')}\n`;
    }

    return context;
  }

  private async summarizeMessages(messages: Message[]): Promise<string> {
    // Implementation from section 2
    return summarizeConversation(messages);
  }

  private async extractFacts(messages: Message[]): Promise<string[]> {
    // Implementation from section 3
    const facts = await extractImportantFacts(messages);
    return facts.map(f => `${f.type.toUpperCase()}: ${f.content}`);
  }

  private analyzeFavorites(orders: any[]): string[] {
    const itemCounts = new Map<string, number>();

    orders.forEach(order => {
      (order.items || []).forEach((item: string) => {
        const name = item.split(':')[0].trim();
        itemCounts.set(name, (itemCounts.get(name) || 0) + 1);
      });
    });

    return Array.from(itemCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);
  }
}
```

### Usage in Existing Code

```typescript
// server/aiFunctions.ts

import { ConversationMemoryService } from './services/memory.service.js';
const memoryService = new ConversationMemoryService();

export async function analyzeOrderSummaryFromConversation(
  messages: Message[],
  orderId: string,  // Add this parameter
  userId: string,   // Add this parameter
  customerName?: string,
  menuItems?: Array<{ name: string; price: string; category: string | null }>
): Promise<OrderSummaryResult> {
  // Build smart context instead of sending all messages
  const conversationContext = await memoryService.buildContext(orderId, userId);

  const menuContext = buildMenuContext(menuItems);
  const systemPrompt = buildOrderSummaryPrompt(menuContext);

  try {
    const getOrderSummary =
      process.env.MODEL === "TRUCUBE" ? TrucubeOrderSummary : OpenAIOrderSummary;

    // Use smart context instead of full conversation
    const response: OrderSummaryResult = await getOrderSummary(
      systemPrompt,
      conversationContext,  // Instead of formatConversation(messages)
      customerName
    );

    // Rest of the function remains the same...
    return response;
  } catch (error) {
    console.error("Error analyzing order:", error);
    return { orderMade: false };
  }
}
```

---

## 11. Monitoring & Metrics

Track the effectiveness of your memory system:

```typescript
interface MemoryMetrics {
  avgTokensPerRequest: number;
  avgResponseTime: number;
  cacheHitRate: number;
  factExtractionAccuracy: number;
  customerRecognitionRate: number;
}

async function trackMemoryMetrics(
  orderId: string,
  metrics: {
    tokensUsed: number;
    responseTime: number;
    cacheHit: boolean;
    factsExtracted: number;
    customerFound: boolean;
  }
) {
  await db.insert(memoryMetricsTable).values({
    orderId,
    tokensUsed: metrics.tokensUsed,
    responseTime: metrics.responseTime,
    cacheHit: metrics.cacheHit,
    factsExtracted: metrics.factsExtracted,
    customerFound: metrics.customerFound,
    timestamp: new Date()
  });
}
```

---

## Conclusion

This conversation memory system provides:

1. **Scalability**: Handle unlimited conversation length
2. **Efficiency**: 60-80% token reduction for long conversations
3. **Context Preservation**: Never lose important information
4. **Personalization**: Remember customer preferences and history
5. **Intelligence**: Use semantic search to find relevant past interactions

**Quick Wins (Implement First):**
- Sliding window (1 week, huge token savings)
- Customer favorite items (2 days, better predictions)
- Conversation summarization (3 days, better long-term context)

**Advanced Features (Later):**
- Vector embeddings for semantic memory
- Automatic fact extraction and persistence
- Cross-conversation learning
