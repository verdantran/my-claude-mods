# my-claude-mods

Small mods that change Claude Code's interface and behaviour, packaged as a plugin marketplace.

## Install

Add the marketplace once:

```
/plugin marketplace add verdantran/my-claude-mods
```

Then install whichever mods you want:

```
/plugin install usage-meter@my-claude-mods
/plugin install usage-wrap-up@my-claude-mods
```

You can also browse them all from the `/plugin` menu. To pick up new mods or updates, run `/plugin marketplace update my-claude-mods`.

## Mods

| Mod | What it does |
| --- | --- |
| [usage-meter](./usage-meter) | A slim band above the prompt showing how much of your 5-hour and weekly Claude Code limits you have used |
| [usage-wrap-up](./usage-wrap-up) | Near the end of your 5-hour or weekly limit, asks Claude to wrap up tidily if it can't finish in what's left |

## Adding a mod

1. Create a folder with its own `.claude-plugin/plugin.json` and a `README.md`.
2. Add an entry to `.claude-plugin/marketplace.json`.
3. Add a row to the table above, using the same one-line description as `plugin.json`.
