import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Phone, Info, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MessageBubble from './MessageBubble';
import IOSStatusBar from './IOSStatusBar';
import QuickReplyTemplates from './QuickReplyTemplates';
import EditableOrderSummary from './EditableOrderSummary';
import AISuggestedResponse from './AISuggestedResponse';
import type { Conversation, OrderDetails } from '@shared/schema';

type OptimisticMessage = {
  id: string;
  text: string;
  isOutgoing: boolean;
  timestamp: string;
};

type AIOrderDetailsPayload = {
  items?: string[];
  pickupTime?: string;
  notes?: string;
};

const DEFAULT_PICKUP_PLACEHOLDER = 'TBD';

function parsePriceFromItem(item: string | undefined): number {
  if (!item) {
    return 0;
  }
  const match = item.match(/:\s*\$([\d.,]+)/);
  if (!match) {
    return 0;
  }
  const numeric = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function derivePickupTimestampFromTime(pickupTime?: string): number {
  if (!pickupTime) {
    return Date.now();
  }

  const trimmed = pickupTime.trim();
  if (!trimmed) {
    return Date.now();
  }

  const match = trimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) {
    return Date.now();
  }

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toUpperCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return Date.now();
  }

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  const candidate = new Date();
  candidate.setHours(hours, minutes, 0, 0);

  // If the calculated time is more than 3 hours in the past, assume it's for the next day
  if (candidate.getTime() < Date.now() - 3 * 60 * 60 * 1000) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
}

function createOrderDetailsFromAIDetails(details: AIOrderDetailsPayload): OrderDetails {
  const normalizedItems = Array.isArray(details.items)
    ? details.items.map((item) => item.trim()).filter(Boolean)
    : [];

  const totalValue = normalizedItems.reduce((sum, item) => sum + parsePriceFromItem(item), 0);
  const pickupTimeText = details.pickupTime?.trim() || DEFAULT_PICKUP_PLACEHOLDER;
  const pickupTimestamp = derivePickupTimestampFromTime(details.pickupTime);

  const result: OrderDetails = {
    items: normalizedItems,
    pickupTime: pickupTimeText,
    pickupTimestamp,
    total: totalValue.toFixed(2),
  };

  if (details.notes && details.notes.trim()) {
    result.notes = details.notes.trim();
  }

  return result;
}

interface ConversationViewProps {
  conversation: Conversation;
  detectedPickupTime?: string;
  onBack?: () => void;
  onMarkReady?: (conversationId: string) => void;
  onUpdateOrder?: (conversationId: string, orderDetails: OrderDetails) => void;
  onSendMessage?: (conversationId: string, messageText: string) => Promise<void> | void;
  onDeleteOrder?: (conversationId: string) => void;
}

