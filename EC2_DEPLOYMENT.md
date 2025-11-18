# Amazon EC2 Deployment Guide - OrderFlowUX

This guide will help you deploy your OrderFlowUX application to Amazon EC2, which is an excellent choice for SSE applications if you need more control, scalability options, or prefer AWS infrastructure.

## EC2 vs Railway Comparison

### EC2 Advantages
✅ **Full Control**: Complete control over the server environment  
✅ **Scalability**: Easy horizontal scaling with Auto Scaling Groups  
✅ **Cost Control**: Pay only for what you use (can be cheaper at scale)  
✅ **AWS Integration**: Native integration with RDS, S3, CloudWatch, etc.  
✅ **Custom Configurations**: Install any software, configure exactly as needed  
✅ **Production Ready**: Enterprise-grade reliability and uptime  

### Railway Advantages
✅ **Easier Setup**: Zero-config deployment from GitHub  
✅ **Faster Deployment**: Minutes instead of hours to set up  
✅ **Less Maintenance**: No server management, OS updates, security patches  
✅ **Better for MVP**: Faster to market, less DevOps overhead  
✅ **Built-in CI/CD**: Automatic deployments on git push  

### When to Choose EC2
- You need fine-grained control over the environment
- You want AWS-native integrations (RDS, S3, CloudWatch, etc.)
- You have DevOps experience or a team
- You need predictable costs at scale
- You require specific security/compliance configurations
- You want to set up load balancing across multiple instances

### When to Choose Railway
- You want to deploy quickly (minutes)
- You prefer minimal server management
- You're building an MVP or small/medium application
- You want automatic deployments without CI/CD setup
- You're a solo developer or small team

## Prerequisites

