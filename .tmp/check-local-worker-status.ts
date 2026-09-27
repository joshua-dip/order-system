import { config } from 'dotenv';
import { getDb } from '../lib/mongodb';
import { getLocalWorkerStatus } from '../lib/local-variant-jobs';
process.env.DOTENV_CONFIG_QUIET='true';
config({path:'.env'}); config({path:'.env.local'});
async function main(){ const r=await getLocalWorkerStatus(await getDb('gomijoshua')); console.log(JSON.stringify(r)); }
main().then(()=>process.exit(0)).catch(()=>{console.error('Worker status lookup failed');process.exit(1)});
