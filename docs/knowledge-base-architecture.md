# UX Audit Knowledge Base

## Data boundaries

- **Past Findings** is the user-facing archive of saved client findings. Audit payloads stay in their original JSON shape in `audit_findings.finding`; client/audit/page metadata remains separate.
- **Knowledge Base memory** is an internal, backend-only store of generalized, approved calibration rules. These rows use a small versioned JSON payload instead of several user-facing prose fields.
- **Reference documents** remain a distinct sourced corpus in `ux_knowledge_documents`. They are not client findings and are not silently rewritten as learned rules.

A prior client finding may be retrieved as a relevant example, but it is explicitly marked as an archive record and is never promoted into a global rule automatically. Only approved Knowledge Base memory records are treated as general rules during audit generation. New memories are drafts unless approval is explicitly provided.

## Compact memory payload (v1)

```json
{"v":1,"k":"false_positive","s":"india_bfsi_mobile","r":"Do not report a repeated CTA when both instances serve distinct journey steps.","kw":["cta","journey_step"],"ex":["Bad: ... Good: ..."],"lang":"hinglish"}
```

- `v`: payload format version.
- `k`: correction category.
- `s`: normalized scope token string.
- `r`: short action rule.
- `kw`: normalized retrieval terms.
- `ex`: short calibration examples.
- `lang`: source feedback language.

The raw feedback is preserved separately in `raw_feedback` as provenance and as a possible local-training input; it is not passed into ordinary audit retrieval. Only the compact `model_payload` is retrieved by the audit engine.

## Local-model export

The backend-only route `GET /api/knowledge-base?dataset=learnings&format=jsonl` exports approved memory records as `messages`-style JSONL. The route `GET /api/knowledge-base?dataset=past-findings&format=jsonl` exports saved findings as a separate JSONL dataset with the finding JSON unchanged.

Both exports require `Authorization: Bearer <KNOWLEDGE_BASE_EXPORT_TOKEN>`. Set `KNOWLEDGE_BASE_EXPORT_TOKEN` as a server-only environment variable. The route returns 503 while it is unset and never places the token in a URL. The two datasets are intentionally separate so local training pipelines can decide whether to use generalized lessons, client-specific findings, or both.

The JSONL is a portable starting format, not a guarantee that every local training framework accepts the exact same schema without an adapter. It is data preparation/export only; approving a memory does not alter model weights.
