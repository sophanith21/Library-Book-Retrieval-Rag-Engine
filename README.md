# Library Book Retrieval RAG Engine (LBRE: Ly-Bree)

A scalable, microservices-driven digital library and Retrieval-Augmented Generation (RAG) search engine built with **NestJS**, **RabbitMQ**, **PostgreSQL (PgVector)**, **SeaweedFS (S3)**, **React/Vite**, and **Grafana OpenTelemetry (LGTM)**.

---

## 🏛️ System Architecture

```
                       Client Browser
                             │
                             ▼
                      [Edge Gateway] (Nginx :80)
                       │           │           │
           (Static / UI Route)     │      (Monitoring)
                       │      (API Route)      │
                       ▼           ▼           ▼
                  [UI Server] [API Gateway] [Grafana]
             (Vite npm run dev)  (:3000)   (otel-lgtm)
                                   │
       ┌───────────────────────────┴───────────────────────────┐
       │                                                       │
       │  [Authentication]        [Book Service] ◄────────┐    │
       │  (admin/student)         (Read & Add)            │    │
       │                                                  │    │
       │  [Indexing Service]      [RabbitMQ]              │    │
       │  (BM25 + Dense)          (Event Bus)             │    │
       │                                                  │    │
       │  [LLM Service]           [Retrieval Service]     │    │
       │  (RAG Synthesis)         (RRF Fusion)            │    │
       │                                                  │    │
       │  [PostgreSQL DB]         [Object Storage]        │    │
       │  (PgVector Vector DB)    [Database (SeaweedFS)] ─┘    │
       └───────────────────────────────────────────────────────┘
```

---

## 🛠️ Development Workflow

The project is structured specifically for team development:
1. **All backend microservices, databases, event broker, monitoring, and the Edge Gateway run in Docker containers**.
2. **The frontend runs locally on the host using `npm run dev`** to enable instant Hot Module Replacement (HMR), source maps, and browser developer tools (React DevTools, Vite debuggers).
3. **Frontend API requests route through the Edge Proxy (`:80`) to the containerized backend**.

```
[Browser + React DevTools] 
         │
         ├───> http://localhost:5173 (Host Vite Dev Server with HMR)
         │           │
         │           └─── [Proxy /api] ───┐
         │                                ▼
         └─────────────> [Edge Gateway: Port 80 (Nginx)]
                                 │
                                 └───> [api-gateway:3000 (Docker Container)]
                                              │
                                              └───> [RabbitMQ Microservices (Docker Containers)]
```

---

## 🚀 Step-by-Step Local Setup Guide

