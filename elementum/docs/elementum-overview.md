# Elementum Platform Overview

> Extracted from [docs.elementum.io](https://docs.elementum.io) using the MCP chatbot tools.

## What is Elementum?

Elementum is an **intelligent process automation platform** that orchestrates people, rules, LLMs, and AI agents — without moving your data from your data warehouse. It's a **no-code platform** designed for business users, not engineers.

## Core Building Blocks

### Apps
The containers that hold business logic and configuration. Each app organizes data, workflow logic, automations, and user permissions around a specific business process (onboarding, incident management, vendor reviews, etc.).

**What makes up an App:**
- **Data structure** — CloudLinks connect to existing data sources, Elements define business entities
- **Process design** — Flow maps workflow stages, approval processes, assignment rules
- **User experience** — Layouts control how users interact with data, forms capture input, views display info
- **Automation engine** — Event-driven rules, AI agents, external integrations

### Elements
Structured data objects representing key business entities (vendors, products, incidents, customers). Each Element has defined fields capturing essential information.

**Types:**
- **Master data** — Core entities (Customers, Products, Vendors)
- **Transactional** — High-volume business events (logs, metrics)
- **Configuration** — Settings/rules (approval thresholds, SLA definitions)
- **Historical** — Append-only records for audit trails
- **Semi-structured** — Flexible data with JSON columns (form responses, API payloads)

### CloudLinks
Connect Elementum to existing data repositories (Snowflake, BigQuery, Databricks) without copying or syncing. External data becomes instantly usable inside workflows.

### Flow
Visual process builder that defines how records move through stages, decision points, automations, and user inputs. Think of it as the roadmap for your workflow.

### Tables
Dynamic, real-time data views that stay synchronized with data sources. Use when data is read-only or for cross-functional dashboards.

## Automations

Event-driven rules that define what happens when something changes. Core building blocks:

| Component | Purpose |
|---|---|
| **Triggers** | Start on record changes, status transitions, file events, schedules |
| **Conditions** | Filter with comparisons, branch (if/else) logic |
| **Actions** | Update fields, create records, notify, approve, call webhooks, invoke AI |
| **Schedules** | Time-based triggers and SLA deadline tracking |
| **Error handling** | Built-in retries and failure paths |

**Patterns:** Event-driven rules, scheduled processing, human-in-the-loop workflows, system integrations.

## AI & Intelligence

- **AI Agents** — Autonomous assistants that use tools, make decisions, and take actions within workflows
- **AI Actions** — One-shot AI operations (classify, extract, summarize, generate)
- **AI Services** — Connections to external AI providers (OpenAI, Google Gemini, custom models)

## Key Features for Recipe Framework

| Feature | Relevance to Recipes |
|---|---|
| **Layout Builder** | Fields + Components define the app's UI → recipe captures field additions |
| **Workflow Stages** | Stages define the process flow → recipe captures stage creation |
| **Assignment Rules** | Who handles work at each stage → recipe captures rule config |
| **Approval Processes** | Review/approval workflows → recipe captures approval setup |
| **Automations** | Event-driven rules → recipe captures trigger/condition/action config |
| **Forms** | Data intake → recipe captures form builder config |
| **Views** | List, Board, Calendar displays → recipe captures view setup |

## Doc Sources

- [Welcome to Elementum](https://docs.elementum.io/getting-started/welcome-to-elementum)
- [Quick Start Guide](https://docs.elementum.io/getting-started/quickstart)
- [Core Concepts](https://docs.elementum.io/getting-started/fundamentals/core-concepts)
- [Build an App](https://docs.elementum.io/getting-started/build-an-app)
- [Layout Builder](https://docs.elementum.io/workflows/layouts)
- [Automations](https://docs.elementum.io/workflows/automation-system)
- [AI Overview](https://docs.elementum.io/ai-agents/ai-overview)
- [API Reference](https://docs.elementum.io/api-reference/api-introduction)
