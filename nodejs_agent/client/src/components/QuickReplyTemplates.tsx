import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { MessageSquarePlus, CheckCircle, User, DollarSign, Clock } from 'lucide-react';

interface QuickReplyTemplatesProps {
  onSelectTemplate: (template: string) => void;
}

const templates = [
  {
    id: 'order-ready',
    category: 'Order Status',
    icon: CheckCircle,
    text: 'Your order is ready for pickup!',
  },
  {
    id: 'confirm-total',
    category: 'Confirmation',
    icon: DollarSign,
    text: 'Perfect! Total confirmed - we\'ll have it ready soon!',
  },
  {
    id: 'ask-name',
    category: 'Information',
    icon: User,
    text: 'What\'s your name for the order?',
  },
  {
    id: 'ask-time',
    category: 'Information',
    icon: Clock,
    text: 'When would you like to pick it up?',
  },
  {
    id: 'running-behind',
    category: 'Order Status',
    icon: Clock,
    text: 'Running a few minutes behind - your order will be ready in 5 minutes!',
  },
  {
    id: 'thank-you',
    category: 'Confirmation',
    icon: CheckCircle,
    text: 'Thank you! See you soon! 🌽',
  },
];

export default function QuickReplyTemplates({ onSelectTemplate }: QuickReplyTemplatesProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="rounded-full flex-shrink-0"
          data-testid="button-quick-reply"
        >
          <MessageSquarePlus className="w-5 h-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[60vh]">
        <SheetHeader>
          <SheetTitle>Quick Replies</SheetTitle>
          <SheetDescription>
            Tap a message to send it
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-2 overflow-y-auto max-h-[calc(60vh-8rem)]">
          {templates.map((template) => {
            const Icon = template.icon;
            return (
              <button
                key={template.id}
                onClick={() => onSelectTemplate(template.text)}
                className="w-full p-4 text-left border rounded-lg hover-elevate active-elevate-2 transition-colors"
                data-testid={`quick-reply-${template.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">{template.category}</p>
                    <p className="text-sm text-foreground">{template.text}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
