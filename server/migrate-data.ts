import "dotenv/config";
import bcrypt from "bcrypt";
import { db } from "./db";
import { orders, orderConversations, menuItems, users, type Message } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const USER_EMAIL = "talhanadeem22.dev@gmail.com";
const USER_PASSWORD = "password123"; // Temporary password for migration

// Base time is 9 hours ago to show orders from earlier today
const BASE_TIME = Date.now() - (9 * 60 * 60 * 1000);

// Helper to get tag from order count
function getOrderTag(count: number): string {
  if (count >= 8) return 'VIP (8x)';
  if (count === 7) return '7th order';
  if (count === 6) return '6th order';
  if (count === 5) return '5th order';
  if (count === 4) return '4th order';
  if (count === 3) return '3rd order';
  if (count === 2) return '2nd order';
  return '1st order';
}

// Helper to map status
function mapStatus(status: string): 'New' | 'Confirmed' | 'Ready' | 'Completed' {
  const statusMap: Record<string, 'New' | 'Confirmed' | 'Ready' | 'Completed'> = {
    'new': 'New',
    'confirmed': 'Confirmed',
    'ready': 'Ready',
    'completed': 'Completed'
  };
  return statusMap[status] || 'New';
}

// Helper to parse timestamp string to Date
function parseTimestamp(timeStr: string): Date {
  const [time, meridiem] = timeStr.split(' ');
  const [hours, minutes] = time.split(':');
  
  let hour = parseInt(hours);
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  
  // Use BASE_TIME instead of current time to keep all times 9 hours earlier
  const date = new Date(BASE_TIME);
  date.setHours(hour, parseInt(minutes), 0, 0);
  
  return date;
}

