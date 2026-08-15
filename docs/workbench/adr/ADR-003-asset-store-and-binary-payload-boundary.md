# ADR-003: Asset Store and Binary Payload Boundary

> **Status**: Proposed / Refined
> **Date**: 2026-05-16  
> **Decision scope**: Future data-layer iteration after MVP Stage 0-5
> **2026-08-15 refinement**: [`../plans/local-data-blob-store-foundation-plan.md`](../plans/local-data-blob-store-foundation-plan.md) 将底层字节层收束为通用内容寻址 Blob Store。Source Artifact 与 Media Asset 是引用 Blob 的不同逻辑记录；自动生成的 Thumbnail 属于可重建 Cache，不默认作为权威 Asset。

---

## Context

Loom Studio may support media-producing extensions in future stages, including text-to-image, image editing, audio generation, previews, thumbnails, and other binary artifacts.

The current MVP data model is JSON-first:

- JSON-RPC request / response envelopes.
- `DocumentRecord.content` as JSON.
- In-memory Document Store with full `structuredClone()` snapshots.
- Trace / Audit / Diagnostics as JSON facts.

This is appropriate for control-plane data:

- manifests
- metadata
- diagnostics
- trace summaries
- document references
- extension RPC params/results

It is not appropriate as the default binary media path.

---

## Decision

Binary media payloads must not be stored directly in normal `DocumentRecord.content` as base64 strings by default.

Loom Studio should split media handling into two planes:

```text
Document Store / SQLite:
  structured metadata, ownership, references, relations, revision facts

Blob Store:
  immutable bytes, checksums, streaming storage

Asset / Artifact metadata:
  stable ids, blob refs, provenance, media metadata

Cache:
  generated thumbnails, previews, rebuildable derivatives
```

A generated image document should store an asset reference, not the image bytes:

```json
{
  "type": "example.image.generated",
  "content": {
    "assetId": "asset_abc",
    "mimeType": "image/png",
    "width": 1024,
    "height": 1024,
    "sizeBytes": 845213,
    "sha256": "...",
    "promptRef": "..."
  }
}
```

The binary bytes should be served through asset/data-plane endpoints, for example:

```text
GET /assets/:assetId/original
GET /assets/:assetId/thumb
POST /assets/upload
```

or through an equivalent future local transport.

---

## Rationale

JSON-RPC is the platform control plane. It is good for invoking capabilities and exchanging small/medium JSON payloads.

It is not suitable for routine binary transfer because:

- base64 expands payloads by roughly one third;
- JSON parse/stringify adds CPU and memory overhead;
- current Document Store clones whole documents;
- revision snapshots would duplicate large payloads;
- trace/audit may accidentally capture oversized or sensitive raw payloads;
- browser rendering should use URLs/blobs instead of large JSON strings.

Keeping binary in an Asset Store allows:

- smaller Document records;
- stable metadata and ownership semantics;
- better thumbnail/original separation;
- future streaming/range request support;
- easier export/import packaging;
- safer trace/audit redaction.

---

## Consequences

### Accepted

- Documents may reference assets by `assetId`.
- RPC methods may create/register assets through control-plane calls.
- Frontend rendering should use an asset URL or blob URL.
- Trace/Audit should record asset ids, hashes, sizes, and metadata, not raw binary by default.

### Deferred

- Concrete Asset Store API.
- Filesystem vs SQLite BLOB vs object-store backend.
- Thumbnail generation pipeline.
- Asset garbage collection.
- Asset export/import package format.
- Permission model for media access.

### Rejected for default path

- Storing generated images as base64 strings in normal `DocumentRecord.content`.
- Returning large binary media through normal JSON-RPC result payloads.
- Recording raw media payloads in diagnostics, trace, or audit details.

---

## Current MVP Testing Implication

MVP performance tests should focus on JSON control-plane performance:

- `system.ping` latency baseline;
- small/medium JSON `docs.write` / `docs.get` round trips;
- pagination behavior;
- request/response serialization overhead.

Media/binary tests are deferred until the Asset Store design exists.
