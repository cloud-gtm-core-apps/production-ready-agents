import { Wifi, Signal, BatteryCharging } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface IOSStatusBarProps {
  time?: string;
}

export default function IOSStatusBar({ time = "9:41" }: IOSStatusBarProps) {
  const isMobile = useIsMobile();

  // Don't show status bar on actual mobile devices - they have their own
  if (isMobile) {
    return null;
  }

  return (
    <div className="flex items-center justify-between px-8 pt-3 pb-2 bg-background text-foreground text-sm font-medium">
      <div className="flex-1">
        <span className="font-semibold">{time}</span>
      </div>
      <div className="flex items-center gap-1">
        <Signal className="w-4 h-4" />
        <Wifi className="w-4 h-4" />
        <BatteryCharging className="w-5 h-5" />
      </div>
    </div>
  );
}
