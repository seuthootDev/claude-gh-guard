# claude-gh-guard

![claude-gh-guard: stop Claude Code from committing to your work repo with your personal GitHub account](assets/social-preview.png)

[![npm version](https://img.shields.io/npm/v/claude-gh-guard)](https://www.npmjs.com/package/claude-gh-guard)
[![npm downloads](https://img.shields.io/npm/dm/claude-gh-guard)](https://www.npmjs.com/package/claude-gh-guard)
[![CI](https://github.com/seuthootDev/claude-gh-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/seuthootDev/claude-gh-guard/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/claude-gh-guard)](https://www.npmjs.com/package/claude-gh-guard)
[![license](https://img.shields.io/npm/l/claude-gh-guard)](LICENSE)

Stop Claude Code from committing to your work repo with your personal GitHub account.

It adds two things to Claude Code: a status line segment that always shows which GitHub identity is in play for the current repo, and a `PreToolUse` hook that blocks `git commit`, `git push` and `gh pr create` when the identity is definitely the wrong one. Zero runtime dependencies, Node >= 18.

**Right account** — the status line confirms the GitHub identity for this repo, followed by the Claude account in use:

![Status line showing a matching GitHub account](assets/match.png)

**Wrong account** — the status line turns red (here the SSH key still belongs to the right account, so it is shown too) and `gh pr create` is blocked with the fix:

![Status line showing a mismatch and the hook denying gh pr create](assets/mismatch.png)

**Nothing to check** — outside a GitHub repo (here: no remote yet) the segment is grey and nothing is blocked:

![Status line showing an untracked repo without a remote](assets/no-remote.png)

## Install

```sh
npx claude-gh-guard init
```

or

```sh
npm i -g claude-gh-guard && claude-gh-guard init
```

`init`:

- copies the CLI to `~/.claude-gh-guard/bin/cli.mjs`
- backs up your `settings.json`
- sets the status line to the guard; an existing status line is kept and wrapped via `--after '<original>'`
- adds a `PreToolUse` hook with matcher `Bash`

The settings file is `$CLAUDE_CONFIG_DIR/settings.json` if that variable is set, else `~/.claude/settings.json`. Use `--settings <path>` to override.

`claude-gh-guard uninstall` removes the hook and restores your original status line.

## States

| State | Meaning | Glyph | Blocks? |
|---|---|---|---|
| MATCH | Active account is the expected one (and the email check passes or is skipped) | 🟢 `[OK]` | no |
| MISMATCH | Active account is not the expected one, or the author email is wrong | 🔴 `[X]` | **yes** |
| AMBIGUOUS | Several of your accounts can push and commit history doesn't decide | 🟡 `[~]` | no (warning) |
| UNKNOWN | Expected account can't be determined (still learning, no access, API error) | ⚪ `[?]` | no (warning) |
| UNTRACKED | Not a git repo, no origin, or a non-GitHub remote | ⚪ `[?]` | no |
| UNAUTH | `gh` has no active login | ⚠️ `[!]` | no (warning) |

Only a definite MISMATCH blocks. Every other state, and any internal error, lets the command through.

Use `--ascii` or `GH_GUARD_ASCII=1` for the ASCII glyphs; `NO_COLOR` disables colors.

## Claude account

The status line also shows which Claude account Claude Code is logged in with, so you can tell your Claude configs apart at a glance:

```
🟢 gh:your-login · claude:company.example (max)
```

- A Team or Enterprise organization is shown by its name; a personal plan by its email domain, plus the plan.
- Read from `$CLAUDE_CONFIG_DIR/.claude.json` if that variable is set, else `~/.claude.json`.
- Display only: the Claude account is never judged and never blocks anything. MCP connectors follow the Claude account, so this also tells you which set of connectors you are using.
- `doctor` prints the full email and organization.

## Which identity each command is checked against

| Command | Identity that matters | How it is determined |
|---|---|---|
| `git commit` | author email | effective email, including `git -c user.email=...`, `GIT_AUTHOR_EMAIL=...` and `git commit --author=...` overrides |
| `git push` over SSH | owner of the SSH key | `ssh -T` for the host (or alias) of the URL git pushes to (`pushurl`, `insteadOf` applied); unknown with a custom SSH command |
| `git push` over HTTPS with the gh credential helper first | active gh account | `gh` `hosts.yml` |
| `git push` over HTTPS with another helper first | not checked | push identity unknown |
| `gh pr create` (including `-R [HOST/]OWNER/REPO`) | active gh account | `gh` `hosts.yml` |

## How the expected account is decided

1. A matching profile in `~/.gh-guard.json` (optional, below).
2. The repo owner is one of your logged-in accounts.
3. Learned automatically: for other owners (for example orgs) the guard asks the GitHub API which of your logged-in accounts can push to the repo. If several can, the one with the most recent commits wins. Results are cached for 7 days in `~/.claude-gh-guard/learned.json`. Tokens are fetched in memory with `gh auth token` and never written to disk.
4. Otherwise UNKNOWN.

The status line's render cache refreshes at least every 10 minutes.

## Moved repos (transfers and renames)

After a repo is transferred or renamed, GitHub keeps redirecting the old URL, so git keeps working while your remote still names the old owner. The guard judges by the remote URL, so it would keep judging by the old owner, and could expect the wrong account.

To catch this, the status line asks the GitHub API in the background, once per repo every 7 days, what the repo is called now (cached in `~/.claude-gh-guard/moved.json`). If the name changed:

- the status line appends `· moved→new-owner/repo`
- the hook adds a notice to every guarded command, and a note to any block, with the fix: `git remote set-url origin <new url>` (protocol and SSH alias kept)
- `doctor` prints a `moved:` line, checking live if the cache is stale

It only warns: the expected account is still judged by the remote URL until you update it.

## Optional profiles: `~/.gh-guard.json`

```json
{
  "profiles": {
    "personal": {
      "ghUser": "your-personal-login",
      "gitEmail": "you@example.com",
      "owners": ["your-personal-login"]
    },
    "work": {
      "ghUser": "your-work-login",
      "gitEmail": ["you@company.com", "you@users.noreply.github.com"],
      "owners": ["company-org", "other-org/one-repo"]
    }
  }
}
```

`owners` entries are an owner (`company-org`) or an exact `owner/repo`; `owner/repo` wins over `owner`; no wildcards. First matching profile wins. `gitEmail` is a string or an array. A matching profile skips automatic learning.

## Doctor

```sh
claude-gh-guard doctor
```

Prints, for the current directory: gh config location, logins, active account, remote, whether the repo has moved, effective email, push identity, expected account and why, resulting state, and timing. For AMBIGUOUS it prints a ready-to-paste profile snippet.

## Windows

- The `gh` config is read from `%APPDATA%\GitHub CLI`.
- Claude Code runs commands through Git Bash; the guard works there without WSL.
- If your terminal can't render emoji, use `--ascii` or `GH_GUARD_ASCII=1`.

## Known gaps

None of these ever block a command; they only limit what the guard can check.

- Commands inside subshells or groups (`( ... )`, `{ ...; }`) or behind `env` / `command` prefixes are not inspected.
- Only `github.com` is tracked. GitHub Enterprise and other hosts are UNTRACKED (never blocked); profiles do not change that today.
- Custom SSH commands (`core.sshCommand`, `GIT_SSH`, `GIT_SSH_COMMAND`) can pick any key, so the push identity is unknown (not blocked).
- HTTPS pushes whose first credential helper is not the gh helper (for example Git Credential Manager) have an unknown push identity (not blocked).
- The status line never spawns `ssh`, so it shows the SSH push identity only after the hook or `doctor` has probed it once. Run `claude-gh-guard doctor` in the repo once to prime it.
- The status line judges the push remote, while `gh pr create` is judged against the PR base repo (a `gh-resolved` remote, else `upstream`, else `origin`). In fork workflows the two can differ.
- On Windows without Git Bash, a wrapped status line is run through `cmd.exe`; a wrapped command containing quotes may not run there.

## License

MIT
