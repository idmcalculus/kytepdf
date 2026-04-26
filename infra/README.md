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
pulumi config set --secret apiKey YOUR_SHARED_KEY
pulumi config set corsOrigin https://kytepdf.com
pulumi config set certificateArn arn:aws:acm:REGION:ACCOUNT_ID:certificate/CERTIFICATE_ID
pulumi up
```

Pulumi will output an HTTPS `publicUrl` backed by an Application Load Balancer. Route your
production DNS name to the ALB and use that URL through a backend-for-frontend or server-side API
gateway. Do not put the shared gateway key in the frontend bundle.

## Config Options

- `serviceName` (string, default `kytepdf-gateway`)
- `containerPort` (number, default `8080`)
- `instanceType` (string, default `t3.micro`)
- `allowCidr` (string, default `0.0.0.0/0`)
- `maxFileSizeMb` (number, default `50`)
- `apiKey` (required secret string)
- `corsOrigin` (required string, e.g. `https://kytepdf.com`)
- `certificateArn` (required ACM certificate ARN for HTTPS)

## Free-Tier Notes

- ECS itself is free, but EC2 is only free within AWS Free Tier limits (typically 750 hours of t3.micro for 12 months).
- LibreOffice + OCR can exceed 1GB RAM. If conversions OOM, bump `instanceType` to `t3.small` (not free-tier).
- The instance security group only accepts gateway traffic from the ALB security group. The public
  URL is HTTPS; HTTP requests are redirected to HTTPS.

## Frontend Env

Set only the gateway URL in the app `.env` if the frontend talks to a same-origin BFF:

```
VITE_CLOUD_GATEWAY_URL=https://api.kytepdf.com/convert
```
