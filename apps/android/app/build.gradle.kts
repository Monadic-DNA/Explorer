import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.monadicdna.explorer"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.monadicdna.explorer"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += providers.gradleProperty("explorerAbis").orElse("arm64-v8a").get().split(',') }
    }
    buildFeatures { compose = true; buildConfig = true }
    // Release signing: upload key for Play App Signing, credentials in gitignored keystore.properties.
    val keystoreProperties = Properties().apply { val f = rootProject.file("keystore.properties"); if (f.exists()) f.inputStream().use { load(it) } }
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias", "")
            keyPassword = keystoreProperties.getProperty("keyPassword", "")
            storeFile = keystoreProperties.getProperty("storeFile", "").takeIf { it.isNotEmpty() }?.let { rootProject.file(it) }
            storePassword = keystoreProperties.getProperty("storePassword", "")
        }
    }
    buildTypes {
        release {
            // Signing config applies only when keystore.properties exists, so CI without the key still assembles.
            if (keystoreProperties.getProperty("storePassword", "").isNotEmpty()) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            // Ship native symbols in the bundle so Play shows native stack traces.
            ndk { debugSymbolLevel = "FULL" }
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    // The bundled catalog snapshot is already zstd-compressed.
    androidResources { noCompress += "zst" }
    testOptions.unitTests.all {
        it.systemProperty("jna.library.path", rootProject.file("../../target/release").absolutePath)
        it.systemProperty("explorer.sample.dir", rootProject.file("../../.test-data/public-sample").absolutePath)
    }
}
// scripts/build-native.mjs places the catalog snapshot pinned in catalog/snapshot.json.
val catalogAsset = file("src/main/assets/catalog.zst")
tasks.named("preBuild") { doFirst { check(catalogAsset.exists()) { "Missing bundled research catalog. Run: node scripts/build-native.mjs android <abi>" } } }
dependencies {
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.8.7")
    // Health Connect: on-device health metrics for report and chat enrichment.
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("com.android.billingclient:billing-ktx:8.0.0")
    // Carries the sync key to a new device, end-to-end encrypted (docs/native-data-store.md).
    implementation("com.google.android.gms:play-services-auth-blockstore:16.4.0")
    // Access to the user's own Google Drive app-data folder, where encrypted sync records are stored.
    implementation("com.google.android.gms:play-services-auth:21.3.0")
    val composeBom = platform("androidx.compose:compose-bom:2025.04.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("net.java.dev.jna:jna:5.17.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
