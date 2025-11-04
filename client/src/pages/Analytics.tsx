import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { useLocation } from 'wouter';
import IPhoneFrame from '@/components/IPhoneFrame';
import IOSStatusBar from '@/components/IOSStatusBar';
import { ArrowLeft, RefreshCw, TrendingUp, Calendar, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format } from 'date-fns';

interface PopularityDataPoint {
  date: string;
  items: Array<{
    menuItemName: string;
    orderCount: number;
    quantity: number;
  }>;
}

export default function Analytics() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useUser({ redirectTo: '/login' });
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'custom'>('30d');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Calculate date range based on selection
  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    
    if (timeRange === 'custom' && customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }

    const start = new Date();
    switch (timeRange) {
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      case '90d':
        start.setDate(start.getDate() - 90);
        break;
      default:
        start.setDate(start.getDate() - 30);
    }
    start.setHours(0, 0, 0, 0);
    return { startDate: start, endDate: end };
  }, [timeRange, customStartDate, customEndDate]);

  // Fetch popularity data
  const { data: popularityData, isLoading, error } = useQuery<PopularityDataPoint[]>({
    queryKey: ['/api/analytics/popularity', startDate.toISOString(), endDate.toISOString(), groupBy],
    queryFn: async () => {
      const response = await fetch(
        `/api/analytics/popularity?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&groupBy=${groupBy}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch popularity data');
      }
      return response.json();
    },
    enabled: isAuthenticated && !!startDate && !!endDate,
    staleTime: 60000, // 1 minute
    retry: 1,
  });

  // Refresh aggregates mutation
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/analytics/refresh-aggregates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      });
      if (!response.ok) throw new Error('Failed to refresh aggregates');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/popularity'] });
    },
  });

  // Transform data for chart
  const chartData = useMemo(() => {
    if (!popularityData || popularityData.length === 0) return [];

    // Get all unique menu items
    const allItems = new Set<string>();
    popularityData.forEach(point => {
      point.items.forEach(item => allItems.add(item.menuItemName));
    });

    // Create chart data points
    return popularityData.map(point => {
      const dataPoint: any = {
        date: format(new Date(point.date), groupBy === 'month' ? 'MMM yyyy' : groupBy === 'week' ? 'MMM dd' : 'MMM dd'),
        fullDate: point.date,
      };

      // Add each menu item's order count
      Array.from(allItems).forEach(itemName => {
        const item = point.items.find(i => i.menuItemName === itemName);
        dataPoint[itemName] = item?.orderCount || 0;
      });

      return dataPoint;
    });
  }, [popularityData, groupBy]);

  // Get top items summary
  const topItems = useMemo(() => {
    if (!popularityData) return [];

    const itemTotals = new Map<string, { name: string; totalOrders: number; totalQuantity: number }>();

    popularityData.forEach(point => {
      point.items.forEach(item => {
        const existing = itemTotals.get(item.menuItemName);
        if (existing) {
          existing.totalOrders += item.orderCount;
          existing.totalQuantity += item.quantity;
        } else {
          itemTotals.set(item.menuItemName, {
            name: item.menuItemName,
            totalOrders: item.orderCount,
            totalQuantity: item.quantity,
          });
        }
      });
    });

    return Array.from(itemTotals.values())
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .slice(0, 10);
  }, [popularityData]);

  // Get colors for chart lines
  const colors = [
    '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  ];

  if (isAuthLoading) {
    return (
      <IPhoneFrame>
        <div className="flex items-center justify-center h-full">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </IPhoneFrame>
    );
  }

  return (
    <IPhoneFrame>
      <IOSStatusBar />
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/')}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground">Analytics</h1>
            <p className="text-xs text-muted-foreground">Menu Item Popularity</p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Time Range</label>
                  <Select value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Group By</label>
                  <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {timeRange === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Start Date</label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">End Date</label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                Refresh Data
              </Button>
            </CardContent>
          </Card>

          {/* Chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Popularity Trends
              </CardTitle>
              <CardDescription className="text-xs">
                Number of orders per {groupBy} over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  Loading chart data...
                </div>
              ) : error ? (
                <div className="h-64 flex flex-col items-center justify-center text-destructive space-y-2">
                  <p>Error loading data: {error instanceof Error ? error.message : 'Unknown error'}</p>
                  <Button
                    onClick={() => refreshMutation.mutate()}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh Data
                  </Button>
                </div>
              ) : chartData.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground space-y-3">
                  <p>No data available for the selected time range.</p>
                  <p className="text-xs text-center max-w-xs">
                    Make sure you have orders in your order history and try clicking "Refresh Data" to generate analytics.
                  </p>
                  <Button
                    onClick={() => refreshMutation.mutate()}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                    Refresh Data
                  </Button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '12px' }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '12px' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    {topItems.slice(0, 5).map((item, index) => (
                      <Line
                        key={item.name}
                        type="monotone"
                        dataKey={item.name}
                        stroke={colors[index % colors.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name={item.name}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top Items */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Top Items
              </CardTitle>
              <CardDescription className="text-xs">
                Most ordered items in the selected period
              </CardDescription>
            </CardHeader>
            <CardContent>
              {topItems.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No data available
                </div>
              ) : (
                <div className="space-y-2">
                  {topItems.map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: colors[index % colors.length] }}
                        />
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-foreground">{item.totalOrders}</div>
                        <div className="text-xs text-muted-foreground">{item.totalQuantity} qty</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </IPhoneFrame>
  );
}

