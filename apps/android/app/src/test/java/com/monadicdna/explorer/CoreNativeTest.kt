package com.monadicdna.explorer

import org.junit.Assert.*
import org.junit.Test

/** Runs generated Kotlin UniFFI against the host Rust library, not a mock. */
class CoreNativeTest {
    @Test fun parsesGenotypesAndScoresWithRust() {
        val parsed=Core.obj("parse_genotype",json("content" to "# 23andMe\nrs1 1 100 AG"))
        assertEquals(1,parsed.getInt("validVariants"))
        val risk=Core.obj("risk_score",json("genotype" to "AA","riskAllele" to "rs1-A","effectSize" to "1.5","effectType" to "OR"))
        assertEquals(2.25,risk.getDouble("score"),0.0)
    }
    @Test fun invalidOperationsAreRecoverableErrors() {
        try { Core.call("unknown-operation");fail("Expected an error") } catch(expected:IllegalStateException) { assertTrue(expected.message!!.contains("Unknown")) }
        assertEquals(1,Core.obj("version").getInt("protocol"))
    }
}
