# dsh-git-tools

A floating git panel for the DeepSeek Harness Web UI. It registers into the
frame-wide `shell.overlay` slot at the top-right, collapses to the branch name
alone, and acts on the directory the Host resolves for the current work.

## What it does

Collapsed, the panel is the branch with the working tree's tally beside it.
Opened, it is one card whose header carries the same tally beside the title and
whose body holds two rows:

| Row | What it shows | Underneath |
|---|---|---|
| 分支 | The branch alone; the row opens the list | `git rev-parse --abbrev-ref HEAD`, `git branch --no-color` |
| 提交或推送 | The row opens the commit dialog | optional `git add -A`, `git commit -F <file>`, `git push` |

Opening and collapsing is a transition, not a swap: the card unfolds out of — and
folds back into — the corner the pill sits in, the branch list unfolds out of the
corner it shares with its row, and the commit dialog and its veil ease in. Only
the card's fold-back needs to outlive its own unmount, so only that one holds its
element mounted for the length of the animation. The keyframes come from one
stylesheet the plugin installs and removes with itself, since a style attribute
cannot declare them; its marker attribute is what lets `prefers-reduced-motion`
switch every animation off.

The tally is the changed-file count with the lines they add and remove, and the
pill and the card's header render it from one element, so collapsing and opening
never disagree; it is shown only while the working tree holds lines to count, so a
clean tree — or a change that carries no lines at all — says nothing rather than a
zero. File count and line count rest on the same set of paths:

- `git status --porcelain=v2 --branch -z -uall` answers the branch, its upstream
  and unpushed count, and every changed path — new files included. `-uall` because
  the default collapses an untracked directory into one record naming a directory,
  whose files would then never be counted.
- `git diff --numstat HEAD` answers the lines of everything git already tracks.
- A new file is in no diff, so its lines are counted by reading it, skipping a file
  git would call binary (a NUL byte) and one past 8 MiB, the way `--numstat` prints
  `-` for both. Without this a working tree whose changes are mostly new files
  reads as almost nothing — the case a tally is consulted for.

The same counts, and the changed-file count, appear again in the commit dialog,
which re-reads them: that is where a person deciding whether to commit is looking
anyway.

The branch row opens a list that floats to the left of the card, level with the
row it belongs to: a search field, a `分支` heading, every local branch with the
one in use leading the list, carrying a check and told what the working tree still
holds, and `创建并检出新分支…` (`git checkout -b <name>`).

The commit row opens a dialog over the dimmed frame — the card stays crisp behind
it — with the branch and the line counts, the message, the `包含未暂存的更改`
switch beside the changed-file count, a `跳过 Git hooks（--no-verify）` switch, and
three rows: 提交, 提交并推送, 推送. Escape, a click on the veil, or picking a
branch closes it. The hooks switch is off by default and, once armed, states that
it bypasses the repository's own commit checks: it exists for a repository whose
hooks cannot start under the sandbox (see the limitations), and the decision to
bypass them is the person's, never a fallback the panel takes on its own.

推送 is grey when there is nothing to publish: the branch tracks an upstream and
is level with it, which the Host reads from the same `status --porcelain=v2`
record. That count is re-read after every commit and push, so the row lights up as
soon as a commit is waiting. A branch with no upstream at all is not grey — its
count is unknown rather than zero, and `git push` is left to say what it needs.

The message is optional. Left empty, 提交 and 提交并推送 first ask the Session's
own model to write one and commit with it; the sparkle beside the box does the
same on demand. Either way the text lands in the box first, so what is about to
be committed is visible before it is.

The panel reads the state when it appears, whenever the frame switches Sessions,
and after each command. Nothing polls. Each Session's last read is kept, so
switching back shows that Session's numbers at once and the read that follows
replaces them — a switch is a refresh, not a blank card.

## Which checkout it acts on

The Host resolves it, because the browser knows only part of it: `shell.overlay`
is a frame-level slot, so the entry is handed no Session prop, and the Session
list the page can see carries no selection field. The Host tries, in order:

1. an absolute `cwd` sent with the request,
2. the live Agent of the named `sessionId`,
3. the most recently created live Agent, or the first registered workspace —
   **only when no Session was named**.

