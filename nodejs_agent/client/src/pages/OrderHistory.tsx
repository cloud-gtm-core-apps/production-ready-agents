import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { useLocation } from 'wouter';
import IPhoneFrame from '@/components/IPhoneFrame';
import IOSStatusBar from '@/components/IOSStatusBar';
import { ArrowLeft, Calendar, Clock, DollarSign, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { OrderHistory, Customer } from '@shared/schema';

interface OrderHistoryWithCustomer extends OrderHistory {
  customer?: Customer;
}

export default function OrderHistory() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useUser({ redirectTo: '/login' });
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const [allOrders, setAllOrders] = useState<OrderHistoryWithCustomer[]>([]);
  const limit = 20;

  const { data, isLoading, error } = useQuery<{
    orders: OrderHistoryWithCustomer[];
    total: number;
    hasMore: boolean;
  }>({
    queryKey: ['/api/order-history', page],
    queryFn: async () => {
      const response = await fetch(`/api/order-history?page=${page}&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch order history');
      return response.json();
    },
    enabled: isAuthenticated,
  });

  // Accumulate orders when new page loads
  useEffect(() => {
    if (data?.orders) {
      if (page === 1) {
        setAllOrders(data.orders);
      } else {
        setAllOrders(prev => [...prev, ...data.orders]);
      }
    }
  }, [data?.orders, page]);

  const formatDate = (dateInput: Date | string) => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateInput: Date | string) => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Confirmed':
        return 'bg-blue-500/20 text-blue-500';
      case 'Ready':
        return 'bg-yellow-500/20 text-yellow-500';
      case 'Completed':
        return 'bg-green-500/20 text-green-500';
      default:
        return 'bg-gray-500/20 text-gray-500';
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <IPhoneFrame>
        <div className="flex flex-col h-full bg-gradient-to-b from-[hsl(var(--background-gradient-start))] to-[hsl(var(--background-gradient-end))]">
          <IOSStatusBar />
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </IPhoneFrame>
    );
  }

  if (error) {
    return (
      <IPhoneFrame>
        <div className="flex flex-col h-full bg-gradient-to-b from-[hsl(var(--background-gradient-start))] to-[hsl(var(--background-gradient-end))]">
          <IOSStatusBar />
          <div className="flex items-center justify-center h-full">
            <p className="text-red-500">Error loading order history</p>
          </div>
        </div>
      </IPhoneFrame>
    );
  }

  return (
    <IPhoneFrame>
      <div className="flex flex-col h-full bg-gradient-to-b from-[hsl(var(--background-gradient-start))] to-[hsl(var(--background-gradient-end))]">
        <IOSStatusBar />
        
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-black">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLocation('/')}
            className="rounded-full"
          >
            <ArrowLeft className="w-5 h-5 text-primary" />
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold text-lg">Order History</h1>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4">
            {allOrders.map((order) => {
              const orderSummary = order.orderSummary as any;
              const items = orderSummary?.items || [];
              const total = orderSummary?.total || '0.00';
              const pickupTime = orderSummary?.pickupTime;

              return (
                <div
                  key={order.id}
                  className="bg-black/40 backdrop-blur-sm rounded-lg border border-border p-4 space-y-3"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">
                          {order.customer?.firstName && order.customer?.lastName
                            ? `${order.customer.firstName} ${order.customer.lastName}`
                            : order.customer?.phoneNumber || 'Unknown Customer'}
                        </h3>
                        <Badge className={getStatusColor(order.status || '')}>
                          {order.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {order.customer?.phoneNumber}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(order.createdAt)}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(order.createdAt)}
                      </p>
                    </div>
                  </div>

                  {/* Items */}
                  {items.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Package className="w-4 h-4" />
                        <span>Items</span>
                      </div>
                      <div className="space-y-1 pl-6">
                        {items.map((item: string, index: number) => (
                          <p key={index} className="text-sm text-muted-foreground">
                            • {item}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Total */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-foreground">${total}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  {order.notes && (
                    <div className="pt-2 border-t border-border/50">
                      <p className="text-xs text-muted-foreground italic">
                        {order.notes}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {allOrders.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Package className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No order history found</p>
              </div>
            )}
          </div>

          {/* See More Button - loads more items and appends to list */}
          {data?.hasMore && (
            <div className="mt-6 flex justify-center pb-4">
              <Button
                onClick={() => setPage(prev => prev + 1)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[120px]"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'See More'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </IPhoneFrame>
  );
}

