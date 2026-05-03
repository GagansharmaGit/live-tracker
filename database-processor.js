import { kafkaClient } from './kafka-client.js';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('./location_history.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS location_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,
    user_id TEXT,
    name TEXT,
    latitude REAL,
    longitude REAL,
    timestamp INTEGER
  )
`);

const insertStmt = db.prepare(`
  INSERT INTO location_events (event_type, user_id, name, latitude, longitude, timestamp) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

async function init() {
  const kafkaConsumer = kafkaClient.consumer({
    groupId: `database-processor`,
  });
  await kafkaConsumer.connect();

  await kafkaConsumer.subscribe({
    topics: ['location-updates'],
    fromBeginning: true,
  });

  kafkaConsumer.run({
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const data = JSON.parse(message.value.toString());
      
      try {
        insertStmt.run(
          data.type, 
          data.userId, 
          data.name, 
          data.latitude || null, 
          data.longitude || null, 
          data.timestamp || Date.now()
        );
        console.log(`[DB Insert]: User ${data.name} - ${data.type}`);
      } catch (err) {
        console.error("DB Insert Error", err);
      }

      await heartbeat();
    },
  });
}

init();
