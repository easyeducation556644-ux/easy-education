plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.easyeducation.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.easyeducation.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "1.1.5"
    }

    buildFeatures { buildConfig = true }
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
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-auth:21.2.0")
}
