package com.monadicdna.explorer

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant

/**
 * Reads Apple Health-style metrics from Health Connect and formats 30-day aggregates for LLM prompts.
 * Only aggregates ever leave the device, and only inside the existing share-with-provider consent.
 */
class HealthData(private val context: Context) {

    val permissions = setOf(
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(BloodPressureRecord::class),
    )

    fun available() = HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    fun permissionContract() = androidx.health.connect.client.contracts.HealthPermissionsRequestContract()

    suspend fun granted(): Boolean {
        if (!available()) return false
        return HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions().containsAll(permissions)
    }

    /** A metric's categories drive which prompts include it. */
    private data class Metric(val text: String, val categories: Set<String>)

    private suspend inline fun <reified T : androidx.health.connect.client.records.Record> read(client: HealthConnectClient, range: TimeRangeFilter) =
        client.readRecords(ReadRecordsRequest(T::class, range)).records

    /** Formats the aggregates as a prompt block, filtered to metrics relevant to the requested categories. */
    suspend fun promptBlock(categories: Set<String>): String {
        if (!granted()) return ""
        val client = HealthConnectClient.getOrCreate(context)
        val range = TimeRangeFilter.between(Instant.now().minus(Duration.ofDays(30)), Instant.now())
        val metrics = mutableListOf<Metric>()
        val resting = read<RestingHeartRateRecord>(client,range)
        if (resting.size >= 7) metrics += Metric("resting heart rate %.0f bpm".format(resting.map { it.beatsPerMinute }.average()), setOf("cardiovascular"))
        val hrv = read<HeartRateVariabilityRmssdRecord>(client,range)
        if (hrv.size >= 7) metrics += Metric("heart rate variability %.0f ms".format(hrv.map { it.heartRateVariabilityMillis }.average()), setOf("cardiovascular", "sleep"))
        val pressure = read<BloodPressureRecord>(client,range)
        pressure.maxByOrNull { it.time }?.let { latest ->
            if (pressure.size >= 3) metrics += Metric("latest blood pressure %.0f/%.0f mmHg".format(latest.systolic.inMillimetersOfMercury, latest.diastolic.inMillimetersOfMercury), setOf("cardiovascular"))
        }
        val sleep = read<SleepSessionRecord>(client,range)
        if (sleep.size >= 7) {
            val hours = sleep.map { Duration.between(it.startTime, it.endTime).toMinutes() / 60.0 }.average()
            metrics += Metric("sleep %.1f hours per night".format(hours), setOf("sleep"))
        }
        val steps = read<StepsRecord>(client,range)
        if (steps.size >= 7) metrics += Metric("%,d steps per day".format(steps.groupBy { it.startTime.atZone(it.startZoneOffset).toLocalDate() }.values.map { day -> day.sumOf { it.count } }.average().toInt()), setOf("activity", "metabolic"))
        val weight = read<WeightRecord>(client,range)
        weight.maxByOrNull { it.time }?.let { latest ->
            if (weight.size >= 2) metrics += Metric("latest weight %.1f kg".format(latest.weight.inKilograms), setOf("metabolic"))
        }

        if (metrics.isEmpty()) return ""
        // Relevant metrics first; fall back to the vitals summary when nothing matches the request.
        val relevant = metrics.filter { it.categories.any { c -> c in categories } }
        val chosen = (relevant.ifEmpty { metrics.filter { "cardiovascular" in it.categories || "sleep" in it.categories || "metabolic" in it.categories } }).take(5)
        if (chosen.isEmpty()) return ""
        return "Recent health measurements from the user's device (30-day aggregates): " +
            chosen.joinToString("; ") { it.text } +
            ". Correlate these with the genetic findings where relevant, without treating either as causal."
    }
}
