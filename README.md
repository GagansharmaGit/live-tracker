# Real-Time Location Tracking System (Kafka + OIDC + WebSockets)

A massively scalable, real-time location sharing application where authenticated users can broadcast their geolocation and view others moving on a map in real-time. This project uses Kafka to decouple high-throughput location updates from database persistence, ensuring the WebSocket server remains highly responsive.

## 🚀 Project Overview
This application demonstrates how modern tracking apps (like Uber, Zomato, or Strava) handle real-time geospatial data at scale. Instead of writing every coordinate update directly to a database, events are streamed to an Apache Kafka topic. One consumer group handles real-time socket broadcasting, while an independent consumer group asynchronously persists the data to SQLite.

## 🛠 Tech Stack
- **Backend**: Node.js, Express.js
- **Real-Time Communication**: Socket.IO
- **Event Streaming**: Apache Kafka (KafkaJS)
- **Database / Persistence**: SQLite3
- **Authentication**: OIDC / OAuth 2.0 (Custom Identity Provider)
- **Frontend Map**: Leaflet.js

## 🔀 Architecture & Event Flow

### 1. OIDC Auth Setup & Flow
1. User clicks "Login with Konoha OIDC".
2. The app redirects the user to the OIDC Identity Provider with an OAuth 2.0 Authorization Code flow request.
3. Upon successful login, the provider redirects back to `/auth/callback` with a `code`.
4. The backend exchanges the `code` for an `access_token`, fetches user information, and generates an `HttpOnly` JWT session cookie.
5. Sockets are only allowed to connect if they provide a valid session cookie.

### 2. Socket Event Flow
- The frontend (if authenticated) requests the device's Geolocation every 5 seconds.
- It emits a `client:location:update` event to the Socket.IO server.
- **Crucially**, the backend does *not* broadcast the event directly. Instead, it extracts the authenticated `userId` and `name` from the socket's verified session and publishes the event to Kafka.

### 3. Kafka Event Flow
- **Producer**: The WebSocket server acts as a Kafka Producer. It publishes `{ type: 'location', userId, name, lat, lng }` events to the `location-updates` topic. On disconnect, it publishes `{ type: 'disconnect', userId }`.
- **Consumer Group 1 (Socket Server)**: The Socket.IO server consumes the `location-updates` topic. When an event arrives, it emits `server:location:update` to all connected frontend clients so they can update the map markers.
- **Consumer Group 2 (Database Processor)**: A completely separate Node.js process (`database-processor.js`) consumes the *exact same* topic. It takes the events and runs heavy SQL `INSERT` operations into the `location_history.db` SQLite database.

> **Why Kafka?** Direct DB writes on every socket event are extremely expensive and can bottleneck the WebSocket server under high load. By streaming to Kafka, the socket server instantly offloads the event and returns to handling other users, while the database processor catches up at its own speed without affecting the live map experience.

## ⚙️ Setup Instructions

### Prerequisites
- Node.js (v18+)
- Docker & Docker Compose (for Kafka)
- An active OIDC Identity Provider (e.g., Konoha OIDC Service)

### 1. Environment Variables
Create a `.env` file in the root directory:
```env
PORT=8000
APP_URL=http://localhost:8000
OIDC_ISSUER=https://konoha-oidc-service.onrender.com
OIDC_CLIENT_ID=your_client_id_here
OIDC_CLIENT_SECRET=your_client_secret_here
SESSION_SECRET=a_very_secure_random_string_for_jwt
```

### 2. Start Kafka
Start the local Kafka cluster using the provided Docker Compose file:
```bash
docker-compose up -d
```
Wait a few moments for Kafka to fully initialize.

### 3. Install Dependencies
```bash
pnpm install
```

### 4. Create Kafka Topics
Initialize the necessary topics on your Kafka cluster:
```bash
node kafka-admin.js
```

### 5. Run the Application
You need to run both the web server and the database processor.
Open two terminals:

**Terminal 1 (Web & Socket Server):**
```bash
node index.js
```

**Terminal 2 (Database Processor):**
```bash
node database-processor.js
```

Visit `http://localhost:8000` in your browser.

## ⚠️ Assumptions and Limitations
- **Kafka Setup**: Assumes Kafka is running locally on port `9092` as configured in `kafka-client.js`.
- **Geolocation API**: Browsers restrict Geolocation API usage on insecure contexts. Ensure you test via `http://localhost` or a valid `https` domain.
- **User Disconnects**: If a user forcefully closes the browser, the socket disconnects and a disconnect event is published. However, as an extra safeguard, the frontend implements a stale marker cleanup that removes markers not updated within 30 seconds.

## 🎥 Submission Demo
- **Demo Video (YouTube Unlisted)**: [youtube video]https://www.youtube.com/watch?v=LgmcCeDBky8
- **Public GitHub Repository**: [Codebase]https://github.com/GagansharmaGit/live-tracker
