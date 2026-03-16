---
name: openviking
description: RAG and semantic search via OpenViking Context Database MCP server. Query documents, search knowledge base, add files/URLs to vector memory. Use for document Q&A, knowledge management, AI agent memory, file search, semantic retrieval. Triggers on "openviking", "search documents", "semantic search", "knowledge base", "vector database", "RAG", "query pdf", "document query", "add resource".
---

# OpenViking - Context Database for AI Agents

OpenViking is ByteDance's open-source **Context Database** designed for AI Agents — a next-generation RAG system that replaces flat vector storage with a filesystem paradigm for managing memories, resources, and skills.

**Key Features:**
- **Filesystem paradigm**: Organize context like files with URIs (`viking://resources/...`)
- **Tiered context (L0/L1/L2)**: Abstract → Overview → Full content, loaded on demand
- **Directory recursive retrieval**: Better accuracy than flat vector search
- **MCP server included**: Full RAG pipeline via Model Context Protocol

---

## Status Check

OpenViking runs automatically inside this container via LiteLLM proxy.

```bash
curl -s http://localhost:2033/mcp && echo "Running" || echo "Not running"
```

## How to Use

OpenViking is pre-configured and ready. Use MCP calls to the server at `http://localhost:2033/mcp`.

## Tools Available

| Tool | Description |
|------|-------------|
| `query` | Full RAG pipeline — search + LLM answer |
| `search` | Semantic search only, returns docs |
| `add_resource` | Add files, directories, or URLs |

## Example Usage

```
"Query: What is OpenViking?"
"Search: machine learning papers"
"Add https://example.com/article to knowledge base"
"Add ~/documents/report.pdf"
```

## MCP Call Format

```bash
curl -N -X POST http://localhost:2033/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query","arguments":{"question":"What is OpenClaw?"}}}'
```

## Architecture

- **LiteLLM proxy** (port 10624): Routes Claude token as OpenAI-compatible API
- **OpenViking MCP** (port 2033): Knowledge base server using LiteLLM for VLM + local fastembed for embeddings
- **Knowledge base**: Pre-seeded with OpenClaw docs, add more via `add_resource`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Server not running | Check `/data/openviking.log` |
| LiteLLM not running | Check `/data/litellm.log` |
| Embedding slow first time | fastembed downloads model (~100MB) on first use |
