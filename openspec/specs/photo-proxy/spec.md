# photo-proxy Specification

## Purpose

TBD - created by archiving change 'lunch-photo-push-service'. Update Purpose after archive.

## Requirements

### Requirement: Server-side photo fetch

WHEN a client requests `GET /api/photo/{dishId}`, the system SHALL fetch the corresponding image from the source API server-to-server and SHALL return it to the client with the correct `Content-Type` header.

#### Scenario: Valid dishId returns image

- **WHEN** a client requests `GET /api/photo/{dishId}` for a `dishId` that has an uploaded photo
- **THEN** the system SHALL return the image binary with a `Content-Type` header matching the image's actual format

---
### Requirement: Edge caching of fetched photos

The system SHALL cache successfully fetched photos at the edge with a long-lived `Cache-Control` (at least 30 days), keyed by `dishId`.

#### Scenario: Repeated request served from cache

- **WHEN** a client requests `GET /api/photo/{dishId}` for a `dishId` that was already fetched and cached within the cache window
- **THEN** the system SHALL serve the cached response instead of fetching from the source API again

---
### Requirement: No direct client access to source domain

The frontend SHALL NOT reference the source domain directly for images; all photo requests SHALL go through the `/api/photo/{dishId}` endpoint.

#### Scenario: Frontend markup uses proxy path only

- **WHEN** the frontend renders a dish photo
- **THEN** the image element's source SHALL point to `/api/photo/{dishId}` and SHALL NOT point to the source domain directly
