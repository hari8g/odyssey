// packages/main/src/riaf/riafPrompts.ts

import type { LLMMessage } from '../llm/llmProvider.interface'

/**
 * Builds the initial user message that instructs the agent to produce
 * the 12-section RIAF repository-context document.
 */
export function buildRiafUserMessage(
  repoTitle: string,
  outputFileName: string,
  maxFiles: number,
  includeTests: boolean,
): LLMMessage {
  const testNote = includeTests
    ? 'Include test coverage analysis and test strategy in the Testing section.'
    : 'Do NOT include test file details unless directly relevant to architecture.'

  const content = `\
You are generating a repository-context document for: **${repoTitle}**
Output file: \`${outputFileName}\`
Maximum files to deep-read: ${maxFiles}
${testNote}

## Your Task

Investigate the repository thoroughly using the available tools, then produce a complete,
accurate Markdown document with **exactly** the following 12 sections in order.
Use the tool results as your sole source of truth — do not invent details.

---

# ${repoTitle}

## 1. What This Repository Does

*One paragraph (3-5 sentences) describing the product, its users, and its core value proposition.*

Investigate: read the README, package.json/pyproject.toml/Cargo.toml at the root, and any
\`src/index\` or \`main\` entry point. Use \`search_codebase\` for "purpose", "description",
"overview" if the README is thin.

---

## 2. Architecture Overview

*A concise description of the top-level architectural style (monolith, microservices, layered,
event-driven, etc.) with a text diagram if helpful.*

Investigate: \`get_ucg_metrics\` for the big picture, \`ls_dir\` the root and \`src/\`, then
\`get_import_graph\` on 2-3 entry-point files to understand layering.

---

## 3. File Responsibility Map

*A table or bulleted list mapping every top-level directory / key file to its single
responsibility. Cover at most ${Math.min(maxFiles, 60)} entries.*

Investigate: \`ls_dir\` each top-level directory, \`get_file_outline\` for key files,
\`search_symbols\` to confirm responsibilities.

---

## 4. Module Wiring

*How the major modules connect: dependency injection, event bus, direct imports, etc.
Show the critical call chains.*

Investigate: \`get_import_graph\` on 3-5 central files. Note cycles from \`get_ucg_metrics\`.

---

## 5. External Dependencies

*Table of third-party libraries: name, version (if known), purpose, and which internal
modules consume them.*

Investigate: \`get_ucg_metrics\` for external dep counts, then \`search_codebase\` for
import statements. Read \`package.json\` / lock files via \`read_file\`.

---

## 6. Entry Points

*List every user-facing or system entry point (CLI commands, HTTP routes, event handlers,
scheduled jobs, exported APIs).*

Investigate: search_symbols for exported functions at root modules, \`search_codebase\` for
"app.listen", "createServer", "main(", "export default", "@Controller", "@app.route", etc.

---

## 7. Key Patterns & Conventions

*Document the dominant coding patterns: naming conventions, error handling strategy,
async model, data validation approach, logging, etc.*

Investigate: read 3-5 representative files from different layers, search for error-handling
patterns with \`search_codebase\`.

---

## 8. Implementation Cookbook

*Step-by-step recipes for the 4 most common developer tasks in this repo
(e.g. "Add a new API endpoint", "Add a database migration", "Add a new React component").*

Base each recipe on actual patterns observed in the codebase.

---

## 9. Configuration

*All configuration surface: env vars, config files, feature flags, secrets management.*

Investigate: \`search_codebase\` for "process.env", "os.environ", "config", \`read_file\`
on any .env.example, config/, settings files.

---

## 10. Testing

*Testing strategy, frameworks used, how to run tests, test file conventions, coverage gaps.*

${includeTests ? 'Use `get_tests_for_file` on key modules. List test commands from the workspace profile.' : 'Provide a brief overview of the testing approach only.'}

---

## 11. Known Issues & Technical Debt

*Import cycles, oversized files, missing tests, deprecated patterns, TODOs in code.*

Investigate: \`get_ucg_metrics\` for cycles, \`search_codebase\` for "TODO", "FIXME",
"HACK", "deprecated", \`get_recently_changed\` for churn hotspots.

---

## 12. Quick Reference

*Cheat-sheet table: common commands, key file locations, important env vars, and any
"gotchas" a new developer must know on day one.*

---

## Instructions

1. Work through each section **in order**.
2. Call tools to gather evidence **before** writing each section.
3. After completing all 12 sections, output the final assembled Markdown document
   as your last message — no extra commentary, just the document.
4. Keep the document under 6000 words total. Be precise, not verbose.
`

  return { role: 'user', content }
}
