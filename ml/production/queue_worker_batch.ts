/** Scoped worker queue submission/export; no model calls, question saves, or review writes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from '../../scripts/_cli-env';
import { getDb } from '../../lib/mongodb';
import { enqueueLocalVariantJob, LOCAL_VARIANT_JOBS_COLLECTION, getLocalWorkerStatus, type LocalVariantJobDoc } from '../../lib/local-variant-jobs';
import { resolveLocalVariantType } from '../../lib/local-variant-types';
loadCliEnv(process.cwd());
const [mode, folder] = process.argv.slice(2);
if (!['check', 'enqueue', 'snapshot'].includes(mode) || !folder) throw new Error('Usage: check|enqueue|snapshot <batch-dir>');
const dir = path.resolve(folder);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const prefix = `production:${manifest.batch_id}:`;
const write = (name: string, value: unknown) => { const f = path.join(dir,name); fs.writeFileSync(f+'.tmp', JSON.stringify(value,null,2)+'\n'); fs.renameSync(f+'.tmp',f); };
async function main() {
 const db = await getDb('gomijoshua');
 const jobs = db.collection<LocalVariantJobDoc>(LOCAL_VARIANT_JOBS_COLLECTION);
 const tags = manifest.slots.map((s: any) => prefix+s.key);
 if (tags.length < 1 || tags.length > 100 || new Set(tags).size !== tags.length) throw new Error('Invalid batch size/duplicate slot');
 if (mode === 'snapshot') {
  const rows = await jobs.find({requested_by:{$in:tags}}).sort({created_at:1}).toArray();
  const counts: Record<string,number>={}; for(const r of rows) counts[r.status]=(counts[r.status]||0)+1;
  write('job-results.json',{at:new Date().toISOString(),counts,jobs:rows});
  console.log(JSON.stringify({batch:manifest.batch_id,counts,worker:await getLocalWorkerStatus(db)}));return;
 }
 const worker=await getLocalWorkerStatus(db);
 if(!worker.workers.some(w=>w.online && !w.fake)) throw new Error('No live real worker');
 const checks=[];
 for (const s of manifest.slots) {
  const type=resolveLocalVariantType(s.type); if(!type||s.textbook!==manifest.textbook)throw new Error('Invalid scope');
  const passageId=new ObjectId(s.passage_id);
  const p=await db.collection('passages').findOne({_id:passageId},{projection:{textbook:1,'content.original':1}});
  const original=p?.content?.original?.trim();
  if(p?.textbook!==s.textbook || original!==s.paragraph || crypto.createHash('sha256').update(original).digest('hex')!==s.paragraph_sha256)throw new Error('Source changed');
  // This first batch is restricted to genuinely empty slots, regardless of stored status.
  const stored=await db.collection('generated_questions').countDocuments({passage_id:{$in:[passageId,s.passage_id]},type:s.type});
  const own=await jobs.findOne({requested_by:prefix+s.key});
  const other=await jobs.findOne({passage_id:passageId,type,requested_by:{$ne:prefix+s.key},status:{$in:['queued','running','done']},saved_question_id:{$exists:false}});
  if(stored||other)throw new Error(`Slot no longer empty: ${s.key}`);
  checks.push({key:s.key,existing_job:own?String(own._id):null});
 }
 write('queue-preflight.json',{at:new Date().toISOString(),checks});
 if(mode==='check'){console.log(JSON.stringify({ok:true,slots:checks.length}));return;}
 const lock=path.join(dir,'.enqueue.lock');const fd=fs.openSync(lock,'wx');
 try{
  const ids=[];
  for(const s of manifest.slots){
   const tag=prefix+s.key;
   // Stable per-slot tag recovers a crash after DB insert but before the local receipt.
   let job=await jobs.findOne({requested_by:tag});
   if(!job)job=await enqueueLocalVariantJob(db,{type:resolveLocalVariantType(s.type)!,passageId:new ObjectId(s.passage_id),textbook:s.textbook,source:s.source,paragraph:s.paragraph,requestedBy:tag});
   ids.push({key:s.key,job_id:String(job._id)});write('queue-receipts.json',ids);
  }
  console.log(JSON.stringify({batch:manifest.batch_id,registered:ids.length}));
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e instanceof Error && !/mongodb|password|uri/i.test(e.message)?e.message:'Batch operation failed; inspect scoped receipts before retry');process.exit(1)});
