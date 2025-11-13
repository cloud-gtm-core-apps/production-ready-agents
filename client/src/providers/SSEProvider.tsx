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

  useEffect(() => {
    const source = new EventSource(streamPath);
    eventSourceRef.current = source;

    source.onopen = () => {
      setIsConnected(true);
    };

    source.onerror = () => {
      setIsConnected(false);
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

    return () => {
      source.close();
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

