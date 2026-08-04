# Ownership Transfer Runbook

A step-by-step procedure for taking ownership of the Marketing Budget
Dashboard, written to be read and acted on by an AI agent (Claude Code, Claude
Cowork, or any assistant Patricia is using) as well as by a person.

**How to read this document if you are an AI agent:** every step is tagged.

- **`[YOU]`** — this step needs the human's direct action: creating an
  account, clicking Accept on an invitation, entering a password, or
  authorising something in a browser. Do not attempt to perform this step
  yourself, including by driving a browser through it. Read the step aloud,
  wait for confirmation it is done, then continue.
- **`[AGENT]`** — this step is a normal file, terminal, or configuration
  operation. Do it directly; no need to ask permission for the specific
  command unless it looks destructive (it won't, in this document).

Do not skip ahead. Several steps depend on the one before completing — most
importantly, nothing in "Local setup" works until the GitHub transfer (Part 1)
is accepted.

If you are the human (Patricia) reading this yourself: the `[YOU]` /
`[AGENT]` tags still tell you which steps you have to do by hand and which
your assistant can just do for you once you hand it this file.

---

## Before you start

This document may have been sent to you directly (email, AirDrop, a shared
file) rather than through the GitHub repository itself — that's deliberate.
You can't be given access to the repository *inside* the repository, so this
first copy has to arrive some other way. Once Part 1 is done, everything else
in this project — including any future version of this document — lives in
your own copy of the repo.

---

## Part 1 — Accounts and ownership transfer

### 1.1 — `[YOU]` Create a GitHub account

If you don't already have one: [github.com/signup](https://github.com/signup).
Tell the person handing this over your GitHub username or the email you used —
they need it to send the transfer.

### 1.2 — `[YOU]` Accept the GitHub repository transfer

You'll receive an email or GitHub notification offering to transfer
`Avizent/PSH-Worksheet` to your account. Accept it. Once accepted, the
repository is yours — visible at `github.com/<your-username>/PSH-Worksheet`.

### 1.3 — `[YOU]` Create a Supabase account

If you don't already have one: [supabase.com](https://supabase.com). This is
where the actual budget data lives — a hosted PostgreSQL database.

### 1.4 — `[YOU]` Accept the Supabase project transfer or organisation invite

You'll be invited either to a Supabase organisation, or directly to the
project. Accept it. Once accepted, you can see the project in your Supabase
dashboard.

### 1.5 — `[YOU]` Reset the database password

In the Supabase dashboard: **Project Settings → Database → Reset database
password**. Do this yourself, even though a working password already exists —
the point is that the new one is something only you have ever seen. Copy the
new connection string somewhere safe (a password manager, not a chat
message) — you'll need it in Part 3.

**Checkpoint:** Part 1 is complete when you can see the repository under your
own GitHub account and the project in your own Supabase dashboard, and you
have a new connection string saved. Nothing below this line works until then.

---

## Part 2 — Local environment

From here on, if you're reading this inside an agent session, these are the
agent's steps to run.

### 2.1 — `[YOU]` Install Claude Code

If this document is being read by Claude Code already, this step is done.
Otherwise: [claude.com/claude-code](https://claude.com/claude-code). An agent
cannot install its own first instance on your machine.

### 2.2 — `[AGENT]` Check for Xcode Command Line Tools, Node.js, and pnpm

```bash
xcode-select -p || xcode-select --install
node --version   # needs 18+; if missing, install from nodejs.org
corepack enable   # provides pnpm
```

### 2.3 — `[AGENT]` Clone the repository

Use the URL from your own GitHub account, not the original — it's yours now.

```bash
git clone https://github.com/<your-username>/PSH-Worksheet.git
cd PSH-Worksheet
pnpm install
```

### 2.4 — `[AGENT]` Confirm the clone is sound

```bash
pnpm run typecheck
```

Should complete with no errors across all six packages. If it doesn't, stop
and report what failed rather than continuing to Part 3.

---

## Part 3 — Build and install the desktop app

### 3.1 — `[AGENT]` Build

```bash
pnpm --filter @workspace/scripts build-desktop
pnpm --filter @workspace/desktop package
```

This produces `artifacts/desktop/release/mac-arm64/Marketing Budget Dashboard.app`.

### 3.2 — `[AGENT]` Install

```bash
rm -rf "/Applications/Marketing Budget Dashboard.app"
cp -R "artifacts/desktop/release/mac-arm64/Marketing Budget Dashboard.app" /Applications/
xattr -dr com.apple.quarantine "/Applications/Marketing Budget Dashboard.app"
```

The `xattr` step matters: an app built locally on this Mac has no quarantine
flag, so it opens without a Gatekeeper warning. Building it here rather than
receiving it from elsewhere is what makes that true — see the note in
`docs/SESSION-CONTEXT.md` if you want the full explanation.

**Why build locally rather than just copy the `.app` that already exists on
the original machine:** a file that arrives by AirDrop, USB, or download
carries a quarantine flag and macOS will block it. One built directly on this
Mac does not. This is also why you'll rebuild locally whenever the code
changes, rather than waiting for someone to hand you a new installer.

### 3.3 — `[YOU]` First launch

Open **Marketing Budget Dashboard** from Applications or Spotlight. It will
ask for the database connection string — paste the one you saved in step 1.5.
It's stored encrypted in your Mac's Keychain, not in a file anyone can read.

Sign in with the account credentials provided separately (not in this
document).

**Checkpoint:** you should see the budget dashboard with live figures. If the
app shows a connection error, the most likely cause is the connection string
from 1.5 — check it was copied in full.

---

## Part 4 — Verify

### 4.1 — `[AGENT]` Run the test suite

```bash
pnpm --filter @workspace/api-server test
```

Should show all tests passing (91 at last count — check
`docs/SESSION-CONTEXT.md` for the current number). This runs against an
in-process test database and cannot touch your live data.

### 4.2 — `[YOU]` Run Check Integrity

In the app: admin area → **Data Integrity** (shield icon) → **Check
Integrity**. This is the fastest way to confirm the data itself is in good
shape after a transfer. It only reads data — nothing it does can change
anything.

---

## What to read next

Once the transfer is done, three documents cover everything else:

- **`CLAUDE.md`** — project conventions, read automatically by Claude Code in
  this repository.
- **`docs/SESSION-CONTEXT.md`** — what's been done and why, including
  decisions that look odd without the reasoning behind them. Read this before
  changing anything that seems strange.
- **`HANDOVER.md`** — current state of the data, what's outstanding, and
  where things are in the codebase.

This runbook's job ends once Part 4 is complete — it's a one-time procedure,
not an ongoing reference.
