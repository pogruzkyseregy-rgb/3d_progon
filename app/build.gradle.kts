plugins {
    id("com.android.application")
}

android {
    namespace = "com.aurora.tamagotchi"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aurora.tamagotchi"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The web game lives in ../web and is packed straight into the APK assets
    sourceSets["main"].assets.srcDirs("../web")
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
