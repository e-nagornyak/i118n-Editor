# i118n-Editor

Desktop editor for JSON locale files, built with Tauri 2 (Rust backend) and React.
Open a folder of `en.json`, `uk.json`, … and edit every language side by side in one table.

## Features

- Project management: several locale folders, the last opened one is restored on start
- Virtualized table and tree view, fast on thousands of keys
- Search, "empty only" filter, find & replace, command palette
- Per-language fill stats and missing-key counters
- Placeholder validation (`{name}`, `{{count}}`, …) across languages
- Undo / redo history and a diff view before saving
- Preserves each file's indent, line endings and trailing newline on save
- Watches the folder and picks up external file changes
- Auto-translate for single cells or in bulk: DeepL, MyMemory, Lingva, Google (unofficial), LibreTranslate

## Development

Requirements: Node.js 18+, Rust stable, [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev     # run the app
npm run tauri:build   # build a release bundle
```

## License

[MIT](LICENSE)
