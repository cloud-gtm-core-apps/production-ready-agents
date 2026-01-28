import MessageBubble from '../MessageBubble';

export default function MessageBubbleExample() {
  return (
    <div className="p-4 space-y-3 bg-background">
      <MessageBubble 
        text="Hey, we're at the corner gas station lot in Dearborn Heights. Text your name, order, and pickup time."
        isOutgoing={false}
        timestamp="9:41 AM"
      />
      <MessageBubble 
        text="John, Crispy Cancun (mild), 15 min"
        isOutgoing={true}
        timestamp="9:42 AM"
      />
    </div>
  );
}
