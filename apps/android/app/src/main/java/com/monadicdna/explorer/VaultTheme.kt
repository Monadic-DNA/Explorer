package com.monadicdna.explorer

import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
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

// Vault's StarLoaderView: colored stars spin and pulse around the brand mark while the app works.
// The brand mark is white-on-dark art, so the dark star anchors the loader on the light canvas.
@Composable fun VaultStarLoader(modifier: Modifier = Modifier, central: Int = R.drawable.vault_star) {
    val infinite = androidx.compose.animation.core.rememberInfiniteTransition(label="vault-stars")
    val spin by infinite.animateFloat(0f, 360f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(4000, easing=androidx.compose.animation.core.LinearEasing)), label="spin")
    val stars = listOf(R.drawable.vault_star_orange, R.drawable.vault_star_blue, R.drawable.vault_star_purple, R.drawable.vault_star_yellow)
    Box(modifier.size(120.dp), contentAlignment=Alignment.Center) {
        Image(painterResource(central), contentDescription=null, modifier=Modifier.size(56.dp))
        stars.forEachIndexed { index, resource ->
            val pulse by infinite.animateFloat(1f, 0.8f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(1200), androidx.compose.animation.core.RepeatMode.Reverse, initialStartOffset=androidx.compose.animation.core.StartOffset(index*200)), label="pulse$index")
            val angle = index * Math.PI / 2
            Image(painterResource(resource), contentDescription=null, modifier=Modifier
                .offset(x=(kotlin.math.cos(angle)*50).dp, y=(kotlin.math.sin(angle)*50).dp)
                .size(20.dp)
                .rotate(spin)
                .graphicsLayer { scaleX=pulse; scaleY=pulse })
        }
    }
}

@Composable fun VaultHero() {
    // Like Vault's splash screen, the brand mark turns once when the hero appears.
    val spin = androidx.compose.animation.core.Animatable(0f)
    androidx.compose.runtime.LaunchedEffect(Unit){ spin.animateTo(360f, androidx.compose.animation.core.tween(3000, easing=androidx.compose.animation.core.CubicBezierEasing(0.8f,0.2f,0.5f,1f))) }
    Column(Modifier.fillMaxWidth().background(VaultColors.darkMain, RoundedCornerShape(32.dp)).padding(24.dp), horizontalAlignment=Alignment.CenterHorizontally, verticalArrangement=Arrangement.spacedBy(20.dp)) {
        Image(painterResource(R.drawable.vault_brand_mark), contentDescription=null, modifier=Modifier.size(64.dp).rotate(spin.value))
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
