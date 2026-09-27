import fs from 'node:fs';
import {loadCliEnv} from '../scripts/_cli-env';
import {getDb} from '../lib/mongodb';
loadCliEnv(process.cwd());
async function main(){const db=await getDb('gomijoshua');const rows=await db.collection('local_variant_workers').find({_id:'MacBook-Pro.local'},{projection:{_id:1,backend:1,base_model:1,reasoner:1,started_at:1,last_seen:1,pid:1,version:1,types:1}}).toArray();fs.writeFileSync('ml/production/batches/2026-09-27-jun23-go1-worker-02/worker-models.json',JSON.stringify({captured_at:new Date().toISOString(),workers:rows},null,2));console.log('Worker model metadata captured');}
main().then(()=>process.exit(0)).catch(()=>process.exit(1));