export default function ConversationView({
  conversation,
  detectedPickupTime,
  onBack,
  onMarkReady,
  onUpdateOrder,
  onSendMessage,
  onDeleteOrder,
}: ConversationViewProps) {
  const [messageInput, setMessageInput] = useState('');
  const [aiSuggestedResponse, setAiSuggestedResponse] = useState<string | null>(conversation.aiSuggestedResponse ?? null);
  const [aiItems, setAiItems] = useState<string[] | undefined>(conversation.orderDetails?.items);
  const [aiNotes, setAiNotes] = useState<string | undefined>(conversation.orderDetails?.notes ?? undefined);
  const [aiPickupTime, setAiPickupTime] = useState<string | undefined>(conversation.orderDetails?.pickupTime ?? undefined);
  const [autoStartEditing, setAutoStartEditing] = useState(false);
  const [aiOrderDetails, setAiOrderDetails] = useState<OrderDetails | null>(conversation.orderDetails ?? null);
  const [isSending, setIsSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastCustomerMessageIdRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const suggestionRef = useRef<HTMLDivElement>(null);
  const [suggestionHeight, setSuggestionHeight] = useState<number>(0);

  useEffect(() => {
    setAiSuggestedResponse(conversation.aiSuggestedResponse ?? null);
  }, [conversation.id]);

  useEffect(() => {
    if (conversation.aiSuggestedResponse) {
      setAiSuggestedResponse(conversation.aiSuggestedResponse);
    }
  }, [conversation.aiSuggestedResponse]);

  useEffect(() => {
    if (Array.isArray(conversation.orderDetails?.items) && conversation.orderDetails!.items.length > 0) {
      setAiItems(conversation.orderDetails!.items);
    }

    if (conversation.orderDetails?.notes) {
      setAiNotes(conversation.orderDetails.notes);
    }

    if (conversation.orderDetails?.pickupTime) {
      setAiPickupTime(conversation.orderDetails.pickupTime);
    }
  }, [conversation.orderDetails?.items, conversation.orderDetails?.notes, conversation.orderDetails?.pickupTime]);

  useEffect(() => {
    if (conversation.orderDetails) {
      setAiOrderDetails(conversation.orderDetails);
    } else {
      setAiOrderDetails(null);
    }
  }, [conversation.id, conversation.orderDetails]);

  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 50);

    return () => clearTimeout(timer);
  }, [conversation.id, conversation.messages.length]);

  useEffect(() => {
    if (optimisticMessages.length === 0) {
      return;
    }

    const existingTexts = new Set(
      conversation.messages.map((message) => message.text.trim().toLowerCase()),
    );

    setOptimisticMessages((previous) =>
      previous.filter((message) => !existingTexts.has(message.text.trim().toLowerCase())),
    );
  }, [conversation.messages, optimisticMessages.length]);

  useEffect(() => {
    if (!aiSuggestedResponse) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [aiSuggestedResponse]);

  useEffect(() => {
    if (!suggestionRef.current) {
      setSuggestionHeight(0);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSuggestionHeight(entry.contentRect.height);
      }
    });

    observer.observe(suggestionRef.current);

    return () => {
      observer.disconnect();
    };
  }, [aiSuggestedResponse]);

  useEffect(() => {
    const latestCustomerMessage = [...conversation.messages]
      .reverse()
      .find((message) => message.isOutgoing === true);

    if (!latestCustomerMessage) {
      return;
    }

    if (lastCustomerMessageIdRef.current === latestCustomerMessage.id) {
      return;
    }

    lastCustomerMessageIdRef.current = latestCustomerMessage.id;

    let cancelled = false;

    const refreshInsights = async () => {
      try {
        const summaryRes = await fetch(`/api/orders/${conversation.id}/ai-order-summary`);

        if (!cancelled && summaryRes.ok) {
          const summaryData = await summaryRes.json();
          if (summaryData?.details) {
            setAiItems(summaryData.details.items ?? undefined);
            setAiNotes(summaryData.details.notes ?? undefined);
            setAiPickupTime(summaryData.details.pickupTime ?? undefined);
            setAiOrderDetails(createOrderDetailsFromAIDetails(summaryData.details));
          }
        }

        const suggestionRes = await fetch(`/api/orders/${conversation.id}/ai-suggested-reply`);

        if (!cancelled && suggestionRes.ok) {
          const suggestionData = await suggestionRes.json();
          if (typeof suggestionData?.suggestion === 'string' && suggestionData.suggestion.trim()) {
            setAiSuggestedResponse(suggestionData.suggestion);
          }
        }
      } catch (error) {
        console.error('[ConversationView] Failed to refresh AI insights:', error);
      }
    };

    void refreshInsights();

    return () => {
      cancelled = true;
    };
  }, [conversation.id, conversation.messages]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !onSendMessage) {
      return;
    }

    const text = messageInput.trim();
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticEntry: OptimisticMessage = {
      id: optimisticId,
      text,
      isOutgoing: false,
      timestamp: new Date().toISOString(),
    };

    setMessageInput('');
    setOptimisticMessages((previous) => {
      const updated = [...previous, optimisticEntry];
      // Scroll immediately after the optimistic message is added
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 0);
      return updated;
    });

    try {
      setIsSending(true);
      await onSendMessage(conversation.id, text);
    } catch (error) {
      console.error('Error sending message:', error);
      setOptimisticMessages((previous) => previous.filter((message) => message.id !== optimisticId));
      setMessageInput(text);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

  const handleUseSuggestion = (text: string) => {
    setMessageInput(text);
  };

  const handleQuickReply = (template: string) => {
    setMessageInput(template);
  };

  const handleConfirmOrder = () => {
    setAutoStartEditing(true);
  };

  const handleSaveOrder = (updatedDetails: OrderDetails) => {
    onUpdateOrder?.(conversation.id, updatedDetails);
    setAutoStartEditing(false);
    setAiOrderDetails(updatedDetails);
  };

  const orderDetailsToDisplay = conversation.orderDetails ?? aiOrderDetails;
  const normalizedOrderStatus = (conversation.orderStatus ?? 'new') as 'new' | 'confirmed' | 'ready' | 'completed';

  const isUrgent = () => {
    if (normalizedOrderStatus === 'new') return false;
    if (!orderDetailsToDisplay?.pickupTimestamp) return false;
    const now = Date.now();
    const timeUntilPickup = orderDetailsToDisplay.pickupTimestamp - now;
    const minutesUntilPickup = timeUntilPickup / (1000 * 60);
    return minutesUntilPickup > 0 && minutesUntilPickup < 10;
  };

  const isRunningLate = () => {
    if (!orderDetailsToDisplay?.pickupTimestamp) return false;
    if (normalizedOrderStatus !== 'confirmed') return false;
    return Date.now() > orderDetailsToDisplay.pickupTimestamp;
  };

  const getOrderCountText = () => {
    const count = conversation.orderCount;
    if (count === 1) return null;
    if (count === 2) return '2nd order';
    if (count === 3) return '3rd order';
    if (count >= 8) return `VIP (${count}x)`;
    return `${count}th order`;
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[hsl(var(--background-gradient-start))] to-[hsl(var(--background-gradient-end))]">
      <IOSStatusBar />

      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-black">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          data-testid="button-back"
          className="rounded-full"
        >
          <ArrowLeft className="w-5 h-5 text-primary" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-lg truncate" data-testid="text-contact-name">
              {conversation.customerName || conversation.phoneNumber}
            </h2>
            {getOrderCountText() && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-repeat-customer">
                {getOrderCountText()}
              </Badge>
            )}
            {isRunningLate() && (
              <Badge className="text-xs bg-orange-500 hover:bg-orange-600 text-white" data-testid="badge-running-late">
                LATE
              </Badge>
            )}
            {isUrgent() && !isRunningLate() && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-urgent">
                URGENT
              </Badge>
            )}
          </div>
          {conversation.customerName && conversation.phoneNumber && (
            <p className="text-xs text-muted-foreground">{conversation.phoneNumber}</p>
          )}
        </div>
        <Button size="icon" variant="ghost" data-testid="button-call" className="rounded-full">
          <Phone className="w-5 h-5 text-primary" />
        </Button>
        <Button size="icon" variant="ghost" data-testid="button-info" className="rounded-full">
          <Info className="w-5 h-5 text-primary" />
        </Button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        ref={messagesContainerRef}
        style={{ paddingBottom: aiSuggestedResponse ? '5rem' : '2rem' }}
      >
        {conversation.messages
          .filter((message) => !message.isAIOrganized)
          .map((message) => (
            <MessageBubble
              key={message.id}
              text={message.text}
              isOutgoing={message.isOutgoing}
              timestamp={new Date(message.timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            />
          ))}
        {optimisticMessages.map((message) => (
          <MessageBubble
            key={message.id}
            text={message.text}
            isOutgoing={message.isOutgoing}
            timestamp={new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {aiSuggestedResponse && (
        <AISuggestedResponse suggestion={aiSuggestedResponse} onUseSuggestion={handleUseSuggestion} />
      )}

      {orderDetailsToDisplay && (
        <div className="px-4 pb-3 max-h-[60vh] overflow-y-auto">
          <EditableOrderSummary
            orderDetails={orderDetailsToDisplay}
            orderStatus={normalizedOrderStatus}
            detectedPickupTime={detectedPickupTime}
            onSave={handleSaveOrder}
            autoStartEditing={autoStartEditing}
            onCancelEditing={() => setAutoStartEditing(false)}
            itemsFromAI={aiItems}
            notesFromAI={aiNotes}
            pickupTimeFromAI={aiPickupTime}
          />

          {conversation.orderStatus === 'new' && onDeleteOrder && (
            <div className="flex gap-2 mt-3">
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => onDeleteOrder(conversation.id)}
                data-testid="button-delete-order"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Order
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirmOrder}
                data-testid="button-confirm-order"
              >
                Confirm Order
              </Button>
            </div>
          )}

          {conversation.orderStatus === 'new' && !onDeleteOrder && (
            <Button
              className="w-full mt-3"
              onClick={handleConfirmOrder}
              data-testid="button-confirm-order"
            >
              Confirm Order
            </Button>
          )}

          {conversation.orderStatus === 'confirmed' && onMarkReady && (
            <Button
              className="w-full mt-3"
              onClick={() => onMarkReady(conversation.id)}
              data-testid="button-mark-ready"
            >
              Mark Ready for Pickup
            </Button>
          )}

          {onDeleteOrder && conversation.orderStatus !== 'new' && (
            <Button
              variant="destructive"
              className="w-full mt-3"
              onClick={() => onDeleteOrder(conversation.id)}
              data-testid="button-delete-order"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Order
            </Button>
          )}
        </div>
      )}

      <div className="px-4 py-3 border-t border-border bg-black">
        <div className="flex items-center gap-2">
          <QuickReplyTemplates onSelectTemplate={handleQuickReply} />
          <div className="flex-1 flex items-center gap-2 bg-muted rounded-full px-4 py-2">
            <input
              type="text"
              placeholder="iMessage"
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1 bg-transparent outline-none text-base text-foreground"
              data-testid="input-message"
              disabled={isSending}
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageInput.trim() || isSending}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-50 cursor-pointer"
              data-testid="button-send"
            >
              <span className="text-primary-foreground text-lg">↑</span>
            </button>
          </div>
        </div>
      </div>

      <div className="h-8 bg-transparent" />
    </div>
  );
}

