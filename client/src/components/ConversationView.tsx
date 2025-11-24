import { useEffect, useRef, useState } from 'react';
import type { EditableOrderSummaryRef } from './EditableOrderSummary';
import { ArrowLeft, Phone, Info, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import MessageBubble from './MessageBubble';
import IOSStatusBar from './IOSStatusBar';
import QuickReplyTemplates from './QuickReplyTemplates';
import EditableOrderSummary from './EditableOrderSummary';
import AISuggestedResponse from './AISuggestedResponse';
import { useIsMobile } from '@/hooks/use-mobile';
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
  onMarkReady?: (conversationId: string, orderWasUpdated?: boolean) => void;
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
  const [lunchSpecialRequest, setLunchSpecialRequest] = useState<boolean>(false);
  const [autoStartEditing, setAutoStartEditing] = useState(false);
  const [aiOrderDetails, setAiOrderDetails] = useState<OrderDetails | null>(conversation.orderDetails ?? null);
  const [isSending, setIsSending] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [initialOrderDetails, setInitialOrderDetails] = useState<OrderDetails | null>(null);
  const [showOptInAlert, setShowOptInAlert] = useState(false);
  const [optInStatus, setOptInStatus] = useState<{ twilioCampaignEnabled: boolean; optInStatus: 'opted-in' | 'pending' | 'opted-out' | null } | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isMobile = useIsMobile();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastCustomerMessageIdRef = useRef<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const suggestionRef = useRef<HTMLDivElement>(null);
  const [suggestionHeight, setSuggestionHeight] = useState<number>(0);
  const orderSummaryRef = useRef<EditableOrderSummaryRef>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const suggestionFallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setAiSuggestedResponse(conversation.aiSuggestedResponse ?? null);
    // Reset initial order details when conversation changes
    // It will be set properly in the next useEffect when conversation.orderDetails is available
    setInitialOrderDetails(null);
    setAiOrderDetails(null);
    // Reset opt-in status when conversation changes
    setOptInStatus(null);
  }, [conversation.id]);

  // Fetch opt-in status when conversation changes or new messages arrive
  useEffect(() => {
    const fetchOptInStatus = async () => {
      try {
        const response = await fetch(`/api/orders/${conversation.id}/opt-in-status`);
        if (response.ok) {
          const data = await response.json();
          setOptInStatus(data);
        }
      } catch (error) {
        console.error('Error fetching opt-in status:', error);
      }
    };

    void fetchOptInStatus();
  }, [conversation.id, conversation.messages.length]); // Also refresh when messages change

  // Refresh opt-in status when we see a YES message (customer just opted in)
  useEffect(() => {
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (lastMessage && lastMessage.isOutgoing) {
      const upperText = lastMessage.text.toUpperCase().trim();
      if (upperText === 'YES' || upperText === 'Y') {
        // Refresh opt-in status after a delay to allow backend to update
        const timer = setTimeout(() => {
          const fetchOptInStatus = async () => {
            try {
              const response = await fetch(`/api/orders/${conversation.id}/opt-in-status`);
              if (response.ok) {
                const data = await response.json();
                setOptInStatus(data);
              }
            } catch (error) {
              console.error('Error fetching opt-in status:', error);
            }
          };
          void fetchOptInStatus();
        }, 1000); // Increased delay to ensure backend has processed
        return () => clearTimeout(timer);
      }
    }
  }, [conversation.id, conversation.messages]);

  // Update AI suggested response when it arrives via SSE
  // If we get it from SSE, cancel any pending fallback timeout
  useEffect(() => {
    if (conversation.aiSuggestedResponse) {
      setAiSuggestedResponse(conversation.aiSuggestedResponse);
      // Cancel fallback timeout since SSE delivered the suggestion
      if (suggestionFallbackTimeoutRef.current) {
        clearTimeout(suggestionFallbackTimeoutRef.current);
        suggestionFallbackTimeoutRef.current = null;
      }
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

  // Set initial order details and aiOrderDetails when conversation first loads
  // This runs when conversation.id changes OR when conversation.orderDetails first becomes available
  useEffect(() => {
    if (conversation.orderDetails) {
      // Set initial order details when conversation first opens (only if not already set)
      setInitialOrderDetails((prev) => {
        if (!prev) {
          return { ...conversation.orderDetails! };
        }
        return prev; // Keep existing initial order details
      });
      // Set aiOrderDetails if we don't have local edits (only if null/undefined)
      setAiOrderDetails((prev) => prev ?? conversation.orderDetails ?? null);
    }
  }, [conversation.id, conversation.orderDetails]); // Watch both conversation.id and orderDetails

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

  // Scroll to bottom when input is focused (keyboard opens)
  useEffect(() => {
    if (isInputFocused) {
      // Small delay to allow keyboard to start opening, then scroll
      const timer1 = setTimeout(() => {
        if (messagesContainerRef.current && messagesEndRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 100);
      
      // Additional scroll after keyboard fully opens
      const timer2 = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 400);
      
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [isInputFocused]);

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

  // Refresh AI order summary when new customer messages arrive
  // AI suggested reply comes via SSE, so we only fetch it as a fallback if SSE doesn't deliver
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

    // Always refresh order summary when new messages arrive
    // Add a delay on first fetch to allow backend order detection to complete
    const refreshOrderSummary = async (delayMs = 0, retryCount = 0) => {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      if (cancelled) return;

      try {
        const summaryRes = await fetch(`/api/orders/${conversation.id}/ai-order-summary`);

        if (!cancelled && summaryRes.ok) {
          const summaryData = await summaryRes.json();
          
          // If we got an order, stop retrying
          if (summaryData?.details && summaryData.orderMade) {
            setAiItems(summaryData.details.items ?? undefined);
            setAiNotes(summaryData.details.notes ?? undefined);
            setAiPickupTime(summaryData.details.pickupTime ?? undefined);
            setLunchSpecialRequest(summaryData.lunchspecialrequest ?? false);
            setAiOrderDetails(createOrderDetailsFromAIDetails(summaryData.details));
            return; // Success - stop retrying
          }

          // If no order detected yet, retry with exponential backoff (max 3 retries)
          if (!summaryData?.orderMade && retryCount < 3) {
            // Retry at: 2.5s, 4.5s, 7s (giving backend more time for complex analyses)
            const retryDelays = [2500, 4500, 7000];
            const delay = retryDelays[retryCount] || 7000;
            setTimeout(() => {
              if (!cancelled) {
                refreshOrderSummary(0, retryCount + 1);
              }
            }, delay);
            return;
          }
        }
      } catch (error) {
        console.error('[ConversationView] Failed to refresh AI order summary:', error);
        // Retry on error with exponential backoff (max 2 error retries)
        if (retryCount < 2 && !cancelled) {
          const retryDelays = [2000, 4000];
          const delay = retryDelays[retryCount] || 4000;
          setTimeout(() => {
            if (!cancelled) {
              refreshOrderSummary(0, retryCount + 1);
            }
          }, delay);
        }
      }
    };

    // Add initial delay for first order to allow backend order detection to start
    void refreshOrderSummary(1000);

    // Clear any existing fallback timeout
    if (suggestionFallbackTimeoutRef.current) {
      clearTimeout(suggestionFallbackTimeoutRef.current);
      suggestionFallbackTimeoutRef.current = null;
    }

    // Set a fallback timeout: if SSE hasn't provided the suggestion within 3 seconds, fetch via API
    // This handles cases where SSE is slow, delayed, or not connected
    const orderIdForFallback = conversation.id;
    suggestionFallbackTimeoutRef.current = setTimeout(async () => {
      // Only fetch if we still don't have a suggestion (timeout will be cancelled if SSE delivers)
      if (!cancelled) {
        try {
          const suggestionRes = await fetch(`/api/orders/${orderIdForFallback}/ai-suggested-reply`);

          if (!cancelled && suggestionRes.ok) {
            const suggestionData = await suggestionRes.json();
            if (typeof suggestionData?.suggestion === 'string' && suggestionData.suggestion.trim()) {
              setAiSuggestedResponse(suggestionData.suggestion);
            }
          }
        } catch (error) {
          console.error('[ConversationView] Failed to fetch AI suggested reply (fallback):', error);
        }
      }
      suggestionFallbackTimeoutRef.current = null;
    }, 3000); // 3 second timeout for SSE to deliver

    return () => {
      cancelled = true;
      if (suggestionFallbackTimeoutRef.current) {
        clearTimeout(suggestionFallbackTimeoutRef.current);
        suggestionFallbackTimeoutRef.current = null;
      }
    };
  }, [conversation.id, conversation.messages.length, conversation.messages, conversation.aiSuggestedResponse, aiSuggestedResponse]);

  // Poll for order summary on mount if conversation has customer messages but no order summary yet
  // This handles cases where user opens conversation after message already arrived
  useEffect(() => {
    const hasCustomerMessages = conversation.messages.some(msg => msg.isOutgoing === true);
    const hasOrderDetails = !!conversation.orderDetails;
    const hasAiOrderDetails = !!aiOrderDetails;

    // If there are customer messages but no order summary, poll immediately
    if (hasCustomerMessages && !hasOrderDetails && !hasAiOrderDetails) {
      console.log('[ConversationView] Mount check: Customer messages exist but no order summary, polling...');
      
      let cancelled = false;
      const pollOnMount = async (retryCount = 0) => {
        if (cancelled) return;

        try {
          const summaryRes = await fetch(`/api/orders/${conversation.id}/ai-order-summary`);
          if (cancelled) return;

          if (summaryRes.ok) {
            const summaryData = await summaryRes.json();
            
            if (summaryData?.details && summaryData.orderMade) {
              setAiItems(summaryData.details.items ?? undefined);
              setAiNotes(summaryData.details.notes ?? undefined);
              setAiPickupTime(summaryData.details.pickupTime ?? undefined);
              setLunchSpecialRequest(summaryData.lunchspecialrequest ?? false);
              setAiOrderDetails(createOrderDetailsFromAIDetails(summaryData.details));
              return; // Success
            }

            // Retry if no order yet (max 2 retries on mount)
            if (!summaryData?.orderMade && retryCount < 2) {
              const retryDelays = [3000, 5000];
              setTimeout(() => {
                if (!cancelled) {
                  pollOnMount(retryCount + 1);
                }
              }, retryDelays[retryCount]);
            }
          }
        } catch (error) {
          console.error('[ConversationView] Mount poll failed:', error);
          // Retry once on error
          if (retryCount === 0 && !cancelled) {
            setTimeout(() => {
              if (!cancelled) {
                pollOnMount(1);
              }
            }, 3000);
          }
        }
      };

      // Small delay to avoid immediate duplicate polls
      const timer = setTimeout(() => {
        void pollOnMount();
      }, 500);

      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [conversation.id]); // Only run when conversation changes

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !onSendMessage) {
      return;
    }

    const text = messageInput.trim();

    // Only check opt-in status if Twilio Campaign is enabled and we have status data
    // Allow sending if status is null (still loading) or if campaign is disabled
    if (optInStatus?.twilioCampaignEnabled) {
      // If status is null or not opted-in, show alert
      if (!optInStatus.optInStatus || optInStatus.optInStatus !== 'opted-in') {
        // Show alert dialog to inform user
        setShowOptInAlert(true);
        return;
      }
    }

    await sendMessage(text);
  };

  const sendMessage = async (text: string) => {
    if (!onSendMessage) {
      return;
    }

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
    // If form is already expanded (editing), trigger save with confirmation (send to preparation)
    if (orderSummaryRef.current?.isEditing) {
      // Trigger save with confirmation dialog which will send to preparation
      orderSummaryRef.current.triggerSaveWithConfirmation();
    } else {
      // Otherwise, expand the form
      setAutoStartEditing(true);
    }
  };

  const handleSaveOrder = (updatedDetails: OrderDetails) => {
    onUpdateOrder?.(conversation.id, updatedDetails);
    setAutoStartEditing(false);
    // Keep the updated details in aiOrderDetails so comparison works
    setAiOrderDetails(updatedDetails);
    console.log('[Save Order] Order saved, updated aiOrderDetails:', updatedDetails);
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

      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 border-b border-border bg-black">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          data-testid="button-back"
          className="rounded-full min-h-[44px] min-w-[44px]"
        >
          <ArrowLeft className="w-5 h-5 text-primary" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <h2 className="font-semibold text-base sm:text-lg truncate" data-testid="text-contact-name">
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
        <Button size="icon" variant="ghost" data-testid="button-call" className="rounded-full min-h-[44px] min-w-[44px]">
          <Phone className="w-5 h-5 text-primary" />
        </Button>
        <Button size="icon" variant="ghost" data-testid="button-info" className="rounded-full min-h-[44px] min-w-[44px]">
          <Info className="w-5 h-5 text-primary" />
        </Button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-2 sm:space-y-3"
        ref={messagesContainerRef}
        style={{ 
          paddingBottom: aiSuggestedResponse 
            ? (isMobile && isInputFocused 
                ? 'calc(8rem + env(safe-area-inset-bottom, 0px))' 
                : 'calc(5rem + env(safe-area-inset-bottom, 0px))')
            : (isMobile && isInputFocused 
                ? 'calc(7rem + env(safe-area-inset-bottom, 0px))' 
                : 'calc(2rem + env(safe-area-inset-bottom, 0px))')
        }}
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
        <div className="px-3 sm:px-4 pb-2 sm:pb-3 max-h-[60vh] overflow-y-auto">
          <EditableOrderSummary
            ref={orderSummaryRef}
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
              onClick={() => {
                // Compare current order details with initial order details
                // Use aiOrderDetails if available (most recent saved state), otherwise use conversation.orderDetails
                const currentDetails = aiOrderDetails ?? conversation.orderDetails ?? null;
                
                console.log('[Mark Ready] Comparison data:', {
                  hasInitialOrderDetails: !!initialOrderDetails,
                  hasCurrentDetails: !!currentDetails,
                  initialOrderDetails,
                  currentDetails,
                  aiOrderDetails,
                  conversationOrderDetails: conversation.orderDetails,
                });
                
                const hasChanged = initialOrderDetails && currentDetails ? (
                  // Compare items (sort arrays for comparison)
                  JSON.stringify((initialOrderDetails.items || []).sort()) !== JSON.stringify((currentDetails.items || []).sort()) ||
                  // Compare notes (handle null/undefined)
                  (initialOrderDetails.notes || '') !== (currentDetails.notes || '') ||
                  // Compare pickup time
                  (initialOrderDetails.pickupTime || '') !== (currentDetails.pickupTime || '') ||
                  // Compare total
                  (initialOrderDetails.total || '0.00') !== (currentDetails.total || '0.00')
                ) : false;
                
                console.log('[Mark Ready] Order changed check:', {
                  hasChanged,
                  initialItems: initialOrderDetails?.items,
                  currentItems: currentDetails?.items,
                  itemsChanged: JSON.stringify((initialOrderDetails?.items || []).sort()) !== JSON.stringify((currentDetails?.items || []).sort()),
                  initialNotes: initialOrderDetails?.notes,
                  currentNotes: currentDetails?.notes,
                  notesChanged: (initialOrderDetails?.notes || '') !== (currentDetails?.notes || ''),
                  initialPickupTime: initialOrderDetails?.pickupTime,
                  currentPickupTime: currentDetails?.pickupTime,
                  pickupTimeChanged: (initialOrderDetails?.pickupTime || '') !== (currentDetails?.pickupTime || ''),
                  initialTotal: initialOrderDetails?.total,
                  currentTotal: currentDetails?.total,
                  totalChanged: (initialOrderDetails?.total || '0.00') !== (currentDetails?.total || '0.00'),
                });
                
                onMarkReady(conversation.id, hasChanged);
              }}
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

      <div 
        ref={inputContainerRef}
        className="sticky bottom-0 z-10 px-3 sm:px-4 py-2 sm:py-3 border-t border-border bg-black"
        style={{ 
          paddingBottom: `calc(0.5rem + env(safe-area-inset-bottom, 0px))`,
          // On mobile, use transform to ensure it stays above keyboard
          ...(isMobile ? {
            transform: 'translateZ(0)', // Force hardware acceleration
          } : {})
        }}
      >
        <div className="flex items-center gap-2">
          <QuickReplyTemplates onSelectTemplate={handleQuickReply} />
          <div className="flex-1 flex items-center gap-2 bg-muted rounded-full px-3 sm:px-4 py-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="iMessage"
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              onKeyPress={handleKeyPress}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              className="flex-1 bg-transparent outline-none text-sm sm:text-base text-foreground"
              data-testid="input-message"
              disabled={isSending}
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageInput.trim() || isSending}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-50 cursor-pointer min-h-[44px] min-w-[44px]"
              data-testid="button-send"
            >
              <span className="text-primary-foreground text-base sm:text-lg">↑</span>
            </button>
          </div>
        </div>
      </div>


      <AlertDialog open={showOptInAlert} onOpenChange={setShowOptInAlert}>
        <AlertDialogContent className="max-w-[280px] p-4">
          <AlertDialogHeader className="pb-2">
            <AlertDialogTitle className="text-base">Cannot Send Message</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              {optInStatus?.optInStatus === 'opted-out' 
                ? 'This customer has opted out. Messages cannot be sent.'
                : 'This customer has not completed the opt-in process. They must reply YES to receive messages.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 pt-2">
            <AlertDialogCancel 
              className="m-0 flex-1 text-xs h-8"
              onClick={() => setShowOptInAlert(false)}
            >
              OK
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

