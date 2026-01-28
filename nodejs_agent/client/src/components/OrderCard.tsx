import { Clock, User, DollarSign, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type OrderStatus = 'new' | 'confirmed' | 'ready';

interface OrderCardProps {
  orderId: string;
  customerName: string;
  items: string[];
  pickupTime: string;
  total: string;
  status: OrderStatus;
  onConfirm?: () => void;
  onAdjust?: () => void;
}

const statusColors = {
  new: 'border-l-[#f59e0b]',
  confirmed: 'border-l-[#3b82f6]',
  ready: 'border-l-[#10b981]'
};

const statusLabels = {
  new: 'New',
  confirmed: 'Confirmed',
  ready: 'Ready'
};

function isUrgent(pickupTime: string): boolean {
  const match = pickupTime.match(/(\d+)\s*min/i);
  if (match) {
    const minutes = parseInt(match[1], 10);
    return minutes < 10;
  }
  return false;
}

export default function OrderCard({
  orderId,
  customerName,
  items,
  pickupTime,
  total,
  status,
  onConfirm,
  onAdjust
}: OrderCardProps) {
  const urgent = isUrgent(pickupTime);

  return (
    <div className={cn(
      "bg-card rounded-xl shadow-ios border-l-4 p-4 space-y-3",
      statusColors[status]
    )}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-lg" data-testid={`text-customer-${orderId}`}>
              {customerName}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Order #{orderId}</p>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <div className="px-3 py-1 rounded-full bg-muted text-xs font-medium">
            {statusLabels[status]}
          </div>
          {urgent && (
            <Badge 
              variant="destructive" 
              className="text-xs gap-1"
              data-testid={`badge-urgent-${orderId}`}
            >
              <AlertCircle className="w-3 h-3" />
              URGENT
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {items.map((item, index) => (
          <p key={index} className="text-sm text-foreground">• {item}</p>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className={cn(
          "flex items-center gap-2 text-sm",
          urgent ? "text-destructive font-semibold" : "text-muted-foreground"
        )}>
          <Clock className="w-4 h-4" />
          <span>{pickupTime}</span>
        </div>
        <div className="flex items-center gap-1 font-semibold">
          <DollarSign className="w-4 h-4" />
          <span data-testid={`text-total-${orderId}`}>{total}</span>
        </div>
      </div>

      {status === 'new' && (
        <div className="flex gap-2 pt-2">
          <Button
            onClick={onConfirm}
            className="flex-1"
            data-testid={`button-confirm-${orderId}`}
          >
            Confirm Order
          </Button>
          <Button
            onClick={onAdjust}
            variant="outline"
            className="flex-1"
            data-testid={`button-adjust-${orderId}`}
          >
            Adjust
          </Button>
        </div>
      )}
    </div>
  );
}
