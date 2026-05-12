# Stagecraft Progression

Stagecraft Progression is a SillyTavern UI extension for reusable staged roleplay progression.

It stores the current stage per chat, injects only the active stage into the prompt, and keeps stage logic separate from character content. The default pack has 7 stages with unified moves and advancement conditions, but the stage count can be changed in the extension panel.

## Install

Copy this folder into one of these SillyTavern extension locations:

- `data/<your-user>/extensions/stagecraft-progression`
- `public/scripts/extensions/third-party/stagecraft-progression`

Then restart or reload SillyTavern and enable **Stagecraft Progression** in the Extensions panel.

## What It Does

- Stores `stage`, `progress`, and history in chat metadata.
- Injects the active stage before each generation through a prompt interceptor.
- Supports configurable stage counts from 1 to 50.
- Lets you manually advance, regress, reset, and lock the stage.
- Can automatically test for advancement every X assistant turns using a configurable percent chance.
- Can pick a forced action move only every X assistant turns, so stages do not fire on every reply.
- Can generate action moves, reward moves, punishment moves, or advancement conditions for the selected stage from a short concept note.
- Can generate a stage skeleton or full pack from a short character/progression goal.
- Can react to assistant control markers:
  - `[stagecraft:advance]`
  - `[stagecraft:regress]`
  - `[stagecraft:progress]`
  - `[stagecraft:reward]`
  - `[stagecraft:punishment]`
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

Start from `packs/default-7-stage.json`, then replace the neutral text with character-specific material.

## Recommended Use

Use the extension for mechanics and state. Use lorebooks for background details, character knowledge, locations, and flavor. Avoid putting stage keywords in lorebook keys unless you intentionally want lorebook activation.

For reliable progression, keep manual advance available even if marker automation is enabled. Models can miss control tags, but the extension state panel remains authoritative.

Auto-advance is intentionally optional. Enable **Auto-test stage advancement**, set **Test every X assistant turns**, and set the **Advance threshold %**. When the interval is reached, Stagecraft rolls 1-100; if the roll is at or below the threshold, it advances one stage unless the current stage is locked.

Action selection has its own pacing. Set **Pick action every X assistant turns** plus **Action chance**. Stagecraft only tests for a forced action on that interval; all other turns simply inject the stage behavior and let the scene continue naturally.

To fill stage content faster, select the current stage, write a short note in **Stage field concept**, choose the item count, and click one of the generate buttons. Stagecraft asks the active LLM for a JSON array and writes the result as moves or advancement conditions.

To create a pack from a concept, set the stage count, write a goal in **Character / progression goal**, then click **Generate Stage Skeleton** or **Generate Full Pack**. Skeleton generation creates stage names, behavior, and advancement conditions. Full pack generation also creates moves for each stage.
