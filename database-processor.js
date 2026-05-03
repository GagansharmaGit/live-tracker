import { kafkaClient } from './kafka-client.js';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('./location_history.db');

// Initialize table
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
        // Re-preparing inside the loop prevents the "statement finalized" issue 
        // that occurs in node:sqlite (experimental) if a previous run had a conflict or state change.
        const stmt = db.prepare(`
          INSERT INTO location_events (event_type, user_id, name, latitude, longitude, timestamp) 
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
          data.type, 
          data.userId, 
          data.name, 
          data.latitude || null, 
          data.longitude || null, 
          data.timestamp || Date.now()
        );
        
        console.log(`[DB Insert]: User ${data.name} - ${data.type}`);
      } catch (err) {
        console.error("DB Insert Error:", err.message);
      }

      await heartbeat();
    },
  });
}

init().catch(console.error);
