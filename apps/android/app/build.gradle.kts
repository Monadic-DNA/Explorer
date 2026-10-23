plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.monadicdna.explorer"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.monadicdna.explorer"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += providers.gradleProperty("explorerAbis").orElse("arm64-v8a").get().split(',') }
    }
    buildFeatures { compose = true; buildConfig = true }
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
    implementation("com.android.billingclient:billing-ktx:8.0.0")
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
