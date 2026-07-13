# WMGF Validator

`wmgf-validator` is the platform-independent semantic validator for WMGF v1 JSON.
It exposes `validate_json(&str)` as a normal Rust API for a future desktop application,
and the same function through JNI for the Android player.

Android file existence checks stay in the Kotlin storage layer because they depend on
the Storage Access Framework. JSON structure, graph transitions, node/button/control
references, media constraints, social links, and safe relative paths are validated here.

```bash
cargo test --manifest-path validator/Cargo.toml --locked
bash validator/build-android.sh
```

The Android Gradle build runs both commands automatically and packages arm64-v8a,
armeabi-v7a, x86, and x86_64 libraries.
