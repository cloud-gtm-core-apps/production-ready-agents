import { Sparkles } from 'lucide-react';

interface AISuggestedResponseProps {
  suggestion: string;
  onUseSuggestion: (text: string) => void;
}

export default function AISuggestedResponse({ suggestion, onUseSuggestion }: AISuggestedResponseProps) {
  return (
    <div className="px-4 py-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          <Sparkles className="h-4 w-4 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-purple-300 mb-1.5">AI Suggested Response</p>
          <div
            onClick={() => onUseSuggestion(suggestion)}
            className="w-full bg-purple-600 rounded-lg px-4 py-2.5 cursor-pointer hover:bg-purple-600/90 transition-colors"
            data-testid="button-ai-suggestion"
          >
            <p className="text-sm text-white leading-relaxed">{suggestion}</p>
          </div>
          <p className="text-xs text-purple-300/60 mt-1.5">Tap to use this response</p>
        </div>
      </div>
    </div>
  );
}
