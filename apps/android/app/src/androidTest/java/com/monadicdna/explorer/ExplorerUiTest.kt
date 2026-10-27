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
        activity.onNodeWithText("Account and premium").performScrollTo().performClick()
        activity.onNodeWithText("Stablecoin payments are available only on Web. They are not available in the Android app.").performScrollTo().assertIsDisplayed()
        activity.onNodeWithText("Subscribe with card").assertDoesNotExist()
        activity.onNodeWithText("Manage subscription or pay with a connected wallet").assertDoesNotExist()
    }
    @Test fun nativeHomeAndResultsNavigation() {
        // Chat and Reports are primary tabs; Results and Browse are secondary, under More.
        for(tab in listOf("Home","Chat","Reports","You","More"))activity.onNodeWithText(tab).assertIsDisplayed()
        activity.onNodeWithText("More").performClick()
        activity.onNodeWithText("Browse research").assertIsDisplayed()
        activity.onNodeWithText("Your matches").performClick()
        activity.onNodeWithText("saved study matches",substring=true).assertIsDisplayed()
    }
}
