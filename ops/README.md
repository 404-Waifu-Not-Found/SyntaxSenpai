# Operations

This repo now includes a deployable runtime service focused on production operations for SyntaxSenpai:

- health and readiness probes
- Prometheus metrics
- Grafana dashboard provisioning
- JSON backup export and restore for chats and memories
- Docker and Docker Compose support
- Kubernetes manifests with HPA and backup CronJob
- manifest-based tool plugins

## Local stack

Run the runtime with monitoring:

```bash
docker compose up --build
```

Endpoints:

- Runtime API: `http://localhost:8787`
- Health: `http://localhost:8787/healthz`
- Readiness: `http://localhost:8787/readyz`
- Metrics: `http://localhost:8787/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` with `admin` / `admin`

## Backup API

Create a backup:

```bash
curl -X POST http://localhost:8787/api/v1/backups/export \
  -H 'Content-Type: application/json' \
  -d '{"reason":"manual-backup"}'
```

List backups:

```bash
curl http://localhost:8787/api/v1/backups
```

Restore a backup:

```bash
curl -X POST http://localhost:8787/api/v1/backups/restore \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"backup-2026-01-01T00-00-00-000Z.json"}'
```

## Plugin system

Tool plugins live under `plugins/`. Each plugin must have a `plugin.json` manifest and an entry module that exports `activate({ manifest, registerTool })`.

The example plugin at `plugins/echo-tool` shows the expected shape.

## Kubernetes

Base manifests are in `infra/k8s/base` and the production overlay is in `infra/k8s/overlays/production`.

Deploy manually:

```bash
kubectl apply -k infra/k8s/overlays/production
```
