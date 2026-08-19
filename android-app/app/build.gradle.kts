plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.easyeducation.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.easyeducation.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 18
        versionName = "2.3.0-native"
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    lint {
        // AGP 8.7.x + Kotlin 2.0 can crash inside Lifecycle's LiveData lint detector.
        // Keep release lint enabled and disable only the crashing detector.
        disable += "NullSafeMutableLiveData"
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("EE_KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("EE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("EE_KEY_ALIAS")
                keyPassword = System.getenv("EE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// NewPipeExtractor ships the full protobuf-javalite runtime. Firebase also pulls a small
// protolite bundle containing overlapping well-known protobuf classes. Keep the full runtime as
// the single source of truth so release builds do not package duplicate DescriptorProtos classes.
configurations.configureEach {
    exclude(group = "com.google.firebase", module = "protolite-well-known-types")
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.webkit:webkit:1.12.1")

    val composeBom = platform("androidx.compose:compose-bom:2025.05.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-auth:21.2.0")

    implementation(platform("com.google.firebase:firebase-bom:34.11.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-messaging")
    // Compile-only because the PO-token implementation does not use Crashlytics at runtime; this
    // only keeps an optional diagnostic import source-compatible while the integration settles.
    compileOnly("com.google.firebase:firebase-crashlytics")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    // Mature YouTube extraction engine: signatureCipher + n-parameter deobfuscation,
    // adaptive DASH streams, current player client handling. Easy Education keeps its own
    // encrypted downloader/player; this dependency is used only to resolve media streams.
    implementation("com.github.libre-tube:NewPipeExtractor:738c3d4")

    val media3Version = "1.9.4"
    implementation("androidx.media3:media3-common:$media3Version")
    implementation("androidx.media3:media3-datasource:$media3Version")
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")
    implementation("androidx.media3:media3-transformer:$media3Version")
}
