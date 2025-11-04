import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { queryClient } from '@/lib/queryClient';
import IPhoneFrame from '@/components/IPhoneFrame';
import ConversationView from '@/components/ConversationView';
import MessageList from '@/components/MessageList';
import MessageListSkeleton from '@/components/MessageListSkeleton';
import TabBar from '@/components/TabBar';
import SideDrawer from '@/components/SideDrawer';
import type { Conversation } from '@shared/schema';

type Tab = 'new' | 'confirmed' | 'ready' | 'completed';

const INITIAL_GREETING = "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [viewingConversationId, setViewingConversationId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [detectedPickupTimes, setDetectedPickupTimes] = useState<Record<string, string>>({});
  const activeConversationRef = useRef<{ orderId: string; phoneNumber: string } | null>(null);

  // Check if user is authenticated, redirect to login if not
  const { user, isAuthenticated, isLoading: isAuthLoading } = useUser({ redirectTo: '/login' });

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  // Fetch conversations from API based on active tab (no cache)
  const { data: conversations = [], isLoading, error: conversationsError, refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ['/api/orders', activeTab],
    enabled: isAuthenticated, // Only fetch when authenticated
    staleTime: 0, // Always consider data stale
    gcTime: 0, // Don't cache data
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // Log errors for debugging
  useEffect(() => {
    if (conversationsError) {
      console.error('Error fetching conversations:', conversationsError);
    }
    if (conversations) {
      console.log(`[Frontend] Loaded ${conversations.length} conversations for tab: ${activeTab}`);
    }
  }, [conversationsError, conversations, activeTab]);

  // Fetch counts for all tabs (no cache)
  const { data: counts, refetch: refetchCounts } = useQuery<{ new: number; confirmed: number; ready: number; completed: number }>({
    queryKey: ['/api/orders/counts'],
    enabled: isAuthenticated,
    staleTime: 0, // Always consider data stale
    gcTime: 0, // Don't cache data
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  // No need to filter - API already returns conversations for the active tab
  const filteredConversations = conversations;

  // Use counts from API
  const conversationCounts = counts || {
    new: 0,
    confirmed: 0,
    ready: 0,
    completed: 0,
  };

  const handleConfirmOrder = (conversationId: string) => {
    // TODO: Call API to update order status
    console.log('Confirm order:', conversationId);
    setViewingConversationId(null);
  };

  const handleMarkReady = (conversationId: string) => {
    // TODO: Call API to update order status
    console.log('Mark ready:', conversationId);
    setViewingConversationId(null);
  };

  const handleMarkPickedUp = (conversationId: string) => {
    // TODO: Call API to update order status
    console.log('Mark picked up:', conversationId);
    setViewingConversationId(null);
  };

  const handleUpdateOrder = (conversationId: string, orderDetails: any) => {
    // TODO: Call API to update order details
    console.log('Update order:', conversationId, orderDetails);
  };

  const handleDeleteOrder = async (conversationId: string) => {
    if (!confirm('Are you sure you want to delete this order? This cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/orders/${conversationId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Navigate back to conversation list
        setViewingConversationId(null);

        // Immediately remove from cache and refetch to get fresh data
        queryClient.removeQueries({ queryKey: ['/api/orders'] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Force immediate refetch
        await Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      } else {
        console.error('Failed to delete order');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  };

  const handleSendMessage = async (conversationId: string, messageText: string) => {
    try {
      const response = await fetch(`/api/orders/${conversationId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText }),
      });
      
      if (response.ok) {
        // Immediately remove from cache and refetch to get fresh data
        queryClient.removeQueries({ queryKey: ['/api/orders', activeTab] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Force immediate refetch to get updated messages
        await Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      } else {
        const error = await response.json();
        console.error('Failed to send message:', error.message || 'Unknown error');
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleSummarizeOrder = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/orders/${conversationId}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // If pickup time was detected/updated, update the state
        if (data.pickupTime) {
          setDetectedPickupTimes(prev => {
            const updated = {
              ...prev,
              [conversationId]: data.pickupTime,
            };
            console.log(`[Frontend] Updated detectedPickupTimes from summarize API:`, updated);
            return updated;
          });
        }
        
        // Immediately remove from cache and refetch to get fresh data
        queryClient.removeQueries({ queryKey: ['/api/orders', activeTab] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Force immediate refetch to get updated messages
        await Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      } else {
        const error = await response.json();
        console.error('Failed to summarize order:', error.message || 'Unknown error');
      }
    } catch (error) {
      console.error('Error summarizing order:', error);
    }
  };

  const handleStartTestConversation = async () => {
    if (!user) return;

    // Close existing WebSocket if any
    if (ws) {
      ws.close();
    }

    // Create WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/test-simulator`;
    const newWs = new WebSocket(wsUrl);

    newWs.onopen = () => {
      console.log('WebSocket connected for test conversation');
      // Start a new conversation
      newWs.send(JSON.stringify({
        type: 'start',
      }));
    };

    newWs.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'conversation_started') {
        // Store conversation details
        activeConversationRef.current = {
          orderId: data.orderId,
          phoneNumber: data.phoneNumber,
        };
        
        // Show typing animation
        setIsTyping(true);
        
        // Wait a moment, then send initial greeting to trigger AI response
        setTimeout(() => {
          newWs.send(JSON.stringify({
            type: 'send_message',
            orderId: data.orderId,
            phoneNumber: data.phoneNumber,
            text: INITIAL_GREETING,
          }));
        }, 500);
        
      } else if (data.type === 'message_received') {
        // Hide typing animation
        setIsTyping(false);
        
        // Immediately remove from cache and refetch to get fresh data
        queryClient.removeQueries({ queryKey: ['/api/orders', 'new'] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Force immediate refetch
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['/api/orders', 'new'] }),
          queryClient.refetchQueries({ queryKey: ['/api/orders/counts'] }),
        ]);
        
        // Switch to "New" tab if not already there
        setActiveTab('new');
      } else if (data.type === 'pickup_time_detected') {
        // Store detected pickup time (don't save to DB, just show in form)
        console.log(`[Frontend] Pickup time detected for order ${data.orderId}: ${data.pickupTime}`);
        setDetectedPickupTimes(prev => {
          const updated = {
            ...prev,
            [data.orderId]: data.pickupTime,
          };
          console.log(`[Frontend] Updated detectedPickupTimes:`, updated);
          return updated;
        });
        // Trigger refetch to update the UI if conversation is open
        queryClient.refetchQueries({ queryKey: ['/api/orders'] });
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.message);
        setIsTyping(false);
      }
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsTyping(false);
    };

    newWs.onclose = () => {
      console.log('WebSocket disconnected');
      setIsTyping(false);
    };

    setWs(newWs);
  };

  const handleSelectConversation = (conversationId: string) => {
    setViewingConversationId(conversationId);
  };

  const handleBackFromConversation = () => {
    setViewingConversationId(null);
  };

  const viewingConversation = conversations.find(c => c.id === viewingConversationId);

  // Show skeleton while checking auth
  if (isAuthLoading) {
    return (
      <IPhoneFrame>
        <div className="relative h-full flex flex-col overflow-hidden">
          <div className="relative z-10 flex flex-col h-full">
            <MessageListSkeleton />
            <TabBar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              counts={conversationCounts}
            />
          </div>
        </div>
      </IPhoneFrame>
    );
  }

  // Redirect to login (this will happen via useUser hook)
  if (!isAuthenticated) {
    return (
      <IPhoneFrame>
        <div className="relative h-full flex flex-col overflow-hidden items-center justify-center">
          <div className="text-primary">Redirecting to login...</div>
        </div>
      </IPhoneFrame>
    );
  }

  return (
    <IPhoneFrame>
      <div className="relative h-full flex flex-col overflow-hidden">
        <SideDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
        <div className="relative z-10 flex flex-col h-full">
          {viewingConversation ? (
            <ConversationView
              conversation={viewingConversation}
              detectedPickupTime={detectedPickupTimes[viewingConversation.id]}
              onBack={handleBackFromConversation}
              onConfirmOrder={handleConfirmOrder}
              onMarkReady={handleMarkReady}
              onUpdateOrder={handleUpdateOrder}
              onSendMessage={handleSendMessage}
              onDeleteOrder={handleDeleteOrder}
              onSummarizeOrder={handleSummarizeOrder}
            />
          ) : (
            <>
              {isLoading ? (
                <MessageListSkeleton />
              ) : (
                <MessageList 
                  conversations={filteredConversations}
                  onSelectConversation={handleSelectConversation}
                  onOpenMenu={() => setIsDrawerOpen(true)}
                  onMarkReady={handleMarkReady}
                  onMarkPickedUp={handleMarkPickedUp}
                  onStartTestConversation={handleStartTestConversation}
                  isTyping={isTyping}
                />
              )}
              <TabBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                counts={conversationCounts}
              />
            </>
          )}
        </div>
      </div>
    </IPhoneFrame>
  );
}
