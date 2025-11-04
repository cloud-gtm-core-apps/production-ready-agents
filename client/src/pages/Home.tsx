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

  // Establish WebSocket connection on mount for real-time updates
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Create persistent WebSocket connection for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/test-simulator`;
    const newWs = new WebSocket(wsUrl);

    newWs.onopen = () => {
      console.log('[Home] WebSocket connected for real-time updates');
    };

    newWs.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      
      // Don't refetch on message_sent - optimistic message already shows it
      // Don't refetch on message_stream_complete - streaming message already shows it perfectly
      // The streaming message will naturally be replaced by DB message on next navigation or refresh
      if (data.type === 'message_received') {
        // Hide typing animation
        setIsTyping(false);
        
        // If this is an AI organized message, refetch to show it
        if (data.isAIOrganized) {
          console.log(`[Frontend] AI organized message received for order ${data.orderId}, refetching conversations...`);
          // Refetch all order-related queries (matching query keys that start with '/api/orders')
          setTimeout(async () => {
            await queryClient.refetchQueries({ 
              queryKey: ['/api/orders'],
              exact: false 
            });
            console.log(`[Frontend] Refetched conversations after AI organized message`);
          }, 300); // Slightly longer delay to ensure DB is updated
        } else {
          // Regular message - only refetch counts to update badge numbers
          queryClient.refetchQueries({ queryKey: ['/api/orders/counts'] });
        }
        
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
        // Don't refetch - just update the state, the conversation view will use detectedPickupTime prop
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.message);
        setIsTyping(false);
      }
    };

    newWs.onerror = (error) => {
      console.error('[Home] WebSocket error:', error);
      setIsTyping(false);
    };

    newWs.onclose = () => {
      console.log('[Home] WebSocket disconnected, attempting to reconnect...');
      setIsTyping(false);
      // Reconnect after a delay
      setTimeout(() => {
        if (isAuthenticated && user) {
          // Reconnect by re-running the effect
        }
      }, 3000);
    };

    setWs(newWs);

    // Cleanup WebSocket on unmount
    return () => {
      if (newWs) {
        newWs.close();
      }
    };
  }, [isAuthenticated, user]);

  // Fetch conversations from API based on active tab (with short cache to prevent flickering)
  const { data: conversations = [], isLoading, error: conversationsError, refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ['/api/orders', activeTab],
    enabled: isAuthenticated, // Only fetch when authenticated
    staleTime: 1000, // Consider data fresh for 1 second
    gcTime: 30000, // Keep in cache for 30 seconds
    refetchOnMount: false, // Don't refetch on mount if data is fresh
    refetchOnWindowFocus: false, // Don't refetch on window focus to prevent flickering
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

  // Clear viewing conversation when tab changes
  useEffect(() => {
    setViewingConversationId(null);
  }, [activeTab]);

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

  const handleUpdateOrder = async (conversationId: string, orderDetails: any) => {
    try {
      // Call API to send order to preparation
      const response = await fetch(`/api/orders/${conversationId}/send-to-preparation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderDetails }),
      });

      if (response.ok) {
        // Immediately remove from cache and refetch to get fresh data
        queryClient.removeQueries({ queryKey: ['/api/orders', activeTab] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Force immediate refetch
        await Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      } else {
        const error = await response.json();
        console.error('Failed to send order to preparation:', error.message || 'Unknown error');
        alert(error.message || 'Failed to send order to preparation. Please try again.');
      }
    } catch (error) {
      console.error('Error sending order to preparation:', error);
      alert('Failed to send order to preparation. Please try again.');
    }
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
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, cannot send message');
      alert('Connection lost. Please refresh the page.');
      return;
    }

    try {
      // Send message via WebSocket for real-time streaming
      ws.send(JSON.stringify({
        type: 'send_message',
        orderId: conversationId,
        text: messageText,
      }));
      
      // Message will appear instantly via WebSocket message_sent event
      // AI response will stream in via message_stream_chunk events
    } catch (error) {
      console.error('Error sending message via WebSocket:', error);
      alert('Failed to send message. Please try again.');
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
        
        // Only refetch counts to update badge numbers, not the full conversation list
        // The message is already displayed via streaming, so we don't need to refresh everything
        queryClient.refetchQueries({ queryKey: ['/api/orders/counts'] });
        
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
              ws={ws}
              onBack={handleBackFromConversation}
              onConfirmOrder={handleConfirmOrder}
              onMarkReady={handleMarkReady}
              onUpdateOrder={handleUpdateOrder}
              onSendMessage={handleSendMessage}
              onDeleteOrder={handleDeleteOrder}
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
