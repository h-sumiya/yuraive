#!/usr/bin/env bash
set -euo pipefail

crate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$crate_dir/.." && pwd)"
player_dir="$project_dir/player-android"
output_dir="${1:-$player_dir/app/build/generated/rustJniLibs}"

sdk_dir="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_dir" && -f "$player_dir/local.properties" ]]; then
    sdk_dir="$(sed -n 's/^sdk\.dir=//p' "$player_dir/local.properties" | tail -1)"
fi
if [[ -z "$sdk_dir" ]]; then
    echo "Android SDK directory is not configured" >&2
    exit 1
fi

ndk_version="${YURAIVE_ANDROID_NDK_VERSION:-}"
ndk_dir="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ -z "$ndk_dir" ]]; then
    if [[ -z "$ndk_version" ]]; then
        echo "YURAIVE_ANDROID_NDK_VERSION is not configured" >&2
        exit 1
    fi
    ndk_dir="$sdk_dir/ndk/$ndk_version"
elif [[ -n "$ndk_version" && -f "$ndk_dir/source.properties" ]]; then
    installed_ndk_version="$(sed -n 's/^Pkg\.Revision[[:space:]]*=[[:space:]]*//p' "$ndk_dir/source.properties" | head -1)"
    if [[ "$installed_ndk_version" != "$ndk_version" ]]; then
        echo "Android NDK version mismatch: expected $ndk_version, found $installed_ndk_version" >&2
        exit 1
    fi
fi
toolchain="$ndk_dir/toolchains/llvm/prebuilt/linux-x86_64/bin"
if [[ ! -d "$toolchain" ]]; then
    echo "Android NDK LLVM toolchain was not found: $toolchain" >&2
    exit 1
fi

mkdir -p "$output_dir"
find "$output_dir" -type f -name 'lib*.so' -delete

build_abi() {
    local target="$1"
    local abi="$2"
    local linker="$3"
    local linker_var="CARGO_TARGET_${target^^}_LINKER"
    linker_var="${linker_var//-/_}"
    local cc_var="CC_${target//-/_}"
    local ar_var="AR_${target//-/_}"

    env \
        "$linker_var=$toolchain/$linker" \
        "$cc_var=$toolchain/$linker" \
        "$ar_var=$toolchain/llvm-ar" \
        cargo build \
        --manifest-path "$crate_dir/Cargo.toml" \
        --locked \
        --release \
        --target "$target"

    mkdir -p "$output_dir/$abi"
    local output="$output_dir/$abi/libyuraive_runtime.so"
    cp "$crate_dir/target/$target/release/libyuraive_runtime.so" "$output"
    "$toolchain/llvm-strip" --strip-unneeded "$output"
}

build_abi aarch64-linux-android arm64-v8a aarch64-linux-android26-clang
build_abi x86_64-linux-android x86_64 x86_64-linux-android26-clang
