const http = require('http');
const app = require('./app');
const config = require('./config/env');
const connectDB = require('./config/db');
const setupSockets = require('./sockets');

const startServer = async () => {
  await connectDB();

  const server = http.createServer(app);
  setupSockets(server);

  server.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
