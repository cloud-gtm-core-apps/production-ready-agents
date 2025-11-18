import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

interface MessageBubbleProps {
  text: string;
  isOutgoing?: boolean;
  timestamp?: string;
  isAIOrganized?: boolean;
}

export default function MessageBubble({ text, isOutgoing = false, timestamp, isAIOrganized = false }: MessageBubbleProps) {
  return (
    <div className={cn(
      "flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300",
      isOutgoing ? "items-start" : "items-end"
    )}>
      <div className={cn(
        "max-w-[85%] sm:max-w-[75%] px-3 sm:px-4 py-2 rounded-2xl",
        isAIOrganized 
          ? "bg-purple-600 text-white rounded-br-md border-2 border-purple-400" 
          : isOutgoing 
            ? "bg-muted text-foreground rounded-bl-md" 
            : "bg-primary text-primary-foreground rounded-br-md"
      )}>
        {isAIOrganized && (
          <div className="flex items-center gap-1.5 mb-2 sm:mb-3 pb-2 border-b border-purple-400/30">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">AI Organized</span>
          </div>
        )}
        <p className={cn(
          "text-sm sm:text-base",
          isAIOrganized ? "whitespace-pre-line leading-6 sm:leading-7" : "leading-relaxed"
        )}>{text}</p>
      </div>
      {timestamp && (
        <span className="text-xs text-muted-foreground px-2">{timestamp}</span>
      )}
    </div>
  );
}
