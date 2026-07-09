# Installing Catamaran

Packaged builds are published on the
[latest release](https://github.com/arunk4m/catamaran/releases/latest) for macOS.
Once installed, Catamaran can update itself from **Settings → Updates** (Stable or Dev
channel).

Prefer to build from source? See the [developer guide](DEVELOPMENT.md).

## macOS

1. Download the `.dmg` for your chip from the
   [latest release](https://github.com/arunk4m/catamaran/releases/latest):
   - Apple Silicon (M1/M2/M3/…): `Catamaran_<version>_aarch64.dmg`
   - Intel: `Catamaran_<version>_x64.dmg`
2. Open the `.dmg` and drag **Catamaran** into **Applications**.

> **First launch on an unsigned build:** community builds are not yet Developer-ID
> signed, so Gatekeeper will warn that the app "cannot be verified". Either
> right-click the app in Applications and choose **Open → Open**, or clear the
> quarantine flag once:
>
> ```sh
> xattr -cr /Applications/Catamaran.app
> ```
>
> Signed and notarized builds are on the roadmap.

> **Kubeconfigs with exec auth (OIDC, cloud CLIs)?** Catamaran resolves your
> login-shell `PATH` at startup, so tools like `aws`, `gke-gcloud-auth-plugin`,
> and `kubectl` plugins are found even when launched from the Dock. If a context
> still can't find its credential plugin, make sure the tool is installed and on
> your shell `PATH`.

### Building the DMG yourself

```sh
pnpm install
pnpm tauri build     # produces .app and .dmg under apps/desktop/src-tauri/target/release/bundle/
```

## Updating

Catamaran checks for updates from **Settings → Updates**:

- **Stable** — released versions (default).
- **Dev** — rolling pre-releases for early access.

Updates are cryptographically signed and verified before install.

## Uninstalling

Drag **Catamaran** from Applications to the Trash. Application data lives in your OS
config directory; remove it manually if you want a clean uninstall.
