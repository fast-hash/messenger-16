const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const config = require('./config/env');
const authRoutes = require('./routes/auth');
const chatsRoutes = require('./routes/chats');
const attachmentsRoutes = require('./routes/attachments');
const messagesRoutes = require('./routes/messages');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const devicesRoutes = require('./routes/devices');
const errorHandler = require('./middleware/error');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api', attachmentsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/devices', devicesRoutes);

app.use(errorHandler);

module.exports = app;
