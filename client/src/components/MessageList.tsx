import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Conversation } from '@shared/schema';
import { MessageCircle, Menu, Check, Sparkles } from 'lucide-react';
import IOSStatusBar from './IOSStatusBar';

interface MessageListProps {
  conversations: Conversation[];
  onSelectConversation: (conversationId: string) => void;
  onOpenMenu?: () => void;
  onMarkReady?: (conversationId: string) => void;
  onMarkPickedUp?: (conversationId: string) => void;
  onStartTestConversation?: () => void;
  isTyping?: boolean;
}

export default function MessageList({ conversations, onSelectConversation, onOpenMenu, onMarkReady, onMarkPickedUp, onStartTestConversation, isTyping }: MessageListProps) {
  const getLastMessage = (conversation: Conversation) => {
    if (conversation.messages.length === 0) return '';
    return conversation.messages[conversation.messages.length - 1].text;
  };

  const getLastMessageTime = (conversation: Conversation) => {
    if (conversation.messages.length === 0) return '';
    // Use the first message time instead of last
    const timestamp = conversation.messages[0].timestamp;
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const isUrgent = (conversation: Conversation) => {
    if (conversation.orderStatus === 'new') return false;
    if (!conversation.orderDetails?.pickupTimestamp) return false;
    const now = Date.now();
    const timeUntilPickup = conversation.orderDetails.pickupTimestamp - now;
    const minutesUntilPickup = timeUntilPickup / (1000 * 60);
    return minutesUntilPickup > 0 && minutesUntilPickup < 10;
  };

  const isRunningLate = (conversation: Conversation) => {
    if (!conversation.orderDetails?.pickupTimestamp) return false;
    if (conversation.orderStatus !== 'confirmed') return false;
    const now = Date.now();
    return now > conversation.orderDetails.pickupTimestamp;
  };

  const getDisplayName = (conversation: Conversation) => {
    return conversation.customerName || conversation.phoneNumber;
  };

  const getOrderCountText = (orderCount: number) => {
    if (orderCount === 1) return null;
    if (orderCount === 2) return '2nd order';
    if (orderCount === 3) return '3rd order';
    if (orderCount >= 8) return `VIP (${orderCount}x)`;
    return `${orderCount}th order`;
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[hsl(var(--background-gradient-start))] to-[hsl(var(--background-gradient-end))]">
      <IOSStatusBar />
      
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-black">
        <Button
          size="icon"
          variant="ghost"
          onClick={onOpenMenu}
          data-testid="button-menu"
          className="rounded-md flex-shrink-0"
        >
          <Menu className="w-6 h-6 text-primary" />
        </Button>
        <div className="h-8 bg-primary px-3 py-1 rounded flex items-center flex-1 min-w-0">
          <span className="text-primary-foreground font-bold text-lg whitespace-nowrap" data-testid="text-logo">
            CORN ON THE CORNER
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onStartTestConversation}
          disabled={isTyping}
          data-testid="button-start-test"
          className="flex-shrink-0 border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
        >
          {isTyping ? (
            <>
              <span className="inline-block animate-pulse">●</span>
              <span className="inline-block animate-pulse ml-1" style={{ animationDelay: '0.2s' }}>●</span>
              <span className="inline-block animate-pulse ml-1" style={{ animationDelay: '0.4s' }}>●</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-1" />
              Test
            </>
          )}
        </Button>
      </div>
      
      <div className="px-4 py-2">
        <h1 className="text-3xl font-bold text-foreground" data-testid="text-header-title">
          Orders
        </h1>
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
          <MessageCircle className="w-16 h-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No messages</h3>
          <p className="text-sm text-muted-foreground">
            New orders will appear here
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => {
            const lastMessage = getLastMessage(conversation);
            const lastTime = getLastMessageTime(conversation);
            const urgent = isUrgent(conversation);
            const runningLate = isRunningLate(conversation);
            const displayName = getDisplayName(conversation);
            const orderCountText = getOrderCountText(conversation.orderCount);

            return (
              <div
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                className="flex items-center gap-4 px-4 py-4 border-b border-border/30 bg-black hover-elevate active-elevate-2 cursor-pointer"
                data-testid={`message-row-${conversation.id}`}
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-primary" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <h3 
                        className="font-medium text-foreground truncate"
                        data-testid={`text-customer-name-${conversation.id}`}
                      >
                        {displayName}
                      </h3>
                      {orderCountText && (
                        <Badge 
                          variant="secondary" 
                          className="text-xs px-1.5 py-0.5"
                          data-testid={`badge-repeat-${conversation.id}`}
                        >
                          {orderCountText}
                        </Badge>
                      )}
                      {runningLate && (
                        <Badge 
                          className="text-xs px-1.5 py-0.5 bg-orange-500 hover:bg-orange-600 text-white"
                          data-testid={`badge-late-${conversation.id}`}
                        >
                          LATE
                        </Badge>
                      )}
                      {urgent && !runningLate && (
                        <Badge 
                          variant="destructive" 
                          className="text-xs px-1.5 py-0.5"
                          data-testid={`badge-urgent-${conversation.id}`}
                        >
                          URGENT
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {lastTime}
                    </span>
                  </div>
                  
                  <p 
                    className="text-sm text-muted-foreground truncate mb-2"
                    data-testid={`text-last-message-${conversation.id}`}
                  >
                    {lastMessage}
                  </p>
                  
                  {conversation.orderDetails && (
                    <div className="flex items-center justify-between gap-3 mt-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-foreground">
                          ${conversation.orderDetails.total}
                        </span>
                        {(conversation.orderStatus === 'confirmed' || conversation.orderStatus === 'ready') && (
                          <>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-sm font-medium text-primary">
                              Pickup: {conversation.orderDetails.pickupTime}
                            </span>
                          </>
                        )}
                      </div>
                      {conversation.orderStatus === 'confirmed' && onMarkReady && (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkReady(conversation.id);
                          }}
                          className="flex-shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md"
                          data-testid={`button-mark-ready-${conversation.id}`}
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          Mark Ready
                        </Button>
                      )}
                      {conversation.orderStatus === 'ready' && onMarkPickedUp && (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkPickedUp(conversation.id);
                          }}
                          className="flex-shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md"
                          data-testid={`button-mark-picked-up-${conversation.id}`}
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          Mark Picked Up
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
