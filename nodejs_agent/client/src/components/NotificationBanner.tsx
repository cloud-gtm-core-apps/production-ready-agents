import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NotificationBannerProps {
  title: string;
  message: string;
  icon?: string;
  onDismiss?: () => void;
}

export default function NotificationBanner({ 
  title, 
  message, 
  icon = "🌽",
  onDismiss 
}: NotificationBannerProps) {
  return (
    <div className="absolute top-12 left-4 right-4 z-50 animate-in slide-in-from-top duration-300">
      <div className="bg-card/95 backdrop-blur-xl rounded-2xl shadow-ios-lg p-4 border border-border">
        <div className="flex items-start gap-3">
          <div className="text-2xl">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold text-sm">{title}</h4>
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                  {message}
                </p>
              </div>
              {onDismiss && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onDismiss}
                  className="h-6 w-6 rounded-full shrink-0"
                  data-testid="button-dismiss-notification"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