A named Session whose Agent is not live yet resolves to nothing: neither the
newest Agent nor the first workspace is that Session's checkout, so the state
route answers `pending` and the page re-asks once. A mutating route refuses with
`this Session is still opening`. Answering with a neighbour's directory would put
another checkout's branch and tally behind the name the page asked about.

The page takes the Session the frame is showing from the slot's `useSessions`
seat: the main view retains exactly the Session it displays, under the
`mainView` source, so the row whose `retainedBy.mainView` is set is that
Session. That is a live reading, not a snapshot — switching Sessions moves the
reference, the panel re-reads, and the card, the tooltip, and the path line all
follow. The resolved directory travels back in every response, so acting on
another checkout is never silent. An answer that lands after a switch is filed
under the Session it was issued for and shown only if the frame is still there.

The page takes the Session the frame is showing from the slot's `useSessions`
seat: the main view retains exactly the Session it displays, under the
`mainView` source, so the row whose `retainedBy.mainView` is set is that
Session. That is a live reading, not a snapshot — switching Sessions moves the
reference, the panel re-reads, and the card, the tooltip, and the path line all
follow. The resolved directory travels back in every response, so acting on
another checkout is never silent.

## Where the commands run

Through the composition's own `shell` service — the same executor the `bash` /
`pwsh` tools use — with the deployment's sandbox mode, so a `read-only` session
cannot commit and a denial is reported with the sandbox's own words instead of
being silently dropped. `sandboxPolicy` is deliberately not overridden.

Two things never reach a command line as free text: a branch name must match
`[A-Za-z0-9._/-]{1,200}` without a leading `-` or `..`, and a commit message is
written to a temporary file and passed as `git commit -F <file>`. The one quoted
argument is that path, and quoting refuses anything containing a quote rather
than trying to escape it.

Because that executor runs a command through a shell, no argument this plugin
builds carries shell syntax — no `%`, parentheses, substitutions, or separators.
That is also why the branch list is read with `git branch --no-color` rather than
`for-each-ref --format=%(refname:short)`: the format string is shell syntax before
it is ever a format string. A route test asserts the property over every command
the plugin builds from every route.

## HTTP API

The browser half talks to this one over `/git-tools/api`. Every request passes
the composition's trust fence (the `connection` service's `requestRejection`,
which carries DSH's Host/Origin/Fetch-Metadata fence and the browser login
token) and must also carry `x-dsh-git-tools: 1`. Without the fence any page whose
hostname re-resolves to `127.0.0.1` could run git in a directory of its choosing.

| Method | Path | Purpose |
|---|---|---|
| GET | `/git-tools/api/state?sessionId=<id>` | Branch, local branches, changed files, the `+/-` line counts, and the upstream with its unpushed count, for the resolved checkout. Answers `{ ok, pending: true }` while the named Session has no live Agent |
| POST | `/git-tools/api/checkout` | `{ sessionId, branch }` — switch to an existing branch |
| POST | `/git-tools/api/create-branch` | `{ sessionId, branch }` — create and check out a new branch |
| POST | `/git-tools/api/message` | `{ sessionId, stageAll, locale }` — have the Session's model write a commit message from the pending change, in the language the panel is showing |
| POST | `/git-tools/api/commit` | `{ sessionId, message, stageAll }` — commit, staging every change first when `stageAll` |
| POST | `/git-tools/api/push` | `{ sessionId }` — push |

## The message the model writes

`/message` is a one-shot `ctx.llm.stream()` call with its own system prompt, no
tools, and a 90-second deadline: it reads the working tree and answers, and it
cannot run a turn. The prompt carries the branch, `git status --porcelain`, and
the same diff the commit would take — `git diff HEAD` when the unstaged changes
are included, `git diff --cached` when only the index is. Both are capped before
they are sent, so a large working tree costs a bounded prompt.

The answer is a Conventional Commits message — `type(scope): subject`, where the
type is whichever of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, or `revert` fits — written in a chosen language. The page
sends its choice with the request and the Host picks the instruction language from
it, so the type prefix stays English while the subject does not. Nothing is
committed unseen either way — the text lands in the box first.

## The commit-message language

