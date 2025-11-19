# SSE Flow Analysis - Orders & Conversations

## ✅ What Works Correctly

### 1. **SSE Connection Setup**
- `/api/events` is user-specific (based on `req.user.id`)
- Each user gets their own SSE connection
- Recent events are sent on reconnect (if PRODUCTION=true)

### 2. **Incoming SMS Flow** (`/sms/reply`)
- Receives SMS → Finds/creates order → Gets userId → Emits SSE to that userId ✅
- Message saved to database before SSE emission ✅
- SSE event includes: `orderId`, `message`, `source: 'incoming'`, `isNewOrder` ✅

### 3. **Outgoing Message Flow** (`/api/orders/:orderId/message`)
- Authenticated route → Gets userId from session → Emits SSE to that userId ✅
- Message saved to database before SSE emission ✅
- SSE event includes: `orderId`, `message`, `source: 'outgoing'` ✅

### 4. **Redis Pub/Sub (Production)**
- Events published to Redis channel `sse:user:${userId}` ✅
- Instance ID filtering prevents duplicates ✅
- Recent events stored with end-of-day expiration ✅

### 5. **Frontend Event Handling**
- SSEProvider connects to `/api/events` ✅
- Home.tsx listens for `order-message` events ✅
- Refetches conversations when events arrive ✅
- ConversationView updates when conversation prop changes ✅

## ⚠️ Potential Issues Found

### 1. **CRITICAL: No SSE Auto-Reconnection**
**Issue**: If SSE connection drops, frontend won't reconnect automatically.
**Impact**: User loses real-time updates until page refresh.
**Location**: `client/src/providers/SSEProvider.tsx`

### 2. **Event Ordering Race Condition**
**Issue**: If new events arrive while sending recent events on reconnect, ordering might be wrong.
**Impact**: Messages might appear out of order briefly.
**Location**: `server/routes.ts:1144` - Recent events sent, but new events can arrive simultaneously.

### 3. **Redis Connection Drops**
**Issue**: If Redis connection drops, pub/sub stops working (no reconnection logic).
**Impact**: Multi-instance deployments lose cross-instance event broadcasting.
**Location**: `server/redis.ts` - No reconnection handling for subscriber.

### 4. **Polling vs SSE Conflict**
**Issue**: Frontend polls every 2-5 seconds AND uses SSE, which could cause duplicate updates.
**Impact**: Unnecessary API calls, potential race conditions.
**Location**: `client/src/pages/Home.tsx:34` - `refetchInterval` still active.

### 5. **ConversationView Message Updates**
**Issue**: ConversationView relies on prop updates from parent refetch, not direct SSE events.
**Impact**: Slight delay in message display (waits for refetch to complete).
**Location**: `client/src/components/ConversationView.tsx` - No direct SSE handling.

## 🔧 Recommended Fixes

### Fix 1: Add SSE Auto-Reconnection
Add exponential backoff reconnection logic to SSEProvider.

### Fix 2: Add Redis Reconnection
Add reconnection logic for Redis subscriber connection.

### Fix 3: Reduce/Remove Polling
Since SSE is active, reduce polling interval or remove it entirely.

### Fix 4: Add Event Sequence Numbers
Add sequence numbers to events to ensure proper ordering.

## 📊 Flow Diagram

```
Incoming SMS:
Twilio → /sms/reply → Find/Create Order → Get userId → Save Message → emitSSE(userId, ...)
                                                                          ↓
                                                                    Redis Pub/Sub (if PRODUCTION)
                                                                          ↓
                                                                    All Server Instances
                                                                          ↓
                                                                    Local SSE Clients
                                                                          ↓
                                                                    Frontend SSEProvider
                                                                          ↓
                                                                    Home.tsx useEffect
                                                                          ↓
                                                                    Refetch Conversations
                                                                          ↓
                                                                    ConversationView Updates
```

## ✅ Production Readiness Checklist

- [x] SSE events include all necessary data (orderId, message, source)
- [x] Events are user-specific (userId-based)
- [x] Redis pub/sub works for multi-instance
- [x] Recent events stored for reconnection catch-up
- [x] Instance ID filtering prevents duplicates
- [ ] SSE auto-reconnection (MISSING)
- [ ] Redis subscriber reconnection (MISSING)
- [ ] Event ordering guarantees (PARTIAL)
- [ ] Polling optimization (NEEDS REVIEW)

