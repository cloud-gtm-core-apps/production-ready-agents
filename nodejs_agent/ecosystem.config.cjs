const path = require('path');
require('dotenv').config(); // Load .env file

module.exports = {
    apps: [{
        name: 'api',
        interpreter: 'node',
        script: path.join(__dirname, 'dist', 'index.js'),
        instances: 1,
        exec_mode: 'fork',
        env: {
            NODE_ENV: 'production',
            PORT: process.env.PORT || 5000,
            DATABASE_URL: process.env.DATABASE_URL,
            SESSION_SECRET: process.env.SESSION_SECRET,
            // Add any other environment variables your app needs
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: process.env.PORT || 5000,
            DATABASE_URL: process.env.DATABASE_URL,
            SESSION_SECRET: process.env.SESSION_SECRET,
        },
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s',
        watch: false,
        ignore_watch: ['node_modules', 'logs', 'dist']
    }]
};

