import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Tab = 'new' | 'confirmed' | 'ready' | 'completed';

interface TabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  counts?: {
    new: number;
    confirmed: number;
    ready: number;
    completed: number;
  };
}

export default function TabBar({ activeTab, onTabChange, counts }: TabBarProps) {
  const tabs = [
    { id: 'new' as Tab, label: 'New', count: counts?.new || 0 },
    { id: 'confirmed' as Tab, label: 'Confirmed', count: counts?.confirmed || 0 },
    { id: 'ready' as Tab, label: 'Ready', count: counts?.ready || 0 },
    { id: 'completed' as Tab, label: 'Completed', count: counts?.completed || 0 },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black border-t border-border">
      <div className="flex items-center justify-around px-1 pt-3 pb-8">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex flex-col items-center justify-center gap-1.5 py-2 px-1 flex-1 relative min-h-[48px]"
              data-testid={`button-tab-${tab.id}`}
            >
              <div className="flex items-center gap-1">
                <span className={cn(
                  "text-sm font-medium transition-colors whitespace-nowrap",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  {tab.label}
                </span>
                {tab.count > 0 && (
                  <Badge
                    variant={isActive ? "default" : "secondary"}
                    className={cn(
                      "h-4 min-w-4 px-1 text-[10px] rounded-full leading-none",
                      isActive && "bg-primary text-primary-foreground"
                    )}
                    data-testid={`badge-count-${tab.id}`}
                  >
                    {tab.count}
                  </Badge>
                )}
              </div>
              {isActive && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
