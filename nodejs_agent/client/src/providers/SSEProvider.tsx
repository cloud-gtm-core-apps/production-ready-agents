import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type SSEMessage = {
  event: string;
  data: unknown;
};

type SSEContextValue = {
  lastEvent: SSEMessage | null;
  isConnected: boolean;
};

const SSEContext = createContext<SSEContextValue | undefined>(undefined);

type SSEProviderProps = {
  streamPath?: string;
  children: ReactNode;
};

export function SSEProvider({ streamPath = "/api/events", children }: SSEProviderProps) {
  const [lastEvent, setLastEvent] = useState<SSEMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    const connect = () => {
      // Close existing connection if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const source = new EventSource(streamPath);
      eventSourceRef.current = source;

      source.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        console.log('[SSE] Connected successfully');
      };

      source.onerror = () => {
        setIsConnected(false);
        source.close();

        // Exponential backoff reconnection: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;

        console.log(`[SSE] Connection error, reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      source.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed && typeof parsed === "object" && "event" in parsed) {
            setLastEvent({
              event: typeof parsed.event === "string" ? parsed.event : "message",
              data: "data" in parsed ? parsed.data : parsed,
            });
            return;
          }
          setLastEvent({
            event: "message",
            data: parsed,
          });
        } catch {
          setLastEvent({
            event: "message",
            data: event.data,
          });
        }
      };
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      setIsConnected(false);
    };
  }, [streamPath]);

  const value = useMemo(
    () => ({
      lastEvent,
      isConnected,
    }),
    [lastEvent, isConnected]
  );

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}

export function useSSE(): SSEContextValue | undefined {
  return useContext(SSEContext);
}

