# Trading Dashboard

Real-time trading dashboard that provides visibility into virtual trades, family scores, signal explanations, and wallet status.

## Architecture

```
tradingDashboard/
├── backend/                 # Spring Boot backend
│   └── src/main/java/com/kotsin/dashboard/
│       ├── config/         # WebSocket, Kafka, CORS configuration
│       ├── controller/     # REST API endpoints
│       ├── kafka/          # Kafka consumers (bridge to WebSocket)
│       ├── service/        # Business logic
│       └── websocket/      # WebSocket handlers
└── frontend/               # React + TypeScript frontend
    └── src/
        ├── components/     # Reusable UI components
        ├── hooks/          # Custom React hooks (useWebSocket)
        ├── pages/          # Page components
        ├── services/       # API service layer
        ├── store/          # Zustand state management
        └── types/          # TypeScript type definitions
```

## Features

- **Wallet Dashboard**: View capital, P&L, open positions, win rate
- **Active Positions**: Real-time position tracking with entry/SL/target levels
- **Trade History**: Complete trade log with R-multiple analysis
- **Family Scores**: Live scores from StreamingCandle module
- **Signal Feed**: Real-time signal stream with pass/reject status
- **Stock Detail**: Deep dive into any stock's score breakdown

## Running the Application

### Prerequisites

- Java 17+
- Node.js 18+
- MongoDB running on localhost:27017
- Kafka running on localhost:9092
- StreamingCandle and TradeExecutionModule running

### Backend

```bash
cd backend
mvn spring-boot:run
```

Backend runs on `http://localhost:8085`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wallet` | GET | Current wallet state |
| `/api/wallet/positions` | GET | All positions |
| `/api/trades` | GET | Trade history |
| `/api/trades/stats` | GET | Trade statistics |
| `/api/scores` | GET | All current scores |
| `/api/scores/{scripCode}` | GET | Score for specific stock |
| `/api/scores/{scripCode}/explain` | GET | Detailed score explanation |
| `/api/signals` | GET | Paginated signal history |

## WebSocket Channels

| Channel | Data |
|---------|------|
| `/topic/wallet` | Wallet updates |
| `/topic/scores` | Score updates for all stocks |
| `/topic/scores/{scripCode}` | Score updates for specific stock |
| `/topic/signals` | New curated signals |
| `/topic/trades` | Trade status updates |
| `/topic/regime` | Index regime changes |
| `/topic/notifications` | System notifications |

## Kafka Topics Consumed

- `family-candle-*`: Family candle data from StreamingCandle
- `trading-signals-curated`: Curated signals from StreamingCandle
- `trade-outcomes`: Trade outcomes from TradeExecutionModule
- `regime-index-output`: Regime data from StreamingCandle

## Configuration

Backend configuration in `backend/src/main/resources/application.properties`:

```properties
server.port=8085
spring.data.mongodb.uri=mongodb://localhost:27017/kotsin_trading
spring.kafka.bootstrap-servers=localhost:9092
```

Frontend proxy configuration in `frontend/vite.config.ts` proxies `/api` and `/ws` to backend.

