#!/usr/bin/env bash
set -euo pipefail

crate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
player_dir="$(cd "$crate_dir/.." && pwd)"
output_dir="${1:-$player_dir/app/build/generated/rustJniLibs}"

sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_dir" && -f "$player_dir/local.properties" ]]; then
    sdk_dir="$(sed -n 's/^sdk\.dir=//p' "$player_dir/local.properties" | tail -1)"
fi
if [[ -z "$sdk_dir" ]]; then
    echo "Android SDK directory is not configured" >&2
    exit 1
fi

ndk_dir="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ -z "$ndk_dir" ]]; then
    ndk_dir="$(find "$sdk_dir/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
fi
toolchain="$ndk_dir/toolchains/llvm/prebuilt/linux-x86_64/bin"
if [[ ! -d "$toolchain" ]]; then
    echo "Android NDK LLVM toolchain was not found: $toolchain" >&2
    exit 1
fi

mkdir -p "$output_dir"

build_abi() {
    local target="$1"
    local abi="$2"
    local linker="$3"
    local linker_var="CARGO_TARGET_${target^^}_LINKER"
    linker_var="${linker_var//-/_}"

    env "$linker_var=$toolchain/$linker" \
        cargo build \
        --manifest-path "$crate_dir/Cargo.toml" \
        --locked \
        --release \
        --target "$target"

    mkdir -p "$output_dir/$abi"
    local output="$output_dir/$abi/libwmgf_validator.so"
    cp "$crate_dir/target/$target/release/libwmgf_validator.so" "$output"
    "$toolchain/llvm-strip" --strip-unneeded "$output"
}

build_abi aarch64-linux-android arm64-v8a aarch64-linux-android26-clang
build_abi armv7-linux-androideabi armeabi-v7a armv7a-linux-androideabi26-clang
build_abi i686-linux-android x86 i686-linux-android26-clang
build_abi x86_64-linux-android x86_64 x86_64-linux-android26-clang
