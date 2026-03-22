# MCP Chatbot Server

An MCP (Model Context Protocol) server that exposes three tools for integrating with external chatbot assistants and extracting content from documentation pages.

## Tools

### `external_chatbot_query`

Send a query to an external chatbot REST API and return the answer text along with any cited source URLs.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `chatbot_url` | `string` (required) | — | The chatbot API endpoint URL |
| `query` | `string` (required) | — | The query to send |
| `auth_type` | `none \| api_key \| bearer \| cookie` | `none` | Authentication type |
| `auth_token` | `string` | `""` | Auth token value |
| `request_template` | `object` | auto | JSON body template with `{{query}}` placeholder |
| `response_path` | `string` | `$.answer` | JSONPath to extract the answer text |
| `sources_path` | `string` | `$.sources` | JSONPath to extract source URLs |
| `headers` | `object` | `{}` | Custom HTTP headers |
| `timeout_ms` | `number` | `30000` | Request timeout in milliseconds |

**Response:**

```json
{
  "answer": "To configure webhook triggers, navigate to...",
  "sources": [
    { "title": "Webhook Configuration", "url": "https://docs.example.com/webhooks" }
  ],
  "metadata": { "response_time_ms": 1200, "status_code": 200 }
}
```

### `source_content_extraction`

Fetch HTML pages from given URLs and convert them to raw markdown, preserving all image and video references.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `urls` | `string[]` (required) | — | URLs to fetch and convert |
| `content_selector` | `string` | — | CSS selector to isolate main content (e.g. `article`, `.prose`) |
| `strip_navigation` | `boolean` | `true` | Strip nav, header, footer, sidebar elements |
| `preserve_media` | `boolean` | `true` | Preserve image/video references in output |
| `media_base_url` | `string` | `""` | Base URL to resolve relative paths |
| `max_content_length` | `number` | `50000` | Max characters per page |
| `timeout_ms` | `number` | `30000` | Request timeout per page |

**Response:**

```json
{
  "sources": [
    {
      "url": "https://docs.example.com/webhooks",
      "title": "Webhook Configuration",
      "markdown": "# Webhook Configuration\n\n![diagram](https://...)\n\nTo configure...",
      "media": [
        { "type": "image", "url": "https://...", "alt": "diagram" }
      ],
      "content_length": 12340,
      "status": "success"
    }
  ],
  "total_media_count": 1
}
```

### `chatbot_query_with_sources`

Combined pipeline: query a chatbot, extract cited source URLs, then fetch full markdown from each source page.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `string` (required) | — | The question to ask the chatbot |
| `provider` | `string` | `mintlify` | Chatbot provider name (currently: `mintlify`) |
| `content_selector` | `string` | `article` | CSS selector to isolate main content on source pages |
| `max_content_length` | `number` | `50000` | Max characters per source page |
| `timeout_ms` | `number` | `30000` | Request timeout in milliseconds |

**Response:**

```json
{
  "answer": "Workflows automate business processes by...",
  "sources": [
    {
      "url": "https://docs.elementum.io/workflows/layouts",
      "title": "Layout Builder",
      "markdown": "# Layouts: Building Your Workflow UI\n\n...",
      "content_length": 5016,
      "status": "success"
    }
  ],
  "metadata": {
    "provider": "mintlify",
    "query_time_ms": 12489,
    "extraction_time_ms": 1413,
    "total_time_ms": 13904,
    "sources_found": 3,
    "sources_extracted": 3
  }
}
```

---

## Platform Integration

### How It Fits In

```
Agent Execution Loop
  ├─ Built-in tools (plan, tasks, content)
  ├─ RAG query tool (query_docs)
  ├─ Org-defined tools (http, mcp_server)
  │   └─ MCP Server: "mcp-chatbot"        ← this server
  │       ├─ external_chatbot_query
  │       ├─ source_content_extraction
  │       └─ chatbot_query_with_sources
  └─ Agent synthesizes results using repo's LLM + prompts
```

### Registering as an Organization Tool

Each external chatbot provider is registered as a **separate organization tool record**, all pointing to this same MCP server. The `execution_config` stores provider-specific defaults, and the agent only sends the `query` at call time.

**Example — Mintlify Docs Provider:**

```json
{
  "tool_name": "elementum_docs_chat",
  "display_name": "Elementum Docs Assistant",
  "description": "Query the Elementum documentation chatbot",
  "execution_type": "mcp_server",
  "execution_config": {
    "server_path": "mcp-servers/mcp-chatbot",
    "transport": "stdio",
    "chatbot_url": "https://leaves.mintlify.com/api/assistant/elementum/message",
    "auth_type": "none",
    "request_template": {
      "id": "elementum",
      "messages": [{ "role": "user", "content": "{{query}}" }],
      "fp": "elementum",
      "currentPath": "/"
    },
    "response_path": "$.answer",
    "sources_path": "$.sources[*].url",
    "headers": {
      "Content-Type": "application/json",
      "Origin": "https://docs.elementum.io",
      "Referer": "https://docs.elementum.io/"
    },
    "timeout_ms": 30000
  }
}
```

**Example — Zendesk Provider:**

