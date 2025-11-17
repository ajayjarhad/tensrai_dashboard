# SigNoz Observability Stack

This directory contains the Docker Compose setup for SigNoz observability platform for the Tensrai Dashboard.

## Services

- **OpenTelemetry Collector**: Receives telemetry data from applications
- **ClickHouse**: Time-series database for traces, metrics, and logs
- **Signoz Query Service**: API service for querying observability data
- **Signoz Frontend**: Web UI for visualizing traces and metrics
- **AlertManager**: Alerting and notification system
- **Redis**: Optional caching layer

## Quick Start

1. **Start the observability stack:**
   ```bash
   cd infra/signoz
   docker compose up -d
   ```

2. **Access the SignNoz UI:**
   - Frontend: http://localhost:3301
   - API: http://localhost:8080
   - Health check: http://localhost:3301/health

3. **Check service status:**
   ```bash
   docker compose ps
   ```

## Configuration

### OpenTelemetry Collector
- **gRPC endpoint**: `localhost:4317`
- **HTTP endpoint**: `localhost:4318`
- **Health check**: `http://localhost:13133`

### SignNoz Services
- **Frontend**: http://localhost:3301
- **Query Service API**: http://localhost:8080
- **ClickHouse**: localhost:9000
- **AlertManager**: http://localhost:9093

### Database Credentials
- **Database**: signoz
- **Username**: signoz
- **Password**: password

## Application Integration

### Backend OpenTelemetry Setup
Set the following in `backend/.env` (or your process env) before starting the API:

```env
# OpenTelemetry → SigNoz collector
OTEL_SERVICE_NAME=tensrai-backend
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
# Optional: send headers such as access tokens in a key=value,key2=value2 format
# OTEL_EXPORTER_OTLP_HEADERS=x-scope-orgID=tensrai
```

The backend auto-instrumentation kicks in through `src/otel.ts`, so no additional code changes are required.

### Frontend OpenTelemetry Setup (Optional)
For frontend instrumentation, use the OpenTelemetry Web SDK with the same collector endpoint.

## Stopping the Services

```bash
docker compose down
```

## Data Persistence

- **ClickHouse data**: Persistent in Docker volume `signoz-clickhouse-data`
- **Signoz storage**: Persistent in Docker volume `signoz-storage`
- **Redis data**: Persistent in Docker volume `signoz-redis-data`

## Troubleshooting

### Check Logs
```bash
docker-compose logs -f otel-collector
docker-compose logs -f signoz-query-service
docker-compose logs -f clickhouse
```

### Health Checks
```bash
# Collector health
curl http://localhost:13133/status

# ClickHouse ping
curl http://localhost:8123/ping

# Signoz API health
curl http://localhost:8080/api/v1/health
```

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Application    │───▶│  Otel Collector  │───▶│   ClickHouse    │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │  Signoz Query   │    │  Signoz Frontend│
                       │     Service      │    │        UI       │
                       └──────────────────┘    └─────────────────┘
```

## Monitoring and Alerting

### Metrics Available
- HTTP request latency and error rates
- Authentication events (login, logout, failed attempts)
- Database query performance
- System resource usage

### Dashboards to Create
1. **Authentication Dashboard**: Login attempts, success/failure rates
2. **User Activity Dashboard**: User creation, role changes
3. **Performance Dashboard**: API response times, error rates
4. **System Health Dashboard**: Database connectivity, service uptime

### Alert Rules (Recommended)
- High error rate (>5% for 5 minutes)
- Authentication failures (>10 per minute)
- Database connection failures
- High latency (>1s for API endpoints)

## Production Considerations

For production deployment:
1. Use environment-specific Docker Compose files
2. Configure persistent storage for data
3. Set up proper backup strategies for ClickHouse
4. Configure authentication for SignNoz UI
5. Set up external monitoring for the observability stack itself
6. Consider resource limits and scaling for high-volume deployments
