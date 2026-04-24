# KytePDF ECS (EC2) Gateway via Pulumi

This stack deploys the LibreOffice + OCR gateway on ECS using a single EC2 instance (free-tier friendly).

## Prereqs

- AWS account with default VPC available.
- Pulumi CLI installed.
- Docker installed locally (used to build/push the image).
- AWS credentials configured in your shell.

## Quick Start

```bash
cd infra
npm install
pulumi stack init dev
pulumi config set aws:region us-east-1
pulumi config set serviceName kytepdf-gateway
pulumi config set allowCidr 0.0.0.0/0
pulumi config set --secret apiKey YOUR_SHARED_KEY
pulumi up
```

Pulumi will output `publicUrl`. Use that for `VITE_CLOUD_GATEWAY_URL`.

## Config Options

- `serviceName` (string, default `kytepdf-gateway`)
- `containerPort` (number, default `8080`)
- `instanceType` (string, default `t3.micro`)
- `allowCidr` (string, default `0.0.0.0/0`)
- `maxFileSizeMb` (number, default `50`)
- `apiKey` (secret string, optional)
- `corsOrigin` (string, default `*`)

## Free-Tier Notes

- ECS itself is free, but EC2 is only free within AWS Free Tier limits (typically 750 hours of t3.micro for 12 months).
- LibreOffice + OCR can exceed 1GB RAM. If conversions OOM, bump `instanceType` to `t3.small` (not free-tier).
- To avoid load balancer costs, this stack exposes the service directly on the EC2 public IP.

## Frontend Env

Set these in your app `.env`:

```
VITE_CLOUD_GATEWAY_URL=http://<public-ip>:8080/convert
VITE_CLOUD_GATEWAY_API_KEY=YOUR_SHARED_KEY
```
