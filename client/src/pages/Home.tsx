import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { queryClient } from '@/lib/queryClient';
import IPhoneFrame from '@/components/IPhoneFrame';
import ConversationView from '@/components/ConversationView';
import MessageList from '@/components/MessageList';
import MessageListSkeleton from '@/components/MessageListSkeleton';
import TabBar from '@/components/TabBar';
import SideDrawer from '@/components/SideDrawer';
import type { Conversation, OrderDetails } from '@shared/schema';

type Tab = 'new' | 'confirmed' | 'ready';

const INITIAL_GREETING = "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [viewingConversationId, setViewingConversationId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // Check if user is authenticated, redirect to login if not
  const { user, isAuthenticated, isLoading: isAuthLoading } = useUser({ redirectTo: '/login' });


  // Fetch conversations from API based on active tab (with short cache to prevent flickering)
  const { data: conversations = [], isLoading, error: conversationsError, refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ['/api/orders', activeTab],
    enabled: isAuthenticated, // Only fetch when authenticated
    staleTime: 1000, // Consider data fresh for 1 second
    gcTime: 30000, // Keep in cache for 30 seconds
    refetchOnMount: false, // Don't refetch on mount if data is fresh
    refetchOnWindowFocus: false, // Don't refetch on window focus to prevent flickering
    refetchInterval: viewingConversationId ? 2000 : 5000,
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
  const { data: counts, refetch: refetchCounts } = useQuery<{ new: number; confirmed: number; ready: number }>({
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
  };

  const handleConfirmOrder = (conversationId: string) => {
    console.log('Confirm order requested for', conversationId);
  };

  const handleMarkReady = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/orders/${conversationId}/mark-ready`, {
        method: 'POST',
      });

      if (response.ok) {
        // Refresh query cache to update the UI
        queryClient.removeQueries({ queryKey: ['/api/orders'] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Refetch conversations and counts
        await Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to mark order as ready. Please try again.');
      }
    } catch (error) {
      console.error('Error marking order as ready:', error);
      alert('Failed to mark order as ready. Please try again.');
    }
  };

  const handleMarkPickedUp = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/orders/${conversationId}/mark-picked-up`, {
        method: 'POST',
      });

      if (response.ok) {
        // Refresh query cache to update the UI
        queryClient.removeQueries({ queryKey: ['/api/orders'] });
        queryClient.removeQueries({ queryKey: ['/api/orders/counts'] });
        
        // Refetch conversations and counts
        await Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to mark order as picked up. Please try again.');
      }
    } catch (error) {
      console.error('Error marking order as picked up:', error);
      alert('Failed to mark order as picked up. Please try again.');
    }
  };

  const handleUpdateOrder = async (conversationId: string, orderDetails: OrderDetails) => {
    try {
      const response = await fetch(`/api/orders/${conversationId}/send-to-preparation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderDetails }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = error?.message || 'Failed to update order. Please try again.';
        alert(message);
        throw new Error(message);
      }

      await Promise.all([
        refetchConversations(),
        refetchCounts(),
      ]);
    } catch (error) {
      console.error('Error updating order:', error);
      throw error;
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

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = error?.message || 'Failed to delete order. Please try again.';
        alert(message);
        throw new Error(message);
      }

      setViewingConversationId(null);

      await Promise.all([
        refetchConversations(),
        refetchCounts(),
      ]);
    } catch (error) {
      console.error('Error deleting order:', error);
      throw error;
    }
  };

  const handleSendMessage = async (conversationId: string, messageText: string) => {
    try {
      const response = await fetch(`/api/orders/${conversationId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = error?.message || 'Failed to send message. Please try again.';
        alert(message);
        throw new Error(message);
      }

      const data = await response.json().catch(() => ({}));

      queryClient.setQueryData<Conversation[] | undefined>(['/api/orders', activeTab], (previous) => {
        if (!previous || !Array.isArray(data?.messages)) {
          return previous;
        }

        return previous.map((conversation) => {
          if (conversation.id !== conversationId) {
            return conversation;
          }

          return {
            ...conversation,
            messages: data.messages,
            orderDetails: data.orderDetails ?? conversation.orderDetails,
          };
        });
      });

      // Refresh data to reflect new messages and counts
      await Promise.all([
        refetchConversations(),
        refetchCounts(),
      ]);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  };


  const handleStartTestConversation = async () => {
    if (!user) return;

    try {
      setIsTyping(true);

      const startResponse = await fetch('/api/test-conversation/start', {
        method: 'POST',
      });

      if (!startResponse.ok) {
        const error = await startResponse.json().catch(() => ({}));
        throw new Error(error?.message || 'Failed to start test conversation.');
      }

      const startData = await startResponse.json();
      const { orderId } = startData;

      // Refresh order list to include the new conversation
      await Promise.all([
        refetchConversations(),
        refetchCounts(),
      ]);

      // Automatically focus the new conversation
      if (orderId) {
        setViewingConversationId(orderId);
        setActiveTab('new');
      }
      // Refresh again shortly after to capture AI response
      setTimeout(() => {
        void Promise.all([
          refetchConversations(),
          refetchCounts(),
        ]);
      }, 500);
    } catch (error) {
      console.error('Error starting test conversation:', error);
      alert(error instanceof Error ? error.message : 'Failed to start test conversation.');
    } finally {
      setIsTyping(false);
    }
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
