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
  isStreaming?: boolean;
  isAIOrganized?: boolean;
}

export default function AITestSimulator() {
  const { user, isLoading } = useUser({ redirectTo: '/login' });
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [conversationActive, setConversationActive] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    // Check if any message is currently streaming
    const hasStreaming = messages.some(msg => msg.isStreaming);
    scrollToBottom(hasStreaming);
  }, [messages]);

  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/test-simulator`;
    const newWs = new WebSocket(wsUrl);

    newWs.onopen = () => {
      console.log('WebSocket connected');
      setWs(newWs);
    };

    newWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'conversation_started') {
        setOrderId(data.orderId);
        setPhoneNumber(data.phoneNumber);
        setCustomerName(data.customerName);
        setConversationActive(true);
        setMessages([{
          id: '1',
          text: 'Welcome to Corn on the Corner! 🌽',
          isOutgoing: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        }]);
      } else if (data.type === 'message_stream_start') {
        // Create placeholder message for streaming
        setMessages(prev => [...prev, {
          id: data.messageId,
          text: '',
          isOutgoing: true,
          timestamp: new Date(data.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          isStreaming: true,
        }]);
      } else if (data.type === 'message_stream_chunk') {
        // Append chunk to streaming message
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId
            ? { ...msg, text: msg.text + data.text }
            : msg
        ));
      } else if (data.type === 'message_stream_complete') {
        // Mark streaming as complete
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId
            ? { ...msg, isStreaming: false, timestamp: new Date(data.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) }
            : msg
        ));
      } else if (data.type === 'message_received') {
        // Handle regular messages and AI organized messages
        // isOutgoing: true = customer messages (left), false = restaurant messages (right)
        // AI organized messages are from restaurant, so isOutgoing should be false
        const newMessage: Message = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: data.text,
          isOutgoing: data.isAIOrganized ? false : true, // AI organized = restaurant message (right side)
          timestamp: new Date(data.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          isAIOrganized: data.isAIOrganized || false,
        };
        console.log('[Client] Received message:', newMessage);
        setMessages(prev => [...prev, newMessage]);
      } else if (data.type === 'pickup_time_detected') {
        // Pickup time detected - just log it (not used in AI test simulator)
        console.log(`[AITestSimulator] Pickup time detected for order ${data.orderId}: ${data.pickupTime}`);
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.message);
      }
    };

    newWs.onclose = () => {
      console.log('WebSocket disconnected');
      setWs(null);
    };

    newWs.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return newWs;
  };

  const startConversation = () => {
    if (!user) return;
    
    const newWs = connectWebSocket();
    
    newWs.addEventListener('open', () => {
      newWs.send(JSON.stringify({
        type: 'start',
      }));
    });
  };

  const sendMessage = () => {
    if (!inputMessage.trim() || !ws || !orderId || !phoneNumber || !user) return;

    const messageText = inputMessage.trim();
    
    // Add Rod's message to UI
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      text: messageText,
      isOutgoing: false,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    }]);

    // Send to WebSocket
    ws.send(JSON.stringify({
      type: 'send_message',
      orderId,
      phoneNumber,
      text: messageText,
    }));

    setInputMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
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
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Start Test Conversation
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
                    text={message.text + (message.isStreaming ? '|' : '')}
                    isOutgoing={message.isOutgoing}
                    timestamp={message.timestamp}
                    isAIOrganized={message.isAIOrganized}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSubmit} className="flex gap-2 items-center">
                {orderId && ws && (
                  <Button
                    type="button"
                    onClick={() => {
                      if (!orderId || !ws || ws.readyState !== WebSocket.OPEN) return;
                      ws.send(JSON.stringify({
                        type: 'summarize',
                        orderId: orderId,
                      }));
                      console.log('[AITestSimulator] Sent summarize request for order', orderId);
                    }}
                    size="icon"
                    variant="outline"
                    className="rounded-full border-primary/20 hover:bg-primary/10"
                    data-testid="button-summarize"
                    title="Summarize Order"
                  >
                    <Sparkles className="w-4 h-4 text-primary" />
                  </Button>
                )}
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  className="flex-1 bg-zinc-900 border-zinc-800 text-white"
                  data-testid="input-message"
                />
                <Button
                  type="submit"
                  disabled={!inputMessage.trim()}
                  size="icon"
                  className="rounded-full"
                  data-testid="button-send-message"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
              </form>

              <Button
                onClick={() => {
                  setConversationActive(false);
                  setMessages([]);
                  setOrderId(null);
                  setPhoneNumber(null);
                  setCustomerName(null);
                  if (ws) {
                    ws.close();
                  }
                }}
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
