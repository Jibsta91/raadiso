# 0027 — Reports and blocking: reports in listings with a moderators' queue, blocks in messaging

- Status: Accepted
- Date: 2026-10-04

## Context

Moderators could remove listings, but users had no way to tell them about a scam or a prohibited item, and no
way to stop someone from writing to them. Both are basic safety tools of a marketplace, and Phase 4's AI
governance (review queues, fraud detection) builds on them.

## Decision

- **Reports belong to listings**, next to moderation. Users report a listing with a reason (fraud,
  prohibited, offensive, wrong category, other) and an optional comment of up to 500 characters
  (`POST /api/v1/listings/{id}/reports`, 202). Each person has one open report per listing; reporting again
  updates it. Owners cannot report their own listings, and each person can have at most 20 open reports at a time (handled reports no longer count).
- **Moderators work a queue grouped by listing** (`GET /api/v1/listings/moderation/reports`, role
  `moderator`), most reported first, with counts per reason and the five most recent comments. Reporters'
  ids are not shown. Two outcomes:
  - **Remove**: the existing moderation removal. The owner is notified as before (ADR-0017) and the reports
    are resolved.
  - **Dismiss**: closes the reports. A later report opens a new one.
    Moderators reach the queue at `/moderation`, linked from the account menu for that role only.
- **Blocks belong to messaging** and apply between two people, in every conversation. Blocking the other
  person in a conversation (`PUT/DELETE /api/v1/messaging/conversations/{id}/block`) closes all your
  conversations with them, both ways. Sending, or starting a new conversation, then answers
  `422 conversation_closed`.
  - The blocked person only sees that the conversation is closed (`canMessage: false`,
    `blockedByMe: false`), never who closed it or why. That is safer for the person who blocked.
  - Because no messages are sent, the blocked person causes no e-mails or pushes.
- Web and app have the same tools: "Report listing" on listing pages, and "Block" with an unblock option in
  conversations.

## Alternatives considered

- **A separate moderation service**: cleaner once reports cover users and messages too, but today they are
  about listings only, and removal already lives in listings. The queue can move out when Phase 4 adds AI
  review queues.
- **Blocking per conversation**: easy to get around by starting a new conversation about another listing.
  Blocking a person is what people expect.
- **Telling the blocked person**: more transparent, but it can provoke harassment elsewhere. Common platforms
  stay silent.
- **Automatic actions at a report threshold** (hide a listing after N reports): open to abuse by groups of
  reporters. A person decides, and Phase 4 can add scoring.

## Consequences

- Report comments are personal data written by users: they are kept for moderation, and retention and
  export are part of the Phase 4 GDPR work. Blocks too.
- The e2e suite now signs each demo user in once per run and reuses the sessions (`specs/sessions.setup.ts`).
  More sign-ins had pushed the parallel suite past identity-bff's limit of 20 sign-ins a minute per address.
