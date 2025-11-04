import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AISuggestedResponseProps {
  suggestion: string;
  onUseSuggestion: (text: string) => void;
}

export default function AISuggestedResponse({ suggestion, onUseSuggestion }: AISuggestedResponseProps) {
  return (
    <div className="px-4 py-3 bg-purple-900/20 border-t border-purple-500/30 animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-1">
          <Sparkles className="h-4 w-4 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-purple-300 mb-1.5">AI Suggested Response</p>
          <Button
            onClick={() => onUseSuggestion(suggestion)}
            variant="outline"
            className="w-full justify-start text-left h-auto py-2.5 px-3 bg-purple-600/20 border-purple-400/50 hover:bg-purple-600/30 hover:border-purple-400 text-white"
            data-testid="button-ai-suggestion"
          >
            <p className="text-sm leading-relaxed">{suggestion}</p>
          </Button>
          <p className="text-xs text-purple-300/60 mt-1.5">Tap to use this response</p>
        </div>
      </div>
    </div>
  );
}
