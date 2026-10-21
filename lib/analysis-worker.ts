import {coreCall} from './core';
import type {SavedResult} from './results-manager';
import type {GWASStudy} from './gwas-db';
export type AnalysisTask={studies:GWASStudy[];genotypes:Record<string,string>;now:string};
export type AnalysisReply={results?:SavedResult[];error?:string};
self.onmessage=(event:MessageEvent<AnalysisTask>)=>{
  try{self.postMessage({results:coreCall<SavedResult[]>('analyze_studies',{...event.data,strict:true})} satisfies AnalysisReply);}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'Analysis failed'} satisfies AnalysisReply);}
};
