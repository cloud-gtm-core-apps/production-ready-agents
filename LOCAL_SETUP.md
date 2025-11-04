# Local Setup Guide - OrderFlowUX

This guide will help you run the Corn on the Corner Order Management System locally on Windows.

## Prerequisites

Before you start, make sure you have:
- **Node.js** (v20 or higher) - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **PostgreSQL database** - You have two options:
  1. **Neon Serverless PostgreSQL** (recommended, free tier available) - [Sign up](https://neon.tech/)
  2. **Local PostgreSQL** - Install and run locally

## Step 1: Install Dependencies

Open PowerShell in the project directory and run:

```powershell
npm install
```

## Step 2: Set Up Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Database Connection (required)
DATABASE_URL=postgresql://username:password@host:port/database

# Server Configuration (optional)
PORT=5000
SESSION_SECRET=your-secret-key-change-this-in-production

# OpenAI API Key (optional - needed for AI features)
OPENAI_API_KEY=your-openai-api-key
```

### Getting DATABASE_URL

**Option A: Using Neon (Recommended)**
1. Sign up at [neon.tech](https://neon.tech/)
2. Create a new project
3. Copy the connection string from your project dashboard
4. Format: `postgresql://username:password@ep-xxx.region.aws.neon.tech/database?sslmode=require`

**Option B: Using Local PostgreSQL**
1. Install PostgreSQL locally
2. Create a database: `createdb orderflow`
3. Use: `postgresql://localhost:5432/orderflow`
   - Or: `postgresql://postgres:yourpassword@localhost:5432/orderflow`

## Step 3: Run Database Migrations

After setting up your database, run the migrations to create the tables:

```powershell
npm run db:push
```

This will create the necessary tables in your database (users, orders, order_conversations).

## Step 4: Run the Development Server

For Windows PowerShell, use one of these methods:

### Method 1: Using cross-env (Recommended - if installed)
```powershell
npm install -g cross-env
cross-env NODE_ENV=development tsx server/index.ts
```

### Method 2: Manual PowerShell command
```powershell
$env:NODE_ENV="development"; tsx server/index.ts
```

### Method 3: Use the fixed dev script
The project includes a Windows-compatible dev script. Just run:
```powershell
npm run dev
```

## Step 5: Access the Application

Once the server starts, you should see:
```
serving on port 5000
```

Open your browser and navigate to:
- **Frontend**: http://localhost:5000

The application will be available at that URL with hot-reload enabled.

## Project Structure

```
OrderFlowUX/
├── client/              # React frontend application
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   └── ...
│   └── index.html
├── server/              # Express backend API
│   ├── index.ts        # Server entry point
│   ├── routes.ts       # API routes
│   ├── db.ts           # Database connection
│   └── ...
├── shared/              # Shared TypeScript types
│   └── schema.ts       # Database schema
├── migrations/          # Database migrations
└── package.json
```

## Available Scripts

- `npm run dev` - Start development server (with HMR)
- `npm run build` - Build for production
- `npm run start` - Start production server (requires build first)
- `npm run check` - Type check TypeScript files
- `npm run db:push` - Push database schema changes

## Troubleshooting

### Port Already in Use
If port 5000 is already in use, change the `PORT` in your `.env` file or stop the conflicting service.

### Database Connection Errors
- Verify your `DATABASE_URL` is correct
- Ensure your database is running (if local)
- Check firewall settings if using a remote database
- For Neon, ensure SSL is enabled: `?sslmode=require`

### Windows Script Issues
If `npm run dev` doesn't work on Windows, use the PowerShell command from Step 4, Method 2.

### Missing Dependencies
If you see module errors, delete `node_modules` and `package-lock.json`, then run `npm install` again.

### OpenAI Features Not Working
AI features (message organization, response suggestions) require an `OPENAI_API_KEY`. These features are optional and the app will work without them.

## Development Tips

- The app uses **Hot Module Replacement (HMR)** - changes to frontend files will auto-reload
- Backend changes require a server restart
- Check browser console and terminal for error messages
- The app runs on a single port (5000) that serves both API and frontend

## Next Steps

1. Set up your database and run migrations
2. Create a test user account via the signup page
3. Explore the order management interface
4. Check out the demo data that's loaded automatically

Enjoy developing! 🚀

