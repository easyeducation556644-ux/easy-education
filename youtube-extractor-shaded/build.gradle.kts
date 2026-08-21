import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar

plugins {
    `java-library`
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    implementation("com.github.libre-tube:NewPipeExtractor:738c3d4") {
        // Compile-time annotations only. The Android app already receives jsr305 from gRPC.
        exclude(group = "com.google.code.findbugs", module = "jsr305")
    }
}

val shadedExtractor by configurations.creating {
    isCanBeConsumed = true
    isCanBeResolved = false
}

val shadedJar = tasks.named<ShadowJar>("shadowJar") {
    archiveFileName.set("youtube-extractor-shaded.jar")
    archiveClassifier.set("")

    // NewPipe 738c3d4 requires protobuf-javalite 4.35.1, while Firebase Firestore/gRPC in the
    // Android app resolves protobuf-javalite 3.25.x. Relocate NewPipe's entire protobuf runtime
    // so both stacks can use the version they were built and tested against without classpath
    // replacement or duplicate well-known-message classes.
    relocate("com.google.protobuf", "com.easyeducation.shaded.protobuf")

    // protobuf-javalite also ships source .proto resources. They are not read by the extractor at
    // runtime and Android would otherwise see the original google/protobuf resource paths from
    // both Firebase's protobuf 3.x and this shaded jar. Keep only the relocated bytecode runtime.
    exclude("**/*.proto")
    mergeServiceFiles()
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA")
}

artifacts {
    add(shadedExtractor.name, shadedJar)
}