// Static data from Home.tsx
const staticData = [
  {
    id: '1',
    phoneNumber: '(313) 555-0123',
    customerName: 'Fatima Hassan',
    orderStatus: 'new',
    orderCount: 8,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:45 AM' },
      { text: 'hey its fatima can i get 2 classic elote cups and 1 flaming hot extra spicy 15min', isOutgoing: true, timestamp: '10:46 AM' },
      { text: 'Customer: Fatima\n\n2 Classic Elote Cups\n1 Flamin Hot Cheetos Elote\nExtra spicy\n\nPickup: 15 minutes', isOutgoing: false, timestamp: '10:46 AM' },
      { text: 'Perfect! Ready at 11:01 AM', isOutgoing: false, timestamp: '10:47 AM' },
      { text: 'Thanks!', isOutgoing: true, timestamp: '10:47 AM' }
    ],
    orderPrice: '28.97',
    pickupTime: new Date(BASE_TIME + 15 * 60 * 1000),
    notes: 'Extra spicy'
  },
  {
    id: '2',
    phoneNumber: '(313) 555-0456',
    customerName: 'Ahmed Ali',
    orderStatus: 'new',
    orderCount: 3,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:42 AM' },
      { text: 'Ahmed, Classic Elote Cup, Corn Ribs, and a water please, 20 min', isOutgoing: true, timestamp: '10:43 AM' },
      { text: 'Sounds great!', isOutgoing: false, timestamp: '10:43 AM' },
      { text: 'Can I get extra lime on the elote?', isOutgoing: true, timestamp: '10:44 AM' },
      { text: 'No problem! Extra lime coming up', isOutgoing: false, timestamp: '10:44 AM' }
    ],
    orderPrice: '19.97',
    pickupTime: new Date(BASE_TIME + 20 * 60 * 1000),
    notes: 'Extra lime'
  },
  {
    id: '3',
    phoneNumber: '(313) 555-0987',
    customerName: 'Nour Bakri',
    orderStatus: 'new',
    orderCount: 1,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:40 AM' },
      { text: '2 Flamin Hot Cheetos Elote and a Corn Dog please, 25 min', isOutgoing: true, timestamp: '10:41 AM' },
      { text: 'Perfect! Ready at 11:05 AM', isOutgoing: false, timestamp: '10:41 AM' },
      { text: 'Can I get extra hot sauce on those?', isOutgoing: true, timestamp: '10:42 AM' },
      { text: 'Of course! Extra hot sauce added', isOutgoing: false, timestamp: '10:42 AM' },
      { text: 'are you guys open at 8pm', isOutgoing: true, timestamp: '10:43 AM' }
    ],
    orderPrice: '28.97',
    pickupTime: new Date(BASE_TIME + 25 * 60 * 1000),
    notes: 'Extra hot sauce'
  },
  {
    id: '4',
    phoneNumber: '(313) 555-0234',
    customerName: 'Layla Mansour',
    orderStatus: 'new',
    orderCount: 5,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:38 AM' },
      { text: 'Hi Layla here! 2 Bacon Cheddar Elote, Tajin Fries, and 2 sodas, 18 min', isOutgoing: true, timestamp: '10:39 AM' },
      { text: 'Hi Layla! Ready at 10:57 AM', isOutgoing: false, timestamp: '10:39 AM' },
      { text: 'Perfect! Make them mild please', isOutgoing: true, timestamp: '10:40 AM' },
      { text: 'Got it, mild spice level', isOutgoing: false, timestamp: '10:40 AM' }
    ],
    orderPrice: '37.94',
    pickupTime: new Date(BASE_TIME + 18 * 60 * 1000),
    notes: 'Mild spice level'
  },
  {
    id: '5',
    phoneNumber: '(313) 555-0345',
    customerName: 'Hassan Khalil',
    orderStatus: 'new',
    orderCount: 2,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:35 AM' },
      { text: 'Hassan, Buffalo Ranch Elote, Corn Ribs, and Churro Bites, 30 min', isOutgoing: true, timestamp: '10:36 AM' },
      { text: 'Perfect! Ready at 11:05 AM', isOutgoing: false, timestamp: '10:36 AM' }
    ],
    orderPrice: '24.97',
    pickupTime: new Date(BASE_TIME + 30 * 60 * 1000)
  },
  {
    id: '6',
    phoneNumber: '(313) 555-0567',
    customerName: 'Zainab Ahmad',
    orderStatus: 'new',
    orderCount: 1,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:33 AM' },
      { text: 'Zainab, 3 Classic Elote Cups and a water, 22 min', isOutgoing: true, timestamp: '10:34 AM' },
      { text: 'Great! Ready at 10:55 AM', isOutgoing: false, timestamp: '10:34 AM' }
    ],
    orderPrice: '23.97',
    pickupTime: new Date(BASE_TIME + 22 * 60 * 1000)
  },
  {
    id: '7',
    phoneNumber: '(313) 555-0678',
    customerName: 'Youssef Hammoud',
    orderStatus: 'new',
    orderCount: 4,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:30 AM' },
      { text: 'Youssef, Takis Elote, Street Corn Dog, and Loaded Fries, 15 min', isOutgoing: true, timestamp: '10:31 AM' },
      { text: 'Awesome! Ready at 10:46 AM', isOutgoing: false, timestamp: '10:31 AM' }
    ],
    orderPrice: '26.97',
    pickupTime: new Date(BASE_TIME + 15 * 60 * 1000)
  },
  {
    id: '8',
    phoneNumber: '(313) 555-0789',
    customerName: 'Rania Saleh',
    orderStatus: 'new',
    orderCount: 6,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:28 AM' },
      { text: 'Hi! Rania, 2 Nacho Cheese Elote and Churro Bites, 20 min', isOutgoing: true, timestamp: '10:29 AM' },
      { text: 'Hi Rania! Ready at 10:48 AM', isOutgoing: false, timestamp: '10:29 AM' }
    ],
    orderPrice: '23.97',
    pickupTime: new Date(BASE_TIME + 20 * 60 * 1000)
  },
  {
    id: '9',
    phoneNumber: '(313) 555-0321',
    customerName: 'Omar Ibrahim',
    orderStatus: 'confirmed',
    orderCount: 1,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '9:50 AM' },
      { text: 'Omar, Flamin Hot Cheetos Elote, Corn Ribs, Loaded Tajin Fries, 30 min', isOutgoing: true, timestamp: '9:51 AM' },
      { text: 'Confirmed! Ready at 10:20 AM', isOutgoing: false, timestamp: '9:52 AM' },
      { text: 'Can you make everything extra spicy?', isOutgoing: true, timestamp: '9:53 AM' },
      { text: 'You got it! Extra spicy all around', isOutgoing: false, timestamp: '9:53 AM' },
      { text: 'Thanks! Running a bit late, will be there closer to 10:30', isOutgoing: true, timestamp: '10:15 AM' },
      { text: 'No problem! Your order will be ready', isOutgoing: false, timestamp: '10:16 AM' }
    ],
    orderPrice: '27.97',
    pickupTime: new Date(BASE_TIME - 15 * 60 * 1000),
    notes: 'Extra spicy please!'
  },
  {
    id: '10',
    phoneNumber: '(313) 555-0890',
    customerName: 'Maryam Dabaja',
    orderStatus: 'confirmed',
    orderCount: 3,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:15 AM' },
      { text: 'Maryam, Classic Elote Cup, Street Elote, and a water, 5 min', isOutgoing: true, timestamp: '10:16 AM' },
      { text: 'Confirmed! Ready at 10:21 AM', isOutgoing: false, timestamp: '10:17 AM' },
      { text: 'Perfect! Can I get extra lime with the elote?', isOutgoing: true, timestamp: '10:18 AM' },
      { text: 'Absolutely! Extra lime wedges coming up', isOutgoing: false, timestamp: '10:18 AM' }
    ],
    orderPrice: '16.97',
    pickupTime: new Date(BASE_TIME + 5 * 60 * 1000),
    notes: 'Extra lime wedges'
  },
  {
    id: '11',
    phoneNumber: '(313) 555-0654',
    customerName: 'Ali Bazzi',
    orderStatus: 'confirmed',
    orderCount: 7,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:10 AM' },
      { text: 'Ali, 2 Buffalo Ranch Elote, Bacon Cheddar Elote, Churro Bites, 35 min', isOutgoing: true, timestamp: '10:11 AM' },
      { text: 'Great! Ready at 10:45 AM', isOutgoing: false, timestamp: '10:12 AM' },
      { text: 'Can I get extra cheese on the Bacon Cheddar?', isOutgoing: true, timestamp: '10:13 AM' },
      { text: 'Yes! Extra cheese added', isOutgoing: false, timestamp: '10:13 AM' }
    ],
    orderPrice: '34.96',
    pickupTime: new Date(BASE_TIME + 20 * 60 * 1000),
    notes: 'Extra cheese'
  },
  {
    id: '12',
    phoneNumber: '(313) 555-0901',
    customerName: 'Dina Fawaz',
    orderStatus: 'confirmed',
    orderCount: 2,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '10:05 AM' },
      { text: 'Dina, 2 Takis Elote and a soda, 25 min', isOutgoing: true, timestamp: '10:06 AM' },
      { text: 'Perfect! Ready at 10:31 AM', isOutgoing: false, timestamp: '10:07 AM' }
    ],
    orderPrice: '18.98',
    pickupTime: new Date(BASE_TIME + 8 * 60 * 1000)
  },
  {
    id: '13',
    phoneNumber: '(313) 555-0111',
    customerName: 'Karim Saad',
    orderStatus: 'ready',
    orderCount: 1,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '9:30 AM' },
      { text: 'Karim, Buffalo Ranch Elote and a Street Corn Dog, 25 min', isOutgoing: true, timestamp: '9:31 AM' },
      { text: 'Perfect! Ready at 9:56 AM', isOutgoing: false, timestamp: '9:32 AM' },
      { text: 'Can I get extra ranch on that elote?', isOutgoing: true, timestamp: '9:33 AM' },
      { text: 'No problem! Extra ranch coming up', isOutgoing: false, timestamp: '9:33 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '9:55 AM' },
      { text: 'On my way!', isOutgoing: true, timestamp: '9:56 AM' }
    ],
    orderPrice: '17.98',
    pickupTime: new Date(BASE_TIME),
    notes: 'Extra ranch'
  },
  {
    id: '14',
    phoneNumber: '(313) 555-0222',
    customerName: 'Sara Chami',
    orderStatus: 'ready',
    orderCount: 4,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '9:25 AM' },
      { text: 'Sara, Nacho Cheese Elote, Bacon Cheddar Elote, Corn Ribs, 30 min', isOutgoing: true, timestamp: '9:26 AM' },
      { text: 'Awesome! Ready at 9:56 AM', isOutgoing: false, timestamp: '9:27 AM' },
      { text: 'Perfect! Can you add extra toppings on the Nacho Cheese?', isOutgoing: true, timestamp: '9:28 AM' },
      { text: 'Sure! Extra toppings added', isOutgoing: false, timestamp: '9:28 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '9:54 AM' },
      { text: 'Be there in 2 minutes!', isOutgoing: true, timestamp: '9:55 AM' }
    ],
    orderPrice: '29.97',
    pickupTime: new Date(BASE_TIME),
    notes: 'Extra toppings on Nacho Cheese'
  },
  {
    id: '15',
    phoneNumber: '(313) 555-0333',
    customerName: 'Hadi Jawad',
    orderStatus: 'ready',
    orderCount: 9,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '9:20 AM' },
      { text: 'Hadi, the usual please! 20 min', isOutgoing: true, timestamp: '9:21 AM' },
      { text: 'You got it Hadi! 2 Flamin Hot Cheetos Elote and a soda, ready at 9:41 AM', isOutgoing: false, timestamp: '9:22 AM' },
      { text: 'Perfect thanks!', isOutgoing: true, timestamp: '9:22 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '9:40 AM' }
    ],
    orderPrice: '19.98',
    pickupTime: new Date(BASE_TIME)
  },
  {
    id: '16',
    phoneNumber: '(313) 555-0444',
    customerName: 'Mariam Tariq',
    orderStatus: 'completed',
    orderCount: 5,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '8:30 AM' },
      { text: 'Mariam, 2 Classic Elote Cups and Churro Bites, 20 min', isOutgoing: true, timestamp: '8:31 AM' },
      { text: 'Perfect! Ready at 8:51 AM', isOutgoing: false, timestamp: '8:32 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '8:50 AM' },
      { text: 'Thanks! Just picked it up', isOutgoing: true, timestamp: '8:52 AM' }
    ],
    orderPrice: '18.97',
    pickupTime: new Date(BASE_TIME - 120 * 60 * 1000)
  },
  {
    id: '17',
    phoneNumber: '(313) 555-0555',
    customerName: 'Bilal Hakim',
    orderStatus: 'completed',
    orderCount: 2,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '8:15 AM' },
      { text: 'Bilal, Takis Elote, Corn Ribs, and a water, 25 min', isOutgoing: true, timestamp: '8:16 AM' },
      { text: 'Great! Ready at 8:41 AM', isOutgoing: false, timestamp: '8:17 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '8:40 AM' },
      { text: 'Picked up, thank you!', isOutgoing: true, timestamp: '8:43 AM' }
    ],
    orderPrice: '21.97',
    pickupTime: new Date(BASE_TIME - 140 * 60 * 1000)
  },
  {
    id: '18',
    phoneNumber: '(313) 555-0666',
    customerName: 'Lina Mousa',
    orderStatus: 'completed',
    orderCount: 1,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '8:00 AM' },
      { text: 'Lina, Bacon Cheddar Elote, Street Corn Dog, and a soda, 30 min', isOutgoing: true, timestamp: '8:01 AM' },
      { text: 'Sounds good! Ready at 8:31 AM', isOutgoing: false, timestamp: '8:02 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '8:30 AM' },
      { text: 'Got it! Thanks', isOutgoing: true, timestamp: '8:33 AM' }
    ],
    orderPrice: '21.97',
    pickupTime: new Date(BASE_TIME - 150 * 60 * 1000)
  },
  {
    id: '19',
    phoneNumber: '(313) 555-0777',
    customerName: 'Tariq Mansour',
    orderStatus: 'completed',
    orderCount: 6,
    messages: [
      { text: "Corn On The Corner, This is our storefront location: 1041 Howard st, Dearborn, MI 48124. Please text your order including a name and confirm the given pick up time. Thank you.", isOutgoing: false, timestamp: '7:45 AM' },
      { text: 'Tariq, 2 Nacho Cheese Elote, Buffalo Ranch Elote, Tajin Fries, 18 min', isOutgoing: true, timestamp: '7:46 AM' },
      { text: 'Perfect! Ready at 8:04 AM', isOutgoing: false, timestamp: '7:47 AM' },
      { text: 'Your order is ready for pickup!', isOutgoing: false, timestamp: '8:03 AM' },
      { text: 'Picked it up, delicious as always!', isOutgoing: true, timestamp: '8:05 AM' }
    ],
    orderPrice: '32.96',
    pickupTime: new Date(BASE_TIME - 165 * 60 * 1000),
    notes: 'Extra spicy'
  }
];

