import Foundation
import HealthKit

/**
 * Reads metrics from Apple Health and formats 30-day aggregates for LLM prompts.
 * Only aggregates ever leave the device, and only inside the existing share-with-provider consent.
 */
final class HealthData{
    private let store=HKHealthStore()

    private let restingType=HKQuantityType.quantityType(forIdentifier:.restingHeartRate)!
    private let hrvType=HKQuantityType.quantityType(forIdentifier:.heartRateVariabilitySDNN)!
    private let systolicType=HKQuantityType.quantityType(forIdentifier:.bloodPressureSystolic)!
    private let diastolicType=HKQuantityType.quantityType(forIdentifier:.bloodPressureDiastolic)!
    private let stepType=HKQuantityType.quantityType(forIdentifier:.stepCount)!
    private let weightType=HKQuantityType.quantityType(forIdentifier:.bodyMass)!
    private let sleepType=HKCategoryType.categoryType(forIdentifier:.sleepAnalysis)!

    var available:Bool{HKHealthStore.isHealthDataAvailable()}

    private var readTypes:Set<HKObjectType>{[restingType,hrvType,systolicType,diastolicType,stepType,weightType,sleepType]}

    func authorize() async -> Bool{
        guard available else{return false}
        do{try await store.requestAuthorization(toShare:[],read:readTypes);return true}catch{return false}
    }

    /** A metric's categories drive which prompts include it. */
    private struct Metric{let text:String;let categories:Set<String>}

    private var monthAgo:Date{Calendar.current.date(byAdding:.day,value:-30,to:Date())!}

    /** Average of a quantity type over 30 days, plus the number of sampled days. */
    private func average(_ type:HKQuantityType,unit:HKUnit) async -> (Double,Int)?{
        let predicate=HKQuery.predicateForSamples(withStart:monthAgo,end:Date())
        return await withCheckedContinuation{continuation in
            let query=HKSampleQuery(sampleType:type,predicate:predicate,limit:HKObjectQueryNoLimit,sortDescriptors:nil){_,samples,_ in
                let quantities=(samples as? [HKQuantitySample]) ?? []
                guard !quantities.isEmpty else{continuation.resume(returning:nil);return}
                let days=Set(quantities.map{Calendar.current.startOfDay(for:$0.startDate)}).count
                let avg=quantities.map{$0.quantity.doubleValue(for:unit)}.reduce(0,+)/Double(quantities.count)
                continuation.resume(returning:(avg,days))
            }
            store.execute(query)
        }
    }

    private func latest(_ type:HKQuantityType,unit:HKUnit) async -> (Double,Int)?{
        let predicate=HKQuery.predicateForSamples(withStart:monthAgo,end:Date())
        let sort=NSSortDescriptor(key:HKSampleSortIdentifierStartDate,ascending:false)
        return await withCheckedContinuation{continuation in
            let query=HKSampleQuery(sampleType:type,predicate:predicate,limit:50,sortDescriptors:[sort]){_,samples,_ in
                let quantities=(samples as? [HKQuantitySample]) ?? []
                guard let first=quantities.first else{continuation.resume(returning:nil);return}
                let days=Set(quantities.map{Calendar.current.startOfDay(for:$0.startDate)}).count
                continuation.resume(returning:(first.quantity.doubleValue(for:unit),days))
            }
            store.execute(query)
        }
    }

    private func sleepHours() async -> (Double,Int)?{
        let predicate=HKQuery.predicateForSamples(withStart:monthAgo,end:Date())
        return await withCheckedContinuation{continuation in
            let query=HKSampleQuery(sampleType:sleepType,predicate:predicate,limit:HKObjectQueryNoLimit,sortDescriptors:nil){_,samples,_ in
                let asleep=(samples as? [HKCategorySample]) ?? []
                let sessions=asleep.filter{$0.value==HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue || $0.value>=HKCategoryValueSleepAnalysis.asleepCore.rawValue}
                let nights=Set(sessions.map{Calendar.current.startOfDay(for:$0.endDate)}).count
                guard nights>=7 else{continuation.resume(returning:nil);return}
                let hours=sessions.map{$0.endDate.timeIntervalSince($0.startDate)/3600}.reduce(0,+)/Double(nights)
                continuation.resume(returning:(hours,nights))
            }
            store.execute(query)
        }
    }

    /** Formats the aggregates as a prompt block, filtered to metrics relevant to the requested categories. */
    func promptBlock(categories:Set<String>) async -> String{
        guard available else{return ""}
        var metrics:[Metric]=[]
        if let (avg,days)=await average(restingType,unit:HKUnit(from:"count/min")),days>=7{metrics.append(Metric(text:String(format:"resting heart rate %.0f bpm",avg),categories:["cardiovascular"]))}
        if let (avg,days)=await average(hrvType,unit:HKUnit.secondUnit(with:.milli)),days>=7{metrics.append(Metric(text:String(format:"heart rate variability %.0f ms",avg),categories:["cardiovascular","sleep"]))}
        if let (sys,d1)=await latest(systolicType,unit:.millimeterOfMercury()),let (dia,_)=await latest(diastolicType,unit:.millimeterOfMercury()),d1>=3{metrics.append(Metric(text:String(format:"latest blood pressure %.0f/%.0f mmHg",sys,dia),categories:["cardiovascular"]))}
        if let (hours,_)=await sleepHours(){metrics.append(Metric(text:String(format:"sleep %.1f hours per night",hours),categories:["sleep"]))}
        if let (avg,days)=await average(stepType,unit:.count()),days>=7{metrics.append(Metric(text:String(format:"%,d steps per day",Int(avg)),categories:["activity","metabolic"]))}
        if let (kg,days)=await latest(weightType,unit:.gramUnit(with:.kilo)),days>=2{metrics.append(Metric(text:String(format:"latest weight %.1f kg",kg),categories:["metabolic"]))}

        if metrics.isEmpty{return ""}
        // Relevant metrics first; fall back to the vitals summary when nothing matches the request.
        let relevant=metrics.filter{!$0.categories.isDisjoint(with:categories)}
        let chosen=Array((relevant.isEmpty ? metrics.filter{!$0.categories.isDisjoint(with:["cardiovascular","sleep","metabolic"])} : relevant).prefix(5))
        if chosen.isEmpty{return ""}
        return "Recent health measurements from the user's device (30-day aggregates): "
            + chosen.map{$0.text}.joined(separator:"; ")
            + ". Correlate these with the genetic findings where relevant, without treating either as causal."
    }
}
