# M2 Collaboration Alpha visual verification

## 2026-08-18

The `/chat` route was checked in the desktop viewport (1440×1000) and mobile viewport (390×844). Desktop presents the intended three-pane collaboration layout: product navigation, searchable channel/DM rail, timeline/composer, unread/mention indicators, live-presence/typing affordances, a file attachment composer control, and an isolated thread inspector. On mobile, the navigation shell and thread inspector are intentionally removed so the channel rail, timeline and composer remain usable in a single vertical flow.

The preview state appears when the viewer has no active tenant membership; protected channel requests correctly return 403 and the page continues to show a non-sensitive controlled-pilot empty state with a clear creation CTA. The attachment control remains visible but cannot send without membership. No client runtime error or type error was observed in either viewport. The authenticated behavior is covered by the 20-test acceptance suite, including private-channel isolation, idempotency, read/mention projection, TTL presence/typing, saved messages, and attachment metadata.
