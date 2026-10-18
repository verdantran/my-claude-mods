# usage-wrap-up

Near the end of your 5-hour or weekly limit, asks Claude to wrap up tidily if it can't finish in what's left.

## Install

```
/plugin marketplace add verdantran/my-claude-mods
/plugin install usage-wrap-up@my-claude-mods
```

## How it behaves

- **Mid-turn:** the first time a tool call finishes with any limit at or past its threshold, Claude reads a note beside that tool's result. It says how much is left and when the limit resets, and asks Claude to judge whether it can finish. If it can't, it stops at a safe point, leaves nothing half-done, and ends with a handover of what's done and what's left. You get a toast when this happens.
- **Indicator:** while a limit is past its threshold, a `wrap on` row sits under the usage-meter bars, in the same red the bars turn near the limit. Without usage-meter it shows on its own.
- **New prompts:** while a limit is past its threshold, each prompt you send carries the same note.
- **Once per window:** Claude is told once per limit window, and each limit gets its own note, so it isn't nagged on every tool call. A fresh window, after a reset, can trigger it again.
- **Resets:** a window whose reset time has passed is ignored.
- **Thresholds:** the 5-hour and weekly limits each have their own, both 95% by default; set them from the plugin's config in `/plugin`. Any other limit, such as a spend limit, uses the 5-hour one.

The note is never shown in the transcript; only Claude sees it. Plans without usage limits never trigger it.
