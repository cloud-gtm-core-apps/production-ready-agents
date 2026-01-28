import { TrendingUp, Clock, Star } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import IOSStatusBar from './IOSStatusBar';

interface AnalyticsViewProps {
  totalOrders: number;
  peakHours: string;
  topItem: string;
}

export default function AnalyticsView({ 
  totalOrders, 
  peakHours, 
  topItem 
}: AnalyticsViewProps) {
  return (
    <div className="flex flex-col h-full bg-background">
      <IOSStatusBar />
      
      <div className="bg-primary text-primary-foreground px-4 py-6">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-primary-foreground/80 mt-1">Today's insights</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs">Total Orders</span>
              </div>
              <p className="text-3xl font-bold" data-testid="text-total-orders">{totalOrders}</p>
            </div>

            <div className="bg-card rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-xs">Peak Hours</span>
              </div>
              <p className="text-lg font-bold" data-testid="text-peak-hours">{peakHours}</p>
            </div>
          </div>

          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 text-muted-foreground mb-3">
              <Star className="w-4 h-4" />
              <span className="text-sm font-medium">Top Item</span>
            </div>
            <p className="text-xl font-semibold" data-testid="text-top-item">{topItem}</p>
            <p className="text-sm text-muted-foreground mt-1">Most ordered today</p>
          </div>

          <div className="bg-gradient-to-br from-primary to-primary/80 rounded-xl p-4 text-primary-foreground">
            <h3 className="font-semibold mb-2">Power Hour Special</h3>
            <p className="text-sm opacity-90">Active from 12-2 PM and 12-2 AM</p>
            <div className="mt-3 pt-3 border-t border-primary-foreground/20">
              <p className="text-xs opacity-75">Next Power Hour starts in 2 hours</p>
            </div>
          </div>
        </div>
      </ScrollArea>

      <div className="h-20 bg-background" />
    </div>
  );
}
