# usage-wrap-up

Near the end of your 5-hour or weekly limit, asks Claude to wrap up tidily if it can't finish in what's left.

## Install

```
/plugin marketplace add verdantran/my-claude-mods
/plugin install usage-wrap-up@my-claude-mods
```

## How it behaves

- **Mid-turn:** the first time a tool call finishes with any limit at or past the threshold (95% by default), Claude reads a note beside that tool's result. It says how much is left and when the limit resets, and asks Claude to judge whether it can finish. If it can't, it stops at a safe point, leaves nothing half-done, and ends with a handover of what's done and what's left. You get a toast when this happens.
- **New prompts:** while a limit is past the threshold, each prompt you send carries the same note.
- **Once per window:** Claude is told once per limit window, so it isn't nagged on every tool call. A fresh window, after a reset, can trigger it again.
- **Resets:** a window whose reset time has passed is ignored.
- **Threshold:** change it from the plugin's config in `/plugin`.

The note is never shown in the transcript; only Claude sees it. Plans without usage limits never trigger it.
