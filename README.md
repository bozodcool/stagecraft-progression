# Stagecraft Progression

Stagecraft Progression is a SillyTavern UI extension for reusable staged roleplay progression.

It stores the current stage per chat, injects only the active stage into the prompt, and keeps stage logic separate from character content. The default pack has 7 stages with reusable moves and advancement conditions, but the stage count can be changed in the extension panel.

## Install

Copy this folder into one of these SillyTavern extension locations:

- `data/<your-user>/extensions/stagecraft-progression`
- `public/scripts/extensions/third-party/stagecraft-progression`

Then restart or reload SillyTavern and enable **Stagecraft Progression** in the Extensions panel.

## What It Does

- Stores `stage`, `progress`, and history in chat metadata.
- Injects the active stage before each generation through a prompt interceptor.
- Organizes controls into Current Chat, Stages, Generate, and Settings tabs.
- Supports configurable stage counts from 1 to 50.
- Lets you manually advance, regress, reset, and lock the stage.
- Can advance when the progress counter reaches the active stage target.
- Can automatically test for advancement every X assistant turns using a configurable percent chance.
- Exposes unused stage moves to the model by context, so the character can decide whether the current moment calls for an action, reward, punishment, temptation, withholding, reveal, repair, transition, or no special move.
- Consumes a move once it is used, so it cannot repeat within the same stage.
- Resets the available move pool when the stage changes, while keeping archived stage history in chat metadata.
- Can generate stage moves, stage bundles, or advancement conditions for the selected stage from a short concept note.
- Can generate a stage skeleton or full pack from a short character/progression goal.
- Shows generated content for review before applying it to a stage or pack.
- Can react to assistant control markers:
  - `[stagecraft:advance]`
  - `[stagecraft:regress]`
  - `[stagecraft:progress]`
  - `[stagecraft:reward]`
  - `[stagecraft:punishment]`
- Can react to hidden move-consume markers such as:
  - `[stagecraft:use:action:action-1-example]`
  - `[stagecraft:use:reward:reward-1-example]`
- Optionally scrubs those markers from chat after processing.

## Content Packs

Packs are JSON files with one or more stages. Each stage supports:

- `id`
- `name`
- `behavior`
- `advanceThreshold`
- `advanceConditions`
- `moves`

Each move supports:

- `kind`
- `label`
- `text`
- `trigger`
- `intensity`
- `progress`

Recommended move kinds:

- `action`
- `reward`
- `punishment`
- `temptation`
- `withholding`
- `reveal`
- `repair`
- `transition`

Start from `packs/default-7-stage.json`, then replace the neutral text with character-specific material.

## Recommended Use

Use the extension for mechanics and state. Use lorebooks for background details, character knowledge, locations, and flavor. Avoid putting stage keywords in lorebook keys unless you intentionally want lorebook activation.

For reliable progression, keep manual advance available even if marker automation is enabled. Models can miss control tags, but the extension state panel remains authoritative.

Auto-advance is intentionally optional. Enable **Auto-test stage advancement**, set **Test every X assistant turns**, and set the **Advance threshold %**. When the interval is reached, Stagecraft rolls 1-100; if the roll is at or below the threshold, it advances one stage unless the current stage is locked.

The core runtime is now context-driven instead of random-action driven. Stagecraft injects:

- the active stage behavior
- the advancement conditions
- the unused moves still available in this stage
- instructions telling the model to decide whether the moment fits one move or no special move

If the model uses one of those moves, it appends a hidden consume marker and Stagecraft removes that move from the active stage pool. A stage starts fresh when you advance to the next stage.

To fill stage content faster, select the current stage, write a short note in **Stage field concept**, choose the item count, and click one of the generate buttons. Stagecraft asks the active LLM for JSON and prepares the result for review before applying it.

To create a pack from a concept, set the stage count, write a goal in **Character / progression goal**, then click **Generate Stage Skeleton** or **Generate Full Pack**. Skeleton generation creates stage names, behavior, and advancement conditions. Full pack generation also creates moves for each stage.

To generate a selected stage in one shot, use **Stage bundle**. That creates moves plus advancement conditions for the currently edited stage.

Generated packs, moves, and conditions are shown in a review panel. Apply the preview to update the pack, or discard it without changing existing content.
