package com.monadicdna.explorer

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test

class ExplorerUiTest {
    @get:Rule val activity=createAndroidComposeRule<MainActivity>()
    @Test fun stablecoinPaymentsAreWebOnly() {
        activity.onNodeWithText("More").performClick()
        activity.onNodeWithText("Account").performScrollTo().performClick()
        activity.onNodeWithText("Stablecoin payments are available only on Web. They are not available in the Android app.").performScrollTo().assertIsDisplayed()
        activity.onNodeWithText("Subscribe with card").assertDoesNotExist()
        activity.onNodeWithText("Manage subscription or pay with a connected wallet").assertDoesNotExist()
    }
    @Test fun nativeHomeAndResultsNavigation() {
        activity.onNodeWithText("Your DNA. Your discoveries.").assertIsDisplayed()
        activity.onNodeWithText("Results").performClick()
        activity.onNodeWithText("0 saved study matches").assertIsDisplayed()
    }
}
