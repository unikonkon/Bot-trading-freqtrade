// pm2 — รันบอทสัญญาณเป็น process เดียวค้างไว้
//   npm i -g pm2
//   pm2 start signal-bot/deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup      # ให้กลับมารันเองหลัง reboot
//   pm2 logs signal-bot
module.exports = {
  apps: [
    {
      name: "signal-bot",
      cwd: __dirname + "/../..",          // root ของ repo (มี node_modules และ lib/)
      script: "node_modules/.bin/tsx",
      args: "signal-bot/index.ts",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      kill_timeout: 8000,          // ให้เวลาส่งข้อความ "หยุดทำงาน" ก่อนถูกฆ่า
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
      out_file: "signal-bot/logs/signal-bot.out.log",
      error_file: "signal-bot/logs/signal-bot.err.log",
      time: true,
    },
  ],
};
