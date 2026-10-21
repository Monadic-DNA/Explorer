import {coreCall} from './core';
import type {AnalysisTask,AnalysisReply} from './analysis-worker';
import type {GWASStudy} from './gwas-db';
import type {SavedResult} from './results-manager';

type Slot={worker:Worker|null;busy:boolean};
/** Bounded workers with small, task-specific genotype subsets, never a genome copy per worker. */
export class AnalysisPool {
  readonly concurrency:number;
  private slots:Slot[]=[];
  private waiters:Array<()=>void>=[];
  constructor(){
    const nav=typeof navigator==='undefined'?undefined:navigator as Navigator & {deviceMemory?:number};
    this.concurrency=typeof Worker==='undefined'?1:Math.max(1,Math.min(4,(nav?.hardwareConcurrency||2)-1,(nav?.deviceMemory||8)<=4?2:4));
    for(let i=0;i<this.concurrency;i++){
      let worker:Worker|null=null;
      try{if(typeof Worker!=='undefined')worker=new Worker(new URL('./analysis-worker.ts',import.meta.url),{type:'module'});}catch{/* Restricted browsers use the identical core on the main thread. */}
      this.slots.push({worker,busy:false});
    }
  }
  async analyze(studies:GWASStudy[],genotypeData:Map<string,string>,now:string):Promise<SavedResult[]> {
    while(this.slots.every(slot=>slot.busy))await new Promise<void>(resolve=>this.waiters.push(resolve));
    const slot=this.slots.find(slot=>!slot.busy)!;slot.busy=true;
    try {
      const genotypes:Record<string,string>={};
      for(const study of studies){const id=(study.strongest_snp_risk_allele||'').split('-')[0];const gt=genotypeData.get(id);if(gt)genotypes[id]=gt;}
      const task:AnalysisTask={studies,genotypes,now};
      if(!slot.worker){await new Promise(resolve=>setTimeout(resolve,0));return coreCall<SavedResult[]>('analyze_studies',{...task,strict:true});}
      return await new Promise<SavedResult[]>((resolve,reject)=>{
        const worker=slot.worker!;
        worker.onmessage=(event:MessageEvent<AnalysisReply>)=>{worker.onmessage=null;worker.onerror=null;if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.results||[]);};
        worker.onerror=(event)=>{
          event.preventDefault();console.warn('[Run All] Background worker unavailable; using the shared scorer locally.');
          worker.terminate();slot.worker=null;
          try{resolve(coreCall<SavedResult[]>('analyze_studies',{...task,strict:true}));}catch(error){reject(error);}
        };
        worker.postMessage(task);
      });
    }finally{slot.busy=false;this.waiters.shift()?.();}
  }
  close(){for(const slot of this.slots)slot.worker?.terminate();this.slots=[];}
}
