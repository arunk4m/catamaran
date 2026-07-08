# Contributing to Catamaran

Thanks for your interest! Catamaran is in early, active development, so expect fast movement and breaking changes.

By participating, you agree to abide by our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Setup

Follow the [developer guide](docs/DEVELOPMENT.md) — it covers prerequisites, running the app, architecture, and the capability-registry pattern that almost every change touches.

## Ground rules

1. **Test-driven development is mandatory.** Every change starts with a failing test. No implementation lands without one.
2. **Coverage floors are hard CI gates** — 85% lines for TypeScript; Rust is currently 55% and ratchets toward 85% as cluster-bound integration tests land (never lower it).
3. **Every backend operation must be a capability.** Register it once in `capabilities.rs`; the MCP surface is generated and verified automatically.
4. **Destructive operations must be annotated** (`destructive`, `requires_confirm`) so both UI confirmations and MCP tool hints stay correct.

## Before opening a PR

```sh
cargo test
pnpm test
```

Both must pass locally. Keep PRs focused — one logical change per PR, with a description of what and why.
