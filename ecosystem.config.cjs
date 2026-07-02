// pm2 process definitions for the VPS deploy. .cjs because package.json has
// "type": "module" and pm2's own config loader expects CommonJS here.
module.exports = {
  apps: [
    {
      name: 'cats-api',
      script: 'server.js',
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'cats-bot',
      script: 'bot-start.js',
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
