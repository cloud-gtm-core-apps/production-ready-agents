import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Conversation } from '@shared/schema';
import { MessageCircle, Menu, Check } from 'lucide-react';
import IOSStatusBar from './IOSStatusBar';

interface MessageListProps {
  conversations: Conversation[];
  onSelectConversation: (conversationId: string) => void;
  onOpenMenu?: () => void;
  onMarkReady?: (conversationId: string, orderWasUpdated?: boolean) => void;
  onMarkPickedUp?: (conversationId: string) => void;
}

export default function MessageList({ conversations, onSelectConversation, onOpenMenu, onMarkReady, onMarkPickedUp }: MessageListProps) {
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

  const formatPickupTime = (timeStr: string | null | undefined): string | null => {
    if (!timeStr) return null;
    
    // If it's already formatted (contains AM/PM), normalize it
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3].toUpperCase();
      
      // Handle formats like "5pm" -> "5:00 PM"
      const formatted = `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
      return formatted;
    }
    
    // If it's an ISO string, convert it
    try {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return null;
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      return `${hours12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    } catch {
      // If it's not an ISO string and doesn't match the pattern, return as is
      return timeStr;
    }
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
      
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border flex items-center gap-2 sm:gap-3 bg-black">
        <Button
          size="icon"
          variant="ghost"
          onClick={onOpenMenu}
          data-testid="button-menu"
          className="rounded-md flex-shrink-0 min-h-[44px] min-w-[44px]"
        >
          <Menu className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </Button>
        <div className="h-7 sm:h-8 bg-primary px-2 sm:px-3 py-1 rounded flex items-center">
          <span className="text-primary-foreground font-bold text-sm sm:text-lg whitespace-nowrap" data-testid="text-logo">
            CORN ON THE CORNER
          </span>
        </div>
      </div>
      
      <div className="px-3 sm:px-4 py-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground" data-testid="text-header-title">
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
                className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 sm:py-4 border-b border-border/30 bg-black hover-elevate active-elevate-2 cursor-pointer min-h-[60px]"
                data-testid={`message-row-${conversation.id}`}
              >
                <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1 sm:mb-1.5">
                    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                      <h3 
                        className="font-medium text-sm sm:text-base text-foreground truncate"
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
                    className="text-xs sm:text-sm text-muted-foreground truncate mb-1.5 sm:mb-2"
                    data-testid={`text-last-message-${conversation.id}`}
                  >
                    {lastMessage}
                  </p>
                  
                  {conversation.orderDetails && (
                    <div className="flex items-center justify-between gap-2 sm:gap-3 mt-1.5 sm:mt-2 flex-wrap">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <span className="text-xs sm:text-sm font-medium text-foreground flex-shrink-0">
                          ${conversation.orderDetails.total}
                        </span>
                        {(conversation.orderStatus === 'confirmed' || conversation.orderStatus === 'ready') && (
                          <>
                            <span className="text-xs text-muted-foreground flex-shrink-0">•</span>
                            <span className="text-[10px] sm:text-[11px] font-medium text-primary whitespace-nowrap">
                              Pickup: {formatPickupTime(conversation.orderDetails.pickupTime) || 'Not set'}
                            </span>
                          </>
                        )}
                      </div>
                      {conversation.orderStatus === 'confirmed' && onMarkReady && (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkReady(conversation.id, false); // Order not updated from list view
                          }}
                          className="flex-shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md text-xs sm:text-sm min-h-[36px]"
                          data-testid={`button-mark-ready-${conversation.id}`}
                        >
                          <Check className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
                          <span className="hidden sm:inline">Mark Ready</span>
                          <span className="sm:hidden">Ready</span>
                        </Button>
                      )}
                      {conversation.orderStatus === 'ready' && onMarkPickedUp && (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkPickedUp(conversation.id);
                          }}
                          className="flex-shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md text-[10px] sm:text-[11px] h-7 sm:h-8 px-1.5 sm:px-2 min-h-[36px]"
                          data-testid={`button-mark-picked-up-${conversation.id}`}
                        >
                          <Check className="w-3 h-3 mr-0.5" />
                          <span className="hidden sm:inline">Mark Picked Up</span>
                          <span className="sm:hidden">Picked Up</span>
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
