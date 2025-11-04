import OrderCard from '../OrderCard';

export default function OrderCardExample() {
  return (
    <div className="p-4 bg-background space-y-4">
      <OrderCard
        orderId="1234"
        customerName="John Smith"
        items={['Crispy Cancun (Mild)', 'Loaded Tajin Fries', 'Elote']}
        pickupTime="15 min"
        total="28.50"
        status="new"
        onConfirm={() => console.log('Confirm clicked')}
        onAdjust={() => console.log('Adjust clicked')}
      />
      <OrderCard
        orderId="1235"
        customerName="Sarah Johnson"
        items={['Nashville Chicken']}
        pickupTime="5 min"
        total="12.99"
        status="new"
        onConfirm={() => console.log('Confirm clicked')}
        onAdjust={() => console.log('Adjust clicked')}
      />
      <OrderCard
        orderId="1236"
        customerName="Mike Williams"
        items={['Smash Burger', 'Loaded Tajin Fries']}
        pickupTime="8 min"
        total="22.50"
        status="ready"
      />
    </div>
  );
}
