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
                   (Frontend)    (:3000)   (otel-lgtm)
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

## 🔍 Retrieval & RAG Pipeline Flow

1. **Data Retrieval & Ingestion**:
   - `crawler.py` & `downloader.py` crawl and download EPUB books from standard repositories.
   - `ingest.py` parses each book into `title`, `author`, `cover_url`, and `chapters: [{chapter_no, chunk[]}]`.
   - Stores raw book files and cover thumbnails in **SeaweedFS (S3)** and registers metadata in **PostgreSQL**.

2. **Sparse Indexing & Retrieval**:
   - Inverted index using **BM25 / TF-IDF** scoring over chapter chunks.
   - Output: Sparse ranked chunk list `[(chunk_0, rank=1), (chunk_8, rank=2), ...]`.

3. **Dense Indexing & Retrieval (Vector Embeddings)**:
   - Encodes text chunks into dense vector embeddings using **`BAAI/bge-small-en-v1.5`** (384 dimensions).
   - Indexed via **HNSW Graph Index** in PostgreSQL with `pgvector` for fast cosine similarity search.
   - Output: Dense ranked chunk list `[(chunk_K, rank=1), (chunk_A, rank=2), ...]`.

4. **Reciprocal Rank Fusion (RRF)**:
   - Merges Sparse and Dense ranked candidate lists using Reciprocal Rank Fusion:
     $$\text{RRF\_Score}(d) = \sum_{m \in \{\text{sparse}, \text{dense}\}} \frac{1}{k + \text{rank}_m(d)} \quad (k = 60)$$

5. **Dual Output Stream**:
   - **RAG Overview**: Top 5 fused chunks are fed to the **LLM Service** (local Ollama / LLaMA) to synthesize an academic overview with citations.
   - **Deduplicated Search Results**: Deduplicated by `book_id` (keeping the highest-ranked chunk snippet per book) to provide clean book search result cards.

---

## 📦 Service Breakdown

| Service | Technology | Port | Description |
| :--- | :--- | :--- | :--- |
| **`edge-gateway`** | Nginx Reverse Proxy | `80` | Entrypoint routing `/` to Frontend, `/api/` to API Gateway, and `/monitoring/` to Grafana |
| **`frontend`** | React + Vite + TS | `5173` (internal `80`) | Library Book Retrieval Engine (LBRE) Web UI |
| **`api-gateway`** | NestJS HTTP Gateway | `3000` | REST API orchestrating inter-service RPC via RabbitMQ |
| **`auth`** | NestJS Microservice | Internal (RMQ) | Handles registration, login, and JWT/token validation (admin/student) |
| **`book`** | NestJS Microservice | Internal (RMQ) | Handles book CRUD and object storage interactions with SeaweedFS S3 |
| **`indexing`** | NestJS Microservice | Internal (RMQ) | Chunks chapters, builds sparse inverted index and generates dense embeddings |
| **`retrieval`** | NestJS Microservice | Internal (RMQ) | Executes BM25 sparse search + PgVector HNSW dense search + RRF ranking |
| **`llm`** | NestJS Microservice | Internal (RMQ) | Synthesizes grounded AI overviews using local Ollama / LLaMA models |
| **`rabbitmq`** | RabbitMQ 3 Management | `5672`, `15672` | Asynchronous message broker and event bus |
| **`postgres`** | PostgreSQL 17 + PgVector | `5432` | Relational storage for auth/books and vector storage for `knowledge.chunks` |
| **`seaweedfs`** | SeaweedFS S3 Storage | `8333`, `9333` | S3-compatible object storage for EPUB books and covers |
| **`otel-lgtm`** | Grafana LGTM Stack | `3001` (UI), `4317/4318` | OpenTelemetry monitoring (Loki, Grafana, Tempo, Mimir) |

---

## 🚀 Quickstart with Docker Compose

### Prerequisites
- Docker & Docker Compose installed.

### 1. Start All Services
```bash
docker compose up --build -d
```

### 2. Verify Running Services
```bash
docker compose ps
```

### 3. Access Endpoints
- **LBRE Web Interface**: [http://localhost](http://localhost) (via Edge Gateway)
- **API Gateway**: [http://localhost:3000](http://localhost:3000) or [http://localhost/api/](http://localhost/api/)
- **RabbitMQ Management Dashboard**: [http://localhost:15672](http://localhost:15672) (User: `guest` / `guest`)
- **SeaweedFS S3 Interface**: [http://localhost:8333](http://localhost:8333)
- **Grafana Monitoring Dashboard**: [http://localhost:3001](http://localhost:3001) or [http://localhost/monitoring/](http://localhost/monitoring/) (User: `admin` / `admin`)

---

## 💻 Local Development (Without Full Docker)

If you prefer developing individual services locally on your host machine:

### 1. Start Infrastructure Dependencies
```bash
docker compose up -d postgres rabbitmq seaweedfs
```

### 2. Run Backend Services
```bash
cd backend

# Install dependencies (already installed)
npm install

# Run the API Gateway
npm run start:dev api-gateway

# In separate terminals, run the microservices
npm run start:dev book
npm run start:dev auth
npm run start:dev indexing
npm run start:dev retrieval
npm run start:dev llm
```

### 3. Run Frontend
```bash
cd frontend
npm run dev
# Open http://localhost:5173
```

---

## 📚 Book Ingestion Pipeline

### 1. Download EPUB Books
`epub_links.json` already contains 1,000 verified links from Standard Ebooks.

```bash
# Download sample or catalog epubs
python3 downloader.py
```

### 2. Ingest & Index Books
Run the unified ingestion script to parse chapters, upload files to SeaweedFS, register metadata, and compute embeddings:

```bash
# Ingest downloaded EPUBs
python3 ingest.py --dir downloads_epubs

# Or test parsing a single EPUB without network upload (Dry-run)
python3 ingest.py --file path/to/book.epub --dry-run
```

---

## 📡 API Gateway Endpoints Reference

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health status check |
| `GET` | `/books` | List all available books |
| `GET` | `/books/:id` | Get book metadata by ID |
| `POST` | `/books` | Register a new book |
| `POST` | `/auth/register` | Register a new student or admin user |
| `POST` | `/auth/login` | Authenticate user and receive access token |
| `GET` | `/search?q=:query` | Unified Hybrid RAG Search (BM25 + Vector HNSW + RRF + LLM Overview) |
| `POST` | `/indexing` | Submit chapters and chunks for indexing |

---

## 🧪 Testing

```bash
# Run unit tests
cd backend && npm run test

# Build all microservices
npx nest build api-gateway && npx nest build book && npx nest build auth && npx nest build indexing && npx nest build retrieval && npx nest build llm
```
