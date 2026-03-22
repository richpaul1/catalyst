# Elementum Recipe Framework

A visual, screenshot-driven framework for building and replaying Elementum app configurations.

## Two-Phase Architecture

### Phase 1: Record — Navigate & Build → Output Recipe

An AI agent navigates the Elementum UI via screenshots, builds an app step by step, and records every action into a recipe YAML file.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Elementum   │     │   AI Agent   │     │    Recipe     │
│     UI       │────▶│  (browser +  │────▶│   Output     │
│              │     │ screenshots) │     │   (YAML)     │
└──────────────┘     └──────────────┘     └──────────────┘
```

**Workflow:**
1. Agent opens Elementum, takes a screenshot to understand the UI
2. Agent decides the next action based on what it sees + the playbook
3. Agent performs the action (click, fill, drag, etc.)
4. Agent takes a screenshot to verify the result
5. Agent records: action type, intent, and field values into the recipe YAML
6. Repeat until app is fully configured

**Output:** A single recipe YAML file. Screenshots are ephemeral — used by the agent to navigate, not stored as artifacts.

---

### Phase 2: Replay — Use Recipe to Build App

An AI agent reads a recipe and replays it against a fresh Elementum instance, using screenshots to verify each step succeeded.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Recipe    │     │   AI Agent   │     │  Elementum   │
│    (YAML)    │────▶│  (browser +  │────▶│     UI       │
│              │     │  validation) │     │  (new app!)  │
└──────────────┘     └──────────────┘     └──────────────┘
```

**Workflow:**
1. Agent reads the next step from the recipe YAML
2. Agent takes a screenshot of the current UI state
3. Agent performs the action described in the recipe
4. Agent screenshots and verifies the result
5. Repeat until recipe is complete

---

## Recipe Format (YAML)

```yaml
recipe:
  name: "Vendor Onboarding"
  version: "1.0"
  description: "End-to-end vendor onboarding with 4-stage approval workflow"
  category: "procurement"
  estimated_time: "15 minutes"
  prerequisites:
    - "Active Elementum account with app creation permissions"
    - "CloudLink configured with vendor data source"

app:
  name: "Vendor Onboarding"
  handle: "VND"
  namespace: "vendor-onboarding"
  description: "Manages vendor onboarding from application to activation"
  category: "Procurement"

steps:
  # ── Navigation ──────────────────────────
  - id: 1
    action: navigate
    url: "/apps"
    description: "Open the Apps dashboard"

  # ── Create App ──────────────────────────
  - id: 2
    action: click
    target: "More menu icon (⋮), then 'Create New App'"
    description: "Open the Create App dialog"

  - id: 3
    action: fill
    target: "Create App form"
    fields:
      cloudlink: "Vendor Data"
      name: "Vendor Onboarding"
      namespace: "vendor-onboarding"
      handle: "VND"
      description: "Manages vendor onboarding from application to activation"
      category: "Procurement"

  - id: 4
    action: click
    target: "Create button"
    expect: "Record Details Layout opens"

  # ── Layout: Add Fields ─────────────────
  - id: 5
    action: add_field
    section: "Header"
    field_type: "text"
    field_name: "Company Name"
    required: true

  - id: 6
    action: add_field
    section: "Details"
    field_type: "email"
    field_name: "Contact Email"

  # ── Workflow Stages ────────────────────
  - id: 7
    action: add_stage
    stage_name: "Application"
    description: "Vendor submits their information"

  - id: 8
    action: add_stage
    stage_name: "Review"
    description: "Procurement team evaluates submission"

  # ── Automations ────────────────────────
  - id: 9
    action: add_automation
    trigger: "Record enters Review stage"
    condition: null
    actions:
      - type: "notification"
        target: "Procurement Team"
        message: "New vendor application requires review"
```

---

## Action Vocabulary

| Action | Description | Key Fields |
|---|---|---|
| `navigate` | Go to a URL or page | `url` |
| `click` | Click a button/link/element | `target` (visual description) |
| `fill` | Fill form fields | `fields` (key-value map) |
| `select` | Choose from a dropdown | `target`, `value` |
| `drag` | Drag an element to a position | `source`, `destination` |
| `add_field` | Add a field to the layout | `section`, `field_type`, `field_name` |
| `add_stage` | Add a workflow stage | `stage_name` |
| `add_automation` | Configure an automation rule | `trigger`, `condition`, `actions` |
| `add_component` | Add a UI component | `component_type`, `config` |
| `wait` | Wait for a condition | `condition`, `timeout_ms` |
| `assert` | Verify UI state matches expectation | `condition` |

---

## Directory Structure

```
elementum/
  docs/
    recipe-framework.md        ← this file
    elementum-overview.md      ← platform knowledge from docs
    ui-components.md           ← learned UI component catalog
  recipes/
    vendor-onboarding.yaml     ← recipe definition
    sales-pipeline.yaml
    support-tickets.yaml
```
