import { ScrollArea } from '@/components/ui/scroll-area';
import OrderCard, { OrderStatus } from './OrderCard';
import IOSStatusBar from './IOSStatusBar';

interface Order {
  orderId: string;
  customerName: string;
  items: string[];
  pickupTime: string;
  total: string;
  status: OrderStatus;
}

interface OrderQueueProps {
  orders: Order[];
  onConfirmOrder?: (orderId: string) => void;
  onAdjustOrder?: (orderId: string) => void;
}

export default function OrderQueue({ orders, onConfirmOrder, onAdjustOrder }: OrderQueueProps) {
  return (
    <div className="flex flex-col h-full bg-background">
      <IOSStatusBar />
      
      <div className="bg-primary text-primary-foreground px-4 py-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-sm text-primary-foreground/80 mt-1">
          {orders.length} active {orders.length === 1 ? 'order' : 'orders'}
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-6xl mb-4">🌽</div>
              <p className="text-lg font-medium text-muted-foreground">No orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                New orders will appear here
              </p>
            </div>
          ) : (
            orders.map((order) => (
              <OrderCard
                key={order.orderId}
                {...order}
                onConfirm={() => onConfirmOrder?.(order.orderId)}
                onAdjust={() => onAdjustOrder?.(order.orderId)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="h-20 bg-background" />
    </div>
  );
}
