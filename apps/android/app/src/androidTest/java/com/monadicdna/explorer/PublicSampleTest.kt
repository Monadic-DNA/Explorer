package com.monadicdna.explorer

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import android.graphics.Bitmap
import java.io.File
import androidx.activity.compose.setContent
import java.util.UUID
import org.json.JSONArray
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Full public export -> real native import and bundled Run all -> pinned fixture parity -> paged Results. */
class PublicSampleTest {
    @get:Rule val ui=createAndroidComposeRule<MainActivity>()
    @Test fun public23andMeImportAndResults() {
        val assets=InstrumentationRegistry.getInstrumentation().context.assets
        assumeTrue("Run python scripts/prepare-public-sample.py first",assets.list("public-sample")?.contains("23andme-public.txt")==true)
        fun text(name:String)=assets.open("public-sample/$name").bufferedReader().use{it.readText()}
        val expected=JSONObject(text("expected.json"))
        val studies=JSONArray(text("studies.json"))
        lateinit var model:ExplorerModel
        ui.runOnUiThread {
            model=ExplorerModel(ui.activity.application,SecureDataVault(ui.activity,TestVaultProtector(),File(ui.activity.cacheDir,"public-sample-${UUID.randomUUID()}")),TestSyncKeys())
            model.authenticate={}
            ui.activity.setContent { VaultTheme { ExplorerApp(model) } }
            model.acceptedDisclaimer=true
        }
        // Import runs Run all against the bundled catalog, as a user would see it.
        val bytes=assets.open("public-sample/23andme-public.txt").use{it.readBytes()}
        ui.runOnUiThread { model.run("Importing public sample") { model.importGenotypeData(bytes,"23andme-public.txt") } }
        ui.waitUntil(300000){(!model.busy && model.resultCount>0)||model.error!=null}
        ui.runOnUiThread {
            assertNull(model.error)
            assertEquals(expected.getInt("parsedVariants"),model.metadata.getInt("count"))
        }
        // Match the pinned fixture so expectations stay independent of catalog updates.
        val wanted=expected.getJSONArray("results").objects().associateBy{it.getInt("studyId")}
        var matched=JSONArray()
        ui.runOnUiThread { model.run("Matching pinned fixture") {
            matched=Core.arr("store_analyze",json("store" to model.storeHandle,"studies" to studies,"strict" to true,"now" to "2026-10-21T00:00:00Z"))
            model.refreshResults()
        } }
        ui.waitUntil(60000){!model.busy||model.error!=null}
        ui.onNodeWithText("More").performClick()
        ui.onNodeWithText("Your matches").performClick()
        ui.onNodeWithText("saved study matches",substring=true).assertIsDisplayed()
        ui.runOnUiThread {
            assertNull(model.error)
            assertEquals(wanted.size,matched.length())
            for(row in matched.objects()){
                val expectedRow=wanted.getValue(row.getInt("studyId"))
                // The saved copy in the encrypted store is the same row.
                assertEquals(row.toString(),model.resultFor(row.getInt("studyId")).toString())
                for(key in listOf("matchedSnp","userGenotype","effectType","riskLevel"))assertEquals("$key for study ${expectedRow.getInt("studyId")}",expectedRow.getString(key),row.getString(key))
                assertEquals(expectedRow.getDouble("riskScore"),row.getDouble("riskScore"),1e-12)
            }
            val exported=Core.obj("import_results",json("content" to model.exportResults(),"fileName" to "results.tsv"))
            assertEquals(model.resultCount,exported.getJSONArray("results").length())
        }
        val bitmap=ui.onRoot().captureToImage().asAndroidBitmap()
        File(ui.activity.filesDir,"public-sample-results.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        ui.runOnUiThread { model.clear() }
        ui.waitUntil(30000){!model.dataUnlocked && !model.locking}
    }
}
