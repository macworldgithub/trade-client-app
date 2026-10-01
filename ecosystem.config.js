module.exports = {
  apps: [
    {
      name: 'trade-client-backend',
      script: './dist/main.js',
      instances: 'max', // Utilizes all available CPU cores, or set to 1 or 2
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Logs configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 5000, // Wait up to 5s for graceful shutdown
      listen_timeout: 8000,
    },
  ],
};