Settings → 通用设置 carries the one row this plugin owns: `提交信息语言`, a
three-way choice of `跟随界面` (the default), `中文`, and `English`. It is a declared
client store persisted under `dsh.git-tools.commit-language` and shared by that
row and the panel — one handle, two registrations — so choosing there changes what
the next message is written in with nothing to reload. While it is `跟随界面` the
panel sends the language it is displaying, which is what a deployment that never
touches the row does.

The model is the one the Session is using, resolved in this order:

1. the Session's own selection (its composer pick, then its last request header),
2. the Agent's configured route,
3. the deployment's default model.

So the message is written by the model that conversation is talking to, and a
Session that has never made a request still has one. The call is stamped with the
Session id but is not a Session event — see the limitations.

The output cap is 4,096 tokens, because the cap covers everything the model emits
for the call — including the reasoning a thinking model produces first, which the
panel does not want but spends the same budget on. An answer that runs out of
budget anyway is still used: whatever was written lands in the box as a draft,
and only an answer with no text at all is an error.

## Sources

No build step: `src/index.js` (routes and the git runner), `src/git.js` (the
parsing, validation, and quoting rules), and `src/client.js` (the panel) are the
shipped sources.

## Tests

`tests/git.test.mjs` pins the rules between free text and a command line — which
branch names are accepted, which are refused, that the quoted argument refuses a
quote, and how git's output is parsed, including the `-z` status stream with its
rename records and its unquoted non-ASCII paths. `tests/routes.host.test.mjs`
drives the HTTP routes against a stubbed composition, so a route the page calls
can never fall through to the 404 branch, the trust fence is checked before any
git command, a Session with no live Agent is answered as pending rather than as
another checkout, a new file's lines are counted against real files on disk, and
the message route is shown to call the Session's own model over the diff the
commit would take. `tests/panel.client.test.mjs` boots the browser half in jsdom
and renders the overlay entry the way the shell does — with **no** slot data at
all — so the panel must appear and name the checkout the Host resolved, then
drives opening it, the tally on the pill and in the header (present with line
changes, absent when there are none), the commit body it sends, the message it has
written, the not-a-repository state, and switching the Session the frame shows —
including the read it shows from cache, and the re-ask when the Host has not
opened that Session yet.

```sh
node --test "plugins/dsh-git-tools/tests/*.test.mjs"
```

## Known limitations

- **No merge, rebase, fetch, stash, or graph.** Publishing history is the point
  here; the rest belongs in a terminal, which the sidebar already offers.
- **Push runs `git push` with no arguments.** A branch with no upstream fails
  with git's own message rather than being published with `-u`.
- **The written message is not a Session event.** It reaches a model but is not
  appended to the log, so a replay does not reproduce it and the Session's token
  accounting does not include it. Making it durable means adding a session event,
  which is a Host-side change this panel does not make.
- **The message is bounded.** The diff is capped at 12,000 characters before it
  is sent, so an enormous working tree is described by its first part only.
- **No Git graph.** The reference's `Git 图谱` entry is not implemented; history
  belongs in a terminal or a dedicated viewer.
- **No directory without a Session.** With no Session shown the Host falls back
  to the most recent live Agent and then to a registered workspace; when nothing
  names a directory at all, the read fails and the panel says so instead of
  guessing.
- **The tally reads new files to count them.** A file larger than 8 MiB is skipped
  rather than read, so a working tree whose changes are dominated by one huge new
  file under-reports. Counting them through git instead would mean staging them
  into a scratch index, which writes to the repository.
- **Hooks that are shell scripts cannot run under a confined session on Windows.**
  Git for Windows runs every hook through its own `sh.exe`, and a sandboxed process
  is given no signal pipe, so MSYS dies before the hook body runs and the commit
  aborts. That is the deployment's sandbox rather than this plugin — the `pwsh`
  tool cannot commit in such a repository either. The panel reports the cause in
  one line instead of git's stack trace, and the commit dialog's `跳过 Git hooks
  （--no-verify）` switch is the way through: it is off by default, and arming it
  says it bypasses the repository's own checks.
- **A Session that is still opening shows nothing for a moment.** The panel asks
  again once, 400 ms later; a Session that takes longer than that to get its Agent
  stays on its title until the next switch or command.
