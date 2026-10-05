# The AI team

Claude Code subagents for this repository live in [`.claude/agents/`](../.claude/agents). Each one is a
specialist with its own brief and works in its own context: it sees only the task it is given and what it
reads in the repository. `/agents` in Claude Code lists them.

| Agent                                                       | Role                    | Use it for                                                                                              |
| ----------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| [project-manager](../.claude/agents/project-manager.md)     | Product and delivery    | Plans, slices with owners and acceptance criteria, roadmap and changelog, phase-gate checks             |
| [architect](../.claude/agents/architect.md)                 | Architecture            | Designs, ADRs, contracts and service boundaries, design reviews                                         |
| [backend-engineer](../.claude/agents/backend-engineer.md)   | NestJS services         | APIs, migrations, events and consumers, authorization, new services                                     |
| [frontend-engineer](../.claude/agents/frontend-engineer.md) | Website and console     | Pages, components, translations, accessibility, e2e specs                                               |
| [mobile-engineer](../.claude/agents/mobile-engineer.md)     | Expo app                | Screens, the native iOS look, push, store releases                                                      |
| [platform-engineer](../.claude/agents/platform-engineer.md) | Platform, DevOps, SRE   | Compose and init, Keycloak, OpenBao, Kafka, observability, CI, deployment                               |
| [ai-engineer](../.claude/agents/ai-engineer.md)             | AI and data             | The Phase 4 pillars, LLM routing, evaluation sets, the offline LLM mock                                 |
| [i18n-engineer](../.claude/agents/i18n-engineer.md)         | Countries and languages | Locales, currencies, translations, country launches ([ADR-0032](adr/0032-multi-country-marketplace.md)) |
| [security-engineer](../.claude/agents/security-engineer.md) | Security and privacy    | Threat model, ASVS, privacy and platform law, security reviews                                          |
| [qa-engineer](../.claude/agents/qa-engineer.md)             | Tests                   | Test design, flaky tests, phase-gate verification                                                       |
| [code-reviewer](../.claude/agents/code-reviewer.md)         | Review (read-only)      | The last check of a diff before it is pushed                                                            |

## How work flows

1. **Plan.** The project-manager turns a goal into slices. Each slice has an owner agent, acceptance criteria,
   tests and a note on whether it needs an ADR.
2. **Decide.** The architect writes the ADRs the plan needs. The security-engineer threat-models anything that
   touches identity, money, personal data or a new country.
3. **Build.** Each slice goes to its owner. Independent slices can run in parallel, each in its own git
   worktree.
4. **Verify.** The qa-engineer adds and runs the tests, the security-engineer reviews sensitive changes, and
   the code-reviewer reviews the diff.
5. **Ship.** The main session commits, pushes the branch, opens the pull request and follows CI to green
   (CLAUDE.md, Git). The project-manager updates the roadmap and the changelog.

The main Claude Code session is the orchestrator: subagents cannot start other subagents, so it hands each
task to an agent and collects the result. A good hand-off names the goal, the slice's acceptance criteria, the
ADRs and files that matter, the constraints and what to return. The agents follow [CLAUDE.md](../CLAUDE.md)
like any other session, and leave commits, pushes and pull requests to the main session.

## Asking for the team

Say what you want in plain words. The session picks agents by their descriptions, or you name one:

- "Plan the launch in Sweden with the team."
- "Have the architect write the ADR for country URLs."
- "Ask the security-engineer to review this branch."

## Changing the team

Each agent is one Markdown file: a short frontmatter (`name`, `description`, optionally `tools`, and
`model: inherit`) followed by its brief. When a decision changes how a role works, edit the brief in the same
pull request as the decision. Keep briefs short and point to the ADRs instead of copying them.
