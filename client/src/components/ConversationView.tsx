import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Phone, Info, Trash2, Sparkles } from 'lucide-react';
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
  onBack?: () => void;
  onConfirmOrder?: (conversationId: string) => void;
  onMarkReady?: (conversationId: string) => void;
  onUpdateOrder?: (conversationId: string, orderDetails: OrderDetails) => void;
  onSendMessage?: (conversationId: string, messageText: string) => void;
  onDeleteOrder?: (conversationId: string) => void;
  onSummarizeOrder?: (conversationId: string) => void;
}

export default function ConversationView({ 
  conversation, 
  detectedPickupTime,
  onBack,
  onConfirmOrder,
  onMarkReady,
  onUpdateOrder,
  onSendMessage,
  onDeleteOrder,
  onSummarizeOrder
}: ConversationViewProps) {
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const displayName = conversation.customerName || conversation.phoneNumber;
  
  // Scroll to bottom when conversation opens or messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation.id, conversation.messages.length]);
  
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

  const handleSaveOrder = (updatedDetails: OrderDetails) => {
    onUpdateOrder?.(conversation.id, updatedDetails);
  };

  const handleUseSuggestion = (text: string) => {
    setMessageInput(text);
  };

  const handleSendMessage = () => {
    if (messageInput.trim() && onSendMessage) {
      onSendMessage(conversation.id, messageInput.trim());
      setMessageInput('');
    }
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
        <div ref={messagesEndRef} />
      </div>

      {conversation.aiSuggestedResponse && (
        <AISuggestedResponse
          suggestion={conversation.aiSuggestedResponse}
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
          />
          
          {conversation.orderStatus === 'new' && onConfirmOrder && (
            <Button
              className="w-full mt-3"
              onClick={() => onConfirmOrder(conversation.id)}
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

          {onDeleteOrder && (
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
          {onSummarizeOrder && (
            <button
              onClick={() => onSummarizeOrder(conversation.id)}
              className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center flex-shrink-0 transition-colors"
              data-testid="button-summarize"
              title="Summarize Order"
            >
              <Sparkles className="w-5 h-5 text-primary" />
            </button>
          )}
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
