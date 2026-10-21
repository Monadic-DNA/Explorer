package com.monadicdna.explorer

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val SpaceGrotesk = FontFamily(Font(R.font.space_grotesk_light, FontWeight.Light), Font(R.font.space_grotesk_regular), Font(R.font.space_grotesk_bold, FontWeight.Bold))
val Garamond = FontFamily(Font(R.font.eb_garamond_medium, FontWeight.Medium))

@Composable fun VaultTheme(content: @Composable () -> Unit) {
    // Vault deliberately uses a light app canvas with dark brand panels.
    val base = Typography()
    fun TextStyle.brand() = copy(fontFamily = SpaceGrotesk)
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = VaultColors.darkMain, onPrimary = Color.White,
            secondary = VaultColors.purple900, onSecondary = Color.White,
            primaryContainer = VaultColors.purple200, onPrimaryContainer = VaultColors.purple900,
            secondaryContainer = VaultColors.purple100, onSecondaryContainer = VaultColors.purple900,
            background = VaultColors.offTone, onBackground = VaultColors.darkMain,
            surface = VaultColors.offTone, onSurface = VaultColors.darkMain,
            surfaceVariant = VaultColors.purple100, onSurfaceVariant = VaultColors.darkMain,
            surfaceContainer = Color.White, surfaceContainerHigh = VaultColors.purple100,
            outline = VaultColors.border
        ),
        typography = Typography(
            displayLarge=base.displayLarge.brand(), displayMedium=base.displayMedium.brand(), displaySmall=base.displaySmall.brand(),
            headlineLarge=base.headlineLarge.brand().copy(fontWeight=FontWeight.Bold), headlineMedium=base.headlineMedium.brand().copy(fontWeight=FontWeight.Bold), headlineSmall=base.headlineSmall.brand(),
            titleLarge=base.titleLarge.brand(), titleMedium=base.titleMedium.brand(), titleSmall=base.titleSmall.brand(),
            bodyLarge=base.bodyLarge.brand().copy(fontWeight=FontWeight.Light), bodyMedium=base.bodyMedium.brand(), bodySmall=base.bodySmall.brand(),
            labelLarge=base.labelLarge.brand(), labelMedium=base.labelMedium.brand(), labelSmall=base.labelSmall.brand()
        ),
        shapes = Shapes(extraSmall=RoundedCornerShape(10.dp), small=RoundedCornerShape(16.dp), medium=RoundedCornerShape(24.dp), large=RoundedCornerShape(32.dp), extraLarge=RoundedCornerShape(40.dp)),
        content=content
    )
}

@Composable fun VaultArt(resource: Int, modifier: Modifier = Modifier) {
    Image(painterResource(resource), contentDescription=null, modifier=modifier.height(120.dp).fillMaxWidth())
}

@Composable fun VaultHero() {
    Column(Modifier.fillMaxWidth().background(VaultColors.darkMain, RoundedCornerShape(32.dp)).padding(24.dp), horizontalAlignment=Alignment.CenterHorizontally, verticalArrangement=Arrangement.spacedBy(20.dp)) {
        Image(painterResource(R.drawable.vault_brand_mark), contentDescription=null, modifier=Modifier.size(64.dp))
        Image(painterResource(R.drawable.vault_wordmark), contentDescription="Monadic DNA", modifier=Modifier.fillMaxWidth().height(36.dp))
        Text("EXPLORER", color=Color.White, style=MaterialTheme.typography.labelMedium, letterSpacing=4.sp)
        Text("Your DNA. Your discoveries.", color=Color.White, style=MaterialTheme.typography.headlineLarge)
        Text("Explore genetic research while your DNA remains private, protected, and in your hands.", color=Color.White, style=MaterialTheme.typography.bodyLarge)
    }
}

// The shared Rust core classifies traits; native views choose the corresponding Vault palette.
fun vaultCardPalette(category: String): Pair<Color, Color> = when(category) {
    "cardiometabolic", "immune", "medication" -> VaultColors.green200 to VaultColors.green900
    "sleep_energy" -> VaultColors.yellow200 to VaultColors.yellow900
    "body_composition" -> VaultColors.blue200 to VaultColors.blue900
    else -> VaultColors.purple200 to VaultColors.purple900
}
