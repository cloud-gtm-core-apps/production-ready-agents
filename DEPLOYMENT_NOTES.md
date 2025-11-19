# Deployment Notes for Lightsail

## Important: ESM Path Alias Resolution

Since your project uses ESM (`"type": "module"` in package.json), `tsconfig-paths/register` **will NOT work** because it's designed for CommonJS only.

## Recommended Deployment Approach

### Option 1: Use `tsx` to run compiled code (Recommended)

`tsx` handles path aliases for ESM modules automatically.

**Build:**
```bash
npx tsc --project tsconfig.server.json
```

**Run with PM2:**
```bash
pm2 start tsx --name api --cwd ~/ORDERFLOW -- server/dist/server/index.js
```

Or update your ecosystem.config.js:
```javascript
module.exports = {
    apps: [{
        name: 'api',
        script: 'tsx',
        args: 'server/dist/server/index.js',
        cwd: '/home/ubuntu/ORDERFLOW', // or your actual path
        instances: 1,
        exec_mode: 'fork',
        env: {
            NODE_ENV: 'production',
            PORT: 5000
        }
    }]
};
```

### Option 2: Use esbuild bundler (Alternative)

This resolves all path aliases at build time, so no runtime resolution needed.

**Build:**
```bash
npm run build
```

**Run with PM2:**
```bash
pm2 start dist/index.js --name api --cwd ~/ORDERFLOW
```

### Option 3: Use Node.js with custom loader (Advanced)

Create a custom ESM loader, but this is more complex.

## Current Configuration

- **TypeScript Config**: `tsconfig.server.json` outputs to `server/dist/`
- **Module System**: ESM (ESNext)
- **Path Aliases**: `@shared/*` → `./shared/*`

## Verification Steps

1. **Build:**
   ```bash
   npx tsc --project tsconfig.server.json
   ```

2. **Check output structure:**
   ```bash
   ls -la server/dist/server/
   # Should see index.js and other compiled files
   ```

3. **Test locally:**
   ```bash
   # With tsx (handles path aliases)
   tsx server/dist/server/index.js
   
   # Or with node (will fail on path aliases)
   node server/dist/server/index.js
   ```

4. **Deploy with PM2:**
   ```bash
   pm2 start tsx --name api --cwd ~/ORDERFLOW -- server/dist/server/index.js
   pm2 save
   pm2 startup
   ```

