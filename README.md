# 🎬 Watch Party

A real-time Watch Party application that allows multiple users to watch YouTube videos together in synchronized playback. The application supports room-based collaboration, live chat, host controls, participant management, and seamless synchronization using WebSockets.

---

## 🚀 Live Demo

### Frontend
> https://watch-party-lyart-ten.vercel.app/

### Backend
> https://watch-party-dv20.onrender.com

---

## ✨ Features

### 👥 Room Management
- Create a new watch room
- Join existing rooms using Room ID
- Automatic room cleanup
- Disconnect grace period
- Automatic host transfer when the current host leaves

### 🎥 Video Synchronization
- Shared YouTube video playback
- Play / Pause synchronization
- Seek synchronization
- Real-time playback state updates
- New participants receive the latest playback state instantly

### 💬 Live Chat
- Real-time messaging
- Username-based chat
- Message validation
- Instant broadcasting using Socket.IO

### 👤 Participant Management
- Live participant list
- Online / Offline tracking
- Host and Participant roles
- Automatic participant updates

### ⚡ Real-time Communication
- WebSocket powered communication
- Low latency synchronization
- Event-based architecture

---

# 🛠 Tech Stack

## Frontend

- React.js
- Vite
- Tailwind CSS
- Socket.IO Client
- Axios

## Backend

- Node.js
- Express.js
- Socket.IO
- REST API

## Deployment

- Vercel (Frontend)
- Render (Backend)

## Load Testing

- Artillery

---

# 📂 Project Structure

```
Watch-Party
│
├── frontend
│   ├── src
│   ├── components
│   ├── pages
│   └── context
│
├── backend
│   ├── controllers
│   ├── services
│   ├── models
│   ├── routes
│   ├── sockets
│   ├── utils
│   └── config
│
└── load-test
```

---

# 🔄 Application Flow

```
User

↓

Create Room

↓

REST API

↓

Room Created

↓

Join Room

↓

Socket Connection

↓

Room State

↓

Live Chat

↓

Video Synchronization

↓

Participant Updates

↓

Disconnect
```

---

# ⚙️ Installation

## Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
```

## Install Dependencies

### Frontend

```bash
cd frontend
npm install
```

### Backend

```bash
cd backend
npm install
```

---

# ▶️ Run Locally

## Backend

```bash
npm run dev
```

## Frontend

```bash
npm run dev
```

---

# 🔑 Environment Variables

## Backend (.env)

```env
PORT=4000

CLIENT_URL=http://localhost:5173
```

---

## Frontend (.env)

```env
VITE_API_BASE_URL=http://localhost:4000/api

VITE_SOCKET_URL=http://localhost:4000
```

---

# 📡 REST APIs

| Method | Endpoint | Description |
|---------|----------|-------------|
| POST | /api/rooms | Create Room |
| POST | /api/rooms/:roomId/join | Join Room |
| GET | /api/rooms/:roomId | Get Room Details |
| GET | /api/health | Health Check |

---

# 🔌 Socket Events

## Client Events

- join_room
- leave_room
- send_message
- play
- pause
- seek
- change_video
- time_sync

---

## Server Events

- room_state
- sync_state
- user_joined
- user_left
- participants_updated
- host_changed
- new_message
- error_event

---

# 🧪 Load Testing

Load testing was performed using **Artillery**.

### Test Configuration

- Pre-created Rooms: **100**
- Total Virtual Users: **7800**
- Failed Users: **0**
- Average Session Duration: **7.5 seconds**

The application successfully handled all simulated users without failures while maintaining stable WebSocket connections.

---

# 📸 Screenshots

Add screenshots of:

- Home Page
- Create Room
- Join Room
- Chat
- Watch Party
- Load Testing Result

---

# 📹 Demo

(Optional)

Include a short demonstration video showing:

- Room Creation
- Joining Room
- Video Synchronization
- Live Chat
- Host Transfer

---

# 👨‍💻 Author

**Ankit Pandey**

GitHub:
https://github.com/Ankitpandey860

LinkedIn:
https://www.linkedin.com/in/ankit-pandey-042116325/