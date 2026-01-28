import { useState, useEffect, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ArrowUp, Sparkles } from 'lucide-react';
import MessageBubble from '@/components/MessageBubble';

interface Message {
  id: string;
  text: string;
  isOutgoing: boolean;
  timestamp: string;
  isAIOrganized?: boolean;
}

const DISPLAY_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

const formatTimestamp = (value?: string | number | Date) => {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString('en-US', DISPLAY_TIME_OPTIONS);
};

const toConversationMessage = (apiMessage: any): Message => ({
  id: apiMessage.id,
  text: apiMessage.text,
  isOutgoing: Boolean(apiMessage.isOutgoing),
  timestamp: formatTimestamp(apiMessage.timestamp),
  isAIOrganized: apiMessage.isAIOrganized ?? false,
});

export default function AITestSimulator() {
  const { user, isLoading } = useUser({ redirectTo: '/login' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [conversationActive, setConversationActive] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [orderSummary, setOrderSummary] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const refreshAIInsights = async (currentOrderId: string) => {
    try {
      const [summaryRes, suggestionRes] = await Promise.all([
        fetch(`/api/orders/${currentOrderId}/ai-order-summary`),
        fetch(`/api/orders/${currentOrderId}/ai-suggested-reply`),
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setOrderSummary(summaryData.summary ?? null);
      } else {
        setOrderSummary(null);
      }

      if (suggestionRes.ok) {
        const suggestionData = await suggestionRes.json();
        setAiSuggestion(suggestionData.suggestion ?? null);
      } else {
        setAiSuggestion(null);
      }
    } catch (error) {
      console.error('Error refreshing AI insights:', error);
      setOrderSummary(null);
      setAiSuggestion(null);
    }
  };

  const startConversation = async () => {
    if (!user || isStarting) return;

    setIsStarting(true);
    setAiSuggestion(null);
    setOrderSummary(null);
    try {
      const response = await fetch('/api/test-conversation/start', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to start test conversation (${response.status})`);
      }

      const data = await response.json();

      setOrderId(data.orderId);
      setPhoneNumber(data.phoneNumber);
      setCustomerName(data.customerName);
      setConversationActive(true);
      const normalizedMessages = (data.messages ?? []).map(toConversationMessage);
      setMessages(normalizedMessages);
      if (data.orderId) {
        void refreshAIInsights(data.orderId);
      }
    } catch (error) {
      console.error('Error starting test conversation:', error);
    } finally {
      setIsStarting(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !orderId || !user || isSending) {
      return;
    }

    const messageText = inputMessage.trim();
    const outgoingMessage: Message = {
      id: `rod-${Date.now()}`,
      text: messageText,
      isOutgoing: false,
      timestamp: formatTimestamp(),
    };

    setMessages(prev => [...prev, outgoingMessage]);
    setInputMessage('');
    setIsSending(true);

    try {
      const response = await fetch('/api/test-conversation/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId,
          message: messageText,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message (${response.status})`);
      }

      const data = await response.json();
      const normalizedMessages = (data.messages ?? []).map(toConversationMessage);
      if (normalizedMessages.length > 0) {
        setMessages(normalizedMessages);
      } else if (data.aiMessage) {
        const aiMessage = toConversationMessage(data.aiMessage);
        setMessages(prev => [...prev, aiMessage]);
      }

      if (orderId) {
        void refreshAIInsights(orderId);
      }
    } catch (error) {
      console.error('Error sending test conversation message:', error);
      setMessages(prev => prev.filter(msg => msg.id !== outgoingMessage.id));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage();
  };

  const resetConversation = () => {
    setConversationActive(false);
    setMessages([]);
    setOrderId(null);
    setPhoneNumber(null);
    setCustomerName(null);
    setAiSuggestion(null);
    setOrderSummary(null);
    setInputMessage('');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-black p-4">
      <Card className="w-full max-w-md bg-zinc-950 border-zinc-800">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-white">AI Test Simulator</h1>
          </div>

          {!conversationActive ? (
            <div className="space-y-4">
              <p className="text-zinc-400">
                Start a test conversation with an AI customer. The conversation will be saved to your orders list in real-time.
              </p>
              <Button
                onClick={startConversation}
                className="w-full"
                data-testid="button-start-conversation"
                disabled={isStarting}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {isStarting ? 'Starting...' : 'Start Test Conversation'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
                <div className="text-sm text-zinc-400">Customer</div>
                <div className="text-white font-medium">{customerName}</div>
                <div className="text-sm text-zinc-400">{phoneNumber}</div>
              </div>

              <div className="h-96 overflow-y-auto bg-zinc-900 rounded-lg p-4 space-y-3">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    text={message.text}
                    isOutgoing={message.isOutgoing}
                    timestamp={message.timestamp}
                    isAIOrganized={message.isAIOrganized}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="space-y-3">
                <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-zinc-400">AI Order Summary</span>
                  </div>
                  <div className="text-sm text-white whitespace-pre-line min-h-[3rem]">
                    {orderSummary ?? 'No order summary yet.'}
                  </div>
                </div>

                <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-zinc-400">AI Suggested Reply</span>
                  </div>
                  <div className="text-sm text-white min-h-[2.5rem]">
                    {aiSuggestion ?? 'No suggestion yet.'}
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="flex gap-2 items-center">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 bg-zinc-900 border-zinc-800 text-white"
                  data-testid="input-message"
                  disabled={isSending}
                />
                <Button
                  type="submit"
                  disabled={!inputMessage.trim() || isSending}
                  size="icon"
                  className="rounded-full"
                  data-testid="button-send-message"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
              </form>

              <Button
                onClick={resetConversation}
                variant="outline"
                className="w-full"
                data-testid="button-end-conversation"
              >
                End & Start New Conversation
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
