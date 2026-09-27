/** Scoped review operations for an explicitly saved batch. Never reads credentials aloud. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { config } from 'dotenv';
import { getDb } from '../../lib/mongodb';
import { runPerQuestionValidations, hasBlockingIssue } from '../../lib/variant-review-validators';
import { recordReviewLogFromClaudeCode } from '../../lib/generated-question-review-cc';
process.env.DOTENV_CONFIG_QUIET = 'true'; config({path:'.env'}); config({path:'.env.local'});
const hash = (x:unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function main() {
 const [mode,batch,input,output] = process.argv.slice(2); if(!batch || !output) throw Error('mode batch input output required');
 const saved=JSON.parse(fs.readFileSync(path.join(batch,'save-result.json'),'utf8')).results;
 const ids=saved.filter((x:any)=>x.ok).map((x:any)=>x.inserted_id);
 const db=await getDb('gomijoshua'); const col=db.collection('generated_questions');
 if(mode==='snapshot') {
  const docs=await col.find({_id:{$in:ids.map((x:string)=>new ObjectId(x))}}).toArray();
  fs.writeFileSync(output,JSON.stringify(docs.map(d=>({id:String(d._id),passage_id:String(d.passage_id),source:d.source,textbook:d.textbook,type:d.type,status:d.status,ai_source:d.ai_source,question_data:d.question_data,hash:hash(d.question_data)})),null,2)+'\n');
  console.log(`Scoped snapshot: ${docs.length}`); return;
 }
 const decisions=JSON.parse(fs.readFileSync(input,'utf8')); const results=[];
 for(const d of decisions) {
  if(!ids.includes(d.id)) throw Error('ID outside batch');
  const doc=await col.findOne({_id:new ObjectId(d.id)});
  if(!doc || doc.status!=='대기' || hash(doc.question_data)!==d.before_hash) throw Error('State changed; take new snapshot');
  if(mode==='patch') {
   const candidate={...doc,question_data:d.question_data}; const issues=await runPerQuestionValidations(db,candidate);
   if(hasBlockingIssue(issues)) throw Error('Patch validation failed');
   fs.writeFileSync(output+'.backup-'+d.id+'.json',JSON.stringify({id:d.id,question_data:doc.question_data},null,2)+'\n',{flag:'wx'});
   const r=await col.updateOne({_id:doc._id,status:'대기',question_data:doc.question_data},{$set:{question_data:d.question_data,updated_at:new Date(),ai_source:'local-qwen-codex-edited'}});
   results.push({id:d.id,modified:r.modifiedCount,issues}); if(r.modifiedCount!==1) throw Error('Concurrent patch');
  } else if(mode==='record') {
   if(d.verdict!=='pass' || !d.answer || !d.reason) throw Error('Explicit solved answer and reason required');
   const r=await recordReviewLogFromClaudeCode({generated_question_id:d.id,claude_answer:d.answer,claude_response:d.reason,model:'Codex-AI-production-review',admin_login_id:null,attemptNumber:1});
   results.push(r); fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
   if(!r.ok || !r.is_correct || !r.status_updated_to_complete) throw Error('Review did not complete; stop');
  } else throw Error('Unknown mode');
 }
 fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n'); console.log(`${mode}: ${results.length}`);
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Scoped batch operation failed; inspect recorded results before retrying');process.exit(1)});
