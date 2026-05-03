import http from 'node:http';
import path from 'node:path';
import 'dotenv/config';

import express from 'express';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import cookie from 'cookie';
import { jwtVerify } from 'jose';

import { kafkaClient } from './kafka-client.js';
import authRoutes from './auth.routes.js';

async function main() {
  const PORT = process.env.PORT ?? 8000;

  const app = express();
  app.use(cookieParser());
  app.use('/auth', authRoutes);

  const server = http.createServer(app);
  const io = new Server();

  const kafkaProducer = kafkaClient.producer();
  await kafkaProducer.connect();

  const kafkaConsumer = kafkaClient.consumer({
    groupId: `socket-server-${PORT}`,
  });
  await kafkaConsumer.connect();

  await kafkaConsumer.subscribe({
    topics: ['location-updates'],
    fromBeginning: true,
  });

  kafkaConsumer.run({
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const data = JSON.parse(message.value.toString());
      
      if (data.type === 'location') {
        io.emit('server:location:update', data);
      } else if (data.type === 'disconnect') {
        io.emit('server:user:disconnect', data);
      }
      
      await heartbeat();
    },
  });

  io.attach(server);

  const SESSION_SECRET = process.env.SESSION_SECRET || "secret_key_123";

  io.use(async (socket, next) => {
    try {
      const cookiesStr = socket.request.headers.cookie;
      if (cookiesStr) {
        const cookies = cookie.parse(cookiesStr);
        const token = cookies.session_token;
        if (token) {
          const { payload } = await jwtVerify(token, new TextEncoder().encode(SESSION_SECRET));
          socket.user = { id: String(payload.sub), name: String(payload.name) };
          return next();
        }
      }
    } catch (err) {}
    next(new Error("Authentication error"));
  });

  io.on('connection', (socket) => {
    console.log(`[Socket:${socket.id} (User: ${socket.user.name})]: Connected Success...`);

    socket.on('client:location:update', async (locationData) => {
      const { latitude, longitude } = locationData;
      
      await kafkaProducer.send({
        topic: 'location-updates',
        messages: [{
          key: socket.user.id,
          value: JSON.stringify({ 
            type: 'location',
            userId: socket.user.id, 
            name: socket.user.name, 
            latitude, 
            longitude,
            timestamp: Date.now()
          }),
        }],
      });
    });

    socket.on('disconnect', async () => {
      console.log(`[User:${socket.user.name}]: Disconnected`);
      await kafkaProducer.send({
        topic: 'location-updates',
        messages: [{
          key: socket.user.id,
          value: JSON.stringify({ 
            type: 'disconnect',
            userId: socket.user.id,
            name: socket.user.name,
            timestamp: Date.now()
          }),
        }],
      });
    });
  });

  app.use(express.static(path.resolve('./public')));

  app.get('/health', (req, res) => {
    return res.json({ healthy: true });
  });

  server.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`),
  );
}

main();