```json
{
  "tool_name": "zendesk_help_chat",
  "display_name": "Zendesk Help Center",
  "execution_type": "mcp_server",
  "execution_config": {
    "server_path": "mcp-servers/mcp-chatbot",
    "transport": "stdio",
    "chatbot_url": "https://help.company.com/api/v2/chat",
    "auth_type": "api_key",
    "response_path": "$.result.text",
    "sources_path": "$.result.articles[*].href"
  },
  "secrets": {
    "auth_token": "zen-api-key-xxx"
  }
}
```

### What the Agent Sees

The agent sees these as separate named tools — no knowledge of the underlying config:

```
Agent: "I need to check the Elementum docs"
  → calls: elementum_docs_chat({ query: "How do webhooks work?" })

Agent: "Let me also check our help center"
  → calls: zendesk_help_chat({ query: "How do webhooks work?" })
```

Both calls route to the same MCP server. The platform merges `execution_config` defaults with the agent's `query` parameter.

---

## Integrating with Google Antigravity

[Antigravity](https://deepmind.google) is an agentic AI coding assistant developed by Google DeepMind's **Advanced Agentic Coding** team. It supports MCP servers natively via a `mcp_config.json` file.

### Configuration

Add the server to `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "mcp-chatbot": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/mcp-servers/mcp-chatbot/src/index.ts"
      ]
    }
  }
}
```

### Restart Required

After editing `mcp_config.json`, **restart the Antigravity session** (close and re-open the conversation). Antigravity spawns MCP servers on session start.

### Available Tools After Integration

Once connected, Antigravity gains three new tools it can call directly during conversations:

| Tool | What Antigravity Can Do |
|---|---|
| `external_chatbot_query` | Query any REST chatbot API |
| `source_content_extraction` | Fetch any URL and get clean markdown |
| `chatbot_query_with_sources` | Ask Elementum docs a question and get the answer + full source page content |

### Verifying the Connection

Ask Antigravity to run a tool call:

```
"Use source_content_extraction to fetch https://docs.elementum.io/getting-started/quickstart"
```

If configured correctly, it will return the page content as markdown.

### Monitoring

Antigravity spawns its own MCP server process — logs won't appear in a separate `npm run dev` terminal. Instead, tail the log file:

```bash
tail -f mcp-servers/mcp-chatbot/logs/mcp-chatbot.log
```

---

## Development

### Setup

```bash
cd mcp-servers/mcp-chatbot
npm install
```

### Run MCP Server (stdio)

```bash
npm run dev        # development via tsx
npm run build      # compile TypeScript
npm start          # run compiled output
```

### Run Tests

```bash
npm test                                     # unit tests (vitest)
npx tsx tests/test-chat-tool.ts chatbot      # live chatbot query test
npx tsx tests/test-chat-tool.ts extract      # live content extraction test
npx tsx tests/test-chat-tool.ts combined     # full pipeline: query → sources → markdown
```

The `combined` test accepts a custom query as the third argument:

```bash
npx tsx tests/test-chat-tool.ts combined "How do webhooks work?"
```

### Project Structure

```
mcp-servers/mcp-chatbot/
  src/
    index.ts                       ← MCP server entry, tool registration
    tools/
      chatbot-query.ts             ← external_chatbot_query implementation
      chatbot-with-sources.ts      ← chatbot_query_with_sources (combined pipeline)
      content-extract.ts           ← source_content_extraction implementation
    utils/
      http-client.ts               ← HTTP fetching with auth, timeout, retry
      html-to-markdown.ts          ← Turndown-based converter with media preservation
      jsonpath.ts                  ← JSONPath extraction helper
      logger.ts                    ← Structured logger (stderr + file)
  tests/
    chatbot-query.test.ts          ← unit tests
    chatbot-with-sources.test.ts   ← unit tests
    content-extract.test.ts        ← unit tests
    jsonpath.test.ts               ← unit tests
    test-chat-tool.ts              ← live integration test script
  logs/
    mcp-chatbot.log                ← auto-created log file (gitignored)
```

---

## Logging

The server writes structured JSON logs to **both stderr and a log file**.

### Viewing Logs

```bash
# Watch logs from the Antigravity-spawned MCP instance
tail -f mcp-servers/mcp-chatbot/logs/mcp-chatbot.log
```

### Sample Output

```json
{"ts":"2026-03-22T04:13:05.711Z","level":"INF","component":"server","msg":"MCP Chatbot server started","transport":"stdio"}
{"ts":"2026-03-22T04:13:06.026Z","level":"INF","component":"content-extract","msg":"Extraction complete","totalUrls":1,"succeeded":1,"failed":0,"totalMedia":4}
{"ts":"2026-03-22T04:13:06.097Z","level":"INF","component":"chatbot-with-sources","msg":"Pipeline complete","sourcesFound":3,"sourcesExtracted":3,"totalTimeMs":13904}
```

### Configuration

| Env Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `LOG_FILE` | `logs/mcp-chatbot.log` | Custom log file path |

---

## Known Limitations

| Area | Limitation | Workaround |
|---|---|---|
| **Streaming APIs** | `external_chatbot_query` expects JSON responses. Vercel AI data streams (used by Mintlify) aren't parsed by the tool. | Use `chatbot_query_with_sources` which handles Vercel AI streams natively. |
| **JS-rendered pages** | `source_content_extraction` fetches raw HTML — pages that require JavaScript rendering won't have dynamic content. | Target static/SSR documentation sites. |
| **Auth-gated media** | Images behind authentication are preserved as URLs but won't load without a proxy. | Pass-through URLs; add proxy support in a future phase. |
