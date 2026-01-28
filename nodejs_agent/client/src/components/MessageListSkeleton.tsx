import { Menu, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IOSStatusBar from './IOSStatusBar';

export default function MessageListSkeleton() {
  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[hsl(var(--background-gradient-start))] to-[hsl(var(--background-gradient-end))]">
      <IOSStatusBar />
      
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-black">
        <Button
          size="icon"
          variant="ghost"
          disabled
          className="rounded-md flex-shrink-0"
        >
          <Menu className="w-6 h-6 text-primary" />
        </Button>
        <div className="h-8 bg-primary px-3 py-1 rounded flex items-center flex-1 min-w-0">
          <span className="text-primary-foreground font-bold text-lg whitespace-nowrap">
            CORN ON THE CORNER
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled
          className="flex-shrink-0 border-primary text-primary"
        >
          <Sparkles className="w-4 h-4 mr-1" />
          Test
        </Button>
      </div>
      
      <div className="px-4 py-2">
        <h1 className="text-3xl font-bold text-foreground">
          Orders
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-4 border-b border-border/30 bg-black animate-pulse"
          >
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10" />
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="h-5 bg-muted-foreground/20 rounded w-32" />
                  <div className="h-4 bg-muted-foreground/20 rounded w-16" />
                </div>
                <div className="h-4 bg-muted-foreground/20 rounded w-12" />
              </div>
              
              <div className="h-4 bg-muted-foreground/20 rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
