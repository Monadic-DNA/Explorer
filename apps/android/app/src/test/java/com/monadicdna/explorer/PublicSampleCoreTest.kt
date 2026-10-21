package com.monadicdna.explorer

import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

class PublicSampleCoreTest {
    @Test fun fullPublicExportMatchesIndependentReference() {
        val folder=File(requireNotNull(System.getProperty("explorer.sample.dir")))
        assumeTrue("Prepare optional full sample first",File(folder,"23andme-public.txt").isFile)
        val expected=JSONObject(File(folder,"expected.json").readText())
        val session=(Core.call("session_create") as Number).toLong()
        try {
            val metadata=Core.importGenotype(session,File(folder,"23andme-public.txt").readBytes(),"23andme-public.txt")
            assertEquals(expected.getInt("parsedVariants"),metadata.getInt("count"))
            val result=Core.arr("session_analyze",json("session" to session,"studies" to JSONArray(File(folder,"studies.json").readText()),"strict" to true))
            val wanted=expected.getJSONArray("results").objects().associateBy{it.getInt("studyId")}
            assertEquals(wanted.size,result.length())
            for(actual in result.objects()) {
                val row=wanted.getValue(actual.getInt("studyId"))
                for(key in listOf("matchedSnp","userGenotype","effectType","riskLevel"))assertEquals(row.getString(key),actual.getString(key))
                assertEquals(row.getDouble("riskScore"),actual.getDouble("riskScore"),1e-12)
            }
            val tsv=Core.call("session_export",json("session" to session)) as String
            assertEquals(wanted.size,Core.obj("import_results",json("content" to tsv,"fileName" to "sample.tsv")).getJSONArray("results").length())
        } finally { Core.call("session_close",json("session" to session)) }
    }
}
