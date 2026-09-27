import fs from 'node:fs';
import {ObjectId} from 'mongodb';
import {getDb} from '../lib/mongodb';
import {loadCliEnv} from '../scripts/_cli-env';
import {markLocalJobSaved,getLocalVariantJob} from '../lib/local-variant-jobs';
loadCliEnv(process.cwd());
const dir='ml/production/batches/2026-09-27-jun23-go1-worker-02/';
async function main(){
 const db=await getDb('gomijoshua');
 const result=JSON.parse(fs.readFileSync(dir+'pending-save-results.json','utf8'));
 const map=JSON.parse(fs.readFileSync(dir+'pending-save-map.json','utf8'));
 const linked=[];
 for(const r of result.results){
  const id=r.inserted_id||r.existing_id;if(!id)continue;
  const m=map[r.index];if(!m)throw new Error('Missing index');
  const q=await db.collection('generated_questions').findOne({_id:new ObjectId(id)},{projection:{_id:1,serialNo:1,status:1,source:1,type:1,textbook:1}});
  const job=await getLocalVariantJob(db,new ObjectId(m.job_id));
  if(!q||!job||q.type!==job.type||q.textbook!==job.textbook)throw new Error('Saved identity mismatch');
  if(job.saved_question_id&&String(job.saved_question_id)!==id)throw new Error('Conflicting saved ID');
  if(!job.saved_question_id && !await markLocalJobSaved(db,m.job_id,new ObjectId(id)))throw new Error('Link failed');
  linked.push({...q,job_id:m.job_id});
 }
 fs.writeFileSync(dir+'pending-saved-snapshot.json',JSON.stringify(linked,null,2)+'\n');
 const states:Record<string,number>={};for(const q of linked)states[q.status]=(states[q.status]||0)+1;
 console.log(JSON.stringify({linked:linked.length,states,serialMin:Math.min(...linked.map(q=>q.serialNo)),serialMax:Math.max(...linked.map(q=>q.serialNo))}));
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Scoped linkage failed; inspect receipts, do not resave');process.exit(1)});
