package com.monadicdna.explorer

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

class ExplorerUiTest {
    @get:Rule val activity=createAndroidComposeRule<MainActivity>()
    @Test fun nativeHomeAndResultsNavigation() {
        activity.onNodeWithText("Your DNA. Your discoveries.").assertIsDisplayed()
        activity.onNodeWithText("Results").performClick()
        activity.onNodeWithText("0 saved study matches").assertIsDisplayed()
    }
}
