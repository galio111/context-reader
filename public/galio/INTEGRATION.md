# Galio runtime snapshot

Source: private `galio111/galio-design-library`, revision `88e1f8b9185e5ad938852e997ab1e183cef9acd5`.

The SDK, component catalogs and component runtime are vendored for Context Reader. Original third-party notices remain under `third-party/`. Upstream TSX examples are retained as `.tsx.txt` source references, not application code. Context Reader adapters are in `lib/uiDesignRuntime.ts`; this snapshot is not a live remote import.

The source inventories describe accepted Context Reader commit `b590ed3`. They record source declarations, not proof of visible/replayable behavior for every state. Reviewed current editable bindings are in `lib/ui-inventory.json` and `lib/ui-targets.json`.

The library contains 171 catalog items. Only 18 reviewed button/hover adapters are currently exposed for live replacement; complex transition, physics and layout examples require separate integration. See `docs/ui-design-studio.md` for supported behavior and verification limits.
