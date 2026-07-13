plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "dev.hiro.wmgfplayer"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.hiro.wmgfplayer"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    packaging {
        resources.excludes += setOf(
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*",
        )
        // build-android.sh already strips these with the matching NDK toolchain.
        jniLibs.keepDebugSymbols += "**/libwmgf_validator.so"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    sourceSets.getByName("main").jniLibs.srcDir(layout.buildDirectory.dir("generated/rustJniLibs"))
}

val rustJniOutput = layout.buildDirectory.dir("generated/rustJniLibs")
val buildRustValidator by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir)
    commandLine("bash", rootProject.file("validator/build-android.sh"), rustJniOutput.get().asFile)
    inputs.files(
        rootProject.file("validator/Cargo.toml"),
        rootProject.file("validator/Cargo.lock"),
        rootProject.file("validator/build-android.sh"),
        fileTree(rootProject.file("validator/src")),
    )
    outputs.dir(rustJniOutput)
}

val testRustValidator by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir)
    commandLine("cargo", "test", "--manifest-path", rootProject.file("validator/Cargo.toml"), "--locked")
    inputs.files(
        rootProject.file("validator/Cargo.toml"),
        rootProject.file("validator/Cargo.lock"),
        fileTree(rootProject.file("validator/src")),
    )
}

tasks.named("preBuild").configure { dependsOn(buildRustValidator) }
tasks.matching { it.name == "testDebugUnitTest" }.configureEach { dependsOn(testRustValidator) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.04.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("androidx.core:core-ktx:1.16.0")

    implementation("androidx.media3:media3-exoplayer:1.10.1")
    implementation("androidx.media3:media3-session:1.10.1")
    implementation("androidx.media3:media3-ui:1.10.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.eed3si9n.starlark:starlark:4.2.1") {
        exclude(group = "com.google.auto.value", module = "auto-value")
    }

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
