# WMGF Rust Runtime

`wmgf-runtime` contains the platform-independent WMGF v1 validator and Starlark engine.
The same Rust Starlark implementation is exposed through JNI to the Android player and
through WebAssembly to the editor.

Android file existence checks stay in the Kotlin storage layer because they depend on
the Storage Access Framework. JSON structure, graph transitions, node/button/control
references, media constraints, social links, and safe relative paths are validated here.
The runtime also provides the shared `random`, `randint`, `choice`, and `shuffled`
Starlark built-ins used by both hosts.

```bash
cargo test --manifest-path runtime/Cargo.toml --locked
bash runtime/build-android.sh
cd editor && npm run wasm:build
```

The Android Gradle build runs both commands automatically and packages `arm64-v8a`
and `x86_64` libraries. The Rust Starlark dependency currently requires a 64-bit target.