async function migrateData() {
  console.log('Starting data migration...');
  
  try {
    // First, ensure user exists
    console.log('\n=== Checking User ===');
    let existingUser = await db.select().from(users).where(eq(users.email, USER_EMAIL)).limit(1);
    
    let userId: string;
    if (existingUser.length > 0) {
      userId = existingUser[0].id;
      console.log(`✓ User already exists: ${existingUser[0].email}`);
    } else {
      // Create user
      const hashedPassword = await bcrypt.hash(USER_PASSWORD, 10);
      const newUser = await db.insert(users).values({
        email: USER_EMAIL,
        password: hashedPassword,
      }).returning();
      userId = newUser[0].id;
      console.log(`✓ Created new user: ${USER_EMAIL}`);
    }

    // Clear existing data to avoid duplicates (only for this user)
    console.log('\n=== Cleaning Existing Data ===');
    await db.delete(orderConversations).where(eq(orderConversations.userId, userId));
    await db.delete(orders).where(eq(orders.userId, userId));
    console.log('✓ Cleared existing orders and conversations for this user');

    // Then, migrate menu items (only if they don't exist)
    console.log('\n=== Migrating Menu Items ===');
    const menuData = [
      { name: 'Classic Elote Cup', price: '$8.99', category: 'Elote Cups' },
      { name: 'Buffalo Ranch Elote', price: '$9.99', category: 'Elote Cups' },
      { name: 'Flamin Hot Cheetos Elote', price: '$9.99', category: 'Elote Cups' },
      { name: 'Bacon Cheddar Elote', price: '$10.99', category: 'Elote Cups' },
      { name: 'Nacho Cheese Elote', price: '$9.99', category: 'Elote Cups' },
      { name: 'Corn Ribs', price: '$7.99', category: 'Sides' },
      { name: 'Street Corn Dog', price: '$6.99', category: 'Entrees' },
      { name: 'Churro Bites', price: '$4.99', category: 'Desserts' },
      { name: 'Loaded Tajin Fries', price: '$6.99', category: 'Sides' },
      { name: 'Canned Soda', price: '$1.99', category: 'Drinks' },
    ];

    for (const item of menuData) {
      // Check if item already exists
      const existing = await db.select()
        .from(menuItems)
        .where(and(
          eq(menuItems.userId, userId),
          eq(menuItems.name, item.name)
        ))
        .limit(1);
      
      if (existing.length > 0) {
        console.log(`⊘ Menu item "${item.name}" already exists, skipping`);
        continue;
      }
      
      await db.insert(menuItems).values({
        userId,
        name: item.name,
        price: item.price,
        category: item.category,
        isAvailable: true,
      });
      console.log(`✓ Inserted menu item: ${item.name}`);
    }

    // Then migrate orders
    console.log('\n=== Migrating Orders ===');
    for (const conversation of staticData) {
      // Split customer name
      const nameParts = conversation.customerName?.split(' ') || ['', ''];
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');
      
      // Get first customer message (skip greeting)
      const firstMessage = conversation.messages.find(m => m.isOutgoing)?.text || conversation.messages[0]?.text || '';
      
      // Get last message timestamp
      const lastMessageTime = conversation.messages.length > 0 
        ? parseTimestamp(conversation.messages[conversation.messages.length - 1].timestamp)
        : new Date();
      
      // Insert order
      await db.insert(orders).values({
        id: conversation.id,
        userId,
        firstName: firstName || null,
        lastName: lastName || null,
        number: conversation.phoneNumber,
        tag: getOrderTag(conversation.orderCount) as any,
        firstMessage,
        orderPrice: conversation.orderPrice || null,
        status: mapStatus(conversation.orderStatus),
        isLate: false,
        isUrgent: false,
        pickupTime: conversation.pickupTime || null,
        lastMessage: lastMessageTime
      });
      
      console.log(`✓ Inserted order for ${conversation.customerName}`);
      
      // Convert messages to Message format and store as JSON array in one row
      const formattedMessages: Message[] = conversation.messages.map((msg) => ({
        id: randomUUID(),
        text: msg.text,
        isOutgoing: msg.isOutgoing,
        timestamp: parseTimestamp(msg.timestamp).toISOString(),
      }));
      
      // Insert all messages as JSON array in one conversation row
      await db.insert(orderConversations).values({
        userId,
        orderId: conversation.id,
        number: conversation.phoneNumber,
        messages: formattedMessages,
        updatedAt: new Date(),
      });
      
      console.log(`  ✓ Inserted conversation with ${formattedMessages.length} messages`);
    }
    
    console.log('\n✅ Migration complete!');
    console.log(`Total menu items migrated: ${menuData.length}`);
    console.log(`Total orders migrated: ${staticData.length}`);
    console.log(`Total messages migrated: ${staticData.reduce((sum, c) => sum + c.messages.length, 0)}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateData().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