1. **AWS Account**: Sign up at [aws.amazon.com](https://aws.amazon.com)
2. **AWS CLI**: Install and configure ([Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
3. **SSH Key Pair**: Create in EC2 Console
4. **GitHub Repository**: Your code should be in a GitHub repo

## Step 1: Launch EC2 Instance

### Instance Configuration

1. **Go to EC2 Console** → Click "Launch Instance"

2. **Name**: `OrderFlowUX-Production` (or your preferred name)

3. **AMI**: Choose **Ubuntu 22.04 LTS** (recommended) or **Amazon Linux 2023**

4. **Instance Type**: 
   - **Development/Testing**: `t3.micro` or `t3.small` (Free tier eligible)
   - **Production**: `t3.medium` or `t3.large` (2-4 vCPU, 4-8 GB RAM)
   - **High Traffic**: `t3.xlarge` or larger

5. **Key Pair**: 
   - Create new or select existing
   - **Download the `.pem` file** - you'll need this to SSH

6. **Network Settings**:
   - **Security Group**: Create new security group
   - **Inbound Rules**:
     ```
     Type          Protocol    Port Range    Source
     SSH           TCP         22             Your IP (0.0.0.0/0 for testing)
     HTTP          TCP         80             0.0.0.0/0
     HTTPS         TCP         443            0.0.0.0/0
     Custom TCP    TCP         5000           0.0.0.0/0 (for direct access during setup)
     ```

7. **Storage**: 
   - **Size**: 20 GB (gp3) minimum for production
   - 30-50 GB recommended for growth

8. **Launch Instance**

## Step 2: Connect to EC2 Instance

### Using SSH

```bash
# Replace with your key file and instance IP
ssh -i /path/to/your-key.pem ubuntu@YOUR_EC2_IP_ADDRESS

# For Amazon Linux, use:
ssh -i /path/to/your-key.pem ec2-user@YOUR_EC2_IP_ADDRESS
```

**Find your instance IP**: EC2 Console → Instances → Select instance → Public IPv4 address

## Step 3: Install Node.js and Dependencies

### For Ubuntu 22.04:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools (needed for some npm packages)
sudo apt install -y build-essential

# Install Git
sudo apt install -y git

# Install PM2 (process manager for Node.js)
sudo npm install -g pm2

# Verify installations
node --version  # Should show v20.x.x
npm --version
pm2 --version
```

### For Amazon Linux 2023:

```bash
# Update system
sudo yum update -y

# Install Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install Git
sudo yum install -y git

# Install PM2
sudo npm install -g pm2

# Verify installations
node --version
npm --version
```

## Step 4: Clone and Build Application

```bash
# Clone your repository
cd ~
git clone https://github.com/YOUR_USERNAME/OrderFlowUX.git
cd OrderFlowUX

# Install dependencies
npm install

# Build the application
npm run build

# Verify build output
ls -la dist/
ls -la dist/public/
```

## Step 5: Set Up Environment Variables

Create a `.env` file:

```bash
nano ~/OrderFlowUX/.env
```

Add your environment variables:

```env
# Database (use RDS or external PostgreSQL)
DATABASE_URL=postgresql://username:password@your-db-host:5432/database?sslmode=require

# Server Configuration
PORT=5000
NODE_ENV=production

# Session Secret (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
SESSION_SECRET=your-generated-secret-key-here

# OpenAI API Key (optional)
OPENAI_API_KEY=sk-...

# Clover Integration (optional)
CLOVER_APP_ID=your-clover-app-id
CLOVER_APP_SECRET=your-clover-app-secret
REDIRECT_URI=http://YOUR_DOMAIN_OR_IP/oauth/callback
MERCHENT_API_KEY=your-merchant-api-key
```

Save and exit: `Ctrl+X`, then `Y`, then `Enter`

## Step 6: Set Up PostgreSQL Database

### Option A: Use AWS RDS (Recommended for Production)

1. **Go to RDS Console** → Create database
2. **Engine**: PostgreSQL (latest version)
3. **Template**: Free tier or Production
4. **Instance**: `db.t3.micro` (free tier) or `db.t3.small` (production)
5. **Storage**: 20 GB minimum
6. **Master Username/Password**: Set secure credentials
7. **VPC**: Same VPC as your EC2 instance
8. **Security Group**: Allow PostgreSQL (port 5432) from EC2 security group
9. **Create Database**
10. **Update DATABASE_URL** in your `.env` file with RDS endpoint

### Option B: Use External Database (Neon, Supabase, etc.)

Just update `DATABASE_URL` in `.env` with your external database connection string.

## Step 7: Run Database Migrations

```bash
cd ~/OrderFlowUX
npm run db:push
```

## Step 8: Set Up PM2 for Process Management

Create a PM2 ecosystem file:

```bash
nano ~/OrderFlowUX/ecosystem.config.js
```

Add:

```javascript
module.exports = {
  apps: [{
    name: 'orderflowux',
    script: './dist/index.js',
    cwd: '/home/ubuntu/OrderFlowUX', // Adjust path if using Amazon Linux (ec2-user)
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

Save and exit.

```bash
# Create logs directory
mkdir -p ~/OrderFlowUX/logs

# Start application with PM2
cd ~/OrderFlowUX
pm2 start ecosystem.config.js

# Save PM2 configuration (survives reboots)
pm2 save

# Set up PM2 to start on system boot
pm2 startup
# Follow the instructions shown (usually copy/paste a command)

# Check status
pm2 status
pm2 logs orderflowux
```

## Step 9: Set Up Nginx Reverse Proxy (Recommended)

Install Nginx:

```bash
# Ubuntu
sudo apt install -y nginx

# Amazon Linux
sudo yum install -y nginx
```

Create Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/orderflowux
```

**Note**: Amazon Linux uses `/etc/nginx/conf.d/orderflowux.conf` instead

Add:

```nginx
server {
    listen 80;
    server_name your-domain.com YOUR_EC2_IP;

    # Increase timeouts for SSE
    proxy_read_timeout 86400;
    proxy_connect_timeout 86400;
    proxy_send_timeout 86400;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE-specific headers
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # SSE endpoint needs special handling
    location /api/events {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Cache-Control 'no-cache';
        proxy_set_header Content-Type 'text/event-stream';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 86400;
    }
}
```

Enable site:

```bash
# Ubuntu
sudo ln -s /etc/nginx/sites-available/orderflowux /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Amazon Linux
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## Step 10: Set Up SSL with Let's Encrypt (Optional but Recommended)

```bash
# Install Certbot
# Ubuntu
sudo apt install -y certbot python3-certbot-nginx

# Amazon Linux
sudo yum install -y certbot python3-certbot-nginx

# Get certificate (replace with your domain)
sudo certbot --nginx -d your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

## Step 11: Configure Firewall (UFW for Ubuntu)

```bash
# Ubuntu only - Amazon Linux uses Security Groups
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
sudo ufw status
```

**Note**: Amazon Linux relies on EC2 Security Groups (configured in Step 1).

## Step 12: Set Up Auto-Deploy (Optional)

### Using GitHub Actions + SSH

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to EC2

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to EC2
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd ~/OrderFlowUX
            git pull origin main
            npm install
            npm run build
            pm2 restart orderflowux
```

Add secrets in GitHub: Settings → Secrets → Actions:
- `EC2_HOST`: Your EC2 public IP
- `EC2_SSH_KEY`: Contents of your `.pem` file

### Manual Deploy Script

Create `deploy.sh`:

```bash
#!/bin/bash
cd ~/OrderFlowUX
git pull origin main
npm install
npm run build
npm run db:push  # Only if schema changed
pm2 restart orderflowux
```

Make executable:

```bash
chmod +x ~/OrderFlowUX/deploy.sh
```

## Monitoring and Maintenance

### View Logs

```bash
# Application logs
pm2 logs orderflowux

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# System logs
journalctl -u nginx -f
```

### Monitor Resources

```bash
# Check PM2 status
pm2 status
pm2 monit

# Check system resources
htop  # Install: sudo apt install htop
df -h  # Disk usage
free -h  # Memory usage
```

### Set Up CloudWatch Monitoring (AWS)

1. **Install CloudWatch Agent** (optional but recommended)
2. **Create IAM Role** with CloudWatch permissions
3. **Attach Role** to EC2 instance
4. Monitor CPU, Memory, Disk, Network in CloudWatch Console

## Cost Estimates

### EC2 Costs (US East region)

- **t3.micro** (1 vCPU, 1 GB): ~$7.50/month (free tier first year)
- **t3.small** (2 vCPU, 2 GB): ~$15/month
- **t3.medium** (2 vCPU, 4 GB): ~$30/month
- **t3.large** (2 vCPU, 8 GB): ~$60/month

### RDS Costs (PostgreSQL)

- **db.t3.micro** (free tier first year): $0
- **db.t3.small**: ~$15/month
- **Storage**: $0.115/GB-month (20 GB = ~$2.30/month)

### Total Monthly (Production)
- **Small**: EC2 t3.small + RDS t3.small = ~$32/month
- **Medium**: EC2 t3.medium + RDS t3.small = ~$47/month
- **Large**: EC2 t3.large + RDS t3.medium = ~$95/month

**Note**: AWS Free Tier (first 12 months) includes:
- 750 hours/month of t3.micro EC2
- 750 hours/month of db.t2.micro RDS
- 20 GB storage

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs orderflowux --lines 50

# Check if port 5000 is in use
sudo netstat -tlnp | grep 5000

# Test build
cd ~/OrderFlowUX
npm run build
node dist/index.js  # Should start without errors
```

### SSE Not Working

1. **Check Nginx config**: Ensure `/api/events` location has proper SSE headers
2. **Check security group**: Ensure port 80/443 are open
3. **Check application logs**: `pm2 logs orderflowux`
4. **Test directly**: `curl http://localhost:5000/api/events` (should connect)

### Database Connection Issues

1. **Check DATABASE_URL** in `.env`
2. **Verify RDS security group** allows EC2 security group
3. **Test connection**: `psql $DATABASE_URL` (install: `sudo apt install postgresql-client`)

### High Memory Usage

```bash
# Check memory
free -h
pm2 monit

# If needed, upgrade instance type:
# 1. Create AMI of current instance
# 2. Launch new instance with larger type
# 3. Attach old IP to new instance (Elastic IP)
```

## Security Best Practices

1. ✅ **Use Security Groups**: Restrict SSH to your IP only
2. ✅ **Use SSL/HTTPS**: Set up Let's Encrypt
3. ✅ **Regular Updates**: `sudo apt update && sudo apt upgrade`
4. ✅ **Firewall**: Configure UFW (Ubuntu) or Security Groups
5. ✅ **SSH Keys**: Use key pairs, disable password auth
6. ✅ **Environment Variables**: Never commit `.env` to git
7. ✅ **Backup Strategy**: Regular database backups (RDS automated backups)
8. ✅ **Monitoring**: Set up CloudWatch alarms

## Scaling Options

### Vertical Scaling (Bigger Instance)
1. Create AMI snapshot
2. Stop instance
3. Change instance type
4. Start instance

### Horizontal Scaling (Multiple Instances)
1. Set up **Application Load Balancer (ALB)**
2. Create **Auto Scaling Group**
3. Use **RDS** for shared database
4. Use **ElastiCache** for shared session storage (if needed)

## Next Steps

1. ✅ Deploy to EC2
2. ✅ Set up domain and SSL
3. ✅ Configure monitoring
4. ✅ Set up automated backups
5. ✅ Create deployment automation
6. ✅ Test failover/scaling scenarios

Your SSE-powered application is now running on enterprise-grade AWS infrastructure! 🚀

