package com.monadicdna.explorer

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID
import androidx.compose.runtime.snapshots.Snapshot

/** Two simulated devices share a sync key (as Block Store would) and a stand-in for the user's Google Drive. */
class SyncTest {
    /** An in-memory stand-in for the user's Google Drive app data, shared by two simulated devices. */
    private class FakeCloud: SyncCloud {
        val records=mutableMapOf<String,Pair<Long,String>>()
        override suspend fun list()=synchronized(this){records.map{(record,value)->CloudRecord(record,value.first)}}
        override suspend fun read(records: List<String>)=synchronized(this){records.mapNotNull{name->this.records[name]?.let{CloudRecord(name,it.first,it.second)}}}
        override suspend fun write(record: String, baseRevision: Long, ciphertext: String): Long=synchronized(this){
            val current=records[record]?.first?:0
            if(baseRevision!=current) throw SyncConflict()
            records[record]=(current+1) to ciphertext;current+1
        }
        override suspend fun deleteAll(){synchronized(this){records.clear()}}
    }
    private fun waitFor(timeoutMs:Long,state:()->String={""},condition:()->Boolean){
        val end=System.currentTimeMillis()+timeoutMs
        while(!condition()){check(System.currentTimeMillis()<end){"Timed out. ${state()}"};Thread.sleep(200)}
    }
    private fun onMain(block:()->Unit)=InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    // Without a Compose UI in this test, deliver state-change notifications the way a frame would.
    private fun edit(block:()->Unit)=onMain{block();Snapshot.sendApplyNotifications()}

    @Test fun aNewDeviceFillsInAndEditsToDifferentFieldsMerge() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val app=context.applicationContext as android.app.Application
        val sync=FakeCloud()
        val keys=TestSyncKeys()
        val dirs=listOf(File(context.cacheDir,"sync-a-${UUID.randomUUID()}"),File(context.cacheDir,"sync-b-${UUID.randomUUID()}"))
        fun device(dir:File):ExplorerModel{lateinit var model:ExplorerModel;onMain{model=ExplorerModel(app,SecureDataVault(context,TestVaultProtector(),dir),keys,sync).apply{authenticate={};acceptedDisclaimer=true}};return model}
        try {
            val a=device(dirs[0])
            onMain{a.run("Import"){a.importGenotypeData("# 23andMe\nrs4129267 2 100 TT\nrs7298766 12 100 AG\nrs2281727 17 100 GG\n".toByteArray(),"genome.txt")}}
            waitFor(120000){!a.busy}
            assertNull(a.error);assertTrue("the bundled catalog matched",a.resultCount>0)
            edit{a.profileFields["age"]="40"}
            waitFor(60000,{"records=${sync.records.keys} syncing=${a.syncing} enabled=${a.syncEnabled} message=${a.syncMessage} error=${a.error} age=${a.profileFields["age"]}"}){!a.syncing && sync.records.keys.containsAll(listOf("genotype","results","customization"))}

            // A new device with its own local key restores everything without running the catalog match.
            val b=device(dirs[1])
            waitFor(10000){b.restorable}
            onMain{b.unlockSavedData()}
            waitFor(60000){b.dataUnlocked && b.metadata.optInt("count")==3 && b.resultCount==a.resultCount && b.profileFields["age"]=="40"}

            // Edits to different fields on each device are both kept.
            edit{a.profileFields["age"]="41"}
            waitFor(30000){sync.records["customization"]?.first==2L && !a.syncing}
            edit{b.profileFields["diet"]="vegetarian"}
            waitFor(60000){b.profileFields["age"]=="41" && sync.records["customization"]?.first==3L && !b.syncing}
            onMain{a.lockData()};waitFor(30000){!a.dataUnlocked}
            onMain{a.unlockSavedData()}
            waitFor(60000){a.dataUnlocked && a.profileFields["diet"]=="vegetarian" && a.profileFields["age"]=="41"}

            // Turning sync off deletes the cloud copy and keeps local data.
            onMain{a.setSync(false)};waitFor(30000){!a.busy}
            assertTrue(sync.records.isEmpty());assertNull(keys.key);assertEquals(3,a.metadata.optInt("count"))
            onMain{a.lockData();b.lockData()};waitFor(30000){!a.dataUnlocked&&!b.dataUnlocked}
        } finally { dirs.forEach{it.deleteRecursively()};DeviceStore(context).remove("sync-off") }
    }

}
