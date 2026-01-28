# Design Guidelines: Corn on the Corner - Text-to-Order Mockup

## Design Approach

**Reference-Based Approach**: Drawing inspiration from messaging apps (iMessage, WhatsApp) for customer interface and productivity tools (Linear, Asana) for Rod's dashboard, while maintaining strict brand consistency with Corn on the Corner's established identity.

## Brand Analysis from cornonthecorner.com

**Primary Brand Colors:**
- Warm Yellow/Gold: 45 95% 55% (corn/sunshine theme)
- Deep Green: 140 60% 25% (natural, fresh)
- Off-White/Cream: 40 25% 95% (background)
- Charcoal: 0 0% 20% (text)

**Secondary/Accent Colors:**
- Bright Red: 355 85% 50% (for spicy indicators, urgent notifications)
- Sky Blue: 200 70% 60% (informational elements)

**Typography:**
- Headings: Bold, friendly sans-serif (similar to Montserrat Bold)
- Body: Clean, readable sans-serif (similar to Open Sans or Inter)
- Sizes: Large 32px, Medium 18px, Body 16px, Small 14px, Tiny 12px

## Layout System

**Spacing Primitives**: Use Tailwind spacing of 2, 4, 8, 12, 16 units
- Micro spacing: p-2, gap-2
- Standard spacing: p-4, m-4, gap-4  
- Section spacing: py-8, my-8
- Large spacing: py-12, my-16

**iPhone Interface Specifications:**
- Device Frame: iPhone 14 Pro dimensions (393x852px viewport)
- Safe areas: Account for top notch and bottom gesture bar
- Status bar: 20 0% 10% background with white text/icons
- Navigation bar: 44px height minimum for touch targets
- Bottom navigation: 80px height with safe area padding

## Component Library

### Customer Text Interface (iMessage-style)

**Message Bubbles:**
- Outgoing (customer): Deep green background, white text, rounded-2xl, align right
- Incoming (auto-reply/Rod): Light gray 0 0% 90% background, charcoal text, rounded-2xl, align left
- Spacing: gap-3 between messages, px-4 py-2 internal padding
- Max width: max-w-[75%] for natural conversation flow
- Timestamps: text-xs in 0 0% 50%, positioned below bubbles

**Input Area:**
- Fixed bottom with backdrop blur
- White background with subtle shadow
- Rounded corners (rounded-full)
- Height: h-12 with py-3 px-4
- Send button: Warm yellow circle with white arrow icon

**Menu Link Cards:**
- White background with subtle border
- Product image on left (w-20 h-20 rounded-lg)
- Product name and price stacked on right
- Tap target: min-h-16

### Rod's Dashboard Interface

**Header:**
- Fixed top navigation with brand logo (corn icon + wordmark)
- Background: Deep green gradient to 140 60% 20%
- White text and icons
- Height: h-16 with status indicators (new orders badge in bright red)

**Order Cards:**
- White background with shadow-lg, rounded-xl
- Status indicator bar on left edge: 4px wide color-coded strip
  - Yellow: Received
  - Blue: Confirmed  
  - Orange: Prepping
  - Green: Ready
- Layout: Grid with customer name (bold), order items (list), pickup time (highlighted), total price
- Action buttons: One-tap confirm (green), adjust (blue), contact (gray)
- Spacing: p-4 internal, gap-4 between cards

**Order Queue View:**
- Horizontal scrollable timeline at top showing order progression
- Main area: Vertical list of active orders sorted by time
- Empty state: Illustration with "No orders yet" message

**Inventory Alerts:**
- Toast notifications sliding from top
- Red background for out-of-stock
- Yellow background for low-stock
- Icon + item name + suggested alternative
- Auto-dismiss after 5 seconds or manual close

**Analytics Dashboard:**
- Card-based layout with rounded-xl containers
- Charts: Simple bar/line charts using warm brand colors
- Key metrics: Large numbers (text-4xl) with small labels below
- Grid: grid-cols-2 on mobile

## Navigation Patterns

**Customer App:**
- Single conversation view (no complex navigation)
- Back button (top-left) to return to main menu/home
- Settings icon (top-right) for preferences

**Rod's Dashboard:**
- Bottom tab navigation:
  - Orders (active by default)
  - Queue  
  - Analytics
  - Settings
- Tab icons: Simple line icons
- Active tab: Yellow underline + yellow icon color
- Inactive: Gray icons

## Interaction States

**Buttons:**
- Primary (Confirm/Send): Deep green background, white text, rounded-lg, h-12
  - Active: Slightly darker green
  - Disabled: 0 0% 70% gray
- Secondary (Adjust): White background, deep green border and text, rounded-lg
- Tertiary/Icon: Transparent with icon only

**Cards:**
- Default: shadow-md
- Hover/Selected: shadow-xl with subtle scale (scale-[1.02])
- Loading: Skeleton with animated gradient pulse

**Form Inputs:**
- Border: 2px solid 0 0% 85%
- Focused: Border changes to deep green, shadow-sm
- Error: Red border with small error text below
- Height: h-12 standard

## Messaging Flow Visualization

**Dual-View Layout (for presentation):**
- Split screen: Customer phone (left 40%) + Rod's dashboard (right 60%)
- Connected with animated dotted lines showing data flow
- Synchronized highlighting: When customer sends message, highlight both sides
- Step counter: Small numbered badges (1, 2, 3...) showing progression

**Animation Principles:**
- Message send: Slide up from input with slight bounce
- Auto-reply: Fade in with typing indicator (three dots) for 1 second first
- Order card creation: Slide down from top with attention pulse
- Status changes: Smooth color transition on left border
- Keep animations subtle - maximum 300ms duration

## Images

**Menu Item Photos:**
- Required for order cards and menu links
- Dimensions: Square aspect ratio (1:1)
- Style: Bright, appetizing food photography on white/neutral backgrounds
- Placement: Left side of cards, circular crop for avatars

**Empty States:**
- Friendly illustration of corn character when no orders exist
- Placement: Center of screen with message below
- Style: Simple line art in brand yellow and green

**Logo:**
- Corn icon + "Corn on the Corner" text
- Placement: Dashboard header, customer app top
- Size: h-10 for header, h-8 for footer
- Format: SVG for crisp rendering

**Hero Section (Dashboard Welcome):**
- Not needed - dashboard is utility-focused and action-oriented
- Instead: Quick stats banner with background gradient (deep green to lighter green)

## Dark Mode

Not required for MVP - focus on light mode optimized for daylight outdoor use (food truck environment)

## Accessibility

- Touch targets: Minimum 44x44px per iOS HIG
- Text contrast: WCAG AA compliant against all backgrounds
- Focus indicators: 2px yellow outline on interactive elements
- Screen reader labels for all icons and actions
- Font size: Minimum 14px for body text

## Platform-Specific Details

**iOS Characteristics:**
- System font: SF Pro (or -apple-system fallback)
- Native-feeling animations: Ease-out curves
- Gesture hints: Swipe actions on order cards (swipe left for quick actions)
- Haptic feedback indicators: Comment <!-- Haptic feedback on confirm --> where appropriate
- Status bar: Blurred translucent background
- Keyboard: Push content up, don't overlap

**Presentation Mode:**
- Add "DEMO MODE" subtle watermark in corners
- Pause button to stop auto-progression for client discussion
- Reset button to restart flow from beginning
- Step-by-step controls (Previous/Next) for walkthrough

This mockup prioritizes visual polish and brand consistency while demonstrating the seamless text-to-order flow that eliminates Rod's current pain points.