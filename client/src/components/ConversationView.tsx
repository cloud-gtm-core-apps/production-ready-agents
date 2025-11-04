import { useState, useEffect, useRef } from 'react';
import { queryClient } from '@/lib/queryClient';
import { ArrowLeft, Phone, Info, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MessageBubble from './MessageBubble';
import IOSStatusBar from './IOSStatusBar';
import QuickReplyTemplates from './QuickReplyTemplates';
import EditableOrderSummary from './EditableOrderSummary';
import AISuggestedResponse from './AISuggestedResponse';
import type { Conversation, OrderDetails } from '@shared/schema';

interface ConversationViewProps {
  conversation: Conversation;
  detectedPickupTime?: string;
  ws?: WebSocket | null;
  onBack?: () => void;
  onConfirmOrder?: (conversationId: string) => void;
  onMarkReady?: (conversationId: string) => void;
  onUpdateOrder?: (conversationId: string, orderDetails: OrderDetails) => void;
  onSendMessage?: (conversationId: string, messageText: string) => void;
  onDeleteOrder?: (conversationId: string) => void;
}

export default function ConversationView({ 
  conversation, 
  detectedPickupTime,
  ws,
  onBack,
  onConfirmOrder,
  onMarkReady,
  onUpdateOrder,
  onSendMessage,
  onDeleteOrder
}: ConversationViewProps) {
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoStartEditing, setAutoStartEditing] = useState(false);
  const [aiItems, setAiItems] = useState<string[] | undefined>(undefined);
  const [aiNotes, setAiNotes] = useState<string | undefined>(undefined);
  const [aiPickupTime, setAiPickupTime] = useState<string | undefined>(undefined);
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{ id: string; text: string; isOutgoing: boolean; timestamp: string }>>([]);
  const [streamingMessages, setStreamingMessages] = useState<Record<string, { text: string; timestamp: string; isVisible: boolean }>>({});
  const [isTyping, setIsTyping] = useState(false);
  const [aiSuggestedResponse, setAiSuggestedResponse] = useState<string | undefined>(conversation.aiSuggestedResponse);
  const displayName = conversation.customerName || conversation.phoneNumber;
  
  // Update aiSuggestedResponse when conversation prop changes
  useEffect(() => {
    if (conversation.aiSuggestedResponse) {
      setAiSuggestedResponse(conversation.aiSuggestedResponse);
    }
  }, [conversation.aiSuggestedResponse]);
  
  // Scroll to bottom when conversation opens or messages change
  useEffect(() => {
    // Small delay to ensure DOM is updated before scrolling for smoother animation
    const timer = setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [conversation.id, conversation.messages.length, optimisticMessages.length, Object.keys(streamingMessages).length, isTyping]);

  // Auto-scroll when AI suggested response appears to prevent blocking latest messages
  useEffect(() => {
    if (aiSuggestedResponse && messagesEndRef.current) {
      // Small delay to let the AI suggested response render first
      const timer = setTimeout(() => {
        if (messagesEndRef.current) {
          // Scroll to show the latest messages above the AI suggested response
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [aiSuggestedResponse]);
  
  // Remove optimistic messages when they appear in the real conversation
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    
    // Check if any optimistic message text matches a real message
    const realMessageTexts = new Set(conversation.messages.map(m => m.text.trim()));
    setOptimisticMessages(prev => 
      prev.filter(msg => !realMessageTexts.has(msg.text.trim()))
    );
  }, [conversation.messages, optimisticMessages.length]);
  
  // Remove streaming messages when they appear in the real conversation
  useEffect(() => {
    if (Object.keys(streamingMessages).length === 0) return;
    
    // Check if any streaming message text matches a real message
    // Only remove if the text matches exactly to prevent flickering
    const realMessageTexts = new Set(conversation.messages.map(m => m.text.trim()));
    setStreamingMessages(prev => {
      const updated = { ...prev };
      let hasChanges = false;
      
      Object.keys(updated).forEach(messageId => {
        const streamingText = updated[messageId].text.trim();
        // Only remove if we have a matching message AND the streaming message is visible
        // This ensures smooth transition - the DB message replaces the streaming one seamlessly
        if (updated[messageId].isVisible && streamingText && realMessageTexts.has(streamingText)) {
          delete updated[messageId];
          hasChanges = true;
        }
      });
      
      return hasChanges ? updated : prev;
    });
  }, [conversation.messages]);
  
  // Listen to WebSocket events for streaming messages and sent messages
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        
        // Only handle messages for this conversation
        if (data.orderId !== conversation.id) return;

        if (data.type === 'message_sent') {
          // Rod's message was sent and confirmed - it will appear in refetch
          // The useEffect above will remove it from optimistic when it appears in conversation.messages
        } else if (data.type === 'message_stream_start') {
          // Start typing animation
          setIsTyping(true);
          // Create invisible placeholder block to collect chunks
          setStreamingMessages(prev => ({
            ...prev,
            [data.messageId]: {
              text: '',
              timestamp: data.timestamp || new Date().toISOString(),
              isVisible: false,
            },
          }));
        } else if (data.type === 'message_stream_chunk') {
          // Collect chunks but don't show them yet - wait for complete
          setStreamingMessages(prev => {
            const existing = prev[data.messageId];
            if (!existing) {
              // If message doesn't exist yet, create it
              setIsTyping(true);
              return {
                ...prev,
                [data.messageId]: {
                  text: data.text,
                  timestamp: new Date().toISOString(),
                  isVisible: false,
                },
              };
            }
            
            return {
              ...prev,
              [data.messageId]: {
                ...existing,
                text: existing.text + data.text,
                isVisible: false, // Keep invisible until streaming completes
              },
            };
          });
        } else if (data.type === 'message_stream_complete') {
          // Stop typing animation and show the complete message
          setIsTyping(false);
          setStreamingMessages(prev => {
            const existing = prev[data.messageId];
            if (!existing) return prev;
            
            return {
              ...prev,
              [data.messageId]: {
                ...existing,
                isVisible: true, // Now make it visible with complete text
              },
            };
          });
          
          // Don't remove immediately - let the useEffect handle removal when it appears in conversation.messages
          // This prevents the flash/disappear bug
          // The debounced order detection will trigger on the server and send AI organized message if needed
        } else if (data.type === 'message_received' && data.isAIOrganized) {
          // AI organized message received - trigger refetch to show it
          // This handles both new and updated AI organized messages
          console.log(`[ConversationView] AI organized message received for order ${data.orderId}, refetching...`);
          setTimeout(async () => {
            // Refetch all order-related queries (matching query keys that start with '/api/orders')
            await queryClient.refetchQueries({ 
              queryKey: ['/api/orders'],
              exact: false 
            });
            console.log(`[ConversationView] Refetched conversations after AI organized message`);
          }, 300); // Slightly longer delay to ensure DB is updated
        } else if (data.type === 'ai_suggested_response') {
          // AI suggested response received - update local state
          console.log(`[ConversationView] AI suggested response received for order ${data.orderId}: ${data.suggestion}`);
          if (data.orderId === conversation.id) {
            setAiSuggestedResponse(data.suggestion);
          }
        }
      } catch (error) {
        // Not a JSON message, ignore
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [ws, conversation.id]);
  
  const isUrgent = () => {
    if (conversation.orderStatus === 'new') return false;
    if (!conversation.orderDetails?.pickupTimestamp) return false;
    const now = Date.now();
    const timeUntilPickup = conversation.orderDetails.pickupTimestamp - now;
    const minutesUntilPickup = timeUntilPickup / (1000 * 60);
    return minutesUntilPickup > 0 && minutesUntilPickup < 10;
  };

  const isRunningLate = () => {
    if (!conversation.orderDetails?.pickupTimestamp) return false;
    if (conversation.orderStatus !== 'confirmed') return false;
    const now = Date.now();
    return now > conversation.orderDetails.pickupTimestamp;
  };

  const getOrderCountText = () => {
    const count = conversation.orderCount;
    if (count === 1) return null;
    if (count === 2) return '2nd order';
    if (count === 3) return '3rd order';
    if (count >= 8) return `VIP (${count}x)`;
    return `${count}th order`;
  };

  const handleQuickReply = (template: string) => {
    setMessageInput(template);
  };


  const handleUseSuggestion = (text: string) => {
    setMessageInput(text);
  };

  const handleSendMessage = () => {
    if (messageInput.trim() && onSendMessage) {
      const messageText = messageInput.trim();
      const tempMessageId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Add message to optimistic state immediately for instant display
      setOptimisticMessages(prev => [...prev, {
        id: tempMessageId,
        text: messageText,
        isOutgoing: false, // Rod's messages are outgoing from restaurant perspective
        timestamp: new Date().toISOString(),
      }]);
      
      // Clear input
      setMessageInput('');
      
      // Send via WebSocket
      onSendMessage(conversation.id, messageText);
    }
  };

  // Parse AI organized message to extract items, notes, and pickup time
  const parseAIMessage = (messageText: string) => {
    const lines = messageText.split('\n');
    const items: string[] = [];
    let notes = '';
    let pickupTime = '';
    let foundCustomer = false;
    let foundPickupTime = false;
    let collectingNotes = false;
    const notesLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      
      if (!trimmed) {
        // Empty line - might indicate transition from items to notes
        if (foundCustomer && items.length > 0 && !foundPickupTime) {
          collectingNotes = true;
        }
        continue;
      }
      
      // Skip customer name line
      if (trimmed.toLowerCase().startsWith('customer:')) {
        foundCustomer = true;
        continue;
      }
      
      // Check for pickup time
      if (trimmed.toLowerCase().includes('pickup time:')) {
        const match = trimmed.match(/pickup time:\s*(.+)/i);
        if (match) {
          pickupTime = match[1].trim();
        }
        foundPickupTime = true;
        collectingNotes = false;
        continue;
      }
      
      // If we've found customer
      if (foundCustomer) {
        // Check if it's an item (contains price pattern or quantity pattern)
        const hasPrice = trimmed.includes(':$') || trimmed.match(/:\s*\$[\d.]+/);
        const hasQuantity = trimmed.match(/^\d+x\s/i);
        
        if (hasPrice || hasQuantity) {
          // It's an item
          items.push(trimmed);
          collectingNotes = false;
        } else if (collectingNotes || (items.length > 0 && !foundPickupTime)) {
          // Likely notes - collect until we find pickup time or end
          if (!foundPickupTime) {
            notesLines.push(trimmed);
          }
        } else if (items.length === 0 && !trimmed.toLowerCase().includes('customer')) {
          // Could be first item without price, or notes before items
          // If it's short and looks like an item name, treat as item
          if (trimmed.length < 50 && !trimmed.includes('\n')) {
            items.push(trimmed);
          } else {
            notesLines.push(trimmed);
          }
        }
      }
    }

    notes = notesLines.join('\n').trim();

    return { items, notes, pickupTime };
  };

  const handleConfirmOrder = () => {
    // Find the LATEST AI organized message (most recent timestamp)
    // Since we now create new messages instead of updating, we need the most recent one
    const aiMessages = conversation.messages.filter(msg => msg.isAIOrganized === true);
    
    if (aiMessages.length > 0) {
      // Sort by timestamp descending to get the latest one
      const latestAIMessage = aiMessages.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA; // Descending order (newest first)
      })[0];
      
      // Parse the latest AI message to extract items, notes, and pickup time
      const parsed = parseAIMessage(latestAIMessage.text);
      setAiItems(parsed.items.length > 0 ? parsed.items : undefined);
      setAiNotes(parsed.notes || undefined);
      setAiPickupTime(parsed.pickupTime || undefined);
    }
    
    // Expand and start editing (don't call onConfirmOrder yet - that will happen on save)
    setAutoStartEditing(true);
  };

  const handleSaveOrder = (updatedDetails: OrderDetails) => {
    // Save the order details (don't navigate away)
    onUpdateOrder?.(conversation.id, updatedDetails);
    
    // Reset auto-start editing state after save
    setAutoStartEditing(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const urgent = isUrgent();
  const late = isRunningLate();
  const orderCountText = getOrderCountText();

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
              {displayName}
            </h2>
            {orderCountText && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-repeat-customer">
                {orderCountText}
              </Badge>
            )}
            {late && (
              <Badge className="text-xs bg-orange-500 hover:bg-orange-600 text-white" data-testid="badge-running-late">
                LATE
              </Badge>
            )}
            {urgent && !late && (
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {conversation.messages.map((message) => (
          <MessageBubble
            key={message.id}
            text={message.text}
            isOutgoing={message.isOutgoing}
            timestamp={new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })}
            isAIOrganized={message.isAIOrganized}
          />
        ))}
        {/* Show optimistic messages (sent but not yet confirmed) */}
        {optimisticMessages.map((message) => (
          <MessageBubble
            key={message.id}
            text={message.text}
            isOutgoing={message.isOutgoing}
            timestamp={new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })}
            isAIOrganized={false}
          />
        ))}
        {/* Show streaming messages (invisible blocks that become visible as text arrives) */}
        {Object.entries(streamingMessages).map(([messageId, message]) => (
          <div
            key={messageId}
            className={`transition-opacity duration-300 ${
              message.isVisible 
                ? 'opacity-100' 
                : 'opacity-0'
            }`}
          >
            <MessageBubble
              text={message.text || ' '}
              isOutgoing={true}
              timestamp={new Date(message.timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })}
              isAIOrganized={false}
            />
          </div>
        ))}
        {/* Show typing indicator when AI is responding */}
        {isTyping && (
          <div className="flex items-start gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300 -mt-3">
            <div className="max-w-[75%] px-4 py-2 rounded-2xl bg-muted text-foreground rounded-bl-md">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {aiSuggestedResponse && (
        <AISuggestedResponse
          suggestion={aiSuggestedResponse}
          onUseSuggestion={handleUseSuggestion}
        />
      )}

      {conversation.orderDetails && (
        <div className="px-4 pb-3">
          <EditableOrderSummary
            orderDetails={conversation.orderDetails}
            orderStatus={conversation.orderStatus}
            detectedPickupTime={detectedPickupTime}
            onSave={handleSaveOrder}
            autoStartEditing={autoStartEditing}
            itemsFromAI={aiItems}
            notesFromAI={aiNotes}
            pickupTimeFromAI={aiPickupTime}
          />
          
          {conversation.orderStatus === 'new' && onConfirmOrder && onDeleteOrder && (
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

          {conversation.orderStatus === 'new' && onConfirmOrder && !onDeleteOrder && (
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
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1 bg-transparent outline-none text-base text-foreground"
              data-testid="input-message"
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageInput.trim()}
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