### 1. Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org/) (v20+ or v22+) & `npm`
- [Python 3.10+](https://www.python.org/) (optional, for crawlers/ingestion scripts)

### 2. Environment Configuration
Copy the template `.env.example` file to `.env`:
```bash
cp .env.example .env
cp .env.example backend/.env
```

### 3. Install Dependencies
Install dependencies on your host machine for development tooling and IDE autocompletion:
```bash
# Install frontend packages
cd frontend && npm install && cd ..

# Install backend packages
cd backend && npm install && cd ..
```

### 4. Start the Containerized Backend & Infrastructure
From the project root directory, run:
```bash
docker compose up -d
```
This spins up:
- **`edge-gateway`**: Nginx proxy on `http://localhost:80`
- **`api-gateway`**: HTTP entrypoint container on port 3000
- **`auth`**: Authentication microservice container (RabbitMQ)
- **`book`**: Book microservice container (RabbitMQ + SeaweedFS)
- **`indexing`**: Indexing microservice container (RabbitMQ + PgVector)
- **`retrieval`**: Hybrid retrieval microservice container (RabbitMQ + RRF)
- **`llm`**: LLM synthesis microservice container (RabbitMQ)
- **`postgres`**: PostgreSQL 17 + PgVector container (`:5432`)
- **`seaweedfs`**: S3-compatible storage container (`:8333`, `:9333`)
- **`rabbitmq`**: RabbitMQ message broker container (`:5672`, `:15672`)
- **`otel-lgtm`**: Grafana OpenTelemetry stack container (`:3001`, `:4317/4318`)

*Note: All backend services run in watch mode (`nest start <app> --watch`). When you edit code in `backend/apps/<your-service>`, the container immediately hot-reloads automatically.*

### 5. Start the Frontend
In a new terminal window:
```bash
cd frontend
npm run dev
```

### 6. Open in Browser
- **Frontend App**: [http://localhost:5173](http://localhost:5173) (Use this for development with React DevTools and Vite HMR).
  - All `/api/*` requests from the frontend are automatically routed through the Edge Proxy (`http://localhost:80/api/*`) $\rightarrow$ API Gateway $\rightarrow$ backend microservices.
- **Edge Gateway Directly**: [http://localhost](http://localhost) (Proxies to your host Vite dev server with WebSocket HMR support).

---

## 💾 Volume Strategy: Local Dev vs. Production

### Local Development (`docker-compose.yml` & `Dockerfile.dev`)
In local development, all backend microservices share a single **named volume** (`backend_node_modules`):
```yaml
volumes:
  - ./backend:/app
  - backend_node_modules:/app/node_modules
```

**Why this is used for local dev:**
1. **Prevents Orphan Volumes**: Replaces anonymous volumes (`- /app/node_modules`), preventing Docker from littering your disk with untracked anonymous volume directories on container recreation.
2. **Protects Linux Container Binaries**: Keeps container-compiled Linux binaries (e.g., native dependencies) inside `backend_node_modules` so they aren't overwritten by host-OS `node_modules` when mounting `./backend:/app`.
3. **Monorepo Efficiency**: Because all 6 NestJS microservices share the same monorepo root package tree, a single named volume avoids duplicating 6 separate copies of `node_modules` in dev.

### Production Builds (`Dockerfile`)
**In production, this named volume is NOT used.** Each microservice is packaged into an independent, minimal, self-contained Docker image using multi-stage builds:
```bash
# Example: Building production image for the Book service
docker build -f backend/Dockerfile --build-arg APP=book -t lbre-book:latest ./backend
```

**How production builds work:**
1. **Isolated Stage**: The build stage compiles **only** the target app (`npx nest build ${APP}`).
2. **Production-Only Dependencies**: The final lightweight runtime image installs only runtime dependencies (`npm ci --omit=dev`).
3. **Tree-Shaken Code**: The final image copies only `dist/apps/${APP}` and contains **zero volume mounts** or host overlays. Each microservice container runs strictly with the code and packages it needs.

---

## 📊 Endpoints & Dashboards

| Service / Dashboard | URL | Credentials / Notes |
| :--- | :--- | :--- |
| **Frontend UI (Dev Server)** | [http://localhost:5173](http://localhost:5173) | Host Vite dev server with React DevTools |
| **Edge Gateway (Unified Entry)**| [http://localhost](http://localhost) | Nginx edge proxy |
| **API Gateway (HTTP)** | [http://localhost:3000](http://localhost:3000) or `/api/` | REST HTTP entrypoint |
| **RabbitMQ Management** | [http://localhost:15672](http://localhost:15672) | `guest` / `guest` |
| **SeaweedFS S3 Storage** | [http://localhost:8333](http://localhost:8333) | Access Key: `devaccess`, Secret: `devsecret` |
| **Grafana Monitoring** | [http://localhost:3001](http://localhost:3001) or `/monitoring/` | `admin` / `admin` |

---

## 👥 Group Project Ownership & Working on Microservices

Each group member owns their assigned microservice in `backend/apps/<service>`:
- **`backend/apps/api-gateway`**: HTTP controllers, request routing to RabbitMQ clients.
- **`backend/apps/auth`**: Student/Admin authentication, user registration, JWT validation.
- **`backend/apps/book`**: Book CRUD, SeaweedFS S3 upload/download.
- **`backend/apps/indexing`**: Chapter chunking, sparse BM25 inverted index, dense vector embeddings (`BAAI/bge-small-en-v1.5`).
- **`backend/apps/retrieval`**: Sparse BM25 + Dense PgVector similarity search + Reciprocal Rank Fusion (RRF).
- **`backend/apps/llm`**: RAG synthesis with top 5 fused chunks via local Ollama / LLaMA.
- **`frontend`**: React components, search interface, citations view, dev tools.

### Useful Commands for Daily Development

```bash
# View live logs for your specific microservice
docker compose logs -f book
docker compose logs -f auth
docker compose logs -f api-gateway

# Restart a specific service
docker compose restart book

# Rebuild container images if you update backend package.json
docker compose build

# Stop all containers
docker compose down

# Stop and wipe database data / volumes (clean slate)
docker compose down -v
```

Shared contracts and message patterns are defined in [backend/libs/contracts](file:///home/user/Library-Book-Retrieval-Rag-Engine/backend/libs/contracts/src/index.ts) as the common API interface between microservices.
