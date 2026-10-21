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
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Full public export -> real native import -> Compose Run All -> HTTP -> Rust -> visible results. */
class PublicSampleTest {
    @get:Rule val ui=createAndroidComposeRule<MainActivity>()
    @Test fun public23andMeImportAndRunAll() {
        val assets=InstrumentationRegistry.getInstrumentation().context.assets
        assumeTrue("Run python scripts/prepare-public-sample.py first",assets.list("public-sample")?.contains("23andme-public.txt")==true)
        fun text(name:String)=assets.open("public-sample/$name").bufferedReader().use{it.readText()}
        val expected=JSONObject(text("expected.json"))
        val studies=text("studies.json")
        val server=MockWebServer()
        server.dispatcher=object:Dispatcher(){
            override fun dispatch(request:RecordedRequest):MockResponse {
                val rows=if(request.requestUrl?.queryParameter("offset")=="0")studies else "[]"
                return MockResponse().setHeader("Content-Type","application/json").setBody("{\"data\":$rows}")
            }
        }
        server.start()
        val endpoint=server.url("/").toString().trimEnd('/')
        lateinit var model:ExplorerModel
        try {
            ui.runOnUiThread {
                model=ExplorerModel(ui.activity.application,SecureDataVault(ui.activity,TestVaultProtector(),File(ui.activity.cacheDir,"public-sample-${UUID.randomUUID()}")))
                model.authenticate={}
                ui.activity.setContent { VaultTheme { ExplorerApp(model) } }
                model.backend=endpoint
                model.acceptedDisclaimer=true
            }
            val bytes=assets.open("public-sample/23andme-public.txt").use{it.readBytes()}
            ui.runOnUiThread { model.run("Importing public sample") { model.importGenotypeData(bytes,"23andme-public.txt") } }
            ui.waitUntil(180000){(!model.busy && model.metadata.optInt("count")==expected.getInt("parsedVariants"))||model.error!=null}
            ui.runOnUiThread {
                assertNull(model.error)
                assertEquals(expected.getInt("parsedVariants"),model.metadata.getInt("count"))
            }
            ui.onNodeWithText("Results",useUnmergedTree=false).performClick()
            ui.onNodeWithText("Run all").performClick()
            ui.waitUntil(180000){(!model.busy && model.results.size==expected.getInt("matches"))||model.error!=null}
            ui.onNodeWithText("${expected.getInt("matches")} saved study matches").assertIsDisplayed()
            ui.runOnUiThread {
                assertNull(model.error)
                val wanted=expected.getJSONArray("results").objects().associateBy{it.getInt("studyId")}
                assertEquals(wanted.size,model.results.size)
                for(actual in model.results){
                    val row=wanted.getValue(actual.getInt("studyId"))
                    for(key in listOf("matchedSnp","userGenotype","effectType","riskLevel"))assertEquals("$key for study ${row.getInt("studyId")}",row.getString(key),actual.getString(key))
                    assertEquals(row.getDouble("riskScore"),actual.getDouble("riskScore"),1e-12)
                }
                val imported=Core.obj("import_results",json("content" to model.exportResults(),"fileName" to "results.tsv"))
                assertEquals(wanted.size,imported.getJSONArray("results").length())
            }
            val bitmap=ui.onRoot().captureToImage().asAndroidBitmap()
            File(ui.activity.filesDir,"public-sample-results.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
            ui.runOnUiThread { model.clear() }
        } finally { server.shutdown() }
    }
}
