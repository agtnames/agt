# Rationale: `agt` CLI design decisions

Why the CLI is built the way it is. Newest entries last.

## 2026-09-30: interactive `manifest init`

### R-1. Terminal prompts are a small in-house layer (reversed from `@inquirer/core`)

First choice was `@inquirer/core`, which handles raw keypresses, redraws, resizing and Ctrl+C. Building on it showed that its screen manager always puts the cursor at the end of the input line's text. R-5's placeholders need text *after* the cursor: the instruction or prefill sits in the field with the cursor at its start, and a prefill continues past what you have typed. Doing that on top of the library would mean fighting its cursor maths on every redraw.

So the CLI draws its own frames: raw-mode keypresses through Node's readline, a full redraw of the prompt block on each change, and explicit cursor placement. That is about 150 lines, with no dependency, and it controls exactly where the cursor and the faint text go. Lines are cut to the terminal width so nothing wraps and breaks the redraw.

### R-2. The capability list is bundled, then refreshed from the site in the background

The capability vocabulary lives in the site's code, not in the CLI package.

- **Instant and offline.** The CLI ships with a copy, so the picker opens immediately even on a slow connection or none.
- **Never stale.** The vocabulary grows (69 to 70 so far). A bundled-only copy would leave a CLI installed today never seeing later additions. Fetching `/api/v2/capabilities` in the background while the first steps are filled in keeps it current with no wait.
- **Better ranking.** The same endpoint returns how many published agents use each capability. Ranking ties then go to the terms other agents actually use, which makes an agent easier to find.

The cost is one small, read-only, cacheable site endpoint. If it is down or slow, the CLI silently uses the bundled copy.

### R-3. The CLI reads the agent's own endpoints to prefill and suggest

When an endpoint URL is entered, the CLI reads what the agent says about itself: an MCP server's tool list, or an A2A agent card's skills. That feeds the description prefill and the capability suggestions. It only reads endpoints the user just entered. `--no-probe` turns it off.

### R-4. Capability ranking lives once, in `@agtnames/resolver`

The CLI picker and the site's picker (agt-site#452) need the same ordering: exact match first, then names starting with the typed text, and so on. Two copies would drift and give different results for the same search. One copy in the library both already use keeps them identical.

### R-5. Placeholders come in two kinds and never mix

1. **Prefill suggestion**: a prediction from data the CLI actually has: the current manifest, the agent's MCP server or A2A card, the top-ranked match. It shows as dim text after the cursor. `Tab` fills it into the field and `Enter` submits. If there is no real data, there is no prefill.
2. **Instruction**: text in the field saying what to enter, e.g. `Enter a one-line description of what your agent does`. It is always the primary text. When a prefill occupies the field, the instruction stays primary on the label line.

Example content is never offered as a suggestion. Examples appear only on an empty field after about 3 seconds idle, fading in below the field in italics, and disappear on typing. They cannot be filled with `Tab`.

### R-6. A suggestion is never lost, and can be sent out of the prompt

Overriding a prefill must not cost it, and nothing should force retracing steps or fighting PowerShell's line editing.

- The suggestion stays visible on its own line while you type over it.
- `↑` puts the suggestion back in the field, replacing what you typed. `Esc` clears the field. Neither deletes the suggestion.
- `Ctrl+Y` copies the suggestion to the clipboard, and `Ctrl+K` copies what is in the field.
- Each step's answers are saved as a draft. Quitting with Ctrl+C and running `agt manifest init <name>` again resumes where you stopped.
- At the end, the wizard prints the equivalent non-interactive commands as plain lines, in PowerShell or bash quoting (detected, or set with `--shell`), and offers to copy them. They can then be run directly, in Claude Code's `!` mode or not, without retyping.

### R-7. `j` goes back a step, `;` skips it

Every step can be skipped or revisited, so no question blocks the way forward.

- In lists (choices, the endpoint rows, the capability list) `j` and `;` are plain keys.
- In a typing field they act only while the field is empty. Once anything is typed they are ordinary characters, so a description starting "Just…" or a URL containing `j` types normally. The cost: to start a field's text with a lowercase `j` or `;`, type another character first and go back, or start with uppercase `J`.
- Going back erases the step's summary line and re-opens the previous step in place, with your answer filled in.
- Skipping leaves the field out of the manifest and prints a dim "skipped" line. A skipped required field shows as "(skipped)" in the review before anything is written.

### R-8. Endpoints is one list with an input per row

Choosing protocols and then answering one URL question per protocol was two passes over the same thing. Now each protocol is a row with its own input:

- `↑`/`↓` move between rows. `Tab` (or `→`) puts focus in the row's URL input, which shows the format it needs (`https://…`, `wss://…`) until you type.
- `Enter` in the input saves the row, ticks it, starts reading that endpoint in the background, and moves focus to the next row. `Enter` on an empty input unticks the row. `Esc` on an empty input returns to the list.
- `Enter` from the list continues with every ticked row, so the fast path is Tab, type, Enter per row, then Enter again.
- An empty row's suggestion comes from a URL already entered on the same site (`https://host/mcp` suggests `https://host/a2a`), and each saved row shows its live status inline.

### R-9. The wallet page waits for the wallet and survives a reload

In 0.1.0 the page failed the first request as soon as `window.ethereum` was missing, and that error ended the command. The server then shut down, so the reload the message asked for found nothing. A wallet commonly can't see a fresh `127.0.0.1` page: its site access is set to "on click" or to specific sites, and the port changed on every run. A first publish of nine names hit this on every attempt.

- The page looks for the wallet through `window.ethereum`, `ethereum#initialized` and EIP-6963 announcements, and keeps waiting. After about 3 s it says how to give the wallet access and asks for a reload. The terminal's request stays open meanwhile.
- Loading the page hands every request that was dispatched but not answered to the new page, so a reload never loses one.
- Only a rejection in the wallet (4001) ends the command. Any other wallet error shows Try again and Cancel on the page. For a transaction, the page says to choose Cancel if the wallet's activity shows it was sent.
- `--port <n>` (or `AGT_SIGNER_PORT`) keeps the page on one origin, so a site-access grant applies on every run. The default is still a random port, which avoids collisions. A taken port says so plainly.
