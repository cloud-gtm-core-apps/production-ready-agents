import { useState } from 'react';
import TabBar from '../TabBar';

export default function TabBarExample() {
  const [activeTab, setActiveTab] = useState<'new' | 'confirmed' | 'ready'>('new');

  return (
    <div className="relative h-32 bg-background">
      <TabBar 
        activeTab={activeTab} 
        onTabChange={setActiveTab}
        counts={{
          new: 3,
          confirmed: 2,
          ready: 1
        }}
      />
    </div>
  );
}
